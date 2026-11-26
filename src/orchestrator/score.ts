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

// ---------------------------------------------------------------------------
// 答案规范化（判分用，不参与推理；规则不看 gold，只对答案自身做形式变换）
// ---------------------------------------------------------------------------

/** 尾部量词/后缀：答案与 gold 常只差这几个字（"情侣关系" vs "情侣"、"1次" vs "1"） */
const MEASURE_SUFFIX = /(?:个|次|人|位|名|条|块|元|年|岁|天|只|件|章|回|关系|之间|的时候)$/;

const CN_DIGITS: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 中文数字 → 阿拉伯（限 万 以内，够用且不误伤） */
export function cnToNumber(s: string): number | undefined {
  if (!/^[零一二两三四五六七八九十百千万]+$/.test(s)) return undefined;
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const ch of s) {
    if (CN_DIGITS[ch] !== undefined) {
      digit = CN_DIGITS[ch];
    } else if (CN_UNITS[ch]) {
      section += (digit || 1) * CN_UNITS[ch];
      digit = 0;
    } else if (ch === '万') {
      total += (section + digit) * 10000;
      section = 0;
      digit = 0;
    } else {
      return undefined;
    }
  }
  return total + section + digit;
}

/** 阿拉伯数字 → 中文（限 1 亿以内） */
export function numberToCn(n: number): string | undefined {
  if (!Number.isInteger(n) || n < 0 || n >= 1e8) return undefined;
  if (n === 0) return '零';
  const D = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const U = ['', '十', '百', '千'];
  const conv = (num: number): string => {
    let s = '';
    const digits = String(num).split('').map(Number);
    const len = digits.length;
    digits.forEach((d, i) => {
      const unit = U[len - 1 - i];
      if (d === 0) {
        if (s && !s.endsWith('零')) s += '零';
      } else {
        s += D[d] + unit;
      }
    });
    return s.replace(/^一十/, '十').replace(/零+$/, '');
  };
  const head = Math.floor(n / 10000);
  const tail = n % 10000;
  if (head && tail) return conv(head) + '万' + conv(tail);
  if (head) return conv(head) + '万';
  return conv(tail);
}

/** 生成答案的等价写法：去尾量词、数字形态互转 */
export function answerVariants(answer: string): string[] {
  const base = normalize(answer);
  if (!base) return [];
  const out = new Set<string>();
  out.add(base);

  let cur = base;
  for (let i = 0; i < 3; i += 1) {
    const next = cur.replace(MEASURE_SUFFIX, '').trim();
    if (!next || next === cur) break;
    cur = next;
    out.add(cur);
  }

  for (const v of [...out]) {
    const asNum = cnToNumber(v);
    if (asNum !== undefined) out.add(String(asNum));
    // "10万" → 十万（注意单位已在文本里，不能转完再补一个"万"）
    const m = /^(\d+)万$/.exec(v);
    if (m) {
      const cn = numberToCn(Number(m[1]) * 10000);
      if (cn) out.add(cn);
    }
    if (/^\d+$/.test(v)) {
      const cn = numberToCn(Number(v));
      if (cn) out.add(cn);
    }
  }
  return [...out];
}

/**
 * 规范化判分：两侧都展开成等价写法后再比。
 * 与 verdict() 的唯一区别是多了"形式等价"，语义判定不变。
 */
export function verdictNormalized(pred: string, gold: string[]): Verdict {
  const pv = new Set(answerVariants(pred));
  if (pv.size === 0) return { pass: false, reason: 'miss' };
  for (const g of gold) {
    for (const gv of answerVariants(g)) {
      if (pv.has(gv)) return { pass: true, reason: 'exact' };
    }
  }
  // 长答案仍允许包含匹配（与 verdict 保持一致）
  const p = normalize(pred);
  for (const g of gold) {
    const gn = normalize(g);
    if (gn.length >= 4 && p.includes(gn)) return { pass: true, reason: 'contains' };
  }
  return { pass: false, reason: 'miss' };
}
