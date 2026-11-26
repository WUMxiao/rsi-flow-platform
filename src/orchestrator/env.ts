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

export const ISSUES_FILE = path.join(ROOT, 'data', 'issues.jsonl');
export const RESULTS_DIR = path.join(ROOT, 'public', 'results');

/** 启动前校验必需的目录，报错要能直接指向 .env.local 的哪一行 */
export function assertEnv(): void {
  const problems: string[] = [];
  if (!DATA_DIR) problems.push('DATA_DIR 未设置');
  else if (!fs.existsSync(DATA_DIR)) problems.push(`DATA_DIR 不存在: ${DATA_DIR}`);

  if (!BASELINE_DIR) problems.push('BASELINE_DIR 未设置');
  else if (!fs.existsSync(BASELINE_DIR)) problems.push(`BASELINE_DIR 不存在: ${BASELINE_DIR}`);

  if (problems.length) {
    throw new Error(
      '环境未就绪：\n  - ' +
        problems.join('\n  - ') +
        '\n请在 rsi-flow-platform/.env.local 补齐（参考 .env.example）',
    );
  }
}

export function requireModelCredentials(): { baseUrl: string; apiKey: string } {
  if (!OPENAI_BASE_URL || !OPENAI_API_KEY) {
    throw new Error('缺少 OPENAI_BASE_URL / OPENAI_API_KEY（.env.local）');
  }
  return { baseUrl: OPENAI_BASE_URL, apiKey: OPENAI_API_KEY };
}
