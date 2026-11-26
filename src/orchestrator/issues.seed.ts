// 方案 v2 §六 的问题表，逐条转录成机器可比对的形式。
// 作用：它是"人工给定"的那一侧。--check-issues 拿它跟数据、基线三方对账，
// 任何不一致都打出来；数据永远优先，差异记进 docs/ISSUES.md。
import type { FailureType } from './types.ts';

export interface SeedIssue {
  id: string;
  task: string;
  sampleId: string;
  ctxChars: number;
  /** 可接受的 gold 集合；null = 只记录不校验（对照组） */
  goldAlternatives: string[] | null;
  /** 基线原文若为定值则比对；null = 只记录 */
  baselineExpected: string | null;
  failureType: FailureType;
  /** 人读用；不作硬校验（数据里的原文可能大小写/标点不同） */
  inputHint?: string;
  note?: string;
}

export const SEED: SeedIssue[] = [
  {
    id: 'IB-01',
    task: 'longbook_qa_chn',
    sampleId: '79',
    ctxChars: 3859199,
    goldAlternatives: ['否'],
    baselineExpected: null,
    failureType: 'F1',
    inputHint: '文中的主角可以任意改变时间线, 请问故事的时间线是否只有5条？',
    note: '基线语义其实答对，被抽取判 0 —— 双判定口径的关键样本',
  },
  {
    id: 'IB-02',
    task: 'longbook_qa_chn',
    sampleId: '76',
    ctxChars: 3859199,
    goldAlternatives: ['五', '5'],
    baselineExpected: null,
    failureType: 'F1',
    inputHint: '文中姓夏的角色一共有几个？',
    note: '与 IB-01 共用同一 context，可验证按 context 去重',
  },
  {
    id: 'IB-03',
    task: 'longbook_qa_chn',
    sampleId: '137',
    ctxChars: 2234380,
    goldAlternatives: ['情侣'],
    baselineExpected: null,
    failureType: 'F1',
    inputHint: '中森明菜和木村宏是什么关系',
  },
  {
    id: 'IB-04',
    task: 'longbook_qa_chn',
    sampleId: '136',
    ctxChars: 2234380,
    goldAlternatives: ['喝醉'],
    baselineExpected: null,
    failureType: 'F1',
    inputHint: '木宏村如何重新开始一个新的人生',
  },
  {
    id: 'IB-05',
    task: 'longbook_qa_chn',
    sampleId: '112',
    ctxChars: 2149235,
    goldAlternatives: ['0', '零', '无', '没有'],
    baselineExpected: null,
    failureType: 'F1',
    inputHint: '李波罗有多少个女儿？',
  },
  {
    id: 'IB-06',
    task: 'passkey',
    sampleId: '270',
    ctxChars: 469858,
    goldAlternatives: ['99700'],
    baselineExpected: 'Not provided.',
    failureType: 'F4',
    inputHint: 'What is the pass key?',
  },
  {
    id: 'IB-07',
    task: 'number_string',
    sampleId: '277',
    ctxChars: 469888,
    goldAlternatives: ['3333995555'],
    baselineExpected: 'No digits.',
    failureType: 'F4',
    inputHint: 'What is the sequence of digits?',
    note: '与 IB-06 ctx 长度接近，检查是否同源 context',
  },
  {
    id: 'IB-08',
    task: 'kv_retrieval',
    sampleId: '9',
    ctxChars: 200011,
    goldAlternatives: ['a3fa5e4c-705c-4fad-bb48-b37a21f437cc'],
    baselineExpected: null,
    failureType: 'F6',
    note: '基线少最后 1 位 —— 典型的"截断/生成提前停"失败；input 是多行原文，以数据为准不硬校验',
  },
  {
    id: 'IB-09',
    task: 'longbook_qa_eng',
    sampleId: '255',
    ctxChars: 434156,
    goldAlternatives: ['Thirty'],
    baselineExpected: 'About thirty years old.',
    failureType: 'F3',
    inputHint: 'How old is Felicity at the start of his narration?',
    note: '基线答对但格式不合（带了解释句），指标只给 0.4',
  },
  {
    id: 'IB-10',
    task: 'code_debug',
    sampleId: '3',
    ctxChars: 807189,
    goldAlternatives: ['_init', 'A'],
    baselineExpected: 'B',
    failureType: 'F1',
    inputHint: 'Which funtion has deliberate error?',
    note: '数据 gold 只有 ["_init"]（选项 A 在 options 里不在 gold 里），方案表写的"_init（+选项 A）"要按数据修正',
  },
  {
    id: 'CF-01',
    task: 'longbook_qa_eng',
    sampleId: '71',
    ctxChars: 968742,
    goldAlternatives: null,
    baselineExpected: 'Alannys Harlaw',
    failureType: 'CTRL',
    inputHint: "What Is The Name Of Theresa Brent's Mother?",
    note: '答案正确、只是没复述整句 → 判分误杀，不修',
  },
  {
    id: 'CF-02',
    task: 'longbook_sum_eng',
    sampleId: '1',
    ctxChars: 381748,
    goldAlternatives: null,
    baselineExpected: null,
    failureType: 'CTRL',
    inputHint: 'The summary of the book is:',
    note: 'ROUGE 与人工负相关 → 指标问题，不修',
  },
];

export function seedByTask(): Map<string, SeedIssue[]> {
  const m = new Map<string, SeedIssue[]>();
  for (const s of SEED) {
    const arr = m.get(s.task) ?? [];
    arr.push(s);
    m.set(s.task, arr);
  }
  return m;
}
