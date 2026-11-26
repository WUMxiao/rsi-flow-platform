// 服务端装配层：幂等注册 + 加载 + trace 采集。
// 只被 CLI（以及以后可能有的服务端脚本）引用；页面永远不 import 这个文件。
import flowPkg from '@horsecoder/flow';

import { FLOWS } from '../flows/flows_my.ts';
import { MANIFEST, flowDepths, specOf } from './manifest.ts';
import { NODES } from './nodes.ts';
import type { TraceEntry } from './types.ts';

const flow = flowPkg as unknown as {
  register: (codeId: string, fn: (input: any) => Promise<any>) => void;
  load: (id: string, cfg: unknown) => void;
  run: (id: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const DEPTHS = flowDepths(FLOWS as any);
const SPEC = new Map(MANIFEST.map((s) => [s.codeId, s]));

/** 模块级 trace：不用 args 传（args 会被 checkAllArgs 按 params 裁剪） */
let trace: TraceEntry[] = [];
let currentRunId = '';

export function beginRun(runId: string): void {
  currentRunId = runId;
  trace = [];
}

export function snapshotTrace(): TraceEntry[] {
  return trace.map((t) => ({ ...t }));
}

export function flowDepth(flowId: string): number {
  return DEPTHS[flowId] ?? 0;
}

/** 节点级 try/catch：抛异常会带崩整个流程，所以统一兜成 {error} */
function wrap(codeId: string, fn: (input: any) => Promise<Record<string, unknown>>) {
  const spec = SPEC.get(codeId);
  return async (input: Record<string, unknown>) => {
    const entry: TraceEntry = {
      runId: currentRunId,
      flowId: spec?.flowId ?? 'unknown',
      nodeId: codeId,
      depth: (DEPTHS[spec?.flowId ?? ''] ?? 0) + 1,
      startedAt: Date.now(),
      status: 'pending',
      inKeys: Object.keys(input ?? {}),
      outKeys: [],
    };
    trace.push(entry);
    try {
      const out = await fn(input ?? {});
      entry.status = 'ok';
      entry.outKeys = Object.keys(out ?? {});
      entry.endedAt = Date.now();
      return out;
    } catch (err) {
      entry.status = 'error';
      entry.error = err instanceof Error ? err.message : String(err);
      entry.endedAt = Date.now();
      return { error: entry.error };
    }
  };
}

let initialized = false;

/** 幂等：Next dev 热更新会二次执行，register/load 重复都会抛错 */
export function initOrchestration(): void {
  if (initialized) return;
  initialized = true;

  for (const [codeId, fn] of Object.entries(NODES)) {
    try {
      flow.register(codeId, wrap(codeId, fn));
    } catch {
      // 已注册过
    }
  }

  for (const [id, cfg] of Object.entries(FLOWS)) {
    try {
      flow.load(id, cfg);
    } catch {
      // 已加载过
    }
  }
}

export interface RunOutcome {
  result: Record<string, unknown>;
  trace: TraceEntry[];
}

/** 真正的一次编排执行：平台引擎 run()，不是自写调度器 */
export async function runOrchestration(input: Record<string, unknown>): Promise<RunOutcome> {
  initOrchestration();
  beginRun(String(input.runId ?? 'run'));
  const result = await flow.run('orchestration.main', input);
  return { result: result ?? {}, trace: snapshotTrace() };
}

export function traceOfCode(t: TraceEntry[], codeId: string): TraceEntry[] {
  return t.filter((x) => x.nodeId === codeId);
}

export function specFor(codeId: string) {
  return specOf(codeId);
}
