// 读取已存的基线原件（gpt-6-sol / v3），按 sample_id 对齐。
// 基线是"修复前"的唯一权威来源：不重跑，避免把"换了上下文策略"混进对照。
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { BASELINE_DIR, ROOT } from './env.ts';
import type { BaselineRecord } from './types.ts';

/** 仓库内自带的基线记录（32 条，约 11 KB）：没有 BASELINE_DIR 时的回落来源 */
const BUNDLE_PATH = path.join(ROOT, 'data', 'baseline.jsonl');
let bundleCache: Map<string, BaselineRecord> | null = null;

function loadBundle(): Map<string, BaselineRecord> {
  if (bundleCache) return bundleCache;
  bundleCache = new Map();
  if (!fs.existsSync(BUNDLE_PATH)) return bundleCache;
  const text = fs.readFileSync(BUNDLE_PATH, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line) as Record<string, unknown>;
    const rec: BaselineRecord = {
      task: String(o.task ?? ''),
      sampleId: String(o.sample_id ?? ''),
      model: String(o.model ?? ''),
      raw: String(o.raw ?? ''),
      score: Number(o.score ?? 0),
      keepRatio: Number(o.keep_ratio ?? 0),
      promptTokens: Number(o.prompt_tokens ?? 0),
      completionTokens: Number(o.completion_tokens ?? 0),
      latencyS: 0,
      gold: Array.isArray(o.gold) ? (o.gold as string[]).map(String) : [],
    };
    bundleCache.set(`${rec.task}:${rec.sampleId}`, rec);
  }
  return bundleCache;
}

export function baselinePath(task: string): string {
  return path.join(BASELINE_DIR, `${task}.jsonl`);
}

export async function loadBaseline(task: string, ids: string[]): Promise<Map<string, BaselineRecord>> {
  const want = new Set(ids.map((x) => String(x)));
  const found = new Map<string, BaselineRecord>();

  // 先看仓库内基线包
  const bundle = loadBundle();
  for (const id of want) {
    const hit = bundle.get(`${task}:${id}`);
    if (hit) found.set(id, hit);
  }
  if (found.size === want.size) return found;

  const file = BASELINE_DIR ? baselinePath(task) : '';
  if (!file || !fs.existsSync(file)) {
    const missing = [...want].filter((id) => !found.has(id));
    throw new Error(
      `取不到基线 ${task} #${missing.join(',')}：BASELINE_DIR ${BASELINE_DIR ? '下没有 ' + file : '未设置'}，仓库内 data/baseline.jsonl 也不含这些 id`,
    );
  }

  const rl = createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const o = JSON.parse(line) as Record<string, unknown>;
      const sid = String(o.sample_id ?? '');
      if (!want.has(sid) || found.has(sid)) continue;

      found.set(sid, {
        task: String(o.task ?? task),
        sampleId: sid,
        model: String(o.model ?? ''),
        raw: String(o.raw ?? ''),
        score: Number(o.score ?? 0),
        keepRatio: Number(o.keep_ratio ?? 0),
        promptTokens: Number(o.prompt_tokens ?? 0),
        completionTokens: Number(o.completion_tokens ?? 0),
        latencyS: Number(o.latency_s ?? 0),
        gold: Array.isArray(o.gold) ? (o.gold as string[]).map(String) : [],
      });

      if (found.size === want.size) break;
    }
  } finally {
    rl.close();
  }

  return found;
}

/**
 * 列出基线失败的 sample_id（score === 0），按数值升序。
 * 扩容抽样用：规则是"基线失败的样本才入选"，这样分母里全是真实失败用例。
 */
export async function failingSampleIds(task: string): Promise<string[]> {
  const file = baselinePath(task);
  if (!fs.existsSync(file)) throw new Error(`基线文件不存在: ${file}`);
  const out: string[] = [];
  const rl = createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const o = JSON.parse(line) as Record<string, unknown>;
      if (Number(o.score ?? 0) === 0) out.push(String(o.sample_id ?? ''));
    }
  } finally {
    rl.close();
  }
  return out.filter(Boolean).sort((a, b) => Number(a) - Number(b));
}
