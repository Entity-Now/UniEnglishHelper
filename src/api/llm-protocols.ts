import type { AppConfig, LlmProtocol } from '../shared/domain/types';
import { AppError } from '../shared/messages/errors';

export interface ProtocolChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmProviderPreset {
  id: string;
  label: string;
  protocol: LlmProtocol;
  defaultBaseUrl: string;
  isLocal: boolean;
  requiresApiKey: boolean;
  description: string;
  supportedProtocols: LlmProtocol[];
}

export const LLM_PROVIDER_PRESETS: readonly LlmProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    isLocal: false,
    requiresApiKey: true,
    description: 'OpenAI 官方接口（GPT-4o / GPT-4.1 / o-series）',
    supportedProtocols: ['openai'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    isLocal: false,
    requiresApiKey: true,
    description: 'Anthropic 原生 Messages 协议（Claude 3.5 / 3.7 / 4）',
    supportedProtocols: ['anthropic', 'openai'],
  },
  {
    id: 'ollama',
    label: 'Ollama（本地）',
    protocol: 'ollama',
    defaultBaseUrl: 'http://localhost:11434',
    isLocal: true,
    requiresApiKey: false,
    description: 'Ollama 本地服务，默认原生 /api/chat + /api/tags（也兼容 /v1）',
    supportedProtocols: ['ollama', 'openai'],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio（本地）',
    protocol: 'openai',
    defaultBaseUrl: 'http://localhost:1234/v1',
    isLocal: true,
    requiresApiKey: false,
    description: 'LM Studio 本地推理服务（默认端口 1234，OpenAI 兼容）',
    supportedProtocols: ['openai'],
  },
  {
    id: 'splash',
    label: 'Splash（本地 Apple Silicon）',
    protocol: 'openai',
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    isLocal: true,
    requiresApiKey: false,
    description: 'Inco AI Splash 高速推理服务（支持 OpenAI 与 Anthropic 协议）',
    supportedProtocols: ['openai', 'anthropic'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    isLocal: false,
    requiresApiKey: true,
    description: 'DeepSeek 官方 API（deepseek-chat / deepseek-reasoner）',
    supportedProtocols: ['openai', 'anthropic'],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    protocol: 'openai',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    isLocal: false,
    requiresApiKey: true,
    description: 'Google Gemini OpenAI 兼容端点',
    supportedProtocols: ['openai'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    protocol: 'openai',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    isLocal: false,
    requiresApiKey: true,
    description: 'OpenRouter 多模型聚合网关',
    supportedProtocols: ['openai', 'anthropic'],
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow（硅基流动）',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    isLocal: false,
    requiresApiKey: true,
    description: '硅基流动高速模型托管平台',
    supportedProtocols: ['openai'],
  },
  {
    id: 'vllm',
    label: 'vLLM / SGLang（本地）',
    protocol: 'openai',
    defaultBaseUrl: 'http://localhost:8000/v1',
    isLocal: true,
    requiresApiKey: false,
    description: 'vLLM / SGLang 高吞吐本地或局域网推理服务',
    supportedProtocols: ['openai'],
  },
  {
    id: 'openai-compatible',
    label: '自定义 / OpenAI 兼容',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    isLocal: false,
    requiresApiKey: true,
    description: '任意 OpenAI / Anthropic / Ollama 兼容代理或自建网关',
    supportedProtocols: ['openai', 'anthropic', 'ollama'],
  },
  {
    id: 'local',
    label: '本地通用服务',
    protocol: 'openai',
    defaultBaseUrl: 'http://localhost:11434/v1',
    isLocal: true,
    requiresApiKey: false,
    description: '本地 OpenAI 兼容推理服务（无需 API Key）',
    supportedProtocols: ['openai', 'ollama', 'anthropic'],
  },
] as const;

export const LLM_PROTOCOL_LABELS: Record<LlmProtocol, string> = {
  openai: 'OpenAI 兼容 (/v1/chat/completions)',
  anthropic: 'Anthropic Messages (/v1/messages)',
  ollama: 'Ollama 原生 (/api/chat)',
};

const PRESET_MAP = new Map<string, LlmProviderPreset>(
  LLM_PROVIDER_PRESETS.map((p) => [p.id, p]),
);

const ANTHROPIC_API_VERSION = '2023-06-01';
const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;

export function getProviderPreset(providerId: string): LlmProviderPreset | undefined {
  return PRESET_MAP.get(providerId.trim().toLowerCase());
}

export function isLocalLlmEndpoint(baseUrl: string): boolean {
  const lower = baseUrl.toLowerCase();
  return (
    lower.includes('localhost') ||
    lower.includes('127.0.0.1') ||
    lower.includes('0.0.0.0') ||
    lower.includes('[::1]') ||
    /https?:\/\/[^/]+\.local(?::\d+)?(\/|$)/.test(lower)
  );
}

/**
 * Determine the active wire protocol for a provider.
 * Precedence:
 * 1. Explicit `config.ai.protocols[providerId]`
 * 2. URL hints (anthropic.com, /messages, /api, /v1)
 * 3. Known provider preset default
 * 4. Fallback to 'openai'
 */
export function resolveProtocol(config: AppConfig, providerId: string): LlmProtocol {
  const trimmedId = providerId.trim();
  const explicit = config.ai.protocols?.[trimmedId];
  if (explicit === 'openai' || explicit === 'anthropic' || explicit === 'ollama') {
    return explicit;
  }

  const configuredUrl = config.ai.baseUrls?.[trimmedId]?.trim().replace(/\/+$/, '').toLowerCase();
  if (configuredUrl) {
    if (configuredUrl.includes('api.anthropic.com') || configuredUrl.endsWith('/messages')) {
      return 'anthropic';
    }
    if (configuredUrl.endsWith('/api') || configuredUrl.endsWith('/api/chat')) {
      return 'ollama';
    }
    if (configuredUrl.endsWith('/v1') || configuredUrl.endsWith('/chat/completions')) {
      return trimmedId.toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
    }
    if (configuredUrl.includes(':11434')) {
      return 'ollama';
    }
  }

  const preset = getProviderPreset(trimmedId);
  if (preset) return preset.protocol;
  return 'openai';
}

/**
 * Resolve and normalize the base URL for a given provider and protocol.
 */
export function resolveBaseUrl(
  config: AppConfig,
  providerId: string,
  protocolOverride?: LlmProtocol,
): string {
  const trimmedId = providerId.trim();
  const protocol = protocolOverride ?? resolveProtocol(config, trimmedId);
  const configured = config.ai.baseUrls?.[trimmedId]?.trim().replace(/\/+$/, '');
  const preset = getProviderPreset(trimmedId);
  let baseUrl = configured || preset?.defaultBaseUrl || 'https://api.openai.com/v1';

  if (protocol === 'ollama') {
    // Native Ollama uses host root + /api/chat and /api/tags
    baseUrl = baseUrl
      .replace(/\/api\/chat$/i, '')
      .replace(/\/api\/tags$/i, '')
      .replace(/\/api$/i, '')
      .replace(/\/v1\/chat\/completions$/i, '')
      .replace(/\/v1$/i, '')
      .replace(/\/+$/, '');
    return baseUrl;
  }

  if (protocol === 'anthropic') {
    baseUrl = baseUrl.replace(/\/messages$/i, '').replace(/\/+$/, '');
    if (
      (baseUrl.includes('api.anthropic.com') || isLocalLlmEndpoint(baseUrl)) &&
      !baseUrl.endsWith('/v1')
    ) {
      baseUrl += '/v1';
    }
    return baseUrl;
  }

  // OpenAI-compatible normalization
  baseUrl = baseUrl.replace(/\/chat\/completions$/i, '').replace(/\/+$/, '');
  if (baseUrl.includes('api.deepseek.com') && !baseUrl.endsWith('/v1')) {
    baseUrl += '/v1';
  } else if (baseUrl.includes('api.openai.com') && !baseUrl.endsWith('/v1')) {
    baseUrl += '/v1';
  } else if (baseUrl.includes('api.anthropic.com') && !baseUrl.endsWith('/v1')) {
    baseUrl += '/v1';
  } else if (
    isLocalLlmEndpoint(baseUrl) &&
    !baseUrl.endsWith('/v1') &&
    !baseUrl.endsWith('/api') &&
    !baseUrl.endsWith('/openai')
  ) {
    baseUrl += '/v1';
  }
  return baseUrl;
}

export function buildChatEndpointUrl(baseUrl: string, protocol: LlmProtocol): string {
  if (protocol === 'anthropic') return `${baseUrl}/messages`;
  if (protocol === 'ollama') return `${baseUrl}/api/chat`;
  return `${baseUrl}/chat/completions`;
}

export function buildProtocolHeaders(
  protocol: LlmProtocol,
  apiKey: string,
  isLocal: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const trimmedKey = apiKey.trim();

  if (protocol === 'anthropic') {
    headers['anthropic-version'] = ANTHROPIC_API_VERSION;
    // Required when calling Anthropic API directly from browser/extension contexts
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    if (trimmedKey) {
      headers['x-api-key'] = trimmedKey;
    } else if (isLocal) {
      headers['x-api-key'] = 'local-key';
    }
    return headers;
  }

  if (protocol === 'ollama') {
    if (trimmedKey) {
      headers.Authorization = `Bearer ${trimmedKey}`;
    }
    return headers;
  }

  // OpenAI-compatible
  if (trimmedKey) {
    headers.Authorization = `Bearer ${trimmedKey}`;
  } else if (isLocal) {
    headers.Authorization = 'Bearer local-key';
  }
  return headers;
}

/**
 * Normalize messages for Anthropic Messages API:
 * - Extract all system messages into a top-level `system` string.
 * - Ensure remaining messages alternate cleanly between user and assistant.
 */
function prepareAnthropicMessages(messages: ProtocolChatMessage[]): {
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  const systemParts: string[] = [];
  const chatMsgs: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content.trim()) systemParts.push(m.content);
      continue;
    }
    const last = chatMsgs[chatMsgs.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      chatMsgs.push({ role: m.role, content: m.content });
    }
  }

  if (chatMsgs.length === 0) {
    chatMsgs.push({ role: 'user', content: '' });
  } else if (chatMsgs[0]!.role !== 'user') {
    chatMsgs.unshift({ role: 'user', content: 'Continue.' });
  }

  return {
    ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
    messages: chatMsgs,
  };
}

export function buildProtocolRequestBody(
  config: AppConfig,
  messages: ProtocolChatMessage[],
  opts?: {
    temperature?: number;
    stream?: boolean;
    disableThinking?: boolean;
    model?: string;
    providerId?: string;
    protocol?: LlmProtocol;
    maxTokens?: number;
  },
  omitThinkingParams = false,
): Record<string, unknown> {
  const providerId = opts?.providerId || config.ai.providerId;
  const protocol = opts?.protocol ?? resolveProtocol(config, providerId);
  const baseUrl = resolveBaseUrl(config, providerId, protocol).toLowerCase();
  const effectiveModel = opts?.model || config.ai.model || '';
  const model = effectiveModel.toLowerCase();
  const stream = opts?.stream ?? true;
  const disableThinking =
    opts?.disableThinking ?? (config.ai.disableThinking !== false);
  const temperature = opts?.temperature ?? 0.3;

  if (protocol === 'anthropic') {
    const prepared = prepareAnthropicMessages(messages);
    const body: Record<string, unknown> = {
      model: effectiveModel,
      max_tokens: opts?.maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS,
      messages: prepared.messages,
      stream,
      temperature,
    };
    if (prepared.system) {
      body.system = prepared.system;
    }
    return body;
  }

  if (protocol === 'ollama') {
    const body: Record<string, unknown> = {
      model: effectiveModel,
      messages,
      stream,
      options: {
        temperature,
      },
    };
    if (disableThinking && !omitThinkingParams) {
      // Ollama native thinking toggle (supported by Ollama 0.9+ for Qwen3 / DeepSeek-R1 / Gemma)
      body.think = false;
    }
    return body;
  }

  // OpenAI-compatible protocol
  const body: Record<string, unknown> = {
    model: effectiveModel,
    messages,
    stream,
  };

  if (!model.startsWith('o1') && !model.startsWith('o3')) {
    body.temperature = temperature;
  }

  if (disableThinking && !omitThinkingParams) {
    // 1. Google Gemini official API endpoint
    if (
      baseUrl.includes('generativelanguage.googleapis.com') ||
      (providerId === 'gemini' && !isLocalLlmEndpoint(baseUrl))
    ) {
      body.thinking_config = { thinking_budget: 0 };
    }

    // 2. OpenRouter
    if (baseUrl.includes('openrouter.ai')) {
      body.reasoning = { effort: 'none' };
      body.include_reasoning = false;
    }

    // 3. Ollama / LM Studio / Splash / LiteRT-LM / Local / vLLM / SiliconFlow / DeepSeek / Qwen / Gemma
    if (
      isLocalLlmEndpoint(baseUrl) ||
      baseUrl.includes('siliconflow') ||
      baseUrl.includes('deepseek') ||
      model.includes('r1') ||
      model.includes('reasoner') ||
      model.includes('qwen') ||
      model.includes('gemma')
    ) {
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

/**
 * Parse a single stream line according to the active protocol.
 * Returns `{ text?, done? }`.
 */
export function parseStreamLine(
  protocol: LlmProtocol,
  rawLine: string,
): { text?: string; done?: boolean } {
  const trimmed = rawLine.trim();
  if (!trimmed) return {};

  if (protocol === 'ollama') {
    try {
      const json = JSON.parse(trimmed) as {
        message?: { content?: string };
        response?: string;
        done?: boolean;
        error?: string;
      };
      if (json.error) {
        throw new AppError('AI_FAILED', `Ollama error: ${json.error}`);
      }
      const text = json.message?.content ?? json.response ?? undefined;
      return { text: text || undefined, done: Boolean(json.done) };
    } catch (err) {
      if (err instanceof AppError) throw err;
      return {};
    }
  }

  // SSE-based protocols (OpenAI & Anthropic)
  if (!trimmed.startsWith('data:')) return {};
  const data = trimmed.slice(5).trim();
  if (!data) return {};
  if (data === '[DONE]') return { done: true };

  if (protocol === 'anthropic') {
    try {
      const json = JSON.parse(data) as {
        type?: string;
        delta?: { type?: string; text?: string };
        error?: { message?: string };
      };
      if (json.type === 'message_stop') return { done: true };
      if (json.type === 'error') {
        throw new AppError('AI_FAILED', json.error?.message || 'Anthropic stream error');
      }
      if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
        return { text: json.delta.text || undefined };
      }
      return {};
    } catch (err) {
      if (err instanceof AppError) throw err;
      return {};
    }
  }

  // OpenAI SSE
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
    const text = delta?.content ?? delta?.text ?? json.choices?.[0]?.text;
    return { text: text || undefined };
  } catch {
    return {};
  }
}

export function extractNonStreamText(
  protocol: LlmProtocol,
  json: unknown,
): string {
  if (!json || typeof json !== 'object') return '';

  if (protocol === 'anthropic') {
    const data = json as {
      content?: Array<{ type?: string; text?: string }>;
    };
    if (!Array.isArray(data.content)) return '';
    return data.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')
      .trim();
  }

  if (protocol === 'ollama') {
    const data = json as {
      message?: { content?: string };
      response?: string;
    };
    return (data.message?.content ?? data.response ?? '').trim();
  }

  // OpenAI-compatible
  const data = json as {
    choices?: Array<{ message?: { content?: string }; text?: string }>;
  };
  return (
    data.choices?.[0]?.message?.content ??
    data.choices?.[0]?.text ??
    ''
  ).trim();
}

export interface DiscoveredModel {
  id: string;
  label?: string;
  ownedBy?: string;
  parameterSize?: string;
  quantization?: string;
  sizeBytes?: number;
}

export interface ModelScanResult {
  models: DiscoveredModel[];
  protocol: LlmProtocol;
  endpoint: string;
  latencyMs: number;
}

interface CachedScanEntry {
  result: ModelScanResult;
  expiresAt: number;
}

const MODEL_SCAN_CACHE_TTL_MS = 30_000;
const modelScanCache = new Map<string, CachedScanEntry>();

export function clearModelScanCache(): void {
  modelScanCache.clear();
}

function parseOpenAiModelList(json: unknown): DiscoveredModel[] {
  const rawList = Array.isArray(json)
    ? json
    : Array.isArray((json as { data?: unknown[] })?.data)
      ? (json as { data: unknown[] }).data
      : Array.isArray((json as { models?: unknown[] })?.models)
        ? (json as { models: unknown[] }).models
        : [];

  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];

  for (const item of rawList) {
    if (typeof item === 'string') {
      const id = item.trim();
      if (id && !seen.has(id)) {
        seen.add(id);
        models.push({ id });
      }
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const rawId = obj.id ?? obj.model ?? obj.name;
    if (typeof rawId !== 'string' || !rawId.trim()) continue;
    const id = rawId.trim();
    if (seen.has(id)) continue;
    seen.add(id);

    const displayName =
      typeof obj.display_name === 'string' && obj.display_name.trim()
        ? obj.display_name.trim()
        : undefined;
    const ownedBy =
      typeof obj.owned_by === 'string' && obj.owned_by.trim()
        ? obj.owned_by.trim()
        : undefined;
    const quantization =
      typeof obj.quantization === 'string' && obj.quantization.trim()
        ? obj.quantization.trim()
        : undefined;

    models.push({
      id,
      ...(displayName && displayName !== id ? { label: displayName } : {}),
      ...(ownedBy ? { ownedBy } : {}),
      ...(quantization ? { quantization } : {}),
    });
  }

  return models;
}

function parseOllamaTags(json: unknown): DiscoveredModel[] {
  const rawList = Array.isArray((json as { models?: unknown[] })?.models)
    ? (json as { models: unknown[] }).models
    : [];

  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as {
      name?: string;
      model?: string;
      size?: number;
      details?: {
        parameter_size?: string;
        quantization_level?: string;
        family?: string;
      };
    };
    const id = (obj.name || obj.model || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      parameterSize: obj.details?.parameter_size,
      quantization: obj.details?.quantization_level,
      sizeBytes: typeof obj.size === 'number' ? obj.size : undefined,
      ownedBy: obj.details?.family,
    });
  }

  return models;
}

async function fetchJsonWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<{ status: number; ok: boolean; json?: unknown; text?: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const onExternalAbort = () => ac.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      throw new DOMException('Aborted', 'AbortError');
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { status: res.status, ok: false, text };
    }
    const json = await res.json();
    return { status: res.status, ok: true, json };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Scan the provider's models endpoint (/v1/models, /api/tags, /api/v0/models)
 * and return normalized model metadata for UI selection.
 */
export async function fetchProviderModels(
  config: AppConfig,
  providerIdOverride?: string,
  opts?: {
    forceRefresh?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<ModelScanResult> {
  const providerId = (providerIdOverride || config.ai.providerId || '').trim();
  if (!providerId) {
    throw new AppError('CONFIG_INVALID', '请先选择或填写 Provider');
  }

  const protocol = resolveProtocol(config, providerId);
  const baseUrl = resolveBaseUrl(config, providerId, protocol);
  const isLocal = isLocalLlmEndpoint(baseUrl);
  const apiKey = (config.ai.apiKeys?.[providerId] || '').trim();

  if (!apiKey && !isLocal) {
    throw new AppError('CONFIG_INVALID', `请先填写 ${providerId} 的 API Key`);
  }

  const cacheKey = `${protocol}|${baseUrl}|${apiKey ? apiKey.slice(-6) : 'local'}`;
  if (!opts?.forceRefresh) {
    const cached = modelScanCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }
  }

  const timeoutMs = opts?.timeoutMs ?? (isLocal ? 6_000 : 12_000);
  const startedAt = Date.now();
  const headers = buildProtocolHeaders(protocol, apiKey, isLocal);
  delete headers['Content-Type'];

  let models: DiscoveredModel[] = [];
  let endpoint = '';

  if (protocol === 'ollama') {
    endpoint = `${baseUrl}/api/tags`;
    try {
      const res = await fetchJsonWithTimeout(endpoint, headers, timeoutMs, opts?.signal);
      if (res.ok) {
        models = parseOllamaTags(res.json);
      } else {
        throw new Error(`HTTP ${res.status}: ${(res.text || '').slice(0, 140)}`);
      }
    } catch (tagsErr) {
      if (opts?.signal?.aborted) throw tagsErr;
      // Fallback to Ollama's OpenAI-compatible /v1/models endpoint
      const fallbackEndpoint = `${baseUrl}/v1/models`;
      const res = await fetchJsonWithTimeout(
        fallbackEndpoint,
        buildProtocolHeaders('openai', apiKey, isLocal),
        timeoutMs,
        opts?.signal,
      );
      if (!res.ok) {
        throw new AppError(
          'AI_FAILED',
          `扫描 Ollama 模型失败（HTTP ${res.status}）: ${(res.text || '').slice(0, 140)}`,
        );
      }
      endpoint = fallbackEndpoint;
      models = parseOpenAiModelList(res.json);
    }
  } else {
    endpoint = `${baseUrl}/models`;
    const res = await fetchJsonWithTimeout(endpoint, headers, timeoutMs, opts?.signal);
    if (!res.ok) {
      // LM Studio fallback: try /api/v0/models if /v1/models returned error
      if (
        (providerId.toLowerCase() === 'lmstudio' || baseUrl.includes(':1234')) &&
        !opts?.signal?.aborted
      ) {
        try {
          const origin = new URL(baseUrl).origin;
          const v0Endpoint = `${origin}/api/v0/models`;
          const v0Res = await fetchJsonWithTimeout(v0Endpoint, {}, timeoutMs, opts?.signal);
          if (v0Res.ok) {
            endpoint = v0Endpoint;
            models = parseOpenAiModelList(v0Res.json);
          } else {
            throw new AppError(
              'AI_FAILED',
              `扫描模型失败（HTTP ${res.status}）: ${(res.text || '').slice(0, 140)}`,
            );
          }
        } catch (fallbackErr) {
          if (fallbackErr instanceof AppError) throw fallbackErr;
          throw new AppError(
            'AI_FAILED',
            `扫描模型失败（HTTP ${res.status}）: ${(res.text || '').slice(0, 140)}`,
          );
        }
      } else {
        throw new AppError(
          'AI_FAILED',
          `扫描模型失败（HTTP ${res.status}）: ${(res.text || '').slice(0, 140)}`,
        );
      }
    } else {
      models = parseOpenAiModelList(res.json);
    }
  }

  const result: ModelScanResult = {
    models,
    protocol,
    endpoint,
    latencyMs: Math.max(1, Date.now() - startedAt),
  };

  modelScanCache.set(cacheKey, {
    result,
    expiresAt: Date.now() + MODEL_SCAN_CACHE_TTL_MS,
  });

  return result;
}
