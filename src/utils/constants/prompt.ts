export const WEB_PAGE_PROMPT_TOKENS = [
  'targetLanguage',
  'input',
  'webTitle',
  'webDescription',
  'webContent',
  'webSummary',
] as const;

export const SUBTITLE_PROMPT_TOKENS = [
  'targetLanguage',
  'input',
  'webTitle',
  'webDescription',
  'videoSummary',
] as const;

export const BATCH_SEPARATOR = '%%';
export const BATCH_SEPARATOR_LINE_PATTERN = /\r?\n[ \t]*%%[ \t]*\r?\n/;

export const TARGET_LANGUAGE = WEB_PAGE_PROMPT_TOKENS[0];
export const INPUT = WEB_PAGE_PROMPT_TOKENS[1];
export const WEB_TITLE = WEB_PAGE_PROMPT_TOKENS[2];
export const WEB_DESCRIPTION = WEB_PAGE_PROMPT_TOKENS[3];
export const WEB_CONTENT = WEB_PAGE_PROMPT_TOKENS[4];
export const WEB_SUMMARY = WEB_PAGE_PROMPT_TOKENS[5];

export const SUBTITLE_TARGET_LANGUAGE = SUBTITLE_PROMPT_TOKENS[0];
export const SUBTITLE_INPUT = SUBTITLE_PROMPT_TOKENS[1];
export const SUBTITLE_WEB_TITLE = SUBTITLE_PROMPT_TOKENS[2];
export const SUBTITLE_WEB_DESCRIPTION = SUBTITLE_PROMPT_TOKENS[3];
export const VIDEO_SUMMARY = SUBTITLE_PROMPT_TOKENS[4];

export const getTokenCellText = (token: string) => `{{${token}}}`;

export const DEFAULT_TRANSLATE_SYSTEM_PROMPT = `Translate the text into ${getTokenCellText(TARGET_LANGUAGE)}. Output ONLY the direct translation without explanations, conversational filler, or thinking tags. Preserve line breaks.`;

export const DEFAULT_SUBTITLE_TRANSLATE_SYSTEM_PROMPT = `Translate video subtitles into ${getTokenCellText(SUBTITLE_TARGET_LANGUAGE)}. Output ONLY the translation directly without any explanations, notes, or thinking tags. Keep it concise for spoken subtitles.`;

export const DEFAULT_TRANSLATE_PROMPT = `${getTokenCellText(INPUT)}`;

export const DEFAULT_SUBTITLE_TRANSLATE_PROMPT = `${getTokenCellText(SUBTITLE_INPUT)}`;

export const DEFAULT_BATCH_TRANSLATE_PROMPT = `Separate each translated item with a single line containing only '${BATCH_SEPARATOR}'.`;

export const DEFAULT_TRANSLATE_PROMPT_ID = '__default__';

export const DEFAULT_TRANSLATE_PROMPTS_CONFIG = {
  promptId: null as string | null,
  patterns: [] as Array<{
    id: string;
    name: string;
    systemPrompt: string;
    prompt: string;
  }>,
};
