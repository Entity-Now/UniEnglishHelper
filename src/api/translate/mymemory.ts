import type { FreeMtProvider } from './types';
import { toMyMemoryLang } from './lang';

/**
 * MyMemory free translation API (quota ~1000 words/day without key).
 * https://mymemory.translated.net/doc/spec.php
 */
export const myMemoryFreeProvider: FreeMtProvider = {
  id: 'mymemory',
  label: 'MyMemory (free)',
  origins: ['https://api.mymemory.translated.net/*'],

  async translate({ text, src, dst }) {
    const sl = toMyMemoryLang(src);
    const tl = toMyMemoryLang(dst);
    // MyMemory rejects very long queries; soft-limit
    const q = text.length > 450 ? text.slice(0, 450) : text;
    const url =
      `https://api.mymemory.translated.net/get` +
      `?q=${encodeURIComponent(q)}` +
      `&langpair=${encodeURIComponent(`${sl}|${tl}`)}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`MyMemory HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      responseStatus?: number;
      responseData?: { translatedText?: string };
      quotaFinished?: boolean;
    };
    if (data.quotaFinished) {
      throw new Error('MyMemory quota finished');
    }
    if (data.responseStatus && data.responseStatus !== 200) {
      throw new Error(`MyMemory status ${data.responseStatus}`);
    }
    const out = data.responseData?.translatedText?.trim();
    if (!out) throw new Error('MyMemory: empty translation');
    // MyMemory sometimes returns MYMEMORY WARNING…
    if (out.toUpperCase().includes('MYMEMORY WARNING')) {
      throw new Error(out);
    }
    return out;
  },
};
