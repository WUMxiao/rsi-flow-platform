// 节点实现。S2 是桩：返回固定结构，不调模型，只验证参数怎么下传、结果怎么合并。
// S3–S5 会把 code.plan / code.read / code.verify 的真身填进来，函数签名不变。
import flowPkg from '@horsecoder/flow';

import { planStep } from './steps/plan.ts';
import { readStep } from './steps/read.ts';

const { stop } = flowPkg as unknown as {
  stop: (flowId: string, args: Record<string, unknown>) => Promise<unknown>;
};

export type NodeFn = (input: Record<string, any>) => Promise<Record<string, unknown>>;

export const NODES: Record<string, NodeFn> = {
  // 切块 + 本地检索 + 一次契约生成（1 次模型调用）
  'code.plan': async (input) => {
    const offline = process.env.ORCHESTRATE_OFFLINE === '1';
    const out = await planStep({
      issue: input.issue,
      sampleId: String(input.sampleId),
      runId: String(input.runId ?? ''),
      useLlm: input.useLlm ?? !offline,
    });
    return out as unknown as Record<string, unknown>;
  },

  // 批量喂块精读 + 节点内 Promise.all 扇出
  'code.read': async (input) => {
    // 证据：父流程注入的 traceId 必须穿过子流程的 params 裁剪传到这里。
    // 传不过来就说明嵌套调用的参数链断了 —— 直接抛，让 trace 里出现 error。
    if (!input.traceId) throw new Error('traceId 没有通过嵌套子流程传下来');
    // 跨层 stop 证据：子流程节点直接终止父流程（引擎全局信号表，节点内调用）
    if (input.stopAfterRead) {
      await stop('orchestration.main', { stoppedBy: 'code.read' });
      return { evidence: [], readTokens: 0, drafts: [] };
    }
    const out = await readStep({
      chunks: input.chunks ?? [],
      contract: input.contract,
      question: String(input.issue?.input ?? ''),
    });
    return out as unknown as Record<string, unknown>;
  },

  // S5 会换成：契约核验 + 证据逐字匹配 + 内部重试
  'code.verify': async (input) => {
    return {
      finalAnswer: 'STUB',
      verdict: { pass: true, reason: 'stub', evidenceCount: (input.evidence ?? []).length },
      retries: 0,
    };
  },
};
