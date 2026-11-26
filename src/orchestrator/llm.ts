// 模型网关。只做一件事：一次 chat 调用 + 用量统计 + 失败重试。
// 不做重试策略、不做预算控制 —— 那些属于节点内部逻辑（S5）。
import { MODEL, requireModelCredentials } from './env.ts';

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

export interface ChatResult {
  text: string;
  usage: Usage;
  latencyMs: number;
  model: string;
}

const stats = {
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  cachedTokens: 0,
  failures: 0,
};

export function llmStats() {
  return { ...stats };
}

export function resetLlmStats(): void {
  stats.calls = 0;
  stats.promptTokens = 0;
  stats.completionTokens = 0;
  stats.cachedTokens = 0;
  stats.failures = 0;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  attempts?: number;
}

export async function chat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: ChatOptions = {},
): Promise<ChatResult> {
  const { baseUrl, apiKey } = requireModelCredentials();
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: MODEL,
    messages,
    temperature: opts.temperature ?? 0,
    max_tokens: opts.maxTokens ?? 512,
    stream: false,
  };
  const attempts = opts.attempts ?? 2;
  const t0 = Date.now();
  let lastErr: unknown;

  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        throw new Error(`HTTP ${res.status} ${detail}`);
      }
      const json = (await res.json()) as any;
      const usage = json?.usage ?? {};
      const out: ChatResult = {
        text: String(json?.choices?.[0]?.message?.content ?? ''),
        usage: {
          promptTokens: Number(usage.prompt_tokens ?? 0),
          completionTokens: Number(usage.completion_tokens ?? 0),
          cachedTokens: Number(usage.prompt_tokens_details?.cached_tokens ?? 0),
        },
        latencyMs: Date.now() - t0,
        model: String(json?.model ?? MODEL),
      };
      stats.calls += 1;
      stats.promptTokens += out.usage.promptTokens;
      stats.completionTokens += out.usage.completionTokens;
      stats.cachedTokens += out.usage.cachedTokens;
      return out;
    } catch (err) {
      lastErr = err;
      stats.failures += 1;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }

  throw new Error(`LLM 调用失败：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/** 宽松解析 JSON：模型常把 JSON 包在 ```json 里，或前后带解释 */
export function parseJsonLoose<T>(text: string): T | undefined {
  const s = (text ?? '').trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(body.slice(start, end + 1)) as T;
  } catch {
    return undefined;
  }
}
