/**
 * Normalize BCP-47-ish tags to each free MT vendor's expected codes.
 */

export function normalizeLang(code: string): string {
  return (code || 'auto').trim().replace('_', '-');
}

/** Google free endpoint: en, zh-CN, zh-TW, ja, … */
export function toGoogleLang(code: string): string {
  const c = normalizeLang(code);
  if (c === 'auto' || c === 'und') return 'auto';
  return c;
}

/**
 * Microsoft Translator: zh-Hans / zh-Hant, not zh-CN.
 * @see https://learn.microsoft.com/azure/ai-services/translator/language-support
 */
export function toMicrosoftLang(code: string): string {
  const c = normalizeLang(code).toLowerCase();
  if (c === 'auto' || c === 'und') return '';
  if (c === 'zh' || c === 'zh-cn' || c === 'zh-sg' || c === 'zh-hans') {
    return 'zh-Hans';
  }
  if (c === 'zh-tw' || c === 'zh-hk' || c === 'zh-mo' || c === 'zh-hant') {
    return 'zh-Hant';
  }
  // keep region form for en-US etc. when present; MS accepts short codes
  if (c.startsWith('en')) return c === 'en' ? 'en' : c;
  // strip to primary subtag for most
  const primary = c.split('-')[0];
  return primary;
}

/** MyMemory: langpair uses en|zh-CN style */
export function toMyMemoryLang(code: string): string {
  const c = normalizeLang(code);
  if (c === 'auto' || c === 'und') return 'Autodetect';
  return c;
}
