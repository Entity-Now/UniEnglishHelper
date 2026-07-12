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

  const replaceTokens = (text: string) =>
    text
      .replaceAll(getTokenCellText(TARGET_LANGUAGE), targetLang)
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
