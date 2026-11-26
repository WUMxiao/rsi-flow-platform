// 本地检索：纯字符串/词频，零模型调用。
// 为什么不是"逐块喂模型预筛"：网关每次调用有 4.4k token 固定开销，
// 200 块 × 4.4k = 88 万 token/条，直接崩掉预算（见方案 §10.3①）。
//
// 打分：按块的词命中数加权，权重用 log(1 + N/df) 近似 IDF，
// 再按 df 过滤掉"几乎每块都有"的噪声词（这类词对定位毫无帮助）。
import type { RawChunk } from './chunk.ts';

const CJK = /[\u4e00-\u9fa5]/;

/** 高频虚词/疑问词：单独出现没有定位价值 */
const STOP_TERMS = new Set([
  '什么', '怎么', '如何', '多少', '几个', '哪些', '是否', '请问', '文中', '一下', '这个', '那个',
  '可以', '一个', '一共', '故事', '问题', '他们', '我们', '你们', '自己', '没有', '不是', '就是',
  '因为', '所以', '但是', '如果', '然后', '现在', '时候', '为什么', '什么样',
  'the', 'and', 'for', 'with', 'that', 'this', 'was', 'were', 'are', 'has', 'have', 'had',
  'his', 'her', 'their', 'its', 'which', 'what', 'who', 'whom', 'how', 'why', 'when', 'where',
  'does', 'did', 'can', 'could', 'would', 'should', 'there', 'from', 'into', 'about', 'name',
]);

export interface TermSet {
  /** 强锚点：UUID / 引号内文本 / 长数字串 —— 命中基本等于定位成功 */
  anchors: string[];
  /** 普通检索词（英文词 + 中文 n-gram） */
  terms: string[];
}

export function extractTerms(question: string): TermSet {
  const q = question ?? '';
  const anchors: string[] = [];

  for (const m of q.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)) {
    anchors.push(m[0]);
  }
  for (const m of q.matchAll(/["“]([^"”]{2,80})["”]/g)) {
    anchors.push(m[1]);
  }
  for (const m of q.matchAll(/\b\d{5,}\b/g)) {
    anchors.push(m[0]);
  }

  const terms = new Set<string>();

  // 英文词（>=3 字符，去停用词）—— 门槛放低到 3，像 key/age 这类短词也是有效锚点
  for (const m of q.matchAll(/[A-Za-z][A-Za-z'-]{2,}/g)) {
    const w = m[0].toLowerCase();
    if (!STOP_TERMS.has(w)) terms.add(w);
  }

  // 中文：按标点切段，再取 2~4 字 n-gram（"姓夏"这种恰好是 2 字，能命中）
  for (const seg of q.split(/[^\u4e00-\u9fa5]+/)) {
    if (seg.length < 2) continue;
    for (let n = 2; n <= Math.min(4, seg.length); n += 1) {
      for (let i = 0; i + n <= seg.length; i += 1) {
        const g = seg.slice(i, i + n);
        if (!STOP_TERMS.has(g)) terms.add(g);
      }
    }
  }

  return { anchors: dedupe(anchors), terms: dedupe([...terms]) };
}

export function dedupe(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))];
}

export interface ScoredChunk {
  chunk: RawChunk;
  score: number;
  hits: string[];
}

/**
 * 叙事位置先验："故事开头/结尾"类问题，答案通常在文档两端。
 * 这是纯字符串规则（L0），但它解决的是语义问题——实测 IB-09 的 golden 在 0.1% 处、
 * IB-04 在 0.7% 处，纯词频检索永远够不到。
 */
export type PriorKind = 'start' | 'end' | 'none';

const START_CUES = /at the (start|beginning)|start of (his|her|the)|beginn?ing|一开始|最初|开头|起初|重新开始|重生|from the beginning/i;
const END_CUES = /at the (end|last)|in the end|finally|最后|结局|结尾|最终/i;

export function detectPrior(question: string): PriorKind {
  if (START_CUES.test(question)) return 'start';
  if (END_CUES.test(question)) return 'end';
  return 'none';
}

export function priorMultiplier(rel: number, kind: PriorKind): number {
  if (kind === 'start' && rel <= 0.15) return 1 + 2 * (1 - rel / 0.15);
  if (kind === 'end' && rel >= 0.85) return 1 + 2 * ((rel - 0.85) / 0.15);
  return 1;
}

/**
 * @param chunks 全部块
 * @param terms 检索词（anchors 已并入）
 * @param k 取前 k 块
 */
export function retrieve(
  chunks: RawChunk[],
  terms: string[],
  k: number,
  opts: { prior?: PriorKind; totalChars?: number } = {},
): ScoredChunk[] {
  const N = chunks.length;
  if (!N) return [];
  const clean = dedupe(terms.map((t) => t.trim()).filter((t) => t.length >= 2 || CJK.test(t)));
  if (!clean.length) return [];

  // 文档频率：出现在多少块里
  const df = new Map<string, number>();
  for (const t of clean) {
    const lower = t.toLowerCase();
    let n = 0;
    for (const c of chunks) if (c.text.toLowerCase().includes(lower)) n += 1;
    df.set(t, n);
  }

  // 噪声过滤：超过一半块都含的，视为无区分度
  const useful = clean.filter((t) => {
    const n = df.get(t) ?? 0;
    return n > 0 && n <= Math.max(2, Math.floor(N * 0.5));
  });
  if (!useful.length) return [];

  const weight = (t: string) => Math.log(1 + N / Math.max(1, df.get(t) ?? 1));
  const total = opts.totalChars ?? chunks[chunks.length - 1].end;
  const prior = opts.prior ?? 'none';

  const scored: ScoredChunk[] = chunks.map((c) => {
    const hay = c.text.toLowerCase();
    let score = 0;
    const hits: string[] = [];
    for (const t of useful) {
      const lower = t.toLowerCase();
      let idx = hay.indexOf(lower);
      if (idx < 0) continue;
      let count = 0;
      while (idx >= 0 && count < 5) {
        count += 1;
        idx = hay.indexOf(lower, idx + lower.length);
      }
      score += weight(t) * Math.min(count, 3);
      hits.push(t);
    }
    const rel = ((c.start + c.end) / 2) / Math.max(1, total);
    score *= priorMultiplier(rel, prior);
    return { chunk: c, score, hits };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.start - b.chunk.start)
    .slice(0, k);
}

/** 命中率自检：gold 是否出现在前 n 块里（S3 验收硬指标，大小写不敏感） */
export function hitRankTexts(texts: string[], gold: string[], limit = 3): number {
  const gs = gold.map((g) => g.trim().toLowerCase()).filter((g) => g.length >= 2);
  if (!gs.length) return -1;
  for (let i = 0; i < Math.min(limit, texts.length); i += 1) {
    const hay = texts[i].toLowerCase();
    if (gs.some((g) => hay.includes(g))) return i + 1;
  }
  return 0;
}

/**
 * 软命中：gold 里某个较长的词出现在前 n 块。
 * 长答案（整句 / 摘要）不可能逐字出现在块里，硬判定一定 MISS，软命中用来区分
 * "检索没找到" 和 "找到了但答案需要改写"。
 */
export function softHitRank(texts: string[], gold: string[], limit = 3): number {
  const tokens = gold
    .join(' ')
    .split(/[^A-Za-z0-9\u4e00-\u9fa5]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 5);
  if (!tokens.length) return -1;
  for (let i = 0; i < Math.min(limit, texts.length); i += 1) {
    const hay = texts[i].toLowerCase();
    if (tokens.some((t) => hay.includes(t))) return i + 1;
  }
  return 0;
}

/** 零命中兜底：均匀取样，保证下游还有东西可读（会标注 fallback） */
export function uniformSample<T>(items: T[], k: number): T[] {
  if (!items.length || k <= 0) return [];
  if (items.length <= k) return [...items];
  const step = items.length / k;
  const out: T[] = [];
  for (let i = 0; i < k; i += 1) out.push(items[Math.min(items.length - 1, Math.floor(i * step))]);
  return out;
}

export function hitRank(chunks: ScoredChunk[], gold: string[], limit = 3): number {
  return hitRankTexts(chunks.map((c) => c.chunk.text), gold, limit);
}
