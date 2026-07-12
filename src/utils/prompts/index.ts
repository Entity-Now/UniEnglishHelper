export {
  getWordExplainPrompt,
  type LangLevel,
} from './word-explain';
export {
  getTranslatePromptFromConfig,
  resolvePromptReplacementValue,
  type TranslatePromptOptions,
  type TranslatePromptResult,
} from './translate';
export { getSubtitlesTranslatePromptFromConfig } from './subtitles';
export {
  getLanguageDetectionSystemPrompt,
  parseDetectedLanguageCode,
  type LanguageDetectionOutput,
} from './language-detection';
export { getSubtitlesSegmentationPrompt } from './subtitles-segmentation';
