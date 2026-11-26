// 编排层 CLI。
// S1 只实现 --check-issues：把"方案表 / 数据集 / 基线原件"三方对账，
// 并生成 data/issues.jsonl。后续步骤在这里加 --issue / --all / --ablation。
import fs from 'node:fs';
import path from 'node:path';

import { FLOWS } from '../flows/flows_my.ts';
import { loadBaseline } from './baseline.ts';
import { ctxSha1, goldOf, loadSamples } from './dataset.ts';
import { assertEnv, BASELINE_DIR, DATA_DIR, ISSUES_FILE, MODEL } from './env.ts';
import { SEED, seedByTask, type SeedIssue } from './issues.seed.ts';
import { normalize, normalizeInput, verdict } from './score.ts';
import type { BaselineRecord, Issue, RawSample } from './types.ts';

type Status = 'PASS' | 'WARN' | 'FAIL';

interface Row {
  seed: SeedIssue;
  status: Status;
  problems: string[];
  warnings: string[];
  sample?: RawSample;
  baseline?: BaselineRecord;
  issue?: Issue;
}

interface TaskScan {
  samples: Map<string, RawSample>;
  baselines: Map<string, BaselineRecord>;
  elapsedMs: number;
  error?: string;
}

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const trunc = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n - 1) + '…');

async function scanTask(task: string, seeds: SeedIssue[]): Promise<TaskScan> {
  const ids = seeds.map((s) => s.sampleId);
  const t0 = Date.now();
  try {
    const samples = await loadSamples(task, ids);
    const baselines = await loadBaseline(task, ids);
    return { samples, baselines, elapsedMs: Date.now() - t0 };
  } catch (err) {
    return {
      samples: new Map(),
      baselines: new Map(),
      elapsedMs: Date.now() - t0,
      error: (err as Error).message,
    };
  }
}

function evaluate(seed: SeedIssue, scan: TaskScan): Row {
  const problems: string[] = [];
  const warnings: string[] = [];
  const row: Row = { seed, status: 'PASS', problems, warnings };

  if (scan.error) {
    problems.push(`任务扫描失败：${scan.error}`);
    row.status = 'FAIL';
    return row;
  }

  const sample = scan.samples.get(seed.sampleId);
  if (!sample) {
    problems.push(`数据集里找不到 ${seed.task} #${seed.sampleId}`);
    row.status = 'FAIL';
    return row;
  }
  row.sample = sample;

  // 1) context 长度
  const actualCtx = sample.context.length;
  if (actualCtx !== seed.ctxChars) {
    problems.push(`ctx 长度不符：方案 ${seed.ctxChars} / 数据 ${actualCtx}`);
  }

  // 2) gold
  const gold = goldOf(sample);
  if (gold.length === 0) problems.push('数据 answer 为空');
  if (seed.goldAlternatives) {
    const allowed = new Set(seed.goldAlternatives.map(normalize));
    const bad = gold.filter((g) => !allowed.has(normalize(g)));
    if (bad.length) problems.push(`gold 不在方案集合内：${JSON.stringify(bad)}`);
  }

  // 3) 问题原文（软校验）
  if (seed.inputHint) {
    const a = normalizeInput(seed.inputHint);
    const b = normalizeInput(sample.input);
    if (a !== b) warnings.push(`问题原文有出入：方案「${trunc(seed.inputHint, 40)}」/ 数据「${trunc(sample.input, 40)}」`);
  }

  // 4) 基线
  const base = scan.baselines.get(seed.sampleId);
  if (!base) {
    problems.push(`基线原件里找不到 ${seed.task} #${seed.sampleId}`);
  } else {
    row.baseline = base;
    if (seed.baselineExpected !== null && normalize(base.raw) !== normalize(seed.baselineExpected)) {
      problems.push(`基线原文不符：方案「${seed.baselineExpected}」/ 原件「${trunc(base.raw, 50)}」`);
    }
  }

  row.status = problems.length ? 'FAIL' : warnings.length ? 'WARN' : 'PASS';
  return row;
}

function buildIssue(row: Row): Issue | undefined {
  const { seed, sample, baseline } = row;
  if (!sample || !baseline) return undefined;
  return {
    id: seed.id,
    task: seed.task,
    sampleId: seed.sampleId,
    input: sample.input,
    gold: goldOf(sample),
    ctxChars: sample.context.length,
    ctxSha1: ctxSha1(sample.context),
    failureType: seed.failureType,
    baseline: {
      model: baseline.model,
      raw: baseline.raw,
      score: baseline.score,
      keepRatio: baseline.keepRatio,
      promptTokens: baseline.promptTokens,
      completionTokens: baseline.completionTokens,
    },
    note: seed.note,
  };
}

async function checkIssues(): Promise<number> {
  assertEnv();
  console.log(`DATA_DIR     = ${DATA_DIR}`);
  console.log(`BASELINE_DIR = ${BASELINE_DIR}`);
  console.log(`MODEL        = ${MODEL}\n`);

  const scans = new Map<string, TaskScan>();
  for (const [task, seeds] of seedByTask()) {
    const scan = await scanTask(task, seeds);
    scans.set(task, scan);
    const ok = !scan.error;
    console.log(
      `· ${pad(task, 20)} ${(scan.elapsedMs / 1000).toFixed(1)}s  样本 ${scan.samples.size}/${seeds.length}  基线 ${scan.baselines.size}/${seeds.length}${ok ? '' : '  ERR ' + scan.error}`,
    );
  }
  console.log('');

  const rows = SEED.map((seed) => evaluate(seed, scans.get(seed.task)!));

  console.log(`${pad('ID', 7)}${pad('TASK', 19)}${pad('SID', 5)}${pad('CTX', 10)}${pad('GOLD', 26)}${pad('BASELINE', 24)}R`);
  console.log('-'.repeat(96));
  for (const row of rows) {
    const { seed, sample, baseline } = row;
    const ctx = sample ? String(sample.context.length) : '-';
    const gold = sample ? JSON.stringify(goldOf(sample)) : '-';
    const base = baseline ? `s=${baseline.score} ${verdict(baseline.raw, goldOf(sample!)).reason}` : 'missing';
    console.log(
      `${pad(seed.id, 7)}${pad(seed.task, 19)}${pad(seed.sampleId, 5)}${pad(ctx, 10)}${pad(trunc(gold, 25), 26)}${pad(trunc(base, 23), 24)}${row.status}`,
    );
  }

  const bad = rows.filter((r) => r.status !== 'PASS');
  if (bad.length) {
    console.log('\n差异明细：');
    for (const row of bad) {
      for (const p of row.problems) console.log(`  [FAIL] ${row.seed.id} ${p}`);
      for (const w of row.warnings) console.log(`  [WARN] ${row.seed.id} ${w}`);
    }
  }

  // context 去重报告：长文档场景下同一 context 会被多个问题共用
  const byHash = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.sample) continue;
    const h = ctxSha1(row.sample.context);
    byHash.set(h, [...(byHash.get(h) ?? []), row.seed.id]);
  }
  const dups = [...byHash.entries()].filter(([, ids]) => ids.length > 1);
  if (dups.length) {
    console.log('\ncontext 去重（同一份全文，只读一次）：');
    for (const [h, ids] of dups) console.log(`  ${h}  ${ids.join(' / ')}`);
  }

  const failed = rows.filter((r) => r.status === 'FAIL');
  if (failed.length === 0) {
    const issues = rows.map(buildIssue).filter((x): x is Issue => Boolean(x));
    fs.mkdirSync(path.dirname(ISSUES_FILE), { recursive: true });
    // 保留扩容样本（不在 SEED 里的行），否则重新对账会把 IB-11..IB-30 冲掉
    const seedIds = new Set(SEED.map((s) => s.id));
    let extra: Issue[] = [];
    if (fs.existsSync(ISSUES_FILE)) {
      extra = fs
        .readFileSync(ISSUES_FILE, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Issue)
        .filter((r) => !seedIds.has(r.id));
    }
    const merged = [...issues, ...extra].sort((a, b) => a.id.localeCompare(b.id));
    fs.writeFileSync(ISSUES_FILE, merged.map((i) => JSON.stringify(i)).join('\n') + '\n', 'utf8');
    console.log(`\n已写入 ${path.relative(process.cwd(), ISSUES_FILE)}（${merged.length} 条，其中扩容样本 ${extra.length} 条）`);
  } else {
    console.log(`\n${failed.length} 条未通过，未写入 issues.jsonl`);
  }

  const warns = rows.filter((r) => r.status === 'WARN').length;
  console.log(`\n合计 ${rows.length} 条：PASS ${rows.length - failed.length - warns} / WARN ${warns} / FAIL ${failed.length}`);
  return failed.length === 0 ? 0 : 1;
}

function printStructure(flows: Record<string, any>, flowId: string, depth: number, prefix: string): void {
  const cfg = flows[flowId];
  if (!cfg) {
    console.log(`${prefix}! 流程不存在: ${flowId}`);
    return;
  }
  console.log(`${prefix}${flowId}${depth ? `  (depth ${depth})` : ''}`);
  cfg.nodes.forEach((n: any, i: number) => {
    const last = i === cfg.nodes.length - 1;
    const branch = last ? '└─' : '├─';
    const child = last ? '   ' : '│  ';
    if (n.type === 'flow') {
      console.log(`${prefix}${branch} ${pad(n.id, 9)} flow   →`);
      printStructure(flows, n.reference, depth + 1, `${prefix}${child}   `);
    } else {
      console.log(`${prefix}${branch} ${pad(n.id, 9)} event  → ${n.reference}`);
    }
  });
}

async function validateConfigs(): Promise<number> {
  const { formatIssues, hasError, validateAll } = await import('./validate.ts');
  const issues = validateAll(FLOWS as any);
  console.log(formatIssues(issues));
  const errs = issues.filter((i) => i.level === 'error').length;
  console.log(`\n结构校验：error ${errs} / warn ${issues.length - errs}`);
  return hasError(issues) ? 1 : 0;
}

async function selfTestValidator(): Promise<number> {
  const { hasError, mutationCases, validateAll } = await import('./validate.ts');
  const base = JSON.parse(JSON.stringify(FLOWS));
  const cases = mutationCases();
  let caught = 0;

  console.log('反向测试：故意破坏结构，确认校验器能抓（不抓 = 约束是装饰）\n');
  for (const c of cases) {
    const copy = JSON.parse(JSON.stringify(base));
    c.mutate(copy);
    const issues = validateAll(copy);
    const hit = issues.some((i) => i.rule === c.expectRule && i.level === 'error');
    if (hit) caught += 1;
    console.log(`${hit ? 'CAUGHT' : 'MISSED'}  ${pad(c.expectRule, 4)}${c.name}`);
  }

  const clean = !hasError(validateAll(JSON.parse(JSON.stringify(base))));
  console.log(`${clean ? 'CLEAN ' : 'DIRTY '}     原始结构 ${clean ? '无 error（无假阳性）' : '有 error（假阳性）'}`);
  console.log(`\n合计：${caught}/${cases.length} 个破坏被捕获${clean ? '，原始结构零误报' : ''}`);
  return caught === cases.length && clean ? 0 : 1;
}

/** 检索体检：12 条全部跑 code.plan（不调模型），看候选块与命中率 */
async function planReport(): Promise<number> {
  const { loadIssues } = await import('./issues.ts');
  const { hitRankTexts, softHitRank } = await import('./retrieve.ts');
  const { planStep } = await import('./steps/plan.ts');

  const issues = loadIssues();
  console.log(`${pad('ID', 7)}${pad('TASK', 19)}${pad('CHUNKS', 8)}${pad('TOP', 6)}${pad('RANK', 6)}${pad('SOFT', 6)}${pad('MS', 7)}NOTE`);
  console.log('-'.repeat(96));
  let hit3 = 0;
  let hit1 = 0;
  let softHit = 0;

  for (const issue of issues) {
    const t0 = Date.now();
    let rank = -1;
    let soft = -1;
    let chunkTotal = 0;
    let selected = 0;
    let note = '';
    try {
      const plan = await planStep({ issue, sampleId: issue.sampleId, runId: 'plan-report', useLlm: false });
      const meta = plan.planMeta as any;
      chunkTotal = Number(meta.chunkTotal ?? 0);
      selected = plan.chunks.length;
      const texts = plan.chunks.map((c) => c.text);
      rank = hitRankTexts(texts, issue.gold, 3);
      soft = softHitRank(texts, issue.gold, 3);
      if (meta.fallback) note = `fallback=${meta.fallback}`;
      if (issue.gold.every((g) => g.length < 2)) note = 'gold 太短，跳过硬判定';
    } catch (err) {
      note = err instanceof Error ? err.message : String(err);
      rank = -2;
    }
    const ms = Date.now() - t0;
    if (rank > 0) {
      hit3 += 1;
      if (rank === 1) hit1 += 1;
    }
    if (soft > 0) softHit += 1;
    const rankText = rank === -1 ? 'n/a' : rank === 0 ? 'MISS' : rank === -2 ? 'ERR' : String(rank);
    const softText = soft === -1 ? 'n/a' : soft === 0 ? '-' : `~${soft}`;
    console.log(
      `${pad(issue.id, 7)}${pad(issue.task, 19)}${pad(String(chunkTotal), 8)}${pad(String(selected), 6)}${pad(rankText, 6)}${pad(softText, 6)}${pad(String(ms), 7)}${note}`,
    );
  }

  console.log(`\n硬命中（gold 逐字出现在前 3 块）：${hit3}/${issues.length}，其中第 1 名 ${hit1} 条`);
  console.log(`软命中（gold 里的长词出现在前 3 块）：${softHit}/${issues.length}`);
  return 0;
}

/** 单条问题走平台引擎（真嵌套 + 真节点），S4 起用于验收 read */
async function runEngine(id: string): Promise<number> {
  const { findIssue } = await import('./issues.ts');
  const { llmStats, resetLlmStats } = await import('./llm.ts');
  const { runOrchestration } = await import('./bootstrap.ts');

  const issue = findIssue(id);
  resetLlmStats();
  const t0 = Date.now();
  const { result, trace } = await runOrchestration({
    issue,
    sampleId: issue.sampleId,
    runId: `engine-${t0}`,
    traceId: `T-${t0}`,
    stopAfterRead: false,
  });
  const elapsed = Date.now() - t0;
  const stats = llmStats();

  console.log('=== trace ===');
  console.log(`${pad('depth', 7)}${pad('flowId', 22)}${pad('nodeId', 12)}${pad('status', 8)}${pad('ms', 7)}in → out`);
  for (const e of trace) {
    console.log(
      `${pad(String(e.depth), 7)}${pad(e.flowId, 22)}${pad(e.nodeId, 12)}${pad(e.status, 8)}${pad(String((e.endedAt ?? 0) - e.startedAt), 7)}[${e.inKeys.join(',')}] → [${e.outKeys.join(',')}]`,
    );
  }

  const evidence = (result.evidence ?? []) as Array<{ chunkId: string; quote: string; verified: boolean }>;
  console.log('\n=== 证据 ===');
  if (!evidence.length) console.log('  （空）');
  evidence.slice(0, 6).forEach((e, i) => {
    console.log(`  ${i + 1}. [${e.verified ? 'VERIFIED' : 'unverified'}] ${e.chunkId}  ${e.quote.slice(0, 110).replace(/\s+/g, ' ')}`);
  });

  console.log('\n=== 返回 ===');
  console.log(`  finalAnswer = ${JSON.stringify(result.finalAnswer)}`);
  console.log(`  verdict     = ${JSON.stringify(result.verdict)}`);
  console.log(`  readTokens  = ${String(result.readTokens)}`);
  if (result.failed !== undefined) console.log(`  failed      = ${JSON.stringify(result.failed)}  failReason = ${JSON.stringify(result.failReason)}`);
  if (result.stoppedBy !== undefined) console.log(`  stoppedBy   = ${JSON.stringify(result.stoppedBy)}`);

  if (!evidence.length) {
    const { lastReadDebug } = await import('./steps/read.ts');
    console.log('\n=== read 调试（证据为空）===');
    for (const d of lastReadDebug()) {
      console.log(`  batch#${d.index} chunks=${d.chunkIds.join(',')} parsedOk=${d.parsedOk} evidence=${d.evidenceCount} err=${d.error || '-'}`);
      console.log(`    raw: ${d.rawHead.replace(/\s+/g, ' ').slice(0, 220)}`);
    }
  }

  console.log(`\n=== 成本 === ${stats.calls} 次调用  prompt ${stats.promptTokens} / completion ${stats.completionTokens} token，耗时 ${(elapsed / 1000).toFixed(1)}s`);

  const verified = evidence.filter((e) => e.verified).length;
  const checks: Array<[string, boolean]> = [
    ['trace 里三个节点都执行', trace.filter((t) => t.status === 'ok').length >= 3],
    ['证据非空', evidence.length > 0],
    ['至少一条证据逐字可回溯', verified > 0],
    ['gold 出现在证据里', evidence.some((e) => issue.gold.some((g) => g.length >= 2 && e.quote.toLowerCase().includes(g.toLowerCase())))],
  ];
  console.log('\n=== 断言 ===');
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  return checks.every(([, ok]) => ok) ? 0 : 1;
}

/** 全量 10 条：走引擎跑完，落盘 public/results/results.json */
async function runAll(): Promise<number> {
  const { mainIssues } = await import('./issues.ts');
  const { llmStats, resetLlmStats } = await import('./llm.ts');
  const { runOrchestration } = await import('./bootstrap.ts');
  const { verdict } = await import('./score.ts');
  const { RESULTS_DIR } = await import('./env.ts');

  const allIssues = mainIssues();
  const onlyIdx = process.argv.indexOf('--only');
  const only = onlyIdx >= 0 ? String(process.argv[onlyIdx + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : [];
  const issues = only.length ? allIssues.filter((i) => only.includes(i.id)) : allIssues;

  let calls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  const startedAll = Date.now();

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const tagIdx = process.argv.indexOf('--tag');
  const tag = tagIdx >= 0 ? String(process.argv[tagIdx + 1] ?? '') : '';
  const outFile = path.join(RESULTS_DIR, tag ? `results.${tag}.json` : 'results.json');

  // 结果按 id 累积写入：部分重跑时保留其他条目，避免整份文件被冲掉
  const priorRows: any[] = fs.existsSync(outFile) ? ((JSON.parse(fs.readFileSync(outFile, 'utf8')) as any).rows ?? []) : [];
  const store = new Map<string, any>(priorRows.map((r: any) => [r.id, r]));
  const writeStore = () => {
    const merged = allIssues.map((i) => store.get(i.id)).filter(Boolean);
    fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), rows: merged }, null, 2), 'utf8');
  };

  for (let i = 0; i < issues.length; i += 1) {
    const issue = issues[i];
    resetLlmStats();
    const t0 = Date.now();
    let result: Record<string, unknown> = {};
    let trace: any[] = [];
    let fatal = '';
    try {
      const r = await runOrchestration({
        issue,
        sampleId: issue.sampleId,
        runId: `all-${t0}-${issue.id}`,
        traceId: `T-${issue.id}`,
        stopAfterRead: false,
      });
      result = r.result;
      trace = r.trace;
    } catch (err) {
      fatal = err instanceof Error ? err.message : String(err);
    }
    const stats = llmStats();
    calls += stats.calls;
    promptTokens += stats.promptTokens;
    completionTokens += stats.completionTokens;

    const answer = String(result.finalAnswer ?? '');
    const v = verdict(answer, issue.gold);
    const evidence = (result.evidence ?? []) as any[];
    const row = {
      id: issue.id,
      task: issue.task,
      sampleId: issue.sampleId,
      failureType: issue.failureType,
      gold: issue.gold,
      answer,
      verdict: result.verdict ?? { pass: false, reason: fatal ? 'fatal' : 'missing' },
      autoPass: v.pass,
      autoReason: v.reason,
      baseline: issue.baseline,
      ctxChars: issue.ctxChars,
      ms: Date.now() - t0,
      calls: stats.calls,
      promptTokens: stats.promptTokens,
      completionTokens: stats.completionTokens,
      evidenceCount: evidence.length,
      verifiedCount: evidence.filter((e) => e && e.verified).length,
      trace,
      error: fatal,
    };
    store.set(issue.id, row);
    writeStore();

    console.log(
      `[${i + 1}/${issues.length}] ${pad(issue.id, 6)} ${pad(issue.task, 18)} ans=${JSON.stringify(answer).slice(0, 26)} ` +
        `auto=${row.autoPass ? 'PASS' : 'miss'} base=${issue.baseline.score} calls=${stats.calls} ${(row.ms / 1000).toFixed(0)}s`,
    );
  }

  const finalRows = allIssues.map((i) => store.get(i.id)).filter(Boolean);

  // 汇总表
  console.log(`\n${pad('ID', 7)}${pad('TASK', 19)}${pad('BASELINE', 30)}${pad('OURS', 26)}AUTO   CALLS  SEC`);
  console.log('-'.repeat(110));
  for (const r of finalRows) {
    console.log(
      `${pad(r.id, 7)}${pad(r.task, 19)}${pad(String(r.baseline.raw).replace(/\s+/g, ' ').slice(0, 28), 30)}${pad(String(r.answer).replace(/\s+/g, ' ').slice(0, 24), 26)}${pad(r.autoPass ? 'PASS' : 'miss', 7)}${pad(String(r.calls), 6)}${Math.round(r.ms / 1000)}`,
    );
  }

  const pass = finalRows.filter((r: any) => r.autoPass).length;
  const basePass = finalRows.filter((r: any) => r.baseline.score >= 0.5).length;
  console.log(`\n自动判定：修复后 ${pass}/${finalRows.length} 通过，基线（官方分 ≥0.5）${basePass}/${finalRows.length}`);
  console.log(`本轮调用 ${calls} 次${only.length ? `（仅重跑 ${only.join(',')}）` : ''}，prompt ${promptTokens} / completion ${completionTokens} token，耗时 ${((Date.now() - startedAll) / 60000).toFixed(1)} 分钟`);
  console.log(`结果已写入 ${path.relative(process.cwd(), outFile)}`);
  return 0;
}

/** 消融：同一批问题走两层结构（plan→read），答案取 read 的草稿 */
async function runAblation(): Promise<number> {
  const { mainIssues } = await import('./issues.ts');
  const { llmStats, resetLlmStats } = await import('./llm.ts');
  const { runOrchestration } = await import('./bootstrap.ts');
  const { verdict } = await import('./score.ts');
  const { RESULTS_DIR } = await import('./env.ts');

  const issues = mainIssues();
  const rows: any[] = [];
  let calls = 0;
  let prompt = 0;
  let completion = 0;
  const t0 = Date.now();
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = path.join(RESULTS_DIR, 'results.v2.json');

  for (let i = 0; i < issues.length; i += 1) {
    const issue = issues[i];
    resetLlmStats();
    const s = Date.now();
    let answer = '';
    let trace: any[] = [];
    let error = '';
    try {
      const r = await runOrchestration(
        { issue, sampleId: issue.sampleId, runId: `v2-${s}-${issue.id}`, traceId: `T2-${issue.id}`, stopAfterRead: false },
        'orchestration.v2',
      );
      const drafts = (r.result.drafts ?? []) as string[];
      answer = drafts.find((d) => d && d.trim()) ?? '';
      trace = r.trace;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const stats = llmStats();
    calls += stats.calls;
    prompt += stats.promptTokens;
    completion += stats.completionTokens;
    const v = verdict(answer, issue.gold);
    rows.push({
      id: issue.id,
      task: issue.task,
      gold: issue.gold,
      answer,
      autoPass: v.pass,
      autoReason: v.reason,
      ms: Date.now() - s,
      calls: stats.calls,
      trace,
      error,
    });
    fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), flow: 'orchestration.v2', rows }, null, 2), 'utf8');
    console.log(`[V2 ${i + 1}/${issues.length}] ${pad(issue.id, 6)} ans=${JSON.stringify(answer).slice(0, 26)} auto=${v.pass ? 'PASS' : 'miss'} calls=${stats.calls}`);
  }

  // 与三层结果对照（若存在）
  let mainRows: any[] = [];
  for (const candidate of ['results.pass1.json', 'results.json']) {
    const f = path.join(RESULTS_DIR, candidate);
    if (fs.existsSync(f)) {
      mainRows = (JSON.parse(fs.readFileSync(f, 'utf8')) as any).rows ?? [];
      if (mainRows.length) break;
    }
  }

  console.log(`\n${pad('ID', 7)}${pad('TASK', 19)}${pad('V2 两层', 24)}${pad('V3 三层', 24)}Δ`);
  console.log('-'.repeat(90));
  let v2pass = 0;
  let v3pass = 0;
  for (const r of rows) {
    const m = mainRows.find((x) => x.id === r.id);
    if (r.autoPass) v2pass += 1;
    if (m?.autoPass) v3pass += 1;
    console.log(
      `${pad(r.id, 7)}${pad(r.task, 19)}${pad(`${r.autoPass ? 'PASS' : 'miss'} ${String(r.answer).slice(0, 14)}`, 24)}${pad(`${m ? (m.autoPass ? 'PASS' : 'miss') : '-'} ${String(m?.answer ?? '').slice(0, 14)}`, 24)}${m ? (m.autoPass === r.autoPass ? '' : '≠') : ''}`,
    );
  }
  console.log(`\n两层 ${v2pass}/${rows.length} 通过，三层 ${v3pass}/${rows.length} 通过`);
  console.log(`消融调用 ${calls} 次，prompt ${prompt} / completion ${completion} token，耗时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
  return 0;
}

/** 按 docs/ISSUES.md §六 的规则扩容抽样（先注册、后抽题） */
async function expandIssues(): Promise<number> {
  const { loadIssues } = await import('./issues.ts');
  const { ctxSha1, goldOf, loadSamples } = await import('./dataset.ts');
  const { failingSampleIds } = await import('./baseline.ts');
  const { ISSUES_FILE, MODEL } = await import('./env.ts');

  const QUOTA: Array<[string, number, 'F1' | 'F4' | 'F6']> = [
    ['longbook_qa_chn', 10, 'F1'],
    ['passkey', 2, 'F4'],
    ['number_string', 2, 'F4'],
    ['kv_retrieval', 2, 'F6'],
    ['longbook_qa_eng', 2, 'F1'],
    ['code_debug', 2, 'F1'],
  ];

  const existing = loadIssues();
  const used = new Set(existing.map((r) => `${r.task}:${r.sampleId}`));
  const picks: Array<{ task: string; sid: string; type: 'F1' | 'F4' | 'F6' }> = [];

  for (const [task, n, type] of QUOTA) {
    const failing = await failingSampleIds(task);
    const chosen = failing.filter((id) => !used.has(`${task}:${id}`)).slice(0, n);
    if (chosen.length < n) console.warn(`  ! ${task} 只有 ${chosen.length} 个可用失败样本（需要 ${n}）`);
    for (const sid of chosen) picks.push({ task, sid, type });
  }

  const rows: any[] = [];
  let seq = 11;
  for (const p of picks) {
    const samples = await loadSamples(p.task, [p.sid]);
    const s = samples.get(p.sid);
    if (!s) {
      console.warn(`  ! 取不到 ${p.task}#${p.sid}`);
      continue;
    }
    const gold = goldOf(s);
    rows.push({
      id: `IB-${String(seq).padStart(2, '0')}`,
      task: p.task,
      sampleId: p.sid,
      input: s.input,
      gold,
      ctxChars: s.context.length,
      ctxSha1: ctxSha1(s.context),
      failureType: p.type,
      baseline: { model: MODEL, raw: '', score: 0, keepRatio: 0, promptTokens: 0, completionTokens: 0 },
      note: '扩容样本：按 docs/ISSUES.md §六 规则随机前 N 个基线失败样本',
    });
    seq += 1;
  }

  // 回填这些样本的基线原文（对照表要用）
  for (const r of rows) {
    const { loadBaseline } = await import('./baseline.ts');
    const b = (await loadBaseline(r.task, [r.sampleId])).get(r.sampleId);
    if (b) r.baseline = { model: b.model, raw: b.raw, score: b.score, keepRatio: b.keepRatio, promptTokens: b.promptTokens, completionTokens: b.completionTokens };
  }

  const all = [...existing, ...rows].sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(ISSUES_FILE, all.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  console.log(`${pad('ID', 7)}${pad('TASK', 19)}${pad('SID', 6)}${pad('CTX', 10)}GOLD`);
  for (const r of rows) {
    console.log(`${pad(r.id, 7)}${pad(r.task, 19)}${pad(r.sampleId, 6)}${pad(String(r.ctxChars), 10)}${JSON.stringify(r.gold).slice(0, 40)}`);
  }
  console.log(`\n新增 ${rows.length} 条，issues.jsonl 现共 ${all.length} 条`);
  return 0;
}

async function runIssue(id: string, opts: { dry: boolean; noLlm: boolean }): Promise<number> {
  const { findIssue } = await import('./issues.ts');
  const { llmStats, resetLlmStats } = await import('./llm.ts');
  const { hitRankTexts } = await import('./retrieve.ts');
  const { planStep } = await import('./steps/plan.ts');
  const { preview } = await import('./chunk.ts');

  const issue = findIssue(id);
  resetLlmStats();
  const t0 = Date.now();

  const plan = await planStep({
    issue,
    sampleId: issue.sampleId,
    runId: `cli-${t0}`,
    useLlm: !opts.noLlm,
  });
  const elapsed = Date.now() - t0;
  const stats = llmStats();
  const rank = hitRankTexts(plan.chunks.map((c) => c.text), issue.gold, 3);

  console.log(`issue   ${issue.id}  ${issue.task} #${issue.sampleId}  ctx=${issue.ctxChars} chars  failure=${issue.failureType}`);
  console.log(`chunks  ${String((plan.planMeta as any).chunkTotal)} 块 × ${String((plan.planMeta as any).chunkSize)} 字符 → 选出 ${plan.chunks.length} 块`);
  console.log(`terms   anchors=${JSON.stringify((plan.planMeta as any).anchors)}`);
  console.log(`        keywords=${JSON.stringify(plan.keywords.slice(0, 12))}`);
  console.log(`contract ${JSON.stringify(plan.contract)}`);
  console.log('\n候选块：');
  plan.chunks.forEach((c, i) => {
    const hit = issue.gold.some((g) => g.length >= 2 && c.text.includes(g)) ? ' ← 含 gold' : '';
    console.log(`  #${i + 1}  ${pad(c.id, 6)} score=${pad(String(c.score), 7)} [${c.start}-${c.end}]${hit}`);
    console.log(`        ${preview(c.text, 120)}`);
  });

  console.log(`\ngold ${JSON.stringify(issue.gold)} 在前 3 块中的排名: ${rank === -1 ? '无（gold 太短，跳过）' : rank === 0 ? '未命中' : rank}`);
  console.log(`llm    ${stats.calls} 次调用  prompt ${stats.promptTokens} / completion ${stats.completionTokens} token，失败 ${stats.failures} 次`);
  console.log(`耗时   ${(elapsed / 1000).toFixed(1)}s`);

  const checks: Array<[string, boolean]> = [
    ['候选块数 ≤ 8', plan.chunks.length > 0 && plan.chunks.length <= 8],
    ['gold 出现在前 3 块', rank > 0],
    ['契约格式已确定', Boolean(plan.contract.answerFormat)],
  ];
  console.log('\n=== 断言 ===');
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);

  if (!opts.dry) {
    console.log('\n（S4 起：--issue 会继续跑 read/verify，当前仅完成 plan）');
  }
  return checks.every(([, ok]) => ok) ? 0 : 1;
}

async function smoke(stopAfterRead: boolean): Promise<number> {
  const { runOrchestration } = await import('./bootstrap.ts');
  // 结构自检必须零模型调用：离线开关交给 code.plan
  process.env.ORCHESTRATE_OFFLINE = '1';

  console.log('=== 结构（静态，来自 FlowConfig）===');
  printStructure(FLOWS as Record<string, any>, 'orchestration.main', 0, '');

  const input = {
    issue: { id: 'IB-06', task: 'passkey', input: 'What is the pass key?' },
    sampleId: '270',
    runId: stopAfterRead ? 'smoke-stop' : 'smoke-nest',
    traceId: 'T-0001',
    stopAfterRead,
  };

  const t0 = Date.now();
  const { result, trace } = await runOrchestration(input);
  const elapsed = Date.now() - t0;

  console.log(`\n=== 执行（动态，来自 trace，${elapsed}ms）===`);
  console.log(`${pad('depth', 7)}${pad('flowId', 22)}${pad('nodeId', 12)}${pad('status', 8)}${pad('ms', 6)}in → out`);
  for (const e of trace) {
    const ms = (e.endedAt ?? 0) - e.startedAt;
    console.log(
      `${pad(String(e.depth), 7)}${pad(e.flowId, 22)}${pad(e.nodeId, 12)}${pad(e.status, 8)}${pad(String(ms), 6)}[${e.inKeys.join(',')}] → [${e.outKeys.join(',')}]`,
    );
  }

  console.log('\n=== 返回（引擎按 results 裁剪后）===');
  console.log(JSON.stringify(result, null, 2));

  const ran = (id: string) => trace.some((t) => t.nodeId === id && t.status === 'ok');
  const readEntry = trace.find((t) => t.nodeId === 'code.read');
  const checks: Array<[string, boolean]> = [
    ['plan 在主编排里执行', ran('code.plan')],
    ['read 归属子流程 orchestration.read 且 depth=2', Boolean(readEntry && readEntry.flowId === 'orchestration.read' && readEntry.depth === 2)],
    ['traceId 穿过子流程的 params 裁剪', Boolean(readEntry && readEntry.inKeys.includes('traceId'))],
    ['子流程 read 的 results 合并回父 args', result.evidence !== undefined],
    [stopAfterRead ? 'verify 被跨层 stop 跳过' : 'verify 正常执行', stopAfterRead ? !ran('code.verify') : ran('code.verify')],
  ];
  if (stopAfterRead) {
    checks.push(['跨层 stop 生效（父流程拿到 stoppedBy）', result.stoppedBy === 'code.read']);
  } else {
    checks.push(['verify 的 results 合并回父（finalAnswer）', result.finalAnswer !== undefined]);
  }

  console.log('\n=== 断言 ===');
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} 通过`);
  return failed === 0 ? 0 : 1;
}

function usage(): void {
  console.log(`用法：node --env-file-if-exists=.env.local src/orchestrator/run.ts <命令>

命令：
  --check-issues        三方对账（方案表 / 数据集 / 基线原件）并生成 data/issues.jsonl
  --validate            静态校验 3 个 FlowConfig（8 条规则 + 数据流闭合）
  --selftest-validator  反向测试：故意破坏结构，确认校验器能抓
  --smoke-nest          空跑三层嵌套，打印结构与 trace
  --smoke-stop          空跑 + 跨层 stop，确认子流程能终止父流程
  --issue <id>          跑单条问题（S3 阶段只到 plan；加 --dry-plan 只看候选块）
  --dry-plan            只跑 code.plan，打印候选块与契约
  --engine <id>         单条问题走平台引擎全流程（真嵌套），打印 trace 与证据
  --plan-report         12 条全跑 code.plan（不调模型），体检检索命中率
  --no-llm              不调模型（契约用任务类型兜底），用于离线调试
  --all                 全量 10 条走引擎，落盘 public/results/results.json
  --ablation            （S6b）跑 V1/V2/V3 消融`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes('--check-issues')) return checkIssues();
  if (argv.includes('--validate')) return validateConfigs();
  if (argv.includes('--selftest-validator')) return selfTestValidator();
  if (argv.includes('--smoke-nest')) return smoke(false);
  if (argv.includes('--smoke-stop')) return smoke(true);
  if (argv.includes('--expand-issues')) return expandIssues();
  if (argv.includes('--ablation')) return runAblation();
  if (argv.includes('--all')) return runAll();
  if (argv.includes('--engine')) {
    const i = argv.indexOf('--engine');
    const id = argv[i + 1];
    if (!id || id.startsWith('--')) {
      console.error('--engine 需要一个 id，例如：--engine IB-06');
      return 2;
    }
    return runEngine(id);
  }
  if (argv.includes('--plan-report')) return planReport();
  if (argv.includes('--issue')) {
    const i = argv.indexOf('--issue');
    const id = argv[i + 1];
    if (!id || id.startsWith('--')) {
      console.error('--issue 需要一个 id，例如：--issue IB-06');
      return 2;
    }
    return runIssue(id, { dry: argv.includes('--dry-plan'), noLlm: argv.includes('--no-llm') });
  }
  usage();
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
