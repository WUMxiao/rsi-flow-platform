// 判分与答案规范化。
// S1 只需要"基线是否算答对"这一粗判；S6 会补 ROUGE / 精确匹配 / 契约校验。
// 这里刻意保持纯函数，方便 autogen 阶段直接当 reward 用。

/** 规范化：全角转半角、小写、去首尾引号与标点、压缩空白 */
export function normalize(s: string): string {
  let t = (s ?? '').normalize('NFKC').toLowerCase().trim();
  t = t.replace(/[’‘]/g, "'");
  t = t.replace(/^[\s"'`“”‘’「」《》]+/, '').replace(/[\s"'`“”‘’「」《》]+$/, '');
  t = t.replace(/\s+/g, ' ');
  t = t.replace(/[。．.！!？?，,；;：:]+$/, '');
  return t;
}

export interface Verdict {
  pass: boolean;
  reason: 'exact' | 'contains' | 'miss';
}

/**
 * 粗判：完全一致，或答案串被包含在预测里。
 * contains 只在 gold 长度 >= 4 时启用，避免单字（如"否"）在长句里误命中。
 */
export function verdict(pred: string, gold: string[]): Verdict {
  const p = normalize(pred);
  for (const g of gold) {
    const gn = normalize(g);
    if (!gn) continue;
    if (p === gn) return { pass: true, reason: 'exact' };
    if (gn.length >= 4 && p.includes(gn)) return { pass: true, reason: 'contains' };
  }
  return { pass: false, reason: 'miss' };
}

/** 输入等比：用于"问题原文是否与方案表一致"的软校验 */
export function normalizeInput(s: string): string {
  return normalize(s).replace(/[?？。.]$/, '').replace(/\s+/g, ' ').trim();
}
