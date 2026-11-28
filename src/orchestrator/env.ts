// 环境与路径。所有外部位置集中在这里，其他文件不直接读 process.env。
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname as string;

/** 仓库根目录（src/orchestrator → ../..） */
export const ROOT = path.resolve(here, '..', '..');

const env = process.env;

export const DATA_DIR = env.DATA_DIR ?? '';
export const BASELINE_DIR = env.BASELINE_DIR ?? '';
export const MODEL = env.MODEL ?? 'gpt-6-sol';
export const OPENAI_BASE_URL = env.OPENAI_BASE_URL ?? '';
export const OPENAI_API_KEY = env.OPENAI_API_KEY ?? '';

/** 切块与检索参数（做成 env 可调，S3 调参时不改代码） */
export const CHUNK_SIZE = Number(env.CHUNK_SIZE ?? 4000);
export const CHUNK_OVERLAP = Number(env.CHUNK_OVERLAP ?? 200);
export const TOP_K = Number(env.TOP_K ?? 5);

/** 读取层参数：一次调用塞几块（对抗单次 20–40s 延迟和 10k token 固定开销）
 *  8 块 → 6 个候选块一次读完，省一次往返 */
export const READ_BATCH = Number(env.READ_BATCH ?? 8);
export const READ_MAX_TOKENS = Number(env.READ_MAX_TOKENS ?? 500);

/** 全文分片（map-reduce 升级路径）：片大小与片数上限共同决定单条预算 */
export const SHARD_SIZE = Number(env.SHARD_SIZE ?? 40000);
export const MAX_SHARDS = Number(env.MAX_SHARDS ?? 16);

export const ISSUES_FILE = path.join(ROOT, 'data', 'issues.jsonl');
export const RESULTS_DIR = path.join(ROOT, 'public', 'results');

/** 启动前校验数据源：外部目录与仓库内样本包，二者有其一即可 */
export function assertEnv(): void {
  const problems: string[] = [];
  const ctxBundle = path.join(ROOT, 'data', 'contexts.jsonl.gz');
  const samplesIndex = path.join(ROOT, 'data', 'samples.jsonl');
  const baselineBundle = path.join(ROOT, 'data', 'baseline.jsonl');

  if (DATA_DIR && !fs.existsSync(DATA_DIR)) problems.push(`DATA_DIR 不存在: ${DATA_DIR}`);
  if (!DATA_DIR && !(fs.existsSync(ctxBundle) && fs.existsSync(samplesIndex))) {
    problems.push('DATA_DIR 未设置，且仓库内 data/contexts.jsonl.gz + data/samples.jsonl 不完整');
  }

  if (BASELINE_DIR && !fs.existsSync(BASELINE_DIR)) problems.push(`BASELINE_DIR 不存在: ${BASELINE_DIR}`);
  if (!BASELINE_DIR && !fs.existsSync(baselineBundle)) {
    problems.push('BASELINE_DIR 未设置，且仓库内 data/baseline.jsonl 不存在');
  }

  if (problems.length) {
    throw new Error(
      '环境未就绪：\n  - ' +
        problems.join('\n  - ') +
        '\n外部数据可选：不配 DATA_DIR/BASELINE_DIR 时，会回落到仓库内 data/contexts.jsonl.gz 与 data/baseline.jsonl',
    );
  }
}

export function requireModelCredentials(): { baseUrl: string; apiKey: string } {
  if (!OPENAI_BASE_URL || !OPENAI_API_KEY) {
    throw new Error('缺少 OPENAI_BASE_URL / OPENAI_API_KEY（.env.local）');
  }
  return { baseUrl: OPENAI_BASE_URL, apiKey: OPENAI_API_KEY };
}
