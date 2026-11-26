// FlowConfig 静态校验器。
// 目的有两个，同一份代码两次用：
//   1) 人工写结构时的"测试"——把引擎的静默失败（参数被裁掉、结果被裁掉）变成显式报错
//   2) autogen 阶段的"闸"——LLM 生成的结构先过 L1 才能进 L2 执行
//
// 8 条规则全部来自对 @horsecoder/flow dist/index.js 的实测，不是猜的：
//   R1 params 非空         checkAllArgs 在 params==null 时返回 {}，参数全丢
//   R2 id 唯一 / 路由可达   routeLayers 按 routes 展开，未挂路由的节点永不执行
//   R3 单入边              同一 target 被多条路由指向会被执行多次
//   R4 无环                BFS 展开遇环会死循环
//   R5 reference 存在       execute() 找不到方法直接 throw
//   R6 签名一致            节点只能吃 manifest 声明过的字段，只能吐声明过的结果
//   R7 数据流闭合          上游 results 必须覆盖下游 params（字段级传播）
//   R8 层数 ≤ 3            嵌套是引擎递归，depth 超标说明结构失控
import type { FlowValue } from '@horsecoder/flow';

import { MANIFEST, flowDepths, specOf } from './manifest.ts';

export interface ValidationIssue {
  level: 'error' | 'warn';
  rule: string;
  flowId: string;
  nodeId?: string;
  message: string;
}

interface LooseNode {
  id: string;
  type: string;
  title?: string;
  reference: string;
  params?: FlowValue[];
  results?: FlowValue[];
}

interface LooseFlow {
  id?: string;
  params?: FlowValue[];
  results?: FlowValue[];
  nodes: LooseNode[];
  routes: Array<{ source: string; target: string }>;
  meta?: { authoredBy?: string; humanTouched?: string[]; extraResults?: string[] };
}

const names = (list?: FlowValue[]): string[] => (list ?? []).map((v) => v.name);
const START = 'start';
const END = 'end';

export function validateFlow(flowId: string, cfg: LooseFlow, all: Record<string, LooseFlow>): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const err = (rule: string, message: string, nodeId?: string) =>
    out.push({ level: 'error', rule, flowId, nodeId, message });
  const warn = (rule: string, message: string, nodeId?: string) =>
    out.push({ level: 'warn', rule, flowId, nodeId, message });

  // R1
  if (!Array.isArray(cfg.params)) {
    err('R1', 'flow.params 不是数组：引擎 checkAllArgs 会返回 {}，上一层传下来的参数会全部丢失');
  }

  // R2：id 唯一 + 路由端点存在
  const byId = new Map<string, LooseNode>();
  for (const n of cfg.nodes) {
    if (byId.has(n.id)) err('R2', `节点 id 重复: ${n.id}`, n.id);
    byId.set(n.id, n);
  }
  for (const r of cfg.routes) {
    for (const end of [r.source, r.target]) {
      if (end !== START && end !== END && !byId.has(end)) {
        err('R2', `路由指向不存在的节点: ${end}`);
      }
    }
  }
  const reachable = new Set<string>();
  const walkRoutes = (from: string) => {
    for (const r of cfg.routes.filter((x) => x.source === from)) {
      if (r.target === END) continue;
      if (reachable.has(r.target)) continue;
      reachable.add(r.target);
      walkRoutes(r.target);
    }
  };
  walkRoutes(START);
  for (const n of cfg.nodes) {
    if (!reachable.has(n.id)) err('R2', `节点 ${n.id} 从 start 不可达（没有路由指向它，永不执行）`, n.id);
  }

  // R3：单入边
  const inEdges = new Map<string, number>();
  for (const r of cfg.routes) {
    if (r.target === END) continue;
    inEdges.set(r.target, (inEdges.get(r.target) ?? 0) + 1);
  }
  for (const [id, cnt] of inEdges) {
    if (cnt > 1) err('R3', `节点 ${id} 有 ${cnt} 条入边，会被重复执行 ${cnt} 次`, id);
  }

  // R4：无环
  const state = new Map<string, 0 | 1 | 2>();
  const dfs = (node: string): boolean => {
    const st = state.get(node) ?? 0;
    if (st === 1) return true;
    if (st === 2) return false;
    state.set(node, 1);
    for (const r of cfg.routes.filter((x) => x.source === node)) {
      if (r.target !== END && dfs(r.target)) return true;
    }
    state.set(node, 2);
    return false;
  };
  for (const n of cfg.nodes) {
    if (dfs(n.id)) {
      err('R4', `路由存在环，引擎 BFS 会死循环`, n.id);
      break;
    }
  }

  // R5/R6：reference 与签名
  for (const n of cfg.nodes) {
    if (n.type === 'event') {
      const spec = specOf(n.reference);
      if (!spec) {
        err('R5', `未注册的节点实现: ${n.reference}`, n.id);
        continue;
      }
      if (spec.flowId !== flowId) {
        warn('R6', `节点 ${n.reference} 归属 ${spec.flowId}，被放进了 ${flowId}`, n.id);
      }
      const allowedIn = new Set(names(spec.params));
      const allowedOut = new Set(names(spec.results));
      for (const p of n.params ?? []) {
        if (!allowedIn.has(p.name)) err('R6', `节点 ${n.id} 声明了 manifest 未定义的入参: ${p.name}`, n.id);
      }
      for (const r of n.results ?? []) {
        if (!allowedOut.has(r.name)) err('R6', `节点 ${n.id} 声明了 manifest 未定义的结果: ${r.name}`, n.id);
      }
    } else if (n.type === 'flow') {
      if (!all[n.reference]) err('R5', `嵌套的子流程未加载: ${n.reference}`, n.id);
    } else {
      err('R2', `未知节点类型: ${n.type}`, n.id);
    }
  }

  // R7：数据流闭合（按引擎的 BFS 层序传播可用字段）
  const available = new Set<string>(names(cfg.params));
  const order: string[] = [];
  const seen = new Set<string>();
  let layer = cfg.routes.filter((r) => r.source === START).map((r) => r.target);
  while (layer.length) {
    const next: string[] = [];
    for (const id of layer) {
      if (seen.has(id) || id === END) continue;
      seen.add(id);
      order.push(id);
      next.push(...cfg.routes.filter((r) => r.source === id).map((r) => r.target));
    }
    layer = next;
  }
  for (const id of order) {
    const n = byId.get(id);
    if (!n) continue;
    for (const p of n.params ?? []) {
      if (!available.has(p.name) && p.notnull !== false) {
        err('R7', `节点 ${id} 需要入参 ${p.name}，但没有任何上游产出它（会被静默裁成 undefined）`, id);
      }
    }
    if (n.type === 'flow') {
      const child = all[n.reference];
      if (child) {
        for (const p of child.params ?? []) {
          if (!available.has(p.name) && p.notnull !== false) {
            err('R7', `子流程 ${n.reference} 需要入参 ${p.name}，但父流程没有产出它`, id);
          }
        }
        for (const r of names(child.results)) available.add(r);
      }
    } else {
      for (const r of names(n.results)) available.add(r);
    }
  }
  for (const r of names(cfg.results)) {
    // stop() 注入的字段不走 results 声明（引擎把 signal 里的 args 直接并回），
    // 必须在 meta.extraResults 里显式声明，否则 R7 会误判成"没人产出"。
    if (!available.has(r) && !(cfg.meta?.extraResults ?? []).includes(r)) {
      err('R7', `flow.results 声明了 ${r}，但没有任何节点产出它（会被裁成 null）`);
    }
  }

  // R8：层数
  const depths = flowDepths(all);
  for (const [id, d] of Object.entries(depths)) {
    if (d > 3) err('R8', `流程 ${id} 嵌套深度 ${d} > 3`);
  }

  // meta（autogen 阶段必填，用于算"人工介入率"）
  if (!cfg.meta?.authoredBy) warn('META', '缺少 meta.authoredBy，无法统计人工介入率');

  return out;
}

export function validateAll(flows: Record<string, LooseFlow>): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const [id, cfg] of Object.entries(flows)) out.push(...validateFlow(id, cfg, flows));
  return out;
}

export function hasError(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}

export function formatIssues(issues: ValidationIssue[]): string {
  if (!issues.length) return '（无问题）';
  return issues
    .map((i) => `[${i.level.toUpperCase()}][${i.rule}] ${i.flowId}${i.nodeId ? '/' + i.nodeId : ''}  ${i.message}`)
    .join('\n');
}

/**
 * 反向测试：故意改坏结构，确认校验器能抓到。
 * 这是"约束是硬的，不是装饰"的证据 —— S9 会把它写进 README。
 */
export interface MutationCase {
  name: string;
  mutate: (flows: Record<string, LooseFlow>) => void;
  expectRule: string;
}

export function mutationCases(): MutationCase[] {
  return [
    {
      name: '删掉 read 流程的 results（下游拿不到 evidence）',
      expectRule: 'R7',
      mutate: (f) => {
        f['orchestration.read'].results = [];
      },
    },
    {
      name: '给 plan 加第二条入边（会执行两次）',
      expectRule: 'R3',
      mutate: (f) => {
        f['orchestration.main'].routes.splice(0, 0, { source: 'start', target: 'plan' });
      },
    },
    {
      name: '清空 main.params（引擎会丢掉全部入参）',
      expectRule: 'R7',
      mutate: (f) => {
        f['orchestration.main'].params = [];
      },
    },
    {
      name: '引用不存在的节点实现',
      expectRule: 'R5',
      mutate: (f) => {
        f['orchestration.main'].nodes[0].reference = 'code.nonexistent';
      },
    },
    {
      name: '制造路由环（引擎会死循环）',
      expectRule: 'R4',
      mutate: (f) => {
        f['orchestration.main'].routes.push({ source: 'verify', target: 'plan' });
      },
    },
    {
      name: '复制一个同 id 节点',
      expectRule: 'R2',
      mutate: (f) => {
        const main = f['orchestration.main'];
        main.nodes.push({ ...main.nodes[0] });
      },
    },
    {
      name: '节点声明 manifest 里没有的入参',
      expectRule: 'R6',
      mutate: (f) => {
        f['orchestration.main'].nodes[0].params = [...(f['orchestration.main'].nodes[0].params ?? []), { name: 'hacked', type: 'any' }];
      },
    },
  ];
}
