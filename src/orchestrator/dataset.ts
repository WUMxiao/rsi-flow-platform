// 数据集读取：流式扫 jsonl，按 (task, sampleId) 取样本。
// 单文件最大 862MB / 单行约 4.5MB，所以：
//   1) 先用正则从行首抓 id，命中才 JSON.parse（避免对每行都解析 4.5MB）
//   2) 集齐目标 id 立刻中断读取
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import zlib from 'node:zlib';

import { DATA_DIR, ROOT } from './env.ts';
import type { RawSample } from './types.ts';

const ID_RE = /"id"\s*:\s*"?([^",}\s]+)"?/;

const sampleCache = new Map<string, RawSample>();
const hashCache = new Map<string, string>();

/** 仓库内自带的样本包：context 按 sha1 存一次（28 份 / gzip 28 MB）+ 样本索引（32 行） */
const SAMPLES_INDEX = path.join(ROOT, 'data', 'samples.jsonl');
const CTX_BUNDLE = path.join(ROOT, 'data', 'contexts.jsonl.gz');

let indexCache: Map<string, { input: string; answer: RawSample['answer']; options: string[]; sha1: string }> | null = null;
let ctxCache: Map<string, string> | null = null;

function loadIndex() {
  if (indexCache) return indexCache;
  indexCache = new Map();
  if (!fs.existsSync(SAMPLES_INDEX)) return indexCache;
  for (const line of fs.readFileSync(SAMPLES_INDEX, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line) as Record<string, unknown>;
    indexCache.set(`${String(o.task)}:${String(o.sampleId)}`, {
      input: String(o.input ?? ''),
      answer: (o.answer ?? null) as RawSample['answer'],
      options: Array.isArray(o.options) ? (o.options as string[]) : [],
      sha1: String(o.sha1 ?? ''),
    });
  }
  return indexCache;
}

function loadContexts(): Map<string, string> {
  if (ctxCache) return ctxCache;
  ctxCache = new Map();
  if (!fs.existsSync(CTX_BUNDLE)) return ctxCache;
  const text = zlib.gunzipSync(fs.readFileSync(CTX_BUNDLE)).toString('utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line) as Record<string, unknown>;
    ctxCache.set(String(o.sha1), String(o.context ?? ''));
  }
  return ctxCache;
}

/** 从仓库内样本包取一条（context 按 sha1 共享，兄弟样本不会漏） */
function sampleFromBundle(task: string, id: string): RawSample | undefined {
  const meta = loadIndex().get(`${task}:${id}`);
  if (!meta) return undefined;
  const context = loadContexts().get(meta.sha1);
  if (context === undefined) return undefined;
  return { id, context, input: meta.input, answer: meta.answer, options: meta.options };
}

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

/** 批量取样本；一次扫描取全部，命中即缓存。优先外部 DATA_DIR，缺失时回落到仓库内样本包 */
export async function loadSamples(task: string, ids: string[]): Promise<Map<string, RawSample>> {
  const want = new Set(ids.map((x) => String(x)));
  const found = new Map<string, RawSample>();

  for (const id of want) {
    const hit = sampleCache.get(`${task}:${id}`);
    if (hit) {
      found.set(id, hit);
      hashCache.set(`${task}:${id}`, ctxSha1(hit.context));
    }
  }

  // 回落：仓库内自带的样本包
  if (found.size < want.size) {
    for (const id of want) {
      if (found.has(id)) continue;
      const hit = sampleFromBundle(task, id);
      if (hit) {
        sampleCache.set(`${task}:${id}`, hit);
        hashCache.set(`${task}:${id}`, ctxSha1(hit.context));
        found.set(id, hit);
      }
    }
  }
  if (found.size === want.size) return found;

  const file = DATA_DIR ? dataPath(task) : '';
  if (!file || !fs.existsSync(file)) {
    const missing = [...want].filter((id) => !found.has(id));
    throw new Error(
      `取不到样本 ${task} #${missing.join(',')}：DATA_DIR ${DATA_DIR ? '下没有 ' + file : '未设置'}，仓库内 data/contexts.jsonl.gz 也不含这些 id`,
    );
  }

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

/** 列出数据目录里的任务名；没有配置外部目录时返回空（样本包不按任务分文件） */
export function listTasks(): string[] {
  if (!DATA_DIR || !fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.replace(/\.jsonl$/, ''))
    .sort();
}
