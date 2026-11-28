// 通过后端引擎跑全部 case，结果落到 cases/results/。
// 用法：node server/run-all-backend.mjs [并发数]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BACKEND = process.env.CASE_BACKEND ?? 'http://127.0.0.1:39910';
const FLOW_ID = process.env.CASE_FLOW ?? '@com.horsecoder.common.whuTalent.flowTesting.core/FLOW_RUN';
const CONCURRENCY = Number(process.argv[2] ?? 3);

const issues = fs
  .readFileSync(path.join(ROOT, 'data', 'issues.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l))
  .filter((r) => /^IB-\d+$/.test(r.id));

const outDir = path.join(ROOT, 'cases', 'results');
fs.mkdirSync(outDir, { recursive: true });

async function runOne(issue) {
  const t0 = Date.now();
  const res = await fetch(`${BACKEND}/facade/engine/flow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flowId: FLOW_ID, params: { structure: issue.id } }),
  });
  const text = await res.text();
  let payload = null;
  let parsed = null;
  try {
    payload = JSON.parse(text);
    parsed = JSON.parse(payload.result);
  } catch {
    /* 保留原文 */
  }
  const record = {
    caseId: issue.id,
    task: issue.task,
    sampleId: issue.sampleId,
    flowId: FLOW_ID,
    httpStatus: res.status,
    elapsedMs: Date.now() - t0,
    result: parsed,
    raw: parsed ? undefined : text.slice(0, 800),
  };
  fs.writeFileSync(path.join(outDir, `${issue.id}.json`), JSON.stringify(record, null, 2), 'utf8');
  return record;
}

const queue = [...issues];
const results = [];
async function worker() {
  while (queue.length) {
    const issue = queue.shift();
    try {
      const r = await runOne(issue);
      const p = r.result?.strictPass ? 'PASS' : 'miss';
      console.log(`${r.caseId} ${r.task.padEnd(18)} ${p} calls=${r.result?.calls ?? '-'} ${r.elapsedMs}ms`);
      results.push(r);
    } catch (e) {
      console.log(`${issue.id} ERROR ${e.message}`);
      results.push({ caseId: issue.id, error: String(e.message) });
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const ok = results.filter((r) => r.result);
const pass = ok.filter((r) => r.result.strictPass).length;
const passRaw = ok.filter((r) => r.result.strictPassRaw).length;
const summary = {
  backend: BACKEND,
  flowId: FLOW_ID,
  total: results.length,
  ok: ok.length,
  strictPass: pass,
  strictPassRaw: passRaw,
  totalCalls: ok.reduce((s, r) => s + (r.result.calls ?? 0), 0),
  elapsedMs: results.reduce((s, r) => s + (r.elapsedMs ?? 0), 0),
  results: results.map((r) => ({
    caseId: r.caseId,
    task: r.task,
    strictPass: r.result?.strictPass ?? null,
    strictPassRaw: r.result?.strictPassRaw ?? null,
    answer: r.result?.answer ?? null,
    calls: r.result?.calls ?? null,
    ms: r.elapsedMs ?? null,
    error: r.error ?? null,
  })),
};
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

const lines = [
  `# 后端执行结果（${FLOW_ID}）`,
  '',
  `- 后端：${BACKEND}`,
  `- 共 ${summary.total} 条，成功 ${summary.ok} 条`,
  `- 严格匹配：${summary.strictPass}/${summary.total}（原始口径 ${summary.strictPassRaw}/${summary.total}）`,
  `- 模型调用合计：${summary.totalCalls} 次`,
  '',
  '| # | 任务 | 答案 | 严格 | 调用 | 耗时 |',
  '|---|---|---|---|---|---|',
  ...summary.results.map(
    (r) => `| ${r.caseId} | ${r.task} | ${(r.answer ?? '').slice(0, 24)} | ${r.strictPass ? 'PASS' : 'miss'} | ${r.calls ?? '-'} | ${((r.ms ?? 0) / 1000).toFixed(0)}s |`,
  ),
  '',
];
fs.writeFileSync(path.join(outDir, 'summary.md'), lines.join('\n'), 'utf8');
console.log(`\n合计 ${summary.total} 条：strictPass ${summary.strictPass}/${summary.total}，调用 ${summary.totalCalls} 次`);
