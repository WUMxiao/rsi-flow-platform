// 数据集读取：流式扫 jsonl，按 (task, sampleId) 取样本。
// 单文件最大 862MB / 单行约 4.5MB，所以：
//   1) 先用正则从行首抓 id，命中才 JSON.parse（避免对每行都解析 4.5MB）
//   2) 集齐目标 id 立刻中断读取
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { DATA_DIR } from './env.ts';
import type { RawSample } from './types.ts';

const ID_RE = /"id"\s*:\s*"?([^",}\s]+)"?/;

const sampleCache = new Map<string, RawSample>();
const hashCache = new Map<string, string>();

export function dataPath(task: string): string {
  return path.join(DATA_DIR, `${task}.jsonl`);
}

export function ctxSha1(ctx: string): string {
  return createHash('sha1').update(ctx, 'utf8').digest('hex').slice(0, 16);
}

export function goldOf(sample: RawSample): string[] {
  const a = sample.answer as unknown;
  if (Array.isArray(a)) return a.map((x) => String(x));
  if (a === null || a === undefined) return [];
  return [String(a)];
}

/** 批量取样本；一次扫描取全部，命中即缓存 */
export async function loadSamples(task: string, ids: string[]): Promise<Map<string, RawSample>> {
  const want = new Set(ids.map((x) => String(x)));
  const found = new Map<string, RawSample>();

  for (const id of want) {
    const hit = sampleCache.get(`${task}:${id}`);
    if (hit) found.set(id, hit);
  }
  if (found.size === want.size) return found;

  const file = dataPath(task);
  if (!fs.existsSync(file)) throw new Error(`数据文件不存在: ${file}`);

  const rl = createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      if (!line) continue;
      const m = ID_RE.exec(line);
      if (!m) continue;
      const id = m[1];
      if (!want.has(id) || found.has(id)) continue;

      const obj = JSON.parse(line) as Record<string, unknown>;
      const sample: RawSample = {
        id: String(obj.id),
        context: String(obj.context ?? ''),
        input: String(obj.input ?? ''),
        answer: (obj.answer ?? null) as RawSample['answer'],
        options: Array.isArray(obj.options) ? (obj.options as string[]) : [],
      };
      sampleCache.set(`${task}:${id}`, sample);
      hashCache.set(`${task}:${id}`, ctxSha1(sample.context));
      found.set(id, sample);

      if (found.size === want.size) break;
    }
  } finally {
    rl.close();
  }

  return found;
}

/** 已缓存的 context 指纹（避免重复算 sha1） */
export function cachedCtxSha1(task: string, sampleId: string): string | undefined {
  return hashCache.get(`${task}:${sampleId}`);
}

/** 列出数据目录里的任务名，用于 --check-issues 的完整性提示 */
export function listTasks(): string[] {
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.replace(/\.jsonl$/, ''))
    .sort();
}
