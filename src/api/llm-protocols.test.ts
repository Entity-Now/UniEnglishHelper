import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_CONFIG, type AppConfig } from '../shared/domain/types';
import {
  buildChatRequestBody,
  chatCompletion,
  clearLlmCapabilityCaches,
  clearModelScanCache,
  fetchProviderModels,
  hasLlmCredentials,
  resolveBaseUrl,
  resolveProtocol,
  stripThinkingTags,
} from './ai-provider';
import {
  buildChatEndpointUrl,
  buildProtocolHeaders,
  extractNonStreamText,
  parseStreamLine,
} from './llm-protocols';
import {
  isLlmCircuitOpen,
  recordLlmFailure,
  resetLlmCircuit,
} from './llm-circuit';

function makeConfig(aiOverrides: Partial<AppConfig['ai']> = {}): AppConfig {
  return {
    ...DEFAULT_APP_CONFIG,
    ai: {
      ...DEFAULT_APP_CONFIG.ai,
      ...aiOverrides,
    },
  };
}

function makeSseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(c));
      }
      controller.close();
    },
  });
}

describe('llm-protocols resolution & request building', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearModelScanCache();
    clearLlmCapabilityCaches();
    resetLlmCircuit();
  });

  it('resolves default protocols and baseUrls for OpenAI, Anthropic, Ollama, LM Studio, Splash', () => {
    const cfg = makeConfig();
    expect(resolveProtocol(cfg, 'openai')).toBe('openai');
    expect(resolveBaseUrl(cfg, 'openai')).toBe('https://api.openai.com/v1');

    expect(resolveProtocol(cfg, 'anthropic')).toBe('anthropic');
    expect(resolveBaseUrl(cfg, 'anthropic')).toBe('https://api.anthropic.com/v1');

    expect(resolveProtocol(cfg, 'ollama')).toBe('ollama');
    expect(resolveBaseUrl(cfg, 'ollama')).toBe('http://localhost:11434');

    expect(resolveProtocol(cfg, 'lmstudio')).toBe('openai');
    expect(resolveBaseUrl(cfg, 'lmstudio')).toBe('http://localhost:1234/v1');

    expect(resolveProtocol(cfg, 'splash')).toBe('openai');
    expect(resolveBaseUrl(cfg, 'splash')).toBe('http://127.0.0.1:8000/v1');
  });

  it('treats local frameworks (Ollama, LM Studio, Splash) as keyless credentials', () => {
    const cfg = makeConfig({ apiKeys: {} });
    expect(hasLlmCredentials(cfg, 'ollama')).toBe(true);
    expect(hasLlmCredentials(cfg, 'lmstudio')).toBe(true);
    expect(hasLlmCredentials(cfg, 'splash')).toBe(true);
    expect(hasLlmCredentials(cfg, 'openai')).toBe(false);
    expect(hasLlmCredentials(cfg, 'anthropic')).toBe(false);
  });

  it('allows overriding protocol for Splash to Anthropic Messages', () => {
    const cfg = makeConfig({
      providerId: 'splash',
      model: 'qwen3.8-27b',
      protocols: { splash: 'anthropic' },
    });
    expect(resolveProtocol(cfg, 'splash')).toBe('anthropic');
    expect(resolveBaseUrl(cfg, 'splash')).toBe('http://127.0.0.1:8000/v1');
    expect(buildChatEndpointUrl(resolveBaseUrl(cfg, 'splash'), 'anthropic')).toBe(
      'http://127.0.0.1:8000/v1/messages',
    );
  });

  it('builds Anthropic Messages body with top-level system and merged roles', () => {
    const cfg = makeConfig({
      providerId: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKeys: { anthropic: 'sk-ant-test' },
    });
    const body = buildChatRequestBody(cfg, [
      { role: 'system', content: 'You are a tutor.' },
      { role: 'user', content: 'Part 1' },
      { role: 'user', content: 'Part 2' },
    ]);
    expect(body.model).toBe('claude-sonnet-4-5');
    expect(body.system).toBe('You are a tutor.');
    expect(body.max_tokens).toBe(4096);
    expect(body.messages).toEqual([{ role: 'user', content: 'Part 1\n\nPart 2' }]);
    expect(body.reasoning_effort).toBeUndefined();

    const headers = buildProtocolHeaders('anthropic', 'sk-ant-test', false);
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('builds Ollama native body with think: false when disableThinking is enabled', () => {
    const cfg = makeConfig({
      providerId: 'ollama',
      model: 'qwen3:8b',
      disableThinking: true,
    });
    const body = buildChatRequestBody(cfg, [{ role: 'user', content: 'hi' }]);
    expect(body.model).toBe('qwen3:8b');
    expect(body.think).toBe(false);
    expect(body.options).toEqual({ temperature: 0.3 });
    expect(buildChatEndpointUrl(resolveBaseUrl(cfg, 'ollama'), 'ollama')).toBe(
      'http://localhost:11434/api/chat',
    );
  });

  it('parses streaming & non-streaming responses for Anthropic and Ollama', () => {
    expect(
      parseStreamLine(
        'anthropic',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}',
      ),
    ).toEqual({ text: '你好' });
    expect(
      parseStreamLine('anthropic', 'data: {"type":"message_stop"}'),
    ).toEqual({ done: true });
    expect(
      extractNonStreamText('anthropic', {
        content: [
          { type: 'thinking', text: 'internal' },
          { type: 'text', text: '翻译结果' },
        ],
      }),
    ).toBe('翻译结果');

    expect(
      parseStreamLine('ollama', '{"message":{"content":"世界"},"done":false}'),
    ).toEqual({ text: '世界', done: false });
    expect(
      parseStreamLine('ollama', '{"message":{"content":""},"done":true}'),
    ).toEqual({ text: undefined, done: true });
    expect(
      extractNonStreamText('ollama', { message: { content: '本地结果' } }),
    ).toBe('本地结果');
  });
});

describe('fetchProviderModels auto-scan', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearModelScanCache();
  });

  it('scans Ollama /api/tags and extracts parameter size and quantization', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          models: [
            {
              name: 'qwen3:8b',
              size: 5_000_000_000,
              details: { parameter_size: '8B', quantization_level: 'Q4_K_M', family: 'qwen3' },
            },
            {
              name: 'qwen2.5:1.5b',
              details: { parameter_size: '1.5B' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const cfg = makeConfig({ providerId: 'ollama' });
    const res = await fetchProviderModels(cfg, 'ollama');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(res.protocol).toBe('ollama');
    expect(res.models).toHaveLength(2);
    expect(res.models[0]).toMatchObject({
      id: 'qwen3:8b',
      parameterSize: '8B',
      quantization: 'Q4_K_M',
    });

    // Second call uses TTL cache (no extra fetch)
    const cached = await fetchProviderModels(cfg, 'ollama');
    expect(cached.models).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('scans Anthropic /v1/models with required headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' },
            { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
          ],
        }),
        { status: 200 },
      ),
    );

    const cfg = makeConfig({
      providerId: 'anthropic',
      apiKeys: { anthropic: 'sk-ant-123' },
    });
    const res = await fetchProviderModels(cfg, 'anthropic', { forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-123',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
    expect(res.models).toEqual([
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ]);
  });

  it('scans Splash /v1/models without API key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: 'Qwen3.8-27B', owned_by: 'splash' }],
        }),
        { status: 200 },
      ),
    );

    const cfg = makeConfig({ providerId: 'splash' });
    const res = await fetchProviderModels(cfg, 'splash');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/v1/models',
      expect.anything(),
    );
    expect(res.models[0]?.id).toBe('Qwen3.8-27B');
  });

  it('falls back to /api/v0/models for LM Studio when /v1/models fails', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 'qwen2.5-7b-instruct', quantization: 'Q4_K_M' }],
          }),
          { status: 200 },
        ),
      );

    const cfg = makeConfig({ providerId: 'lmstudio' });
    const res = await fetchProviderModels(cfg, 'lmstudio');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.endpoint).toBe('http://localhost:1234/api/v0/models');
    expect(res.models[0]?.id).toBe('qwen2.5-7b-instruct');
  });
});

describe('performance & reliability optimizations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearLlmCapabilityCaches();
    resetLlmCircuit();
  });

  it('caches thinking-param rejection so subsequent requests skip wasted 400 retry', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      bodies.push(parsed);
      if ('reasoning_effort' in parsed) {
        return new Response('unrecognized field: reasoning_effort', { status: 400 });
      }
      return new Response(
        makeSseStream([
          'data: {"choices":[{"delta":{"content":"OK"}}]}\n',
          'data: [DONE]\n',
        ]),
        { status: 200 },
      );
    });

    const cfg = makeConfig({
      providerId: 'lmstudio',
      model: 'local-model',
      disableThinking: true,
    });

    // First call: 400 then retry succeeds (2 fetches)
    const r1 = await chatCompletion(cfg, [{ role: 'user', content: 'hi' }]);
    expect(r1).toBe('OK');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second call: skips reasoning_effort immediately (only 1 fetch!)
    const r2 = await chatCompletion(cfg, [{ role: 'user', content: 'hi again' }]);
    expect(r2).toBe('OK');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect('reasoning_effort' in bodies[2]!).toBe(false);
  });

  it('isolates circuit breaker state per provider', () => {
    recordLlmFailure(1_000, 'openai');
    recordLlmFailure(1_100, 'openai');
    expect(isLlmCircuitOpen(1_200, 'openai')).toBe(true);
    expect(isLlmCircuitOpen(1_200, 'ollama')).toBe(false);
  });

  it('stripThinkingTags fast-paths plain text and strips <think> blocks', () => {
    expect(stripThinkingTags('  hello world  ')).toBe('hello world');
    expect(stripThinkingTags('<think>reasoning...</think>最终答案')).toBe('最终答案');
  });
});
