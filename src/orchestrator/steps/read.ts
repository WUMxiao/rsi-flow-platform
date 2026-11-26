// code.read：批量精读。
// 三个约束决定了实现形态：
//   1) 引擎同层串行 → 扇出只能写在节点内部（Promise.all）
//   2) 单次调用 ~36s + ~10k token 固定开销 → 必须批量，不能一块一调
//   3) 证据必须可回溯 → 要求模型给块号 + 逐字引用，节点内就地校验 quote 是否真在原文里
import { READ_BATCH, READ_MAX_TOKENS } from '../env.ts';
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

export async function readStep(input: ReadInput): Promise<ReadOutput> {
  const chunks = (input.chunks ?? []).filter((c) => c && typeof c.text === 'string');
  if (!chunks.length) {
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

  return {
    evidence: deduped,
    readTokens: settled.reduce((n, s) => n + s.tokens, 0),
    drafts,
  };
}
