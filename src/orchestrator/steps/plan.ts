// code.plan：切块 + 本地检索 + 一次契约生成。
// 这里只花 1 次模型调用（扩展检索词/定输出格式），检索本身是纯本地的。
import { chunkByStructure, chunkText } from '../chunk.ts';
import { loadSamples } from '../dataset.ts';
import { CHUNK_OVERLAP, CHUNK_SIZE, TOP_K } from '../env.ts';
import { chat, parseJsonLoose } from '../llm.ts';
import { dedupe, detectPrior, extractTerms, retrieve, uniformSample } from '../retrieve.ts';
import type { Contract, Issue } from '../types.ts';

const FORMAT_BY_TASK: Record<string, Contract['answerFormat']> = {
  passkey: 'digit_string',
  number_string: 'digit_string',
  kv_retrieval: 'uuid',
  code_debug: 'short_entity',
  longbook_choice_eng: 'choice_letter',
  longbook_qa_chn: 'short_entity',
  longbook_qa_eng: 'short_entity',
  longdialogue_qa_eng: 'short_entity',
  longbook_sum_eng: 'free_text',
};

/** 模型不可用时的兜底契约：按任务类型定格式，够用且不阻塞流程 */
export function heuristicContract(issue: Issue): Contract {
  const format = FORMAT_BY_TASK[issue.task] ?? 'short_entity';
  const maxChars = format === 'digit_string' ? 32 : format === 'uuid' ? 36 : format === 'choice_letter' ? 16 : 48;
  return { answerFormat: format, mustCite: format !== 'free_text', keywords: [], maxChars };
}

const VALID_FORMATS: Contract['answerFormat'][] = ['short_entity', 'digit_string', 'uuid', 'choice_letter', 'free_text'];

/**
 * 每个任务允许的输出格式白名单。
 * 模型偶尔会把"喝醉"这种短答问题判成 free_text（实测 IB-04 就被判成 free_text），
 * 格式错了会让 verify 的契约核验失效，所以越界一律回退到任务默认格式。
 */
const ALLOWED_BY_TASK: Record<string, Contract['answerFormat'][]> = {
  passkey: ['digit_string'],
  number_string: ['digit_string'],
  kv_retrieval: ['uuid'],
  code_debug: ['short_entity', 'choice_letter'],
  longbook_choice_eng: ['choice_letter'],
  // 长文书问答的答案几乎都是短实体（人名/称谓/数字词），不允许退化成 digit_string：
  // "How old is Felicity..." 的答案是 Thirty，被判成 digit_string 会让契约核验直接判死。
  longbook_qa_chn: ['short_entity'],
  longbook_qa_eng: ['short_entity'],
  longdialogue_qa_eng: ['short_entity'],
  longbook_sum_eng: ['free_text'],
};

interface LlmContract {
  answer_format?: string;
  keywords?: string[];
  max_chars?: number;
}

export interface PlanInput {
  issue: Issue;
  sampleId: string;
  runId: string;
  /** 关掉模型调用（离线/调试）；默认开 */
  useLlm?: boolean;
}

export interface PlanOutput {
  chunks: Array<{ id: string; start: number; end: number; text: string; score: number }>;
  contract: Contract;
  keywords: string[];
  planMeta: Record<string, unknown>;
}

export async function planStep(input: PlanInput): Promise<PlanOutput> {
  const { issue, sampleId, runId } = input;
  const useLlm = input.useLlm !== false;

  const samples = await loadSamples(issue.task, [sampleId]);
  const sample = samples.get(String(sampleId));
  if (!sample) throw new Error(`取不到样本 ${issue.task}#${sampleId}`);

  // 代码类按函数/类边界切块，其余按固定窗口
  const isCode = issue.task === 'code_debug' || issue.task === 'code_run';
  const all = isCode ? chunkByStructure(sample.context, CHUNK_SIZE) : chunkText(sample.context, CHUNK_SIZE, CHUNK_OVERLAP);
  // options 必须一起进检索词：code_debug / 选择题的选项里往往才是真正的定位线索
  const questionText = [sample.input, ...(sample.options ?? [])].join('\n');
  const { anchors, terms } = extractTerms(questionText);

  // 中文 n-gram 数量多，先留长串（更具体），再截断控制检索耗时
  const prunedTerms = [...terms].sort((a, b) => b.length - a.length).slice(0, 40);

  const base = heuristicContract(issue);
  let contract: Contract = { ...base, keywords: dedupe([...anchors, ...prunedTerms.slice(0, 8)]) };
  let llmUsed = false;
  let llmLatency = 0;
  let llmTokens = 0;
  let llmError = '';
  let formatRejected = '';

  if (useLlm) {
    try {
      const res = await chat(
        [
          { role: 'system', content: '你是检索契约生成器。只输出 JSON，不要解释、不要 markdown 代码块以外的内容。' },
          {
            role: 'user',
            content: [
              `问题：${sample.input.slice(0, 400)}`,
              `任务类型：${issue.task}`,
              '请输出 JSON：',
              '{"answer_format":"short_entity|digit_string|uuid|choice_letter|free_text",',
              '"keywords":["最多 6 个用于在超长文档里定位答案的词或短语"],"max_chars":答案最大字符数}',
            ].join('\n'),
          },
        ],
        { maxTokens: 300, temperature: 0 },
      );
      llmLatency = res.latencyMs;
      llmTokens = res.usage.promptTokens + res.usage.completionTokens;
      llmUsed = true;
      const parsed = parseJsonLoose<LlmContract>(res.text);
      if (parsed) {
        const fmt = String(parsed.answer_format ?? '');
        const allowed = ALLOWED_BY_TASK[issue.task];
        if (VALID_FORMATS.includes(fmt as Contract['answerFormat'])) {
          if (!allowed || allowed.includes(fmt as Contract['answerFormat'])) {
            contract.answerFormat = fmt as Contract['answerFormat'];
          } else {
            formatRejected = `${fmt} 不在 ${issue.task} 的白名单内，回退 ${contract.answerFormat}`;
          }
        }
        if (Array.isArray(parsed.keywords)) {
          contract.keywords = dedupe([...anchors, ...parsed.keywords.map(String), ...contract.keywords]);
        }
        const mc = Number(parsed.max_chars);
        if (Number.isFinite(mc) && mc >= 8 && mc <= 400) contract.maxChars = mc;
      }
      contract.mustCite = contract.answerFormat !== 'free_text';
    } catch (err) {
      llmError = err instanceof Error ? err.message : String(err);
    }
  }

  const k = ['digit_string', 'uuid'].includes(contract.answerFormat) ? Math.min(TOP_K, 4) : TOP_K;
  const prior = detectPrior(sample.input);
  let scored = retrieve(all, dedupe([...anchors, ...prunedTerms, ...contract.keywords]), k, {
    prior,
    totalChars: sample.context.length,
  });

  // 位置先验只对"有词频分"的块有效；开头块常常一个检索词都不含（分数 0，乘多少还是 0）。
  // 所以对 start/end 类问题强制把首/尾块塞进候选，保证 read 一定能看到开头/结尾原文。
  let forced = 0;
  if (prior !== 'none' && all.length > k) {
    const edge = prior === 'start' ? all.slice(0, 1) : all.slice(-1);
    const have = new Set(scored.map((s) => s.chunk.id));
    const extra = edge.filter((c) => !have.has(c.id)).map((c) => ({ chunk: c, score: 0, hits: [] as string[] }));
    if (extra.length) {
      forced = extra.length;
      scored = [...extra, ...scored].slice(0, k + forced);
    }
  }
  let fallback = '';
  if (!scored.length) {
    // 零命中：均匀取样兜底，绝不让下游拿到空数组（否则静默失败，看不出原因）
    scored = uniformSample(all, k).map((c) => ({ chunk: c, score: 0, hits: [] }));
    fallback = 'uniform';
  }

  return {
    chunks: scored.map((s) => ({ ...s.chunk, score: Number(s.score.toFixed(2)) })),
    contract,
    keywords: dedupe([...anchors, ...prunedTerms.slice(0, 12), ...contract.keywords]),
    planMeta: {
      runId,
      chunkTotal: all.length,
      chunkSize: CHUNK_SIZE,
      ctxChars: sample.context.length,
      selected: scored.length,
      topScore: scored.length ? Number(scored[0].score.toFixed(2)) : 0,
      hitTerms: scored.length ? scored[0].hits.slice(0, 10) : [],
      anchors,
      prior,
      forced,
      fallback,
      llmUsed,
      llmLatencyMs: llmLatency,
      llmTokens,
      llmError,
      formatRejected,
    },
  };
}
