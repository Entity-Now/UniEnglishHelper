import type { FreeMtProvider } from './types';
import { toGoogleLang } from './lang';

/**
 * Google Translate free endpoint (client=gtx).
 * Unofficial; rate-limited; no API key.
 */
export const googleFreeProvider: FreeMtProvider = {
  id: 'google',
  label: 'Google (free)',
  origins: [
    'https://translate.googleapis.com/*',
    'https://translate.google.com/*',
  ],

  async translate({ text, src, dst }) {
    const sl = toGoogleLang(src);
    const tl = toGoogleLang(dst);
    const url =
      `https://translate.googleapis.com/translate_a/single?client=gtx` +
      `&sl=${encodeURIComponent(sl)}` +
      `&tl=${encodeURIComponent(tl)}` +
      `&dt=t&q=${encodeURIComponent(text)}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Google free MT HTTP ${res.status}`);
    }
    const data = (await res.json()) as unknown[];
    const chunks = data?.[0] as [string, string][] | undefined;
    if (!Array.isArray(chunks)) {
      throw new Error('Google free MT: unexpected response');
    }
    const out = chunks.map((c) => c?.[0] ?? '').join('');
    if (!out) throw new Error('Google free MT: empty translation');
    return out;
  },
};
