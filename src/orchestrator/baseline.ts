// 读取已存的基线原件（gpt-6-sol / v3），按 sample_id 对齐。
// 基线是"修复前"的唯一权威来源：不重跑，避免把"换了上下文策略"混进对照。
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { BASELINE_DIR } from './env.ts';
import type { BaselineRecord } from './types.ts';

export function baselinePath(task: string): string {
  return path.join(BASELINE_DIR, `${task}.jsonl`);
}

export async function loadBaseline(task: string, ids: string[]): Promise<Map<string, BaselineRecord>> {
  const want = new Set(ids.map((x) => String(x)));
  const found = new Map<string, BaselineRecord>();

  const file = baselinePath(task);
  if (!fs.existsSync(file)) throw new Error(`基线文件不存在: ${file}`);

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
