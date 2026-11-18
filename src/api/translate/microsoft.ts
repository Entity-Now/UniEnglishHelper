import type { FreeMtProvider } from './types';
import { toMicrosoftLang } from './lang';

/**
 * Microsoft Translator via Edge Read Aloud / Edge Translate auth token.
 * Public browser-style flow (no Azure subscription key).
 *
 * 1) GET https://edge.microsoft.com/translate/auth → JWT
 * 2) POST api-edge.cognitive.microsofttranslator.com/translate
 */

const AUTH_URL = 'https://edge.microsoft.com/translate/auth';
const TRANSLATE_URL =
  'https://api-edge.cognitive.microsofttranslator.com/translate';

let cachedToken: { value: string; expMs: number } | null = null;

async function getAuthToken(force = false): Promise<string> {
  const now = Date.now();
  if (!force && cachedToken && cachedToken.expMs > now + 60_000) {
    return cachedToken.value;
  }

  const res = await fetch(AUTH_URL, {
    method: 'GET',
    headers: {
      Accept: '*/*',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Microsoft auth HTTP ${res.status}`);
  }
  const token = (await res.text()).trim();
  if (!token || token.length < 20) {
    throw new Error('Microsoft auth: empty token');
  }

  // JWT payload exp (seconds)
  let expMs = now + 8 * 60_000;
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { exp?: number };
    if (payload.exp) expMs = payload.exp * 1000;
  } catch {
    // keep default
  }

  cachedToken = { value: token, expMs };
  return token;
}

async function translateOnce(
  text: string,
  src: string,
  dst: string,
  token: string,
): Promise<string> {
  const from = toMicrosoftLang(src);
  const to = toMicrosoftLang(dst);
  if (!to) throw new Error('Microsoft MT: invalid target language');

  const params = new URLSearchParams({
    'api-version': '3.0',
    to,
    includeSentenceLength: 'true',
  });
  if (from) params.set('from', from);

  const res = await fetch(`${TRANSLATE_URL}?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{ Text: text }]),
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 401 || res.status === 403) {
    const err = new Error(`Microsoft MT auth ${res.status}`);
    (err as Error & { code?: string }).code = 'AUTH';
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Microsoft MT HTTP ${res.status}: ${body.slice(0, 120)}`);
  }

  const data = (await res.json()) as Array<{
    translations?: Array<{ text?: string }>;
  }>;
  const out = data?.[0]?.translations?.[0]?.text;
  if (!out) throw new Error('Microsoft MT: empty translation');
  return out;
}

export const microsoftFreeProvider: FreeMtProvider = {
  id: 'microsoft',
  label: 'Microsoft (free)',
  origins: [
    'https://edge.microsoft.com/*',
    'https://api-edge.cognitive.microsofttranslator.com/*',
    'https://api.cognitive.microsofttranslator.com/*',
  ],

  async translate({ text, src, dst }) {
    let token = await getAuthToken(false);
    try {
      return await translateOnce(text, src, dst, token);
    } catch (err) {
      if ((err as { code?: string }).code === 'AUTH') {
        token = await getAuthToken(true);
        return translateOnce(text, src, dst, token);
      }
      throw err;
    }
  },
};

/** Batch translate (same language pair) — chunked to stay within Microsoft API limits. */
export async function microsoftTranslateBatch(
  texts: string[],
  src: string,
  dst: string,
): Promise<string[]> {
  if (texts.length === 0) return [];
  let token = await getAuthToken(false);

  const from = toMicrosoftLang(src);
  const to = toMicrosoftLang(dst);
  if (!to) throw new Error('Microsoft MT: invalid target language');

  const params = new URLSearchParams({
    'api-version': '3.0',
    to,
  });
  if (from) params.set('from', from);

  const doSlice = async (slice: string[], t: string): Promise<string[]> => {
    const res = await fetch(`${TRANSLATE_URL}?${params.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${t}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(slice.map((Text) => ({ Text }))),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401 || res.status === 403) {
      const err = new Error(`Microsoft MT auth ${res.status}`);
      (err as Error & { code?: string }).code = 'AUTH';
      throw err;
    }
    if (!res.ok) {
      throw new Error(`Microsoft MT batch HTTP ${res.status}`);
    }
    const data = (await res.json()) as Array<{
      translations?: Array<{ text?: string }>;
    }>;
    if (!Array.isArray(data) || data.length !== slice.length) {
      throw new Error(
        `Microsoft MT batch length mismatch: expected ${slice.length}, got ${Array.isArray(data) ? data.length : 'non-array'}`,
      );
    }
    return data.map((row, i) => {
      const out = row?.translations?.[0]?.text;
      if (!out) throw new Error(`Microsoft MT batch empty at ${i}`);
      return out;
    });
  };

  // Chunk by <= 50 items and <= 9,000 chars per request
  const slices: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;
  for (const item of texts) {
    if (
      current.length >= 50 ||
      (current.length > 0 && currentChars + item.length > 9_000)
    ) {
      slices.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += item.length;
  }
  if (current.length > 0) slices.push(current);

  const outputs: string[] = [];
  for (const slice of slices) {
    try {
      outputs.push(...(await doSlice(slice, token)));
    } catch (err) {
      if ((err as { code?: string }).code === 'AUTH') {
        token = await getAuthToken(true);
        outputs.push(...(await doSlice(slice, token)));
      } else {
        throw err;
      }
    }
  }
  return outputs;
}

/** Test helper: clear token cache */
export function __resetMicrosoftTokenCache(): void {
  cachedToken = null;
}
