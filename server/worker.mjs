// Node worker：给 Java 节点调用的执行端。
// 复用已有的 TS 管线（plan → read → verify），不重写逻辑。
// 启动：node --env-file=.env.local server/worker.mjs
import http from 'node:http';

import { runOrchestration } from '../src/orchestrator/bootstrap.ts';
import { findIssue } from '../src/orchestrator/issues.ts';
import { verdict, verdictNormalized } from '../src/orchestrator/score.ts';

const PORT = Number(process.env.WORKER_PORT ?? 39100);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function runCase(caseId) {
  const issue = findIssue(caseId);
  const t0 = Date.now();
  const { result, trace } = await runOrchestration({
    issue,
    sampleId: issue.sampleId,
    runId: `worker-${Date.now()}-${caseId}`,
    traceId: `T-${caseId}`,
    stopAfterRead: false,
  });
  const answer = String(result.finalAnswer ?? '');
  const raw = verdict(answer, issue.gold);
  const norm = verdictNormalized(answer, issue.gold);
  const evidence = (result.evidence ?? []).slice(0, 6).map((e) => ({
    chunkId: e.chunkId,
    quote: String(e.quote ?? '').slice(0, 200),
    verified: Boolean(e.verified),
  }));
  return {
    caseId,
    task: issue.task,
    question: issue.input,
    gold: issue.gold,
    answer,
    strictPass: norm.pass,
    strictPassRaw: raw.pass,
    contractPass: Boolean(result.verdict?.pass),
    verdict: result.verdict ?? null,
    evidence,
    calls: trace.filter((t) => t.status === 'ok').length,
    trace,
    ms: Date.now() - t0,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/execute') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const caseId = String(body.caseId ?? '');
      if (!caseId) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'missing caseId' }));
        return;
      }
      const out = await runCase(caseId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out));
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`worker listening on http://127.0.0.1:${PORT}`);
});
