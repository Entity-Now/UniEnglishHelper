const RTL_LANGS = new Set([
  'ar',
  'he',
  'fa',
  'ur',
  'yi',
  'ps',
  'sd',
  'ug',
  'dv',
  'ara',
  'heb',
  'fas',
  'urd',
]);

export function getLanguageDirectionAndLang(targetCode: string): {
  dir: 'ltr' | 'rtl';
  lang?: string;
} {
  const base = targetCode.toLowerCase().split('-')[0];
  const dir = RTL_LANGS.has(base) ? 'rtl' : 'ltr';
  // Prefer BCP-47 short form when input looks like ISO639-3 (3 letters)
  const lang = base.length === 3 ? undefined : base;
  return { dir, lang };
}
