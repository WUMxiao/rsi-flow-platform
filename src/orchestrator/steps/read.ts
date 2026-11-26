// code.read：批量精读。
// 三个约束决定了实现形态：
//   1) 引擎同层串行 → 扇出只能写在节点内部（Promise.all）
//   2) 单次调用 ~36s + ~10k token 固定开销 → 必须批量，不能一块一调
//   3) 证据必须可回溯 → 要求模型给块号 + 逐字引用，节点内就地校验 quote 是否真在原文里
import { chunkText } from '../chunk.ts';
import { loadSamples } from '../dataset.ts';
import { MAX_SHARDS, READ_BATCH, READ_MAX_TOKENS, SHARD_SIZE } from '../env.ts';
import { chat, parseJsonLoose } from '../llm.ts';
import type { Contract } from '../types.ts';

export interface EvidenceItem {
  chunkId: string;
  quote: string;
  /** quote 是否在所属块里逐字出现（节点内即时校验，防止模型改写/编造） */
  verified: boolean;
}

export interface ReadChunkIn {
  id: string;
  text: string;
  start?: number;
  end?: number;
}

export interface ReadInput {
  chunks?: ReadChunkIn[];
  contract: Contract;
  question: string;
  issue?: { task: string; sampleId: string };
  stopAfterRead?: boolean;
}

export interface ReadOutput {
  evidence: EvidenceItem[];
  readTokens: number;
  drafts: string[];
}

/** 最近一次 readStep 的逐批调试信息（CLI 用；不进流程结果） */
export interface ReadBatchDebug {
  index: number;
  chunkIds: string[];
  parsedOk: boolean;
  rawHead: string;
  evidenceCount: number;
  error: string;
  draft: string;
}

let lastDebug: ReadBatchDebug[] = [];

export function lastReadDebug(): ReadBatchDebug[] {
  return lastDebug;
}

interface BatchJson {
  found?: boolean;
  answer?: string;
  evidence?: Array<{ chunkId?: string; quote?: string }>;
}

function pickBatches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function readBatch(batch: ReadChunkIn[], question: string, contract: Contract, index: number): Promise<{
  evidence: EvidenceItem[];
  draft: string;
  tokens: number;
  latencyMs: number;
  error: string;
  parsedOk: boolean;
  rawHead: string;
}> {
  const body = batch.map((c) => `<<${c.id}>>\n${c.text}`).join('\n\n');
  const t0 = Date.now();
  try {
    const res = await chat(
      [
        {
          role: 'system',
          content:
            '你是长文阅读器。只输出 JSON。证据必须是给定片段里的原文逐字复制，不得改写、不得推断、不得跨片段拼接。',
        },
        {
          role: 'user',
          content: [
            `问题：${question}`,
            `答案格式要求：${contract.answerFormat}，最多 ${contract.maxChars} 字符。`,
            '',
            '片段：',
            body,
            '',
            '请输出 JSON（找不到就 found=false、evidence 留空）：',
            '{"found":true,"answer":"最短答案","evidence":[{"chunkId":"c0","quote":"原文逐字片段"}]}',
          ].join('\n'),
        },
      ],
      { maxTokens: READ_MAX_TOKENS, temperature: 0 },
    );

    const parsed = parseJsonLoose<BatchJson>(res.text);
    const byId = new Map(batch.map((c) => [c.id, c.text]));
    const evidence: EvidenceItem[] = [];

    for (const item of parsed?.evidence ?? []) {
      const cid = String(item.chunkId ?? '');
      const quote = String(item.quote ?? '');
      if (!quote.trim()) continue;
      const source = byId.get(cid);
      // 块号必须来自本批；quote 必须逐字出现。两条都满足才算 verified。
      const verified = Boolean(source && source.includes(quote.trim()));
      evidence.push({ chunkId: cid, quote: quote.trim().slice(0, 600), verified });
    }

    return {
      evidence,
      draft: String(parsed?.answer ?? '').trim(),
      tokens: res.usage.promptTokens + res.usage.completionTokens,
      latencyMs: Date.now() - t0,
      error: parsed ? '' : 'JSON 解析失败',
      parsedOk: Boolean(parsed),
      rawHead: (res.text ?? '').slice(0, 300),
    };
  } catch (err) {
    return {
      evidence: [],
      draft: '',
      tokens: 0,
      latencyMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
      parsedOk: false,
      rawHead: '',
    };
  }
}

/** 计数/是否类问题：答案分散在全文，靠 5-6 个块必然答不准 */
export function isAggregateQuestion(q: string): boolean {
  return /几(个|次|位|人|条|年|种|回|名)|多少|是否|是不是|有没有|几次|哪些/.test(q ?? '');
}

async function extractShard(
  text: string,
  index: number,
  total: number,
  question: string,
  contract: Contract,
): Promise<{ evidence: EvidenceItem[]; draft: string; tokens: number }> {
  try {
    const res = await chat(
      [
        { role: 'system', content: '你在通读一篇超长文档的第若干片。只输出 JSON，摘录必须是本片原文逐字复制。' },
        {
          role: 'user',
          content: [
            `问题：${question}`,
            `这是全文的第 ${index + 1}/${total} 片。`,
            '任务：只摘录本片中与问题直接相关的原文（逐字）。',
            '如果是“几个/几次/是否”这类计数或判断问题，请写明本片中出现了几次、或有无相关描述。',
            '本片没有相关内容就返回 {"found":false,"evidence":[]}。',
            '',
            text.slice(0, 30000),
            '',
            '输出：{"found":true,"note":"本片相关情况（计数/有无）","evidence":[{"chunkId":"s' + index + '","quote":"原文逐字片段"}]}',
          ].join('\n'),
        },
      ],
      { maxTokens: 300, temperature: 0 },
    );
    const parsed = parseJsonLoose<{ found?: boolean; note?: string; evidence?: Array<{ quote?: string }> }>(res.text);
    const evidence: EvidenceItem[] = [];
    for (const e of parsed?.evidence ?? []) {
      const quote = String(e.quote ?? '').trim();
      if (!quote) continue;
      evidence.push({ chunkId: `s${index}`, quote: quote.slice(0, 600), verified: text.includes(quote) });
    }
    return { evidence, draft: String(parsed?.note ?? '').trim(), tokens: res.usage.promptTokens + res.usage.completionTokens };
  } catch {
    return { evidence: [], draft: '', tokens: 0 };
  }
}

/** 升级路径：把全文切片、并行抽取、合并（真正的"对文档扇出"） */
async function escalate(
  issue: { task: string; sampleId: string },
  question: string,
  contract: Contract,
): Promise<{ evidence: EvidenceItem[]; drafts: string[]; tokens: number; shards: number; capped: boolean }> {
  const samples = await loadSamples(issue.task, [issue.sampleId]);
  const sample = samples.get(String(issue.sampleId));
  if (!sample) return { evidence: [], drafts: [], tokens: 0, shards: 0, capped: false };

  const all = chunkText(sample.context, SHARD_SIZE, 0);
  const capped = all.length > MAX_SHARDS;
  const shards = all.slice(0, MAX_SHARDS);
  const settled = await Promise.all(shards.map((s, i) => extractShard(s.text, i, all.length, question, contract)));

  // reduce：把各片的"本片情况"合成一次回答。
  // 只做 map 不做 reduce，等于把 14 份碎片一起交给 verify —— 实测这条会失败。
  let reduceDraft = '';
  let reduceTokens = 0;
  const notes = settled
    .map((s, i) => (s.draft ? `[片${i + 1}] ${s.draft}` : ''))
    .filter(Boolean);
  if (notes.length) {
    try {
      const res = await chat(
        [
          { role: 'system', content: '你负责汇总分片笔记，只输出 JSON。答案必须能从笔记推出，推不出就答"未知"。' },
          {
            role: 'user',
            content: [
              `问题：${question}`,
              `答案格式：${contract.answerFormat}，最多 ${contract.maxChars} 字符。`,
              '',
              '各片笔记：',
              notes.join('\n').slice(0, 12000),
              '',
              '请输出：{"answer":"最终答案"}',
            ].join('\n'),
          },
        ],
        { maxTokens: 200, temperature: 0 },
      );
      const parsed = parseJsonLoose<{ answer?: string }>(res.text);
      reduceDraft = String(parsed?.answer ?? '').trim();
      reduceTokens = res.usage.promptTokens + res.usage.completionTokens;
    } catch {
      reduceDraft = '';
    }
  }

  lastDebug.push({
    index: 100,
    chunkIds: shards.map((s) => s.id),
    parsedOk: true,
    rawHead: `escalated: ${shards.length}/${all.length} shards`,
    evidenceCount: settled.reduce((n, s) => n + s.evidence.length, 0),
    error: '',
    draft: settled.map((s) => s.draft).filter(Boolean).join(' | ').slice(0, 200),
  });

  return {
    evidence: settled.flatMap((s) => s.evidence),
    drafts: [reduceDraft, ...settled.map((s) => s.draft)].filter(Boolean),
    tokens: settled.reduce((n, s) => n + s.tokens, 0) + reduceTokens,
    shards: shards.length,
    capped,
  };
}

export async function readStep(input: ReadInput): Promise<ReadOutput> {
  const chunks = (input.chunks ?? []).filter((c) => c && typeof c.text === 'string');
  if (!chunks.length) {
    if (input.issue) {
      const esc = await escalate(input.issue, input.question ?? '', input.contract);
      return { evidence: esc.evidence.slice(0, 24), readTokens: esc.tokens, drafts: esc.drafts };
    }
    return { evidence: [], readTokens: 0, drafts: [] };
  }

  const batchSize = Math.max(1, Math.min(READ_BATCH, chunks.length));
  const batches = pickBatches(chunks, batchSize);

  // 扇出：引擎同层串行，并行只能在这里做
  const settled = await Promise.all(
    batches.map((b, i) => readBatch(b, input.question, input.contract, i)),
  );

  lastDebug = settled.map((s, i) => ({
    index: i,
    chunkIds: batches[i].map((c) => c.id),
    parsedOk: s.parsedOk,
    rawHead: s.rawHead,
    evidenceCount: s.evidence.length,
    error: s.error,
    draft: s.draft,
  }));

  const evidence = settled.flatMap((s) => s.evidence);
  // 已验证的排前面；同一这段文字只留一条
  const seen = new Set<string>();
  const deduped = evidence
    .sort((a, b) => Number(b.verified) - Number(a.verified))
    .filter((e) => {
      const key = `${e.chunkId}:${e.quote.slice(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  const drafts = settled.map((s) => s.draft).filter(Boolean);
  let merged = deduped;
  let draftsOut = drafts;
  let tokens = settled.reduce((n, s) => n + s.tokens, 0);

  // 升级路径默认关闭：实验（IB-13，17 次调用）证明"每片问模型"拿不到证据——
  // 4 万字的分片里模型判断不出相关性，14/14 片都返回 found:false。
  // 结论写进 docs/ORCHESTRATION.md；需要复现实验时用 ESCALATE=1 打开。
  const escalateEnabled = process.env.ESCALATE === '1';
  const question = input.question ?? '';
  if (escalateEnabled && input.issue && (merged.length === 0 || (isAggregateQuestion(question) && merged.length < 3))) {
    const esc = await escalate(input.issue, question, input.contract);
    tokens += esc.tokens;
    const seenIds = new Set(merged.map((e) => `${e.chunkId}:${e.quote.slice(0, 60)}`));
    for (const e of esc.evidence) {
      const k = `${e.chunkId}:${e.quote.slice(0, 60)}`;
      if (!seenIds.has(k)) {
        seenIds.add(k);
        merged.push(e);
      }
    }
    draftsOut = [...esc.drafts, ...drafts];
  }

  return {
    evidence: merged.slice(0, 24),
    readTokens: tokens,
    drafts: draftsOut.filter(Boolean),
  };
}
