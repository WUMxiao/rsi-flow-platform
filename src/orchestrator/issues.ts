// issues.jsonl 读取（交付物本身就是数据源，CLI 与页面共用同一份）
import fs from 'node:fs';

import { ISSUES_FILE } from './env.ts';
import type { Issue } from './types.ts';

let cached: Issue[] | null = null;

export function loadIssues(): Issue[] {
  if (cached) return cached;
  const raw = fs.readFileSync(ISSUES_FILE, 'utf8');
  cached = raw
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Issue);
  return cached;
}

export function findIssue(id: string): Issue {
  const hit = loadIssues().find((i) => i.id === id);
  if (!hit) {
    throw new Error(`issues.jsonl 里没有 ${id}；先跑 pnpm orchestrate --check-issues`);
  }
  return hit;
}

export function mainIssues(): Issue[] {
  return loadIssues().filter((i) => i.failureType !== 'CTRL');
}
