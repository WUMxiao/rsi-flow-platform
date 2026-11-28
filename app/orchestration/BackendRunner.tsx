'use client';

// 后端运行面板：把 case 发到平台后端（Java 引擎）执行，结果就地展示。
import { Alert, Button, Card, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';

type CaseDef = {
  id: string;
  task: string;
  question: string;
  gold: string[];
  backendFlowId: string;
  backendParam: string;
};

type RunRow = {
  id: string;
  task: string;
  status: 'running' | 'ok' | 'fail';
  answer?: string;
  strict?: boolean;
  calls?: number;
  ms?: number;
  error?: string;
};

const { Text } = Typography;
const DEFAULT_BASE = 'http://127.0.0.1:39910';

export default function BackendRunner({ cases }: { cases: CaseDef[] }) {
  const [base, setBase] = useState(DEFAULT_BASE);
  const [only, setOnly] = useState<string>('IB-06');
  const [rows, setRows] = useState<RunRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem('case-backend');
    if (saved) setBase(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem('case-backend', base);
  }, [base]);

  const byId = useMemo(() => new Map(cases.map((c) => [c.id, c])), [cases]);

  async function runOne(id: string) {
    const def = byId.get(id);
    if (!def) return;
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== id);
      return [{ id, task: def.task, status: 'running' }, ...next];
    });
    const t0 = Date.now();
    try {
      const res = await fetch(`${base}/facade/engine/flow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flowId: def.backendFlowId, params: { [def.backendParam]: id } }),
      });
      const text = await res.text();
      const payload = JSON.parse(text);
      const inner = typeof payload.result === 'string' ? JSON.parse(payload.result) : payload.result;
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                status: 'ok',
                answer: String(inner?.answer ?? ''),
                strict: Boolean(inner?.strictPass),
                calls: Number(inner?.calls ?? 0),
                ms: Date.now() - t0,
              }
            : r,
        ),
      );
    } catch (e: any) {
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: 'fail', error: String(e?.message ?? e), ms: Date.now() - t0 } : r)),
      );
    }
  }

  async function runAll() {
    setBusy(true);
    try {
      for (const c of cases) {
        // 串行，避免把后端和网关打满
        await runOne(c.id);
      }
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { title: '案例', dataIndex: 'id', width: 90 },
    { title: '任务', dataIndex: 'task', width: 170 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) =>
        v === 'ok' ? <Tag color="green">完成</Tag> : v === 'fail' ? <Tag color="red">失败</Tag> : <Tag>运行中</Tag>,
    },
    {
      title: '答案',
      dataIndex: 'answer',
      render: (v: string, r: RunRow) => (r.error ? <Text type="danger">{r.error.slice(0, 60)}</Text> : <Text>{(v ?? '').slice(0, 40)}</Text>),
    },
    {
      title: '严格',
      dataIndex: 'strict',
      width: 90,
      render: (v: boolean) => (v ? <Tag color="green">PASS</Tag> : <Tag color="default">miss</Tag>),
    },
    { title: '调用', dataIndex: 'calls', width: 70 },
    { title: '耗时', dataIndex: 'ms', width: 90, render: (v: number) => (v ? `${Math.round(v / 1000)}s` : '-') },
  ];

  return (
    <Card size="small">
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          title="这一页会真的调用平台后端"
          description={
            <span>
              请求打到 <Text code>{base}/facade/engine/flow</Text>，由 Java 引擎执行流程，节点再回调本地 Node worker
              跑 plan → read → verify。需要先启动后端（39910）与 worker（39100）。
            </span>
          }
        />
        <Space wrap>
          <Text>后端地址</Text>
          <Input style={{ width: 260 }} value={base} onChange={(e) => setBase(e.target.value)} />
          <Text>案例</Text>
          <Select
            style={{ width: 180 }}
            value={only}
            onChange={setOnly}
            options={cases.map((c) => ({ value: c.id, label: `${c.id} · ${c.task}` }))}
          />
          <Button type="primary" disabled={busy} onClick={() => runOne(only)}>
            运行这一条
          </Button>
          <Button disabled={busy} loading={busy} onClick={runAll}>
            全部运行（30 条）
          </Button>
        </Space>
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 10, size: 'small' }}
          dataSource={rows}
          columns={columns as any}
          locale={{ emptyText: '还没有运行记录' }}
        />
      </Space>
    </Card>
  );
}
