// code.verify：把"读到的证据"压成"符合契约的答案"。
//
// 设计原则：规则优先，模型兜底。
//   - 能用正则/证据比对判死的，不花一次调用（passkey / number_string / kv 都属于这类）
//   - 判不死的（need 语义压缩，如 "About thirty years old." → "Thirty"）才调模型 1 次
//   - 引擎不能回退，所以"重试"只能是换一种提示再问一遍，最多 2 次
import { chat, parseJsonLoose } from '../llm.ts';
import type { Contract, Issue } from '../types.ts';

export interface VerifyEvidence {
  chunkId: string;
  quote: string;
  verified: boolean;
}

export interface VerifyInput {
  issue: Issue;
  evidence: VerifyEvidence[];
  contract: Contract;
  drafts: string[];
  runId: string;
}

export interface VerifyVerdict {
  pass: boolean;
  reason: 'rule' | 'llm' | 'no-evidence' | 'format' | 'empty';
  format: string;
  evidenceHit: boolean;
  attempts: number;
  note: string;
}

export interface VerifyOutput {
  finalAnswer: string;
  verdict: VerifyVerdict;
  retries: number;
  /** true = 彻底失败，由节点层调 stop() 把原因带上父流程 */
  hardFail: boolean;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LETTER_RE = /\b([A-D])\b/;

function strip(s: string): string {
  return (s ?? '')
    .trim()
    .replace(/^["'“”‘’\s]+/, '')
    .replace(/["'“”‘’\s]+$/, '')
    .replace(/^(答案|answer)\s*[:：]\s*/i, '')
    .replace(/[。．.]+$/, '')
    .trim();
}

export function formatOk(answer: string, contract: Contract): boolean {
  const a = strip(answer);
  if (!a) return false;
  if (a.length > contract.maxChars * 2) return false;
  switch (contract.answerFormat) {
    case 'digit_string':
      return /^\d{2,}$/.test(a);
    case 'uuid':
      return UUID_RE.test(a) && a.length === 36;
    case 'choice_letter':
      return /^[A-Da-d]$/.test(a);
    case 'short_entity':
      // 短答：不超过 12 个词/字，且不是整句（不以句末标点结尾、不含"因为/所以"这类解释词）
      return a.length <= Math.max(12, contract.maxChars) && !/[。！？；]$/.test(a) && !/(因为|所以|这是|答案是)/.test(a);
    case 'free_text':
      return a.length >= 8;
    default:
      return true;
  }
}

/** 证据里是否出现答案（大小写不敏感） */
export function evidenceHit(answer: string, evidence: VerifyEvidence[]): boolean {
  const a = strip(answer).toLowerCase();
  if (!a || a.length < 2) return false;
  return evidence.some((e) => e.quote.toLowerCase().includes(a));
}

/** 从证据里按格式直接抽候选（免费）；exclude 里的串是问题自带的，必须排除 */
export function candidatesFromEvidence(text: string, contract: Contract, exclude: string[] = []): string[] {
  const out: string[] = [];
  const skip = new Set(exclude.map((e) => e.toLowerCase().trim()));
  switch (contract.answerFormat) {
    case 'digit_string': {
      const nums = text.match(/\b\d{3,}\b/g) ?? [];
      out.push(...nums.filter((n) => !skip.has(n.toLowerCase())));
      break;
    }
    case 'uuid': {
      const all = text.match(new RegExp(UUID_RE.source, 'gi')) ?? [];
      // kv_retrieval 的坑：证据块里同时有 key 和 value，而 key 就是问题里那个 UUID。
      // 不排除问题自带的串，就会把 key 当成答案返回，并且"证据命中"校验还会通过 → 假阳性。
      out.push(...all.filter((u) => !skip.has(u.toLowerCase())));
      break;
    }
    case 'choice_letter': {
      const m = text.match(LETTER_RE);
      if (m) out.push(m[1].toUpperCase());
      break;
    }
    default:
      break;
  }
  return out;
}

/** 问题里自带的强标识串（UUID / 长数字），从候选里排除 */
export function excludeFromQuestion(question: string): string[] {
  const out: string[] = [];
  out.push(...(question.match(new RegExp(UUID_RE.source, 'gi')) ?? []));
  out.push(...(question.match(/\b\d{4,}\b/g) ?? []));
  return out;
}

/** 短答去解释：`情侣（男朋友与女朋友）` → `情侣` */
export function stripGloss(answer: string): string {
  return answer
    .replace(/[（(][^（）()]*[）)]\s*$/g, '')
    .replace(/[—–-]{2,}[^—–]*$/g, '')
    .trim();
}

interface LlmAnswer {
  answer?: string;
}

async function askModel(input: VerifyInput, strict: boolean): Promise<{ text: string; tokens: number }> {
  const fmtHint =
    input.contract.answerFormat === 'digit_string'
      ? '只输出数字串，不要单位、不要解释'
      : input.contract.answerFormat === 'uuid'
        ? '只输出 36 位 UUID，不要引号'
        : input.contract.answerFormat === 'choice_letter'
          ? '只输出一个选项字母 A/B/C/D'
          : input.contract.answerFormat === 'short_entity'
            ? '只输出一个词（人名/称谓/数字词），不要介词短语、不要整句。例：输出 "Thirty" 而不是 "about thirty years of age"'
            : '简体中文短语';

  const evidence = input.evidence
    .slice(0, 8)
    .map((e, i) => `[证据${i + 1}｜${e.chunkId}] ${e.quote}`)
    .join('\n');

  const res = await chat(
    [
      {
        role: 'system',
        content: strict
          ? '你只输出 JSON，且答案必须严格满足给定格式。无法确定时输出空字符串。'
          : '你只输出 JSON。答案必须来自给定证据，不得编造。',
      },
      {
        role: 'user',
        content: [
          `问题：${input.issue.input.slice(0, 300)}`,
          `参考答案（可能不准确）：${input.drafts.join(' | ').slice(0, 300)}`,
          '',
          '证据：',
          evidence,
          '',
          `格式要求：${fmtHint}，最多 ${input.contract.maxChars} 字符。`,
          '请输出：{"answer":"..."}',
        ].join('\n'),
      },
    ],
    { maxTokens: 200, temperature: 0 },
  );

  const parsed = parseJsonLoose<LlmAnswer>(res.text);
  return {
    text: strip(String(parsed?.answer ?? res.text ?? '')),
    tokens: res.usage.promptTokens + res.usage.completionTokens,
  };
}

export async function verifyStep(input: VerifyInput): Promise<VerifyOutput> {
  const { contract, evidence } = input;
  const verifiedEvidence = evidence.filter((e) => e.verified);
  const evidenceText = (verifiedEvidence.length ? verifiedEvidence : evidence).map((e) => e.quote).join('\n');
  const drafts = input.drafts.map(strip).filter(Boolean);

  let attempts = 0;
  const notes: string[] = [];

  // 0) 没有证据就别问模型：mustCite 的题注定判死，问了只是白烧 2 次调用（实测 35s）
  if (!evidence.length) {
    return {
      finalAnswer: '',
      verdict: { pass: false, reason: 'empty', format: contract.answerFormat, evidenceHit: false, attempts: 0, note: '读取层没有返回任何证据' },
      retries: 0,
      hardFail: true,
    };
  }

  // 1) 规则抽取：证据里直接能拿到符合格式的串
  if (contract.answerFormat === 'digit_string' || contract.answerFormat === 'uuid' || contract.answerFormat === 'choice_letter') {
    const exclude = excludeFromQuestion(input.issue.input);
    const cands = candidatesFromEvidence(evidenceText, contract, exclude);
    // 优先选同时出现在 drafts 里的那个
    const fromDraft = cands.find((c) => drafts.some((d) => d.includes(c)));
    const pick = fromDraft ?? cands[0];
    if (pick && formatOk(pick, contract) && evidenceHit(pick, evidence)) {
      return {
        finalAnswer: pick,
        verdict: { pass: true, reason: 'rule', format: contract.answerFormat, evidenceHit: true, attempts, note: 'regex-from-evidence' },
        retries: 0,
        hardFail: false,
      };
    }
    if (cands.length) notes.push(`规则抽到 ${cands.length} 个候选但未通过校验`);
  }

  // 2) 模型兜底（最多 2 次：一次常规、一次严格格式）
  for (let round = 0; round < 2; round += 1) {
    attempts += 1;
    try {
      const { text } = await askModel(input, round === 1);
      const answer = contract.answerFormat === 'short_entity' ? stripGloss(strip(text)) : strip(text);
      if (answer && formatOk(answer, contract)) {
        const hit = evidenceHit(answer, evidence);
        // 只有 mustCite 且证据确实命中，才算通过；否则标 no-evidence 但仍返回最佳答案
        if (hit || !contract.mustCite) {
          return {
            finalAnswer: answer,
            verdict: { pass: true, reason: 'llm', format: contract.answerFormat, evidenceHit: hit, attempts, note: notes.join('; ') },
            retries: round,
            hardFail: false,
          };
        }
        notes.push(`第 ${round + 1} 次答案「${answer.slice(0, 30)}」格式合规但证据里找不到`);
      } else {
        notes.push(`第 ${round + 1} 次答案「${answer.slice(0, 30)}」不合格式`);
      }
    } catch (err) {
      notes.push(`第 ${round + 1} 次调用失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3) 彻底失败：保留最佳猜测，交给节点层 stop() 上报原因
  const fallback = drafts[0] ?? (evidence.length ? evidence[0].quote.slice(0, contract.maxChars) : '');
  const reason: VerifyVerdict['reason'] = fallback ? 'no-evidence' : 'empty';
  return {
    finalAnswer: strip(fallback),
    verdict: {
      pass: false,
      reason,
      format: contract.answerFormat,
      evidenceHit: false,
      attempts,
      note: notes.join('; ') || '无证据',
    },
    retries: Math.max(0, attempts - 1),
    hardFail: true,
  };
}
