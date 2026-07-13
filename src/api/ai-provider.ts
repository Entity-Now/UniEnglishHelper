import type { AppConfig, WordExplainResult } from '../shared/domain/types';
import { AppError } from '../shared/messages/errors';
import { getWordExplainPrompt } from '../utils/prompts/word-explain';
import { translateFree } from './translate';
import {
  isLlmCircuitOpen,
  LLM_WORD_EXPLAIN_TIMEOUT_MS,
  recordLlmFailure,
  recordLlmSuccess,
  withAbortTimeout,
} from './llm-circuit';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function resolveBaseUrl(config: AppConfig, providerId: string): string {
  let baseUrl =
    config.ai.baseUrls?.[providerId]?.replace(/\/$/, '') ||
    'https://api.openai.com/v1';

  // Auto-correct common baseUrls missing /v1
  if (baseUrl.includes('api.deepseek.com') && !baseUrl.endsWith('/v1')) {
    baseUrl += '/v1';
  } else if (baseUrl.includes('api.openai.com') && !baseUrl.endsWith('/v1')) {
    baseUrl += '/v1';
  } else if (baseUrl.includes('api.anthropic.com') && !baseUrl.endsWith('/v1')) {
    baseUrl += '/v1';
  } else if (
    baseUrl.includes('localhost:11434') &&
    !baseUrl.endsWith('/v1') &&
    !baseUrl.endsWith('/api')
  ) {
    baseUrl += '/v1';
  }
  return baseUrl;
}

export async function chatCompletion(
  config: AppConfig,
  messages: ChatMessage[],
  opts?: { temperature?: number; signal?: AbortSignal; timeoutMs?: number },
): Promise<string> {
  const providerId = config.ai.providerId;
  const apiKey = config.ai.apiKeys[providerId];
  if (!apiKey) {
    throw new AppError('AI_FAILED', 'API key not configured for provider: ' + providerId);
  }

  const baseUrl = resolveBaseUrl(config, providerId);
  const run = async (signal?: AbortSignal) => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.ai.model,
        messages,
        temperature: opts?.temperature ?? 0.3,
        stream: false,
      }),
      signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AppError(
        'AI_FAILED',
        `LLM HTTP ${res.status}: ${body.slice(0, 200)}`,
      );
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new AppError('AI_FAILED', 'Empty LLM response');
    return text;
  };

  if (opts?.timeoutMs && opts.timeoutMs > 0) {
    return withAbortTimeout(
      opts.timeoutMs,
      (signal) => run(opts.signal ?? signal),
      'LLM chat',
    );
  }
  return run(opts?.signal);
}

export async function* chatCompletionStream(
  config: AppConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const providerId = config.ai.providerId;
  const apiKey = config.ai.apiKeys[providerId];
  if (!apiKey) {
    throw new AppError('AI_FAILED', 'API key not configured');
  }
  const baseUrl = resolveBaseUrl(config, providerId);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.ai.model,
      messages,
      temperature: 0.3,
      stream: true,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new AppError('AI_FAILED', `Stream HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const json = JSON.parse(data) as {
          choices?: { delta?: { content?: string } }[];
        };
        const chunk = json.choices?.[0]?.delta?.content;
        if (chunk) yield chunk;
      } catch {
        // ignore partial JSON
      }
    }
  }
}

function resolveFreeMtPreferred(config: AppConfig) {
  return config.freeMtProvider && config.freeMtProvider !== 'auto'
    ? config.freeMtProvider
    : ('auto' as const);
}

/**
 * Free-MT word explain — always available as word-popup fallback so UX
 * stays snappy even when LLM is down / circuit is open.
 */
async function explainWithFreeMt(
  config: AppConfig,
  surface: string,
  context: string,
  note: string,
): Promise<WordExplainResult> {
  const preferred = resolveFreeMtPreferred(config);
  const word = await translateFree(
    surface,
    config.sourceLang,
    config.targetLang,
    preferred,
  );
  let contextTranslation: string | undefined;
  if (context.trim()) {
    try {
      const ctx = await translateFree(
        context,
        config.sourceLang,
        config.targetLang,
        preferred,
      );
      contextTranslation = ctx.text;
    } catch {
      // context is optional
    }
  }
  return {
    surface,
    definition: word.text,
    context,
    contextTranslation,
    engine: 'free_mt',
    provider: word.provider,
    note,
  };
}

async function explainWithLlm(
  config: AppConfig,
  surface: string,
  context: string,
): Promise<WordExplainResult> {
  const system = getWordExplainPrompt(
    config.sourceLang,
    config.targetLang,
    config.wordShow?.langLevel ?? 'intermediate',
  );
  const explanation = await chatCompletion(
    config,
    [
      { role: 'system', content: system },
      { role: 'user', content: `Query: ${surface}\nContext: ${context}` },
    ],
    { timeoutMs: LLM_WORD_EXPLAIN_TIMEOUT_MS },
  );
  const definition =
    explanation
      .split('\n')
      .map((l) => l.replace(/^[#*\s-]+/, '').trim())
      .find((l) => l && !l.startsWith('{{') && l.length < 200) ||
    explanation.slice(0, 200);
  return {
    surface,
    definition,
    context,
    explanation,
    engine: 'llm',
    provider: config.ai.providerId,
  };
}

/**
 * Structured word explain with **fast free-MT fallback**.
 *
 * Strategy:
 * 1. Start free MT immediately (parallel) so the user is never blocked on a hung LLM.
 * 2. Try LLM with a hard ~3.5s timeout when a key is present and the circuit is closed.
 * 3. Prefer LLM if it wins; otherwise return free MT.
 * 4. After repeated LLM failures, open a short circuit → free MT only (instant path).
 */
export async function explainWord(
  config: AppConfig,
  surface: string,
  context: string,
): Promise<WordExplainResult> {
  const key = config.ai.apiKeys[config.ai.providerId];
  const circuitOpen = isLlmCircuitOpen();

  // Free MT always starts for word popup (UX) — not gated on feature flags.
  // Feature flags still apply to bulk subtitle translation elsewhere.
  const freeNoteNoKey = '未配置 AI API Key，已使用免费翻译';
  const freeNoteCircuit = 'AI 暂时不可用（已熔断），已使用免费翻译';
  const freeNoteFail = 'AI 请求失败或超时，已回退免费翻译';

  const freePromise = explainWithFreeMt(
    config,
    surface,
    context,
    !key ? freeNoteNoKey : circuitOpen ? freeNoteCircuit : freeNoteFail,
  ).then(
    (r) => ({ ok: true as const, r }),
    (e) => ({
      ok: false as const,
      err: e instanceof Error ? e : new Error(String(e)),
    }),
  );

  // No key or circuit open → free MT only (do not wait on LLM)
  if (!key || circuitOpen) {
    const free = await freePromise;
    if (free.ok) return free.r;
    return {
      surface,
      definition: '',
      context,
      engine: 'none',
      note: !key
        ? '未配置 AI API Key，且免费翻译失败'
        : `AI 熔断中且免费翻译失败：${free.err.message}`,
    };
  }

  // Race: free runs in parallel while LLM has a hard deadline
  const llmPromise = explainWithLlm(config, surface, context).then(
    (r) => ({ ok: true as const, r }),
    (e) => ({
      ok: false as const,
      err: e instanceof Error ? e : new Error(String(e)),
    }),
  );

  const llm = await llmPromise;
  if (llm.ok) {
    recordLlmSuccess();
    return llm.r;
  }

  // LLM failed / timed out → free path (already running)
  recordLlmFailure();
  console.warn('[UEH] AI explain failed, using free MT', llm.err.message);

  const free = await freePromise;
  if (free.ok) {
    return {
      ...free.r,
      note: freeNoteFail,
    };
  }

  return {
    surface,
    definition: '',
    context,
    engine: 'none',
    note: `AI 与免费翻译均失败：${llm.err.message} / ${free.err.message}`,
  };
}

/** Render structured explain for UI (display only). */
export function formatWordExplainForDisplay(r: WordExplainResult): string {
  const parts: string[] = [];
  if (r.definition) parts.push(r.definition);
  if (r.phonetic) parts.push(r.phonetic);
  if (r.explanation && r.engine === 'llm') {
    // Prefer full AI markdown when available; still surface note if present
    const body = r.explanation;
    return r.note ? `${body}\n\n（${r.note}）` : body;
  }
  if (r.contextTranslation) {
    parts.push(`句子译文：${r.contextTranslation}`);
  }
  if (r.note) parts.push(`（${r.note}）`);
  return parts.filter(Boolean).join('\n\n') || r.surface;
}
