import { getTranslationCache, putTranslationCache } from '../../db';
import { simpleKey } from '../../utils/hash';
import type { AppConfig } from '../../shared/domain/types';
import {
  chatCompletion,
  hasLlmCredentials,
  isLocalLlmEndpoint,
  resolveBaseUrl,
} from '../ai-provider';
import type { FreeMtProviderId } from './types';
import {
  FREE_MT_PROVIDERS,
  resolveProviderOrder,
  allFreeMtOrigins,
} from './providers';
import { microsoftTranslateBatch } from './microsoft';
import { AppError } from '../../shared/messages/errors';
import { getSubtitlesTranslatePromptFromConfig } from '../../utils/prompts/subtitles';

export type { FreeMtProviderId } from './types';
export { FREE_MT_PROVIDER_IDS } from './types';
export { listFreeMtProviders, FREE_MT_AUTO_ORDER } from './providers';
export { toMicrosoftLang, toGoogleLang, toMyMemoryLang } from './lang';

export interface TranslateItem {
  id: string;
  text: string;
}

/**
 * Ensure optional host access for free MT endpoints.
 * Safe to call from user-gesture contexts (Options / Popup).
 */
export async function ensureFreeMtPermissions(
  provider: FreeMtProviderId = 'auto',
): Promise<boolean> {
  const origins =
    provider === 'auto'
      ? allFreeMtOrigins()
      : FREE_MT_PROVIDERS[provider].origins;

  // Call chrome.permissions.request directly without awaiting contains() first
  // so transient user activation is never lost across async IPC boundaries.
  return chrome.permissions.request({ origins });
}

function freeMtEnabled(config: AppConfig): boolean {
  return (
    config.features.enableUnofficialFreeMt ||
    config.translateEngine === 'unofficial_free' ||
    config.translateEngine === 'free_mt' ||
    config.translateEngine === 'google_free' ||
    config.translateEngine === 'microsoft_free' ||
    config.translateEngine === 'mymemory_free'
  );
}

function resolveFreeProvider(config: AppConfig): FreeMtProviderId {
  if (config.freeMtProvider) return config.freeMtProvider;
  switch (config.translateEngine) {
    case 'google_free':
      return 'google';
    case 'microsoft_free':
      return 'microsoft';
    case 'mymemory_free':
      return 'mymemory';
    default:
      return 'auto';
  }
}

function engineCacheTag(config: AppConfig, useLlm: boolean): string {
  if (useLlm) {
    const effectiveModel = config.ai.translationModel?.trim() || config.ai.model;
    const effectiveProviderId = config.ai.translationProviderId?.trim() || config.ai.providerId;
    return `llm:${effectiveProviderId}:${effectiveModel}`;
  }
  return `free:${resolveFreeProvider(config)}`;
}

/**
 * In-flight deduplication map for concurrent LLM translation requests
 * (e.g. rapid video seek + prefetch requesting the same cue simultaneously).
 */
const inFlightLlmTranslations = new Map<
  string,
  Promise<{ text: string; cached: boolean; engine: string }>
>();

/**
 * Translate one string with free providers (failover).
 */
export async function translateFree(
  text: string,
  src: string,
  dst: string,
  preferred: FreeMtProviderId = 'auto',
): Promise<{ text: string; provider: string }> {
  const order = resolveProviderOrder(preferred);
  const errors: string[] = [];

  for (const id of order) {
    const provider = FREE_MT_PROVIDERS[id];
    try {
      const out = await provider.translate({ text, src, dst });
      return { text: out, provider: id };
    } catch (err) {
      errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new AppError(
    'TRANSLATE_FAILED',
    `All free MT providers failed. ${errors.join(' | ')}`,
  );
}

/**
 * Batch free MT. Microsoft path batches in one request when selected/auto starts with it.
 */
async function translateFreeBatch(
  items: TranslateItem[],
  src: string,
  dst: string,
  preferred: FreeMtProviderId,
): Promise<{ id: string; text: string; provider: string }[]> {
  if (items.length === 0) return [];

  // Fast path: pure microsoft batch
  if (preferred === 'microsoft') {
    try {
      const outs = await microsoftTranslateBatch(
        items.map((i) => i.text),
        src,
        dst,
      );
      return items.map((item, i) => ({
        id: item.id,
        text: outs[i],
        provider: 'microsoft',
      }));
    } catch {
      // fall through to per-item failover
    }
  }

  // auto: try microsoft batch first for throughput
  if (preferred === 'auto' && items.length > 1) {
    try {
      const outs = await microsoftTranslateBatch(
        items.map((i) => i.text),
        src,
        dst,
      );
      return items.map((item, i) => ({
        id: item.id,
        text: outs[i],
        provider: 'microsoft',
      }));
    } catch {
      // per-item
    }
  }

  const results: { id: string; text: string; provider: string }[] = [];
  for (const item of items) {
    const r = await translateFree(item.text, src, dst, preferred);
    results.push({ id: item.id, text: r.text, provider: r.provider });
  }
  return results;
}

async function translateWithLlm(
  text: string,
  src: string,
  dst: string,
  config: AppConfig,
): Promise<{ text: string; cached: boolean; engine: string }> {
  const effectiveModel = config.ai.translationModel?.trim() || config.ai.model;
  const effectiveProviderId = config.ai.translationProviderId?.trim() || config.ai.providerId;
  const hasKey =
    hasLlmCredentials(config, effectiveProviderId) ||
    hasLlmCredentials(config, config.ai.providerId);
  if (!hasKey) {
    if (freeMtEnabled(config) || config.features.enableUnofficialFreeMt) {
      const r = await translateFree(
        text,
        src,
        dst,
        resolveFreeProvider(config),
      );
      return { text: r.text, cached: true, engine: r.provider };
    }
    return { text, cached: false, engine: 'passthrough' };
  }
  const activeProviderId = hasLlmCredentials(config, effectiveProviderId)
    ? effectiveProviderId
    : config.ai.providerId;
  const promptObj = getSubtitlesTranslatePromptFromConfig(
    config.videoSubtitles?.customPromptsConfig ?? { promptId: null, patterns: [] },
    dst,
    text,
  );
  const out = await chatCompletion(
    config,
    [
      { role: 'system', content: promptObj.systemPrompt },
      { role: 'user', content: promptObj.prompt },
    ],
    {
      model: effectiveModel,
      providerId: activeProviderId,
      disableThinking: true,
      timeoutMs: 30_000,
    },
  );
  return {
    text: out,
    cached: true,
    engine: `llm:${activeProviderId}:${effectiveModel}`,
  };
}

/**
 * Main entry used by background router.
 */
export async function translateTexts(
  texts: TranslateItem[],
  src: string,
  dst: string,
  config: AppConfig,
): Promise<{ id: string; text: string; provider?: string }[]> {
  const effectiveProviderId = config.ai.translationProviderId?.trim() || config.ai.providerId;
  const hasLlmKey =
    hasLlmCredentials(config, effectiveProviderId) ||
    hasLlmCredentials(config, config.ai.providerId);

  const useLlm =
    config.translateEngine === 'official_llm' ||
    (config.features.enableLlmTranslate &&
      config.translateEngine !== 'free_mt' &&
      config.translateEngine !== 'unofficial_free' &&
      config.translateEngine !== 'google_free' &&
      config.translateEngine !== 'microsoft_free' &&
      config.translateEngine !== 'mymemory_free');

  // Prefer free MT when user explicitly selected free engines
  const forceFree =
    config.translateEngine === 'free_mt' ||
    config.translateEngine === 'unofficial_free' ||
    config.translateEngine !== 'official_llm' && !useLlm ||
    (config.features.enableUnofficialFreeMt && !hasLlmKey && !useLlm);

  const preferFree =
    forceFree ||
    (config.features.enableUnofficialFreeMt &&
      config.translateEngine !== 'official_llm');

  const srcKey = src.toLowerCase();
  const dstKey = dst.toLowerCase();
  const willUseLlm = useLlm && hasLlmKey && !(preferFree || forceFree);
  const tag = engineCacheTag(config, willUseLlm).toLowerCase();
  const results: { id: string; text: string; provider?: string }[] = [];
  const miss: TranslateItem[] = [];

  // Parallelize IndexedDB cache lookups instead of sequential awaits
  const cacheEntries = await Promise.all(
    texts.map(async (item) => {
      const key = simpleKey(srcKey, dstKey, tag, item.text);
      const cached = await getTranslationCache(key);
      return { item, cached };
    }),
  );

  for (const { item, cached } of cacheEntries) {
    if (cached && cached.engine !== 'passthrough') {
      results.push({
        id: item.id,
        text: cached.text,
        provider: cached.engine,
      });
    } else {
      miss.push(item);
    }
  }

  if (miss.length === 0) return orderLike(texts, results);

  if (preferFree || forceFree) {
    const preferred = resolveFreeProvider(config);
    try {
      const batch = await translateFreeBatch(miss, src, dst, preferred);
      const writes: Promise<unknown>[] = [];
      for (const item of batch) {
        const origText = miss.find((m) => m.id === item.id)?.text ?? '';
        const key = simpleKey(srcKey, dstKey, tag, origText);
        writes.push(putTranslationCache(key, src, dst, item.provider, item.text));
        results.push(item);
      }
      await Promise.all(writes);
      return orderLike(texts, results);
    } catch (err) {
      // If free failed and LLM is available, fall through
      if (!useLlm || !hasLlmKey) {
        throw err;
      }
    }
  }

  // LLM path: deduplicate identical texts in the batch + in-flight requests,
  // and adapt concurrency (2 for local single-GPU servers, 4 for cloud APIs).
  const activeProviderId = hasLlmCredentials(config, effectiveProviderId)
    ? effectiveProviderId
    : config.ai.providerId;
  const isLocal = isLocalLlmEndpoint(resolveBaseUrl(config, activeProviderId));
  const CONCURRENCY = isLocal ? 2 : 4;

  // Group miss items by identical text so duplicates only trigger 1 LLM request
  const textGroups = new Map<string, TranslateItem[]>();
  for (const item of miss) {
    const group = textGroups.get(item.text);
    if (group) {
      group.push(item);
    } else {
      textGroups.set(item.text, [item]);
    }
  }
  const uniqueTexts = Array.from(textGroups.keys());
  const llmTag = engineCacheTag(config, true).toLowerCase();
  const cacheWrites: Promise<unknown>[] = [];

  let cursor = 0;
  const runWorker = async () => {
    while (cursor < uniqueTexts.length) {
      const idx = cursor++;
      const text = uniqueTexts[idx]!;
      const cacheKey = simpleKey(srcKey, dstKey, llmTag, text);

      let promise = inFlightLlmTranslations.get(cacheKey);
      if (!promise) {
        promise = translateWithLlm(text, src, dst, config).finally(() => {
          inFlightLlmTranslations.delete(cacheKey);
        });
        inFlightLlmTranslations.set(cacheKey, promise);
      }

      const res = await promise;
      if (res.cached && res.engine !== 'passthrough') {
        cacheWrites.push(putTranslationCache(cacheKey, src, dst, res.engine, res.text));
      }
      const group = textGroups.get(text) ?? [];
      for (const item of group) {
        results.push({ id: item.id, text: res.text, provider: res.engine });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, uniqueTexts.length) }, () => runWorker()),
  );
  if (cacheWrites.length > 0) {
    await Promise.all(cacheWrites);
  }

  return orderLike(texts, results);
}

function orderLike(
  input: TranslateItem[],
  results: { id: string; text: string; provider?: string }[],
): { id: string; text: string; provider?: string }[] {
  const map = new Map(results.map((r) => [r.id, r]));
  return input.map((i) => map.get(i.id) ?? { id: i.id, text: i.text });
}
