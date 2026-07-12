import { getTranslationCache, putTranslationCache } from '../../db';
import { simpleKey } from '../../utils/hash';
import type { AppConfig } from '../../shared/domain/types';
import { chatCompletion } from '../ai-provider';
import type { FreeMtProviderId } from './types';
import {
  FREE_MT_PROVIDERS,
  resolveProviderOrder,
  allFreeMtOrigins,
} from './providers';
import { microsoftTranslateBatch } from './microsoft';
import { AppError } from '../../shared/messages/errors';

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

  const has = await chrome.permissions.contains({ origins });
  if (has) return true;
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

function engineCacheTag(config: AppConfig): string {
  if (config.translateEngine === 'official_llm' && !freeMtEnabled(config)) {
    return `llm:${config.ai.providerId}`;
  }
  return `free:${resolveFreeProvider(config)}`;
}

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
): Promise<string> {
  const key = config.ai.apiKeys[config.ai.providerId];
  if (!key) {
    if (freeMtEnabled(config) || config.features.enableUnofficialFreeMt) {
      const r = await translateFree(
        text,
        src,
        dst,
        resolveFreeProvider(config),
      );
      return r.text;
    }
    return text;
  }
  const prompt = `Translate from ${src} to ${dst}. Return only the translation, no quotes.\n\n${text}`;
  return chatCompletion(config, [
    { role: 'system', content: 'You are a precise subtitle translator.' },
    { role: 'user', content: prompt },
  ]);
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
    config.translateEngine === 'google_free' ||
    config.translateEngine === 'microsoft_free' ||
    config.translateEngine === 'mymemory_free' ||
    (config.features.enableUnofficialFreeMt &&
      !config.ai.apiKeys[config.ai.providerId] &&
      !useLlm);

  const preferFree =
    forceFree ||
    (config.features.enableUnofficialFreeMt &&
      config.translateEngine !== 'official_llm');

  const tag = engineCacheTag(config);
  const results: { id: string; text: string; provider?: string }[] = [];
  const miss: TranslateItem[] = [];

  for (const item of texts) {
    const key = simpleKey(src, dst, tag, item.text);
    const cached = await getTranslationCache(key);
    if (cached) {
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
      for (const item of batch) {
        const key = simpleKey(src, dst, tag, miss.find((m) => m.id === item.id)!.text);
        await putTranslationCache(key, src, dst, item.provider, item.text);
        results.push(item);
      }
      return orderLike(texts, results);
    } catch (err) {
      // If free failed and LLM is available, fall through
      if (!useLlm || !config.ai.apiKeys[config.ai.providerId]) {
        throw err;
      }
    }
  }

  // LLM path (per item)
  for (const item of miss) {
    const translated = await translateWithLlm(item.text, src, dst, config);
    const key = simpleKey(src, dst, tag, item.text);
    const engine = config.ai.apiKeys[config.ai.providerId]
      ? `llm:${config.ai.providerId}`
      : 'passthrough';
    await putTranslationCache(key, src, dst, engine, translated);
    results.push({ id: item.id, text: translated, provider: engine });
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
