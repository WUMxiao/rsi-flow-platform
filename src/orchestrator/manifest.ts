// 节点清单（manifest）：LLM 生成结构的"唯一素材"。
// 每个节点必须自描述三件事：吃什么、吐什么、属于哪一层。
// 三个轴（deterministic / verifiable）直接推导自动化级别：
//   deterministic            → L0 纯自动（删掉模型也能跑）
//   !det && verifiable       → L1 受控自动（模型可跑，判定器兜底）
//   !det && !verifiable      → L2 人工保留（不给模型自主权）
import type { FlowValue } from '@horsecoder/flow';
import type { TraceEntry } from './types.ts';

export type AutoLevel = 'L0' | 'L1' | 'L2';

export interface NodeSpec {
  codeId: string;
  title: string;
  desc: string;
  /** 归属流程：用于静态深度、trace 归属、以及"节点被放错流程"的检查 */
  flowId: string;
  params: FlowValue[];
  results: FlowValue[];
  deterministic: boolean;
  verifiable: boolean;
  costHint: { callsMax: number; tokensMax: number; msMax: number };
  tags: string[];
}

const A = (name: string, notnull = true): FlowValue => ({ name, type: 'any', notnull });
const S = (name: string, notnull = true): FlowValue => ({ name, type: 'string', notnull });

export const MANIFEST: NodeSpec[] = [
  {
    codeId: 'code.plan',
    title: '切块 + 契约 + 检索词',
    desc: '把长文档按窗口切块、用本地检索筛候选块、一次 LLM 调用生成输出契约与检索词。',
    flowId: 'orchestration.main',
    params: [A('issue'), S('sampleId'), S('runId')],
    results: [A('chunks'), A('contract'), A('keywords'), A('planMeta')],
    deterministic: false,
    verifiable: true,
    costHint: { callsMax: 1, tokensMax: 8000, msMax: 60000 },
    tags: ['plan', 'retrieval', 'contract'],
  },
  {
    codeId: 'code.read',
    title: '批量精读',
    desc: '把候选块分批喂模型，要求逐字引用；节点内 Promise.all 扇出（引擎同层串行）。',
    flowId: 'orchestration.read',
    params: [A('issue'), A('chunks'), A('contract'), S('runId'), S('traceId'), { name: 'stopAfterRead', type: 'boolean', notnull: false }],
    results: [A('evidence'), A('readTokens'), A('drafts')],
    deterministic: false,
    verifiable: true,
    costHint: { callsMax: 4, tokensMax: 60000, msMax: 180000 },
    tags: ['read', 'llm', 'fanout'],
  },
  {
    codeId: 'code.verify',
    title: '契约核验',
    desc: '按契约核格式、证据逐字匹配、不通过则换词重试（引擎不能回退，循环写在节点内）。',
    flowId: 'orchestration.verify',
    params: [A('issue'), A('evidence'), A('contract'), S('runId'), A('drafts')],
    results: [A('finalAnswer'), A('verdict'), A('retries')],
    deterministic: false,
    verifiable: true,
    costHint: { callsMax: 3, tokensMax: 20000, msMax: 90000 },
    tags: ['verify', 'contract', 'retry'],
  },
];

/**
 * 非节点形态的确定性工具（L0）。
 * 列出来是为了在"自动化边界表"里有据可依：这些环节删掉模型也照样跑。
 */
export const PURE_UTILS: Array<{ name: string; file: string; level: AutoLevel; desc: string }> = [
  { name: 'loadSamples', file: 'src/orchestrator/dataset.ts', level: 'L0', desc: '流式扫 jsonl 取样本，命中即停' },
  { name: 'loadBaseline', file: 'src/orchestrator/baseline.ts', level: 'L0', desc: '按 sample_id 对齐 v3 基线原件' },
  { name: 'ctxSha1', file: 'src/orchestrator/dataset.ts', level: 'L0', desc: 'context 指纹，用于跨问题去重' },
  { name: 'normalize/verdict', file: 'src/orchestrator/score.ts', level: 'L0', desc: '答案规范化与粗判（S6 扩 ROUGE）' },
  { name: 'validateFlowConfig', file: 'src/orchestrator/validate.ts', level: 'L0', desc: '8 条静态规则 + 数据流闭合' },
];

export function levelOf(spec: NodeSpec): AutoLevel {
  if (spec.deterministic) return 'L0';
  return spec.verifiable ? 'L1' : 'L2';
}

export function specOf(codeId: string): NodeSpec | undefined {
  return MANIFEST.find((s) => s.codeId === codeId);
}

/** 静态深度：main=0，它的子流程=1，再下一层=2 */
export function flowDepths(flows: Record<string, { nodes: Array<{ type: string; reference: string }> }>, root = 'orchestration.main'): Record<string, number> {
  const depth: Record<string, number> = { [root]: 0 };
  const walk = (flowId: string, d: number): void => {
    const cfg = flows[flowId];
    if (!cfg) return;
    for (const n of cfg.nodes) {
      if (n.type !== 'flow') continue;
      const child = n.reference;
      depth[child] = Math.max(depth[child] ?? 0, d + 1);
      if (d + 1 < 8) walk(child, d + 1);
    }
  };
  walk(root, 0);
  return depth;
}

/** 从 trace 里取出某个节点 id 的执行序列，M2 自检用 */
export function traceOf(trace: TraceEntry[], codeId: string): TraceEntry[] {
  return trace.filter((t) => t.nodeId === codeId);
}
