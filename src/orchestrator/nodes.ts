// 节点实现。S2 是桩：返回固定结构，不调模型，只验证参数怎么下传、结果怎么合并。
// S3–S5 会把 code.plan / code.read / code.verify 的真身填进来，函数签名不变。
import flowPkg from '@horsecoder/flow';

import { planStep } from './steps/plan.ts';
import { readStep } from './steps/read.ts';
import { verifyStep } from './steps/verify.ts';

const { stop } = flowPkg as unknown as {
  stop: (flowId: string, args: Record<string, unknown>) => Promise<unknown>;
};

export type NodeFn = (input: Record<string, any>) => Promise<Record<string, unknown>>;

export const NODES: Record<string, NodeFn> = {
  // 切块 + 本地检索 + 契约（契约默认走规则；PLAN_LLM=1 可切回模型）
  'code.plan': async (input) => {
    const out = await planStep({
      issue: input.issue,
      sampleId: String(input.sampleId),
      runId: String(input.runId ?? ''),
      useLlm: input.useLlm,
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
      issue: input.issue ? { task: String(input.issue.task), sampleId: String(input.issue.sampleId) } : undefined,
    });
    return out as unknown as Record<string, unknown>;
  },

  // 契约核验 + 证据比对 + 内部重试（规则优先，模型兜底）
  'code.verify': async (input) => {
    const out = await verifyStep({
      issue: input.issue,
      evidence: input.evidence ?? [],
      contract: input.contract,
      drafts: input.drafts ?? [],
      runId: String(input.runId ?? ''),
    });
    if (out.hardFail) {
      // 引擎不能回退，用跨层 stop 把失败原因带回父流程（要求 4 的落点）
      await stop('orchestration.main', { failed: true, failReason: out.verdict.reason });
    }
    return { finalAnswer: out.finalAnswer, verdict: out.verdict, retries: out.retries };
  },
};
