import type { AppConfig, WordExplainResult } from '../shared/domain/types';
import { AppError } from '../shared/messages/errors';
import { getWordExplainPrompt } from '../utils/prompts/word-explain';
import { translateFree } from './translate';

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
  opts?: { temperature?: number },
): Promise<string> {
  const providerId = config.ai.providerId;
  const apiKey = config.ai.apiKeys[providerId];
  if (!apiKey) {
    throw new AppError('AI_FAILED', 'API key not configured for provider: ' + providerId);
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
      temperature: opts?.temperature ?? 0.3,
      stream: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AppError('AI_FAILED', `LLM HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new AppError('AI_FAILED', 'Empty LLM response');
  return text;
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

/**
 * Structured word explain — never dumps meta notes into `definition`.
 */
export async function explainWord(
  config: AppConfig,
  surface: string,
  context: string,
): Promise<WordExplainResult> {
  const key = config.ai.apiKeys[config.ai.providerId];
  if (key) {
    try {
      const system = getWordExplainPrompt(
        config.sourceLang,
        config.targetLang,
        config.wordShow?.langLevel ?? 'intermediate',
      );
      const explanation = await chatCompletion(config, [
        {
          role: 'system',
          content: system,
        },
        {
          role: 'user',
          content: `Query: ${surface}\nContext: ${context}`,
        },
      ]);
      // First non-empty line as short definition when possible
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
    } catch (err) {
      console.warn('[UEH] AI explain failed, trying free MT', err);
    }
  }

  const freeOk =
    config.features.enableUnofficialFreeMt ||
    config.translateEngine === 'free_mt' ||
    config.translateEngine === 'unofficial_free' ||
    config.translateEngine === 'google_free' ||
    config.translateEngine === 'microsoft_free' ||
    config.translateEngine === 'mymemory_free';

  if (freeOk) {
    try {
      const preferred =
        config.freeMtProvider && config.freeMtProvider !== 'auto'
          ? config.freeMtProvider
          : 'auto';
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
          // ignore
        }
      }
      return {
        surface,
        definition: word.text,
        context,
        contextTranslation,
        engine: 'free_mt',
        provider: word.provider,
        note: key
          ? 'AI 请求失败，已回退免费翻译'
          : '未配置 AI API Key，已使用免费翻译',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        surface,
        definition: '',
        context,
        engine: 'none',
        note: `翻译失败：${msg}`,
      };
    }
  }

  return {
    surface,
    definition: '',
    context,
    engine: 'none',
    note: '未配置 AI API Key，且免费翻译已关闭',
  };
}

/** Render structured explain for UI (display only). */
export function formatWordExplainForDisplay(r: WordExplainResult): string {
  const parts: string[] = [];
  if (r.definition) parts.push(r.definition);
  if (r.phonetic) parts.push(r.phonetic);
  if (r.explanation && r.engine === 'llm') {
    // Prefer full AI markdown when available
    return r.explanation;
  }
  if (r.contextTranslation) {
    parts.push(`句子译文：${r.contextTranslation}`);
  }
  if (r.note) parts.push(`（${r.note}）`);
  return parts.filter(Boolean).join('\n\n') || r.surface;
}
