// 三个 FlowConfig。纯 JSON（load() 会 JSON.parse(JSON.stringify(...))），
// 所以这里不能放函数 —— 节点实现在 src/orchestrator/nodes.ts，由 bootstrap 注册。
//
// 结构（三层）：
//   orchestration.main   (depth 0)
//     ├─ plan    event  → code.plan
//     ├─ read    flow   → orchestration.read   (depth 1)
//     │                     └─ fanout event → code.read   (depth 2)
//     └─ verify  flow   → orchestration.verify (depth 1)
//                           └─ check  event → code.verify  (depth 2)
//
// 两条引擎硬约束决定了每个节点都必须显式声明 params/results：
//   1) checkAllArgs 在 params 为 null 时返回 {}，会把上一层传下来的参数全部丢掉
//   2) event 节点只把 results 里声明的字段并回 args
import type { FlowConfig } from '@horsecoder/flow';

const S = (name: string) => ({ name, type: 'string' as const });
const A = (name: string) => ({ name, type: 'any' as const });
const B = (name: string) => ({ name, type: 'boolean' as const });

export const FLOW_MAIN = 'orchestration.main';
export const FLOW_READ = 'orchestration.read';
export const FLOW_VERIFY = 'orchestration.verify';
export const FLOW_V2 = 'orchestration.v2';

export const FLOWS: Record<string, FlowConfig> = {
  [FLOW_MAIN]: {
    id: FLOW_MAIN,
    title: '主编排',
    type: 'flow',
    platform: 'frontend',
    async: false,
    params: [A('issue'), S('sampleId'), S('runId'), S('traceId'), B('stopAfterRead')],
    results: [A('finalAnswer'), A('verdict'), A('evidence'), A('readTokens'), A('retries'), A('stoppedBy'), A('failed'), A('failReason')],
    nodes: [
      {
        id: 'plan',
        type: 'event',
        title: '切块 + 契约 + 检索词',
        reference: 'code.plan',
        params: [A('issue'), S('sampleId'), S('runId')],
        results: [A('chunks'), A('contract'), A('keywords'), A('planMeta')],
      },
      {
        id: 'read',
        type: 'flow',
        title: '读取层（子流程）',
        reference: FLOW_READ,
        params: [],
        results: [],
      },
      {
        id: 'verify',
        type: 'flow',
        title: '核验层（子流程）',
        reference: FLOW_VERIFY,
        params: [],
        results: [],
      },
    ],
    routes: [
      { source: 'start', target: 'plan' },
      { source: 'plan', target: 'read' },
      { source: 'read', target: 'verify' },
      { source: 'verify', target: 'end' },
    ],
    // 结构出处：autogen 阶段由 LLM 生成时改成 'llm'，人改过的字段写进 humanTouched
    // extraResults：stop() 注入的字段不打 results 声明，单独列出（校验器 R7 会用到）
    meta: { authoredBy: 'human', humanTouched: ['nodes', 'routes', 'params', 'results'], extraResults: ['stoppedBy', 'failed', 'failReason'] },
  } as unknown as FlowConfig,

  [FLOW_READ]: {
    id: FLOW_READ,
    title: '读取层',
    type: 'flow',
    platform: 'frontend',
    async: false,
    params: [A('issue'), A('chunks'), A('contract'), S('runId'), S('traceId'), B('stopAfterRead')],
    results: [A('evidence'), A('readTokens'), A('drafts')],
    nodes: [
      {
        id: 'fanout',
        type: 'event',
        title: '并发精读 N 个块',
        reference: 'code.read',
        params: [A('issue'), A('chunks'), A('contract'), S('runId'), S('traceId'), B('stopAfterRead')],
        results: [A('evidence'), A('readTokens'), A('drafts')],
      },
    ],
    routes: [
      { source: 'start', target: 'fanout' },
      { source: 'fanout', target: 'end' },
    ],
    meta: { authoredBy: 'human', humanTouched: ['nodes', 'routes', 'params', 'results'] },
  } as unknown as FlowConfig,

  [FLOW_VERIFY]: {
    id: FLOW_VERIFY,
    title: '核验层',
    type: 'flow',
    platform: 'frontend',
    async: false,
    params: [A('issue'), A('evidence'), A('contract'), S('runId'), A('drafts')],
    results: [A('finalAnswer'), A('verdict'), A('retries')],
    nodes: [
      {
        id: 'check',
        type: 'event',
        title: '契约核验 + 证据比对 + 重试',
        reference: 'code.verify',
        params: [A('issue'), A('evidence'), A('contract'), S('runId'), A('drafts')],
        results: [A('finalAnswer'), A('verdict'), A('retries')],
      },
    ],
    routes: [
      { source: 'start', target: 'check' },
      { source: 'check', target: 'end' },
    ],
    meta: { authoredBy: 'human', humanTouched: ['nodes', 'routes', 'params', 'results'] },
  } as unknown as FlowConfig,
  // 消融用：两层（plan → read），砍掉 verify。
  // 用它和 main 对照，回答"第三层到底值多少"。
  [FLOW_V2]: {
    id: FLOW_V2,
    title: '两层消融（plan→read）',
    type: 'flow',
    platform: 'frontend',
    async: false,
    params: [A('issue'), S('sampleId'), S('runId'), S('traceId'), B('stopAfterRead')],
    results: [A('evidence'), A('readTokens'), A('drafts'), A('chunks')],
    nodes: [
      {
        id: 'plan',
        type: 'event',
        title: '切块 + 契约 + 检索词',
        reference: 'code.plan',
        params: [A('issue'), S('sampleId'), S('runId')],
        results: [A('chunks'), A('contract'), A('keywords'), A('planMeta')],
      },
      {
        id: 'read',
        type: 'flow',
        title: '读取层（子流程）',
        reference: FLOW_READ,
        params: [],
        results: [],
      },
    ],
    routes: [
      { source: 'start', target: 'plan' },
      { source: 'plan', target: 'read' },
      { source: 'read', target: 'end' },
    ],
    meta: { authoredBy: 'human', humanTouched: ['nodes', 'routes'] },
  } as unknown as FlowConfig,
};

/**
 * 平台入口：store.ts 模块加载时调用一次（flows.ts → loadAll → loadMy）。
 * Next dev 热更新会重复执行，所以必须幂等。
 */
let loaded = false;
export const loadMy = async (): Promise<void> => {
  if (loaded) return;
  loaded = true;
  // 通过动态 import 拿 load，避免 flows_my.ts 在客户端打包时把整个包拉进来
  const { load } = (await import('@horsecoder/flow')) as unknown as {
    load: (id: string, cfg: unknown) => void;
  };
  for (const [id, cfg] of Object.entries(FLOWS)) {
    try {
      load(id, cfg);
    } catch {
      // 重复 load 说明已经注册过（HMR / 二次调用），忽略
    }
  }
};
