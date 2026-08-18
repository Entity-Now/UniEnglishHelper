import type { WebPagePromptContext } from '@/types/content';
import type { CustomPromptsConfig } from '@/types/config/subtitles';
import {
  DEFAULT_BATCH_TRANSLATE_PROMPT,
  DEFAULT_TRANSLATE_PROMPT,
  DEFAULT_TRANSLATE_SYSTEM_PROMPT,
  getTokenCellText,
  INPUT,
  TARGET_LANGUAGE,
  WEB_CONTENT,
  WEB_DESCRIPTION,
  WEB_SUMMARY,
  WEB_TITLE,
} from '@/utils/constants/prompt';

export interface TranslatePromptOptions<TContext = unknown> {
  isBatch?: boolean;
  context?: TContext;
}

export interface TranslatePromptResult {
  systemPrompt: string;
  prompt: string;
}

export function resolvePromptReplacementValue(
  value: string | null | undefined,
  fallback: string,
): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

const PROMPT_LANG_NAMES: Record<string, string> = {
  'zh-cn': 'Simplified Chinese (简体中文)',
  'zh-hans': 'Simplified Chinese (简体中文)',
  'zh-sg': 'Simplified Chinese (简体中文)',
  'zh-tw': 'Traditional Chinese (繁體中文)',
  'zh-hant': 'Traditional Chinese (繁體中文)',
  'zh-hk': 'Traditional Chinese (繁體中文)',
  'zh-mo': 'Traditional Chinese (繁體中文)',
  zh: 'Simplified Chinese (简体中文)',
  en: 'English',
  'en-us': 'English (US)',
  'en-gb': 'English (UK)',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
  fr: 'French (Français)',
  de: 'German (Deutsch)',
  es: 'Spanish (Español)',
  ru: 'Russian (Русский)',
  it: 'Italian (Italiano)',
  pt: 'Portuguese (Português)',
  'pt-br': 'Portuguese (Português - Brasil)',
  'pt-pt': 'Portuguese (Português)',
  vi: 'Vietnamese (Tiếng Việt)',
  th: 'Thai (ไทย)',
  id: 'Indonesian (Bahasa Indonesia)',
  ar: 'Arabic (العربية)',
  hi: 'Hindi (हिन्दी)',
  nl: 'Dutch (Nederlands)',
  pl: 'Polish (Polski)',
  tr: 'Turkish (Türkçe)',
};

export function formatLanguageForPrompt(code: string | null | undefined): string {
  if (!code || typeof code !== 'string') return 'Simplified Chinese (简体中文)';
  const normalized = code.trim().toLowerCase().replace('_', '-');
  if (PROMPT_LANG_NAMES[normalized]) {
    return PROMPT_LANG_NAMES[normalized];
  }
  const prefix = normalized.split('-')[0];
  if (prefix && PROMPT_LANG_NAMES[prefix]) {
    return PROMPT_LANG_NAMES[prefix];
  }
  return code;
}

export function getTranslatePromptFromConfig(
  customPromptsConfig: CustomPromptsConfig,
  targetLang: string,
  input: string,
  options?: TranslatePromptOptions<WebPagePromptContext>,
): TranslatePromptResult {
  const { patterns, promptId } = customPromptsConfig;

  let systemPrompt: string;
  let prompt: string;

  if (!promptId) {
    systemPrompt = DEFAULT_TRANSLATE_SYSTEM_PROMPT;
    prompt = DEFAULT_TRANSLATE_PROMPT;
  } else {
    const customPrompt = patterns.find((pattern) => pattern.id === promptId);
    systemPrompt =
      customPrompt?.systemPrompt ?? DEFAULT_TRANSLATE_SYSTEM_PROMPT;
    prompt = customPrompt?.prompt ?? DEFAULT_TRANSLATE_PROMPT;
  }

  if (options?.isBatch) {
    systemPrompt = `${systemPrompt}\n\n${DEFAULT_BATCH_TRANSLATE_PROMPT}`;
  }

  const title = resolvePromptReplacementValue(
    options?.context?.webTitle,
    'No title available',
  );
  const description = resolvePromptReplacementValue(
    options?.context?.webDescription,
    'No description available',
  );
  const contentText = resolvePromptReplacementValue(
    options?.context?.webContent,
    'No content available',
  );
  const summary = resolvePromptReplacementValue(
    options?.context?.webSummary,
    'No summary available',
  );
  const targetLanguageFormatted = formatLanguageForPrompt(targetLang);

  const replaceTokens = (text: string) =>
    text
      .replaceAll(getTokenCellText(TARGET_LANGUAGE), targetLanguageFormatted)
      .replaceAll(getTokenCellText(INPUT), input)
      .replaceAll(getTokenCellText(WEB_TITLE), title)
      .replaceAll(getTokenCellText(WEB_DESCRIPTION), description)
      .replaceAll(getTokenCellText(WEB_CONTENT), contentText)
      .replaceAll(getTokenCellText(WEB_SUMMARY), summary);

  return {
    systemPrompt: replaceTokens(systemPrompt),
    prompt: replaceTokens(prompt),
  };
}
