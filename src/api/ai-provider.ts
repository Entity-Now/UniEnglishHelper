import type { AppConfig, WordExplainResult } from '../shared/domain/types';
import { AppError } from '../shared/messages/errors';
import { getWordExplainPrompt } from '../utils/prompts/word-explain';
import { translateFree } from './translate';
import {
  isLlmCircuitOpen,
  LLM_RETRY_TIMEOUT_MS,
  LLM_WORD_EXPLAIN_TIMEOUT_MS,
  recordLlmFailure,
  recordLlmSuccess,
  resetLlmCircuit,
  withAbortTimeout,
  withStreamingTimeout,
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
    (baseUrl.includes('localhost') ||
      baseUrl.includes('127.0.0.1') ||
      baseUrl.includes('0.0.0.0')) &&
    !baseUrl.endsWith('/v1') &&
    !baseUrl.endsWith('/api')
  ) {
    baseUrl += '/v1';
  }
  return baseUrl;
}

/**
 * Strip thinking tags (<think>...</think>, <thought>...</thought>) and internal reasoning blocks
 * from model outputs.
 */
export function stripThinkingTags(text: string): string {
  if (!text) return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/<thought>[\s\S]*$/gi, '')
    .trim();
}

export function buildChatRequestBody(
  config: AppConfig,
  messages: ChatMessage[],
  opts?: {
    temperature?: number;
    stream?: boolean;
    disableThinking?: boolean;
  },
  omitThinkingParams = false,
): Record<string, unknown> {
  const providerId = config.ai.providerId;
  const baseUrl = resolveBaseUrl(config, providerId).toLowerCase();
  const model = (config.ai.model || '').toLowerCase();
  const stream = opts?.stream ?? true;
  const disableThinking =
    opts?.disableThinking ?? (config.ai.disableThinking !== false);

  const body: Record<string, unknown> = {
    model: config.ai.model,
    messages,
    stream,
  };

  if (!model.startsWith('o1') && !model.startsWith('o3')) {
    body.temperature = opts?.temperature ?? 0.3;
  }

  if (disableThinking && !omitThinkingParams) {
    // 1. Google Gemini official API endpoint
    if (
      baseUrl.includes('generativelanguage.googleapis.com') ||
      (providerId === 'gemini' && !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1'))
    ) {
      body.thinking_config = { thinking_budget: 0 };
    }

    // 2. OpenRouter
    if (baseUrl.includes('openrouter.ai')) {
      body.reasoning = { effort: 'none' };
      body.include_reasoning = false;
    }

    // 3. Ollama / LiteRT-LM / Local / vLLM / SiliconFlow / DeepSeek / Qwen / Gemma
    if (
      baseUrl.includes('localhost') ||
      baseUrl.includes('127.0.0.1') ||
      baseUrl.includes('siliconflow') ||
      baseUrl.includes('deepseek') ||
      model.includes('r1') ||
      model.includes('reasoner') ||
      model.includes('qwen') ||
      model.includes('gemma')
    ) {
      // LiteRT-LM (openai_handler.py) and OpenAI-compatible endpoints recognize reasoning_effort == "none"
      body.reasoning_effort = 'none';
      if (baseUrl.includes('deepseek') || baseUrl.includes('siliconflow')) {
        body.chat_template_kwargs = { thinking: false };
      }
    }

    // 4. OpenAI o-series
    if (model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')) {
      body.reasoning_effort = 'low';
    }
  }

  return body;
}

export function resolveEffectiveTimeoutMs(
  config: AppConfig,
  requestedMs?: number,
): number {
  const providerId = config.ai.providerId;
  const baseUrl = resolveBaseUrl(config, providerId).toLowerCase();
  const isLocal =
    baseUrl.includes('localhost') ||
    baseUrl.includes('127.0.0.1') ||
    baseUrl.includes('0.0.0.0');

  if (isLocal) {
    // Local endpoints on user computer (CPU/GPU) need more time
    return Math.max(requestedMs ?? 0, 60_000);
  }
  return requestedMs ?? LLM_WORD_EXPLAIN_TIMEOUT_MS;
}

export interface ChatCompletionOptions {
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  stream?: boolean;
  onChunk?: (chunk: string, fullText: string) => void;
  disableThinking?: boolean;
}

export async function* chatCompletionStream(
  config: AppConfig,
  messages: ChatMessage[],
  opts?: {
    temperature?: number;
    signal?: AbortSignal;
    disableThinking?: boolean;
  },
): AsyncGenerator<string> {
  const providerId = config.ai.providerId;
  const baseUrl = resolveBaseUrl(config, providerId);
  const isLocal =
    baseUrl.includes('localhost') ||
    baseUrl.includes('127.0.0.1') ||
    baseUrl.includes('0.0.0.0');
  const apiKey = config.ai.apiKeys[providerId] || (isLocal ? 'local-key' : '');
  if (!apiKey) {
    throw new AppError('AI_FAILED', 'API key not configured for provider: ' + providerId);
  }
  const signal = opts?.signal;

  let requestBody = buildChatRequestBody(config, messages, {
    temperature: opts?.temperature,
    stream: true,
    disableThinking: opts?.disableThinking,
  });

  let res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal,
  });

  // If server rejected thinking parameters (HTTP 400 or 422), retry once cleanly
  if (!res.ok && (res.status === 400 || res.status === 422)) {
    const errText = await res.text().catch(() => '');
    const isParamReject =
      errText.includes('thinking') ||
      errText.includes('reasoning') ||
      errText.includes('chat_template_kwargs') ||
      errText.includes('unexpected') ||
      errText.includes('unrecognized') ||
      errText.includes('extra fields') ||
      errText.includes('validation');
    if (isParamReject) {
      requestBody = buildChatRequestBody(
        config,
        messages,
        {
          temperature: opts?.temperature,
          stream: true,
          disableThinking: false,
        },
        true,
      );
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal,
      });
    } else {
      throw new AppError('AI_FAILED', `Stream HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }
  }

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new AppError('AI_FAILED', `Stream HTTP ${res.status}: ${errText.slice(0, 200)}`);
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
          choices?: {
            delta?: {
              content?: string;
              reasoning_content?: string;
              text?: string;
            };
            text?: string;
          }[];
        };
        const delta = json.choices?.[0]?.delta;
        const chunk = delta?.content ?? delta?.text ?? json.choices?.[0]?.text;
        if (!chunk) continue;

        yield chunk;
      } catch {
        // ignore partial JSON
      }
    }
  }

  // Process remaining buffer chunk if present
  if (buffer.trim().startsWith('data:')) {
    const data = buffer.trim().slice(5).trim();
    if (data && data !== '[DONE]') {
      try {
        const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const chunk = json.choices?.[0]?.delta?.content;
        if (chunk) yield chunk;
      } catch {}
    }
  }
}

export async function chatCompletion(
  config: AppConfig,
  messages: ChatMessage[],
  opts?: ChatCompletionOptions,
): Promise<string> {
  const providerId = config.ai.providerId;
  const baseUrl = resolveBaseUrl(config, providerId);
  const isLocal =
    baseUrl.includes('localhost') ||
    baseUrl.includes('127.0.0.1') ||
    baseUrl.includes('0.0.0.0');
  const apiKey = config.ai.apiKeys[providerId] || (isLocal ? 'local-key' : '');
  if (!apiKey) {
    throw new AppError('AI_FAILED', 'API key not configured for provider: ' + providerId);
  }

  const run = async (signal?: AbortSignal, notifyActivity?: () => void) => {
    // By default, use streaming SSE so response starts immediately (avoiding proxy buffer timeouts)
    const useStream = opts?.stream !== false;
    if (useStream) {
      try {
        let fullText = '';
        for await (const chunk of chatCompletionStream(config, messages, {
          temperature: opts?.temperature,
          signal,
          disableThinking: opts?.disableThinking,
        })) {
          fullText += chunk;
          notifyActivity?.();
          const visibleText = stripThinkingTags(fullText);
          opts?.onChunk?.(chunk, visibleText);
        }
        const cleaned = stripThinkingTags(fullText).trim();
        if (cleaned) return cleaned;
      } catch (streamErr) {
        // If streaming fails or connection interrupted, fall back to non-stream fetch
        console.warn('[UEH] stream chat failed, falling back to non-stream', streamErr);
      }
    }

    // Non-streaming fallback
    const baseUrl = resolveBaseUrl(config, providerId);
    let requestBody = buildChatRequestBody(config, messages, {
      temperature: opts?.temperature,
      stream: false,
      disableThinking: opts?.disableThinking,
    });

    let res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!res.ok && res.status === 400) {
      const errText = await res.text().catch(() => '');
      if (
        errText.includes('thinking') ||
        errText.includes('reasoning') ||
        errText.includes('chat_template_kwargs') ||
        errText.includes('unexpected') ||
        errText.includes('unrecognized')
      ) {
        requestBody = buildChatRequestBody(
          config,
          messages,
          {
            temperature: opts?.temperature,
            stream: false,
            disableThinking: false,
          },
          true,
        );
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal,
        });
      }
    }

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
    const rawText = json.choices?.[0]?.message?.content?.trim();
    const text = stripThinkingTags(rawText || '');
    if (!text) throw new AppError('AI_FAILED', 'Empty LLM response');
    opts?.onChunk?.(text, text);
    return text;
  };

  if (opts?.timeoutMs && opts.timeoutMs > 0) {
    return withStreamingTimeout(
      opts.timeoutMs,
      (signal, notifyActivity) => run(opts.signal ?? signal, notifyActivity),
      Math.max(25_000, Math.floor(opts.timeoutMs / 2)),
    );
  }
  return run(opts?.signal);
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

export const DEFINITION_PREFIX_PATTERN =
  /^(?:[【(\[]|\*{1,2})?\s*(?:结合语境的)?(?:精准)?(?:中文|核心|常用核心|语境)?(?:单\s*词|生\s*词|词|释义|中文释义|语境释义|核心释义|翻译|解释|Word|Target|Definition|Translation)\s*(?:[】)\]]|\*{1,2})?\s*[:：]?\s*/i;

export const SENTENCE_PREFIX_PATTERN =
  /^(?:[【(\[]|\*{1,2})?\s*(?:结合语境的)?(?:精准)?(?:上下文|语境|句子|整句|例句|Context|Sentence|Example|语境翻译|句子翻译|上下文翻译)\s*(?:[】)\]]|\*{1,2})?\s*[:：]?\s*/i;

export const QUERY_ECHO_PREFIX_PATTERN =
  /^(?:[【(\[]|\*{1,2})?\s*(?:待查内容|待查单词|待查词|待查|查询|Query|Input)\s*(?:[】)\]]|\*{1,2})?\s*[:：]?\s*/i;

export const ALL_PREFIX_PATTERN =
  /^(?:[【(\[]|\*{1,2})?\s*(?:结合语境的)?(?:精准)?(?:中文|核心|常用核心|语境|上下文|句子|整句)?(?:待查内容|待查单词|待查词|待查|单\s*词|生\s*词|词|查询|释义|中文释义|语境释义|核心释义|翻译|解释|上下文|语境|句子翻译|上下文翻译|Query|Definition|Translation|Word|Target|Input|Context|Sentence|Example|例句)\s*(?:[】)\]]|\*{1,2})?\s*[:：]?\s*/i;

export const QUERY_PREFIX_PATTERN = ALL_PREFIX_PATTERN;

export function cleanLine(l: string, surface?: string): string {
  let res = l.replace(/\*\*/g, '').replace(/^[#>\-\s*•|\d.、]+/gm, '').trim();

  // Strip leading surface prefix like "French: " or "French - "
  if (surface) {
    const escaped = surface.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const surfacePrefix = new RegExp(`^(?:[【(\\[]|\\*{1,2})?\\s*${escaped}\\s*(?:[】)\\]]|\\*{1,2})?\\s*[:：\\-]\\s*`, 'i');
    res = res.replace(surfacePrefix, '').trim();
  }

  while (ALL_PREFIX_PATTERN.test(res)) {
    const next = res.replace(ALL_PREFIX_PATTERN, '').trim();
    if (next === res) break;
    res = next;
  }
  // Strip enclosing quotes: “...”, "...", '...', ‘...’, 「...」, 『...』
  res = res.replace(/^[“”"''`「」『』\s]+|[“”"''`「」『』\s]+$/g, '').trim();
  return res;
}

export function isSentenceLine(l: string): boolean {
  const trimmed = l.replace(/\*\*/g, '').replace(/^[#>\-\s*•|\d.、]+/gm, '').trim();
  return SENTENCE_PREFIX_PATTERN.test(trimmed);
}

export function isExplicitDefinitionLine(l: string): boolean {
  const trimmed = l.replace(/\*\*/g, '').replace(/^[#>\-\s*•|\d.、]+/gm, '').trim();
  return DEFINITION_PREFIX_PATTERN.test(trimmed);
}

export function isQueryEchoLine(l: string): boolean {
  const trimmed = l.replace(/\*\*/g, '').replace(/^[#>\-\s*•|\d.、]+/gm, '').trim();
  return QUERY_ECHO_PREFIX_PATTERN.test(trimmed);
}

/**
 * Extract concise target-language definition from LLM markdown response.
 * Strips title lines, query echoes ("词：word", "查询：word", "待查内容：word"), headers, IPA phonetics,
 * context/sentence translations ("上下文：..."), and example sentences, extracting only the pure word definition.
 */
export function extractDefinitionFromLlm(
  explanation: string,
  surface?: string,
  targetLang = 'zh',
): string {
  if (!explanation) return '';

  const lines = explanation
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const isWord = !surface || !surface.includes(' ') || surface.split(/\s+/).length <= 3;
  const isSurface = (text: string) =>
    Boolean(surface && text.toLowerCase() === surface.toLowerCase().trim());

  // 0. Try to extract from first line header: "# [word] [IPA] [词性. 中文翻译]"
  for (const line of lines.slice(0, 3)) {
    if (/^#+\s+/i.test(line)) {
      const titleContent = line.replace(/^#+\s*/, '').trim();
      let rest = titleContent;
      if (surface && rest.toLowerCase().startsWith(surface.toLowerCase())) {
        rest = rest.slice(surface.length).trim();
      } else {
        rest = rest.replace(/^(?:\[[^\]]+\]|[a-zA-Z\s'-]+)\s*/, '').trim();
      }
      // Remove IPA phonetics: [/][^/]+[/] or [[][^\]]+[\]]
      rest = rest.replace(/^(?:\[[^\]]+\]|\/[^\/]+\/)\s*/, '').trim();
      const cleaned = cleanLine(rest, surface);
      if (cleaned && !isSurface(cleaned) && /[\u4e00-\u9fa5]/.test(cleaned)) {
        return cleaned;
      }
    }
  }

  // 1. Try to extract from "## 释义" / "### 释义" / "## Definition" / "1. 核心单词卡片" section
  let inSection = false;
  const sectionLines: string[] = [];
  for (const line of lines) {
    if (/^#+\s*(?:释义|Definition|.*核心单词卡片|.*单词卡片)/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (/^#+\s+/.test(line) || /^---/.test(line)) {
        break; // reached next section
      }
      sectionLines.push(line);
    }
  }

  if (sectionLines.length > 0) {
    // Check for table cells like | **当前语境释义** | **[释义]** |
    for (const line of sectionLines) {
      const match = line.match(
        /\|\s*(?:\*\*)?(?:当前语境释义|常用核心释义)(?:\*\*)?\s*\|\s*([^|]+)\|/i,
      );
      if (match) {
        const cleaned = cleanLine(match[1].replace(/[\[\]]/g, ''), surface);
        if (
          cleaned &&
          !isQueryEchoLine(match[1]) &&
          !isSurface(cleaned) &&
          (!isWord || !isSentenceLine(match[1]))
        ) {
          return cleaned;
        }
      }
    }

    // Check explicit word definition line in section
    for (const line of sectionLines) {
      if (/^\|/.test(line)) continue;
      if (isWord && isSentenceLine(line)) continue;
      if (isExplicitDefinitionLine(line)) {
        const cleaned = cleanLine(line, surface);
        if (cleaned && !isSurface(cleaned)) return cleaned;
      }
    }

    // Look for Chinese definition line in section
    for (const line of sectionLines) {
      if (/^\|/.test(line)) continue;
      if (isWord && isSentenceLine(line)) continue;
      if (isQueryEchoLine(line)) continue;
      const cleaned = cleanLine(line, surface);
      if (!cleaned || isSurface(cleaned)) continue;
      if (cleaned.startsWith('{{') || cleaned.endsWith('}}')) continue;
      if (/[\u4e00-\u9fa5]/.test(cleaned)) {
        // Skip lines that look like whole example sentences with English and Chinese translation in parens
        if (
          /^[a-zA-Z].*[.!?]["']?\s*[(（].*[\u4e00-\u9fa5]/.test(cleaned) ||
          /^(?:例句|e\.g\.)/i.test(cleaned)
        ) {
          continue;
        }
        return cleaned;
      }
    }

    // Fallback in section: take first non-template non-header line
    for (const line of sectionLines) {
      if (/^\|/.test(line)) continue;
      if (isWord && isSentenceLine(line)) continue;
      if (isQueryEchoLine(line)) continue;
      const cleaned = cleanLine(line, surface);
      if (
        cleaned &&
        !isSurface(cleaned) &&
        !cleaned.startsWith('{{') &&
        !cleaned.endsWith('}}')
      ) {
        return cleaned;
      }
    }
  }

  // 2. Scan lines for explicit definition line (e.g. "单词：法语", "【单词】法语", "释义：法语")
  for (const line of lines) {
    if (/^\|/.test(line)) continue;
    if (isWord && isSentenceLine(line)) continue;
    if (isExplicitDefinitionLine(line)) {
      const cleaned = cleanLine(line, surface);
      if (cleaned && !isSurface(cleaned)) {
        return cleaned;
      }
    }
  }

  // 3. Scan all lines for target language definition (excluding context sentence lines for single words)
  for (const line of lines) {
    if (/^\|/.test(line)) continue;
    if (isWord && isSentenceLine(line)) continue;
    if (isQueryEchoLine(line)) continue;
    const cleaned = cleanLine(line, surface);
    if (!cleaned || isSurface(cleaned)) continue;
    if (cleaned.startsWith('{{') || cleaned.endsWith('}}')) continue;

    // Skip IPA phonetics: [wɜːd], /wɜːd/, **[wɜːd]**
    if (/^[\[/][^\]/]+[\]/]$/.test(cleaned) || /^\*\*\[.*\]\*\*$/.test(line)) {
      continue;
    }
    // Skip standalone POS tags: n. / v. / adj. / etc.
    if (
      /^[a-z]{1,5}\.?$/i.test(cleaned) ||
      /^\[?[a-z]{1,5}\]?$/i.test(cleaned)
    ) {
      continue;
    }
    // Skip header lines
    if (/^#+\s+/.test(line)) {
      continue;
    }

    // If target is Chinese and line has Chinese characters
    if (/[\u4e00-\u9fa5]/.test(cleaned)) {
      if (
        /^[a-zA-Z].*[.!?]["']?\s*[(（].*[\u4e00-\u9fa5]/.test(cleaned) ||
        /^(?:例句|e\.g\.)/i.test(cleaned)
      ) {
        continue;
      }
      return cleaned;
    }
  }

  // 4. Fallback: filter out obvious header/query/context lines and return first reasonable line
  for (const line of lines) {
    if (/^\|/.test(line)) continue;
    if (isWord && isSentenceLine(line)) continue;
    if (isQueryEchoLine(line)) continue;
    const cleaned = cleanLine(line, surface);
    if (!cleaned || isSurface(cleaned)) continue;
    if (cleaned.startsWith('{{') || cleaned.endsWith('}}')) continue;
    if (/^#+\s+/.test(line)) continue;
    if (cleaned.length < 200) return cleaned;
  }

  // 5. Final fallback if all lines were filtered: choose first non-sentence, non-echo line if possible
  const nonSentenceLine = lines.find(
    (l) => !isSentenceLine(l) && !isQueryEchoLine(l),
  );
  const fallbackLine = nonSentenceLine || lines[0] || explanation.slice(0, 200);
  return cleanLine(fallbackLine, surface);
}

export interface ExplainWordOptions {
  forceLlm?: boolean;
  resetCircuit?: boolean;
  timeoutMs?: number;
  onChunk?: (chunk: string, fullText: string) => void;
}

async function explainWithLlm(
  config: AppConfig,
  surface: string,
  context: string,
  opts?: {
    timeoutMs?: number;
    onChunk?: (chunk: string, fullText: string) => void;
  },
): Promise<WordExplainResult> {
  const system = getWordExplainPrompt(
    config.sourceLang,
    config.targetLang,
    config.wordShow?.langLevel ?? 'intermediate',
    config.wordShow?.customSystemPrompt,
  );
  // Only provide the word itself so LLM focuses purely on translating the word without context confusion
  const userContent = surface.trim();

  const effectiveTimeout = resolveEffectiveTimeoutMs(config, opts?.timeoutMs);
  const explanation = await chatCompletion(
    config,
    [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    {
      timeoutMs: effectiveTimeout,
      onChunk: opts?.onChunk,
      disableThinking: true,
    },
  );
  const definition = extractDefinitionFromLlm(
    explanation,
    surface,
    config.targetLang,
  );
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
 * 2. Try LLM with configured timeout when a key is present and the circuit is closed.
 * 3. Prefer LLM if it wins; otherwise return free MT.
 * 4. After repeated LLM failures, open a short circuit → free MT only (instant path).
 * 5. If options.forceLlm is set, bypass circuit breaker and try LLM with extended timeout.
 */
export async function explainWord(
  config: AppConfig,
  surface: string,
  context: string,
  options?: ExplainWordOptions,
): Promise<WordExplainResult> {
  const key = config.ai.apiKeys[config.ai.providerId];
  if (options?.resetCircuit || options?.forceLlm) {
    resetLlmCircuit();
  }
  const circuitOpen = options?.forceLlm ? false : isLlmCircuitOpen();

  // If forceLlm is set and key exists, try LLM with extended timeout
  if (options?.forceLlm && key) {
    try {
      const timeoutMs = resolveEffectiveTimeoutMs(
        config,
        options.timeoutMs ?? LLM_RETRY_TIMEOUT_MS,
      );
      const res = await explainWithLlm(config, surface, context, {
        timeoutMs,
        onChunk: options.onChunk,
      });
      recordLlmSuccess();
      return res;
    } catch (err) {
      console.warn('[UEH] force LLM explain failed, falling back to free MT', err);
      // fallback to standard path below
    }
  }

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
  const effectiveTimeout = resolveEffectiveTimeoutMs(
    config,
    options?.timeoutMs ?? LLM_WORD_EXPLAIN_TIMEOUT_MS,
  );
  const llmPromise = explainWithLlm(config, surface, context, {
    timeoutMs: effectiveTimeout,
    onChunk: options?.onChunk,
  }).then(
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

/**
 * Render structured explain for UI body text only.
 * Sentence translation is shown once in the popup context block — do not
 * embed `句子译文：…` here or it will appear twice.
 */
export function formatWordExplainForDisplay(r: WordExplainResult): string {
  const parts: string[] = [];
  if (r.definition) parts.push(r.definition);
  if (r.phonetic) parts.push(r.phonetic);
  if (r.explanation && r.engine === 'llm') {
    // Prefer full AI markdown when available; still surface note if present
    const body = r.explanation;
    return r.note ? `${body}\n\n（${r.note}）` : body;
  }
  if (r.note) parts.push(`（${r.note}）`);
  return parts.filter(Boolean).join('\n\n') || r.surface;
}
