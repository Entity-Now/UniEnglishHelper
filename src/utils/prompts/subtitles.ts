import type { SubtitlePromptContext } from '@/types/content';
import type { CustomPromptsConfig } from '@/types/config/subtitles';
import {
  DEFAULT_BATCH_TRANSLATE_PROMPT,
  DEFAULT_SUBTITLE_TRANSLATE_PROMPT,
  DEFAULT_SUBTITLE_TRANSLATE_SYSTEM_PROMPT,
  getTokenCellText,
  SUBTITLE_INPUT,
  SUBTITLE_TARGET_LANGUAGE,
  SUBTITLE_WEB_DESCRIPTION,
  SUBTITLE_WEB_TITLE,
  VIDEO_SUMMARY,
} from '@/utils/constants/prompt';
import {
  resolvePromptReplacementValue,
  type TranslatePromptOptions,
  type TranslatePromptResult,
} from './translate';

export function getSubtitlesTranslatePromptFromConfig(
  customPromptsConfig: CustomPromptsConfig,
  targetLang: string,
  input: string,
  options?: TranslatePromptOptions<SubtitlePromptContext>,
): TranslatePromptResult {
  const { patterns, promptId } = customPromptsConfig;

  let systemPrompt: string;
  let prompt: string;

  if (!promptId) {
    systemPrompt = DEFAULT_SUBTITLE_TRANSLATE_SYSTEM_PROMPT;
    prompt = DEFAULT_SUBTITLE_TRANSLATE_PROMPT;
  } else {
    const customPrompt = patterns.find((pattern) => pattern.id === promptId);
    systemPrompt =
      customPrompt?.systemPrompt ?? DEFAULT_SUBTITLE_TRANSLATE_SYSTEM_PROMPT;
    prompt = customPrompt?.prompt ?? DEFAULT_SUBTITLE_TRANSLATE_PROMPT;
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
  const summary = resolvePromptReplacementValue(
    options?.context?.videoSummary,
    'No summary available',
  );

  const replaceTokens = (text: string) =>
    text
      .replaceAll(getTokenCellText(SUBTITLE_TARGET_LANGUAGE), targetLang)
      .replaceAll(getTokenCellText(SUBTITLE_INPUT), input)
      .replaceAll(getTokenCellText(SUBTITLE_WEB_TITLE), title)
      .replaceAll(getTokenCellText(SUBTITLE_WEB_DESCRIPTION), description)
      .replaceAll(getTokenCellText(VIDEO_SUMMARY), summary);

  return {
    systemPrompt: replaceTokens(systemPrompt),
    prompt: replaceTokens(prompt),
  };
}
