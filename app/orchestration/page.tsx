// @ts-nocheck
'use client';

import VisualDiagram from '@horsecoder/visual-core';
import { Alert, Card, Col, Row, Space, Statistic, Table, Tabs, Tag, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';

import { FLOWS } from '../../src/flows/flows_my';
import { buildViewState } from '../../src/flows/viewstate';

const { Title, Paragraph, Text } = Typography;

/** 画布节点渲染（与 /visual 同一套接入代码） */
const NodeBox = ({ element }: any) => {
  const { name, color } = element.state;
  const { width, height } = element.size;
  return (
    <div
      style={{
        width,
        height,
        background: '#fff',
        border: `2px solid ${color}`,
        borderRadius: 8,
        boxSizing: 'border-box',
        overflow: 'hidden',
        fontSize: 12,
        cursor: 'move',
      }}
    >
      <div style={{ background: color, color: '#fff', padding: '4px 8px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {name}
      </div>
      <div style={{ padding: '6px 8px', color: '#8c8c8c' }}>node</div>
    </div>
  );
};

const canvasConfig = {
  elementConfig: { components: { model: { component: NodeBox, minSize: { width: 170, height: 64 } } } },
  linkConfig: { components: { relation: { hasArrow: true, showName: false } } },
  toolbarConfig: [],
  globalConfig: { gridSize: 25 },
};

const SEMANTIC: Record<string, [string, string]> = {
  'IB-01': ['对（判分误杀）', '未答'],
  'IB-02': ['错', '错'],
  'IB-03': ['错', '对'],
  'IB-04': ['错', '错'],
  'IB-05': ['错', '未答'],
  'IB-06': ['错', '对'],
  'IB-07': ['错', '对'],
  'IB-08': ['错（少 1 位）', '错'],
  'IB-09': ['对（0.4 分）', '对'],
  'IB-10': ['错', '错'],
};

const PassTag = ({ ok, raw }: { ok: boolean; raw?: boolean }) =>
  ok ? <Tag color="green">{raw ? 'PASS' : 'PASS(规范化)'}</Tag> : <Tag color="red">miss</Tag>;

export default function OrchestrationPage() {
  const diagramRef = useRef<any>(null);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('structure');
  const viewState = useMemo(() => buildViewState(FLOWS as any), []);

  // 支持 ?tab=results 直接打开某个页签（便于截图与分享）
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t) setTab(t);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => diagramRef.current?.setView(viewState), 60);
    return () => clearTimeout(t);
  }, [viewState]);

  useEffect(() => {
    fetch('/results/results.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);

  const rows: any[] = data?.rows ?? [];
  const normPass = rows.filter((r) => r.strictPass).length;
  const rawPass = rows.filter((r) => r.strictPassRaw).length;
  const contractPass = rows.filter((r) => r.contractPass).length;
  const calls = rows.reduce((n, r) => n + (r.calls ?? 0), 0);
  const avgMs = rows.length ? Math.round(rows.reduce((n, r) => n + (r.ms ?? 0), 0) / rows.length / 1000) : 0;

  const resultColumns = [
    { title: '#', dataIndex: 'id', width: 70, fixed: 'left' as const },
    { title: '任务', dataIndex: 'task', width: 150 },
    { title: '期望', dataIndex: 'gold', width: 160, render: (g: string[]) => <Text code>{(g ?? []).join(' / ').slice(0, 26)}</Text> },
    {
      title: '修复后',
      dataIndex: 'answer',
      width: 180,
      render: (a: string) => (a ? <Text>{a.slice(0, 40)}</Text> : <Text type="secondary">（空）</Text>),
    },
    { title: '严格', dataIndex: 'strictPass', width: 120, render: (v: boolean, r: any) => <PassTag ok={v} raw={r.strictPassRaw} /> },
    { title: '契约', dataIndex: 'contractPass', width: 80, render: (v: boolean) => (v ? <Tag>ok</Tag> : <Tag color="default">no</Tag>) },
    { title: '调用', dataIndex: 'calls', width: 70 },
    { title: '耗时', dataIndex: 'ms', width: 90, render: (v: number) => `${Math.round(v / 1000)}s` },
    { title: '证据', dataIndex: 'evidenceCount', width: 70 },
  ];

  const compareColumns = [
    { title: '#', dataIndex: 'id', width: 70 },
    { title: '基线输出', dataIndex: ['baseline', 'raw'], width: 240, render: (v: string) => <Text type="secondary">{(v || '（空）').slice(0, 60)}</Text> },
    { title: '基线分', dataIndex: ['baseline', 'score'], width: 80 },
    { title: '修复后', dataIndex: 'answer', width: 200, render: (v: string) => (v || '（空）').slice(0, 50) },
    { title: '严格(原始)', dataIndex: 'strictPassRaw', width: 100, render: (v: boolean) => <PassTag ok={v} /> },
    { title: '严格(规范化)', dataIndex: 'strictPass', width: 120, render: (v: boolean) => <PassTag ok={v} /> },
    {
      title: '语义：基线 → 修复',
      width: 200,
      render: (_: any, r: any) => {
        const s = SEMANTIC[r.id];
        return s ? <Text>{s[0]} → {s[1]}</Text> : <Text type="secondary">未人工判定</Text>;
      },
    },
  ];

  return (
    <main style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>
      <Title level={2} style={{ marginBottom: 4 }}>
        三层嵌套编排 · InfiniteBench
      </Title>
      <Paragraph type="secondary" style={{ marginTop: 0 }}>
        平台引擎 <Text code>@horsecoder/flow</Text> 原生嵌套：<Text code>main → read(子流程) → verify(子流程)</Text>。
        共 30 条问题，全部为基线失败样本；对照口径为“同一输入、同一模型 gpt-6-sol”。
      </Paragraph>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="结论先行"        description={
          <span>
            严格匹配 <b>{normPass}/30</b>（规范化后）/ <b>{rawPass}/30</b>（原始）。精确串类（passkey / number_string / kv）8/9；
            长文问答 4/18；代码类 0/3。<b>这套结构的适用边界是“答案有唯一字面锚点”</b>，长文聚合类受限于覆盖率（单条只读全文 0.6%）。
            第三层的可测量收益只有 1 条（格式契约），详见 docs/ORCHESTRATION.md。
          </span>
        }
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={4}><Card size="small"><Statistic title="严格（规范化）" value={normPass} suffix="/30" /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="严格（原始）" value={rawPass} suffix="/30" /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="契约通过（≠答对）" value={contractPass} suffix="/30" /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="模型调用" value={calls} suffix="次" /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="单条平均" value={avgMs} suffix="s" /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="基线严格" value={0} suffix="/30" /></Card></Col>
      </Row>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'structure',
            label: '编排结构',
            children: (
              <div>
                <Paragraph type="secondary">
                  蓝色 = 事件节点（调模型或纯计算），紫色 = 子流程（引擎递归进入），最下方是两层消融结构。
                </Paragraph>
                <div style={{ height: 760, border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden', background: '#fafafa' }}>
                  <VisualDiagram ref={diagramRef} canvasConfig={canvasConfig} onChange={() => {}} />
                </div>
              </div>
            ),
          },
          {
            key: 'results',
            label: `30 条结果${rows.length ? '' : '（加载中）'}`,
            children: err ? (
              <Alert type="warning" showIcon title="结果未加载" description={`${err}（先跑 pnpm orchestrate --all，再刷新）`} />
            ) : (
              <Table
                size="small"
                rowKey="id"
                columns={resultColumns as any}
                dataSource={rows}
                scroll={{ x: 1100 }}
                pagination={{ pageSize: 15 }}
                expandable={{
                  expandedRowRender: (r: any) => (
                    <div>
                      <Paragraph style={{ marginBottom: 6 }}>
                        <b>引擎 trace</b>：
                        {(r.trace ?? []).map((t: any) => (
                          <Tag key={`${t.flowId}-${t.nodeId}`} color={t.status === 'ok' ? 'blue' : 'red'}>
                            depth{t.depth} {t.nodeId} · {t.status} · {(t.endedAt ?? 0) - t.startedAt}ms
                          </Tag>
                        ))}
                      </Paragraph>
                      <Paragraph style={{ marginBottom: 0 }}><b>证据（逐字可回溯）</b></Paragraph>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {(r.evidence ?? []).map((e: any, i: number) => (
                          <li key={i}>
                            <Text code>{e.chunkId}</Text> {e.verified ? <Tag color="green">verified</Tag> : <Tag>unverified</Tag>}
                            <Text> {e.quote}</Text>
                          </li>
                        ))}
                        {(r.evidence ?? []).length === 0 && <li><Text type="secondary">无证据</Text></li>}
                      </ul>
                    </div>
                  ),
                }}
              />
            ),
          },
          {
            key: 'compare',
            label: '修复前后对照',
            children: (
              <Table
                size="small"
                rowKey="id"
                columns={compareColumns as any}
                dataSource={rows}
                pagination={{ pageSize: 15 }}
                scroll={{ x: 1200 }}
              />
            ),
          },
          {
            key: 'commands',
            label: '复现命令',
            children: (
              <Card size="small">
                <Paragraph>页面是静态导出的，<b>没有“运行”按钮</b>——执行在服务端命令行，结果落盘后由本页读取。</Paragraph>
                <pre style={{ background: '#fafafa', padding: 12, borderRadius: 6, overflowX: 'auto' }}>
{`# 环境（一次性）
cp .env.example .env.local   # 填 DATA_DIR / BASELINE_DIR / OPENAI_*

# 三方对账（方案表 / 数据集 / 基线原件）
pnpm orchestrate --check-issues

# 结构校验 + 反向测试（不需要模型）
pnpm orchestrate --validate
pnpm orchestrate --selftest-validator

# 跑 30 条（4 路并发，约 5 分钟）
pnpm orchestrate --all

# 只重算判分（改判分规则后，0 次模型调用）
pnpm orchestrate --rescore main30v2`}
                </pre>
              </Card>
            ),
          },
        ]}
      />
    </main>
  );
}
