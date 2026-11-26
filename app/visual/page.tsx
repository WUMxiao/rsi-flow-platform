// @ts-nocheck
'use client';

import { useEffect, useRef } from 'react';
import VisualDiagram from '@horsecoder/visual-core';

/** 节点渲染组件：由 visual-core 在画布内实例化 */
const NodeBox = ({ element }: any) => {
  const { name, color, type } = element.state;
  const { width, height } = element.size;

  return (
    <div
      style={{
        width,
        height,
        background: '#fff',
        border: `2px solid ${color || '#1677ff'}`,
        borderRadius: 8,
        boxSizing: 'border-box',
        overflow: 'hidden',
        fontSize: 12,
        cursor: 'move',
      }}
    >
      <div
        style={{
          background: color || '#1677ff',
          color: '#fff',
          padding: '4px 8px',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {name}
      </div>
      <div style={{ padding: '6px 8px', color: '#8c8c8c' }}>{type}</div>
    </div>
  );
};

const canvasConfig = {
  elementConfig: {
    components: {
      model: {
        component: NodeBox,
        minSize: { width: 160, height: 64 },
      },
    },
  },
  linkConfig: {
    components: {
      relation: {
        hasArrow: true,
        showName: true,
      },
    },
  },
  toolbarConfig: [],
  globalConfig: {
    gridSize: 25,
  },
};

const viewState = {
  id: 'rsi-flow-demo',
  elements: [
    { id: 'start', name: '开始', type: 'model', color: '#52c41a', x: 120, y: 120, select: false, locked: false },
    { id: 'parse', name: '解析请求', type: 'model', color: '#1677ff', x: 400, y: 120, select: false, locked: false },
    { id: 'run', name: '执行流程', type: 'model', color: '#722ed1', x: 680, y: 120, select: false, locked: false },
    { id: 'end', name: '返回结果', type: 'model', color: '#fa8c16', x: 400, y: 340, select: false, locked: false },
  ],
  links: [
    { id: 'l1', name: '请求', type: 'relation', color: '#bfbfbf', points: [], fromElementId: 'start', toElementId: 'parse' },
    { id: 'l2', name: '参数', type: 'relation', color: '#bfbfbf', points: [], fromElementId: 'parse', toElementId: 'run' },
    { id: 'l3', name: '结果', type: 'relation', color: '#bfbfbf', points: [], fromElementId: 'run', toElementId: 'end' },
    { id: 'l4', name: '结束', type: 'relation', color: '#bfbfbf', points: [], fromElementId: 'end', toElementId: 'start' },
  ],
};

export default function VisualPage() {
  const diagramRef = useRef<any>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      diagramRef.current?.setView(viewState);
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h2 style={{ marginTop: 0 }}>rsi-flow-visual 集成示例</h2>
      <p style={{ color: '#8c8c8c', marginTop: 4 }}>
        画布组件来自 <code>@horsecoder/visual-core</code> 0.3.12，通过本地依赖
        <code> file:../rsi-flow-visual</code> 接入；下方四个节点与连线由 viewState 驱动。
      </p>

      <div
        style={{
          height: 620,
          marginTop: 16,
          border: '1px solid #e5e5e5',
          borderRadius: 8,
          overflow: 'hidden',
          background: '#fafafa',
        }}
      >
        <VisualDiagram
          ref={diagramRef}
          canvasConfig={canvasConfig}
          onChange={(next: any) => console.log('onChange', next)}
        />
      </div>
    </main>
  );
}
