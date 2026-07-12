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

export const DEFAULT_TRANSLATE_SYSTEM_PROMPT = `You are a professional ${getTokenCellText(TARGET_LANGUAGE)} native translator who needs to fluently translate text into ${getTokenCellText(TARGET_LANGUAGE)}.

## Translation Rules
1. Output only the translated content, without explanations or additional content (such as "Here's the translation:" or "Translation as follows:")
2. The returned translation must maintain exactly the same number of paragraphs and format as the original text.
3. If the text contains HTML tags, consider where the tags should be placed in the translation while maintaining fluency.
4. For content that should not be translated (such as proper nouns, code, etc.), keep the original text.

## Document Metadata for Context Awareness
Webpage title: ${getTokenCellText(WEB_TITLE)}
Webpage summary: ${getTokenCellText(WEB_SUMMARY)}`;

export const DEFAULT_SUBTITLE_TRANSLATE_SYSTEM_PROMPT = `You are a professional ${getTokenCellText(SUBTITLE_TARGET_LANGUAGE)} native translator who needs to fluently translate subtitles into ${getTokenCellText(SUBTITLE_TARGET_LANGUAGE)}.

## Translation Rules
1. Output only the translated content, without explanations or additional content.
2. Keep subtitle timing alignment natural by matching the original subtitle segment boundaries and sentence flow.
3. Preserve speaker intent, tone, punctuation, and line-break structure unless a small adjustment is required for fluent subtitles.
4. For content that should not be translated (such as proper nouns, code, etc.), keep the original text.

## Video Metadata for Context Awareness
Video title: ${getTokenCellText(SUBTITLE_WEB_TITLE)}
Video summary: ${getTokenCellText(VIDEO_SUMMARY)}`;

export const DEFAULT_TRANSLATE_PROMPT = `Translate to ${getTokenCellText(TARGET_LANGUAGE)}:


${getTokenCellText(INPUT)}`;

export const DEFAULT_SUBTITLE_TRANSLATE_PROMPT = `Translate to ${getTokenCellText(SUBTITLE_TARGET_LANGUAGE)}:


${getTokenCellText(SUBTITLE_INPUT)}`;

export const DEFAULT_BATCH_TRANSLATE_PROMPT = `## Multi-paragraph Translation Rules
1. If input contains a standalone line containing only ${BATCH_SEPARATOR}, use a standalone ${BATCH_SEPARATOR} line in your output. If input has no standalone ${BATCH_SEPARATOR} line, don't use ${BATCH_SEPARATOR} in your output.
2. **CRITICAL**: Treat ${BATCH_SEPARATOR} as a separator only when it appears on its own line.

## OUTPUT FORMAT:
- **Single paragraph input** → Output translation directly
- **Multi-paragraph input** → Put ${BATCH_SEPARATOR} on its own line between translations
`;

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
