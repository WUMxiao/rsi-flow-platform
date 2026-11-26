// FlowConfig → visual-core 的 viewState。
// 纯函数，客户端可用：page 只 import 这里，不碰 orchestrator/（那里有 fs）。
export type AnyFlow = { id?: string; title?: string; nodes: any[]; routes: any[] };

export interface ViewElement {
  id: string;
  name: string;
  type: string;
  color: string;
  x: number;
  y: number;
  select: boolean;
  locked: boolean;
}

export interface ViewLink {
  id: string;
  name: string;
  type: string;
  color: string;
  points: number[];
  fromElementId: string;
  toElementId: string;
}

const COLORS = { start: '#52c41a', event: '#1677ff', flow: '#722ed1', end: '#fa8c16' };

/** 画布行序：同一深度的兄弟流程也要分行，否则 read/verify 会叠在一起 */
const ROW_ORDER = ['orchestration.main', 'orchestration.read', 'orchestration.verify', 'orchestration.v2'];

/** 静态深度：main=0，它的子流程=1 */
function computeDepth(flows: Record<string, AnyFlow>): Record<string, number> {
  const depth: Record<string, number> = { 'orchestration.main': 0 };
  const walk = (id: string, d: number) => {
    const cfg = flows[id];
    if (!cfg) return;
    for (const n of cfg.nodes) {
      if (n.type !== 'flow') continue;
      if (depth[n.reference] === undefined) depth[n.reference] = d + 1;
      if (d + 1 < 6) walk(n.reference, d + 1);
    }
  };
  walk('orchestration.main', 0);
  if (depth['orchestration.v2'] === undefined) depth['orchestration.v2'] = 3;
  return depth;
}

export function buildViewState(flows: Record<string, AnyFlow>): { id: string; elements: ViewElement[]; links: ViewLink[] } {
  const elements: ViewElement[] = [];
  const links: ViewLink[] = [];

  for (const [flowId, cfg] of Object.entries(flows)) {
    const rowIndex = Math.max(0, ROW_ORDER.indexOf(flowId));
    const y = 50 + rowIndex * 190;
    const startId = `${flowId}:start`;
    const endId = `${flowId}:end`;

    elements.push({ id: startId, name: `${cfg.title ?? flowId} · 开始`, type: 'model', color: COLORS.start, x: 40, y, select: false, locked: false });

    cfg.nodes.forEach((n, i) => {
      elements.push({
        id: `${flowId}:${n.id}`,
        name: n.title,
        type: 'model',
        color: n.type === 'flow' ? COLORS.flow : COLORS.event,
        x: 240 + i * 250,
        y,
        select: false,
        locked: false,
      });
    });

    elements.push({
      id: endId,
      name: '结束',
      type: 'model',
      color: COLORS.end,
      x: 240 + cfg.nodes.length * 250,
      y,
      select: false,
      locked: false,
    });

    for (const r of cfg.routes) {
      links.push({
        id: `${flowId}:${r.source}->${r.target}`,
        name: '',
        type: 'relation',
        color: '#bfbfbf',
        points: [],
        fromElementId: r.source === 'start' ? startId : `${flowId}:${r.source}`,
        toElementId: r.target === 'end' ? endId : `${flowId}:${r.target}`,
      });
    }
  }

  return { id: 'orchestration', elements, links };
}
