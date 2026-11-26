// 编排层类型定义。
// 只放类型，不放实现 —— 这些类型同时被 CLI、节点实现与页面构建脚本引用。

export type FailureType = 'F1' | 'F3' | 'F4' | 'F6' | 'CTRL';

/** 数据集里的一行原始样本（只保留用得到的字段） */
export interface RawSample {
  id: string;
  context: string;
  input: string;
  answer: string[] | string | null;
  options?: string[];
}

/** 交付用的问题清单条目（写进 data/issues.jsonl，不含 context） */
export interface Issue {
  id: string;
  task: string;
  sampleId: string;
  input: string;
  gold: string[];
  ctxChars: number;
  ctxSha1: string;
  failureType: FailureType;
  baseline: BaselineRef;
  note?: string;
}

/** 已存基线的一次调用记录（gpt-6-sol v3） */
export interface BaselineRef {
  model: string;
  raw: string;
  score: number;
  keepRatio: number;
  promptTokens: number;
  completionTokens: number;
}

export interface BaselineRecord extends BaselineRef {
  task: string;
  sampleId: string;
  gold: string[];
  latencyS: number;
}

/** 切块单元（S3 用；这里先定形，避免后面改类型） */
export interface Chunk {
  id: string;
  text: string;
  start: number;
  end: number;
  score?: number;
}

/** 输出契约：由 code.plan 生成，code.verify 按它核验 */
export interface Contract {
  answerFormat: 'short_entity' | 'digit_string' | 'uuid' | 'choice_letter' | 'free_text';
  mustCite: boolean;
  keywords: string[];
  maxChars: number;
}

/** 逐节点执行轨迹（S2 起写入，S7 页面读它着色） */
export interface TraceEntry {
  runId: string;
  flowId: string;
  nodeId: string;
  depth: number;
  startedAt: number;
  endedAt?: number;
  status: 'pending' | 'ok' | 'error' | 'skipped' | 'retried';
  inKeys: string[];
  outKeys: string[];
  error?: string;
}

export type NodeOutput = Record<string, unknown>;
