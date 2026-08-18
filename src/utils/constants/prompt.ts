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

export const DEFAULT_TRANSLATE_SYSTEM_PROMPT = `You are a professional native translator who specializes in fluent and accurate translation into ${getTokenCellText(TARGET_LANGUAGE)}.

## CRITICAL TRANSLATION RULES
1. Strict Target Language: Translate exclusively into ${getTokenCellText(TARGET_LANGUAGE)}. Never output in any other language.
2. Direct Output: Output ONLY the direct translation without any explanations, conversational filler, or meta-comments.
3. Formatting: Preserve the exact paragraph structure, line breaks, and HTML tags/markup from the original text.
4. Preserved Elements: Keep untranslatable proper nouns, brand names, and code blocks unaltered.

## Document Context
Webpage Title: ${getTokenCellText(WEB_TITLE)}
Webpage Summary: ${getTokenCellText(WEB_SUMMARY)}`;

export const DEFAULT_SUBTITLE_TRANSLATE_SYSTEM_PROMPT = `You are an expert bilingual subtitle translator. Your task is to accurately and fluently translate video subtitles into ${getTokenCellText(SUBTITLE_TARGET_LANGUAGE)}.

## CRITICAL TRANSLATION RULES
1. Strict Target Language: You MUST translate exclusively into ${getTokenCellText(SUBTITLE_TARGET_LANGUAGE)}. Under NO circumstances should you output in any other language, nor should you output the source language unchanged unless it is an untranslatable proper noun.
2. Direct Output: Output ONLY the translated subtitle text. Do NOT add any explanations, notes, greetings, or prefixes (such as "Translation:", "Here is the translation:").
3. Subtitle Flow & Timing: Maintain natural, conversational spoken dialogue suitable for video subtitles. Keep sentence boundaries and line structure closely aligned with the original.
4. Preserved Elements: Keep proper nouns, trademarks, formulas, and code names unchanged where standard in ${getTokenCellText(SUBTITLE_TARGET_LANGUAGE)}.
5. Punctuation: Use natural punctuation appropriate for ${getTokenCellText(SUBTITLE_TARGET_LANGUAGE)}.

## Context Awareness (Optional)
Video Title: ${getTokenCellText(SUBTITLE_WEB_TITLE)}
Video Summary: ${getTokenCellText(VIDEO_SUMMARY)}`;

export const DEFAULT_TRANSLATE_PROMPT = `Translate the following text into ${getTokenCellText(TARGET_LANGUAGE)}:

${getTokenCellText(INPUT)}`;

export const DEFAULT_SUBTITLE_TRANSLATE_PROMPT = `Translate the following subtitle text into ${getTokenCellText(SUBTITLE_TARGET_LANGUAGE)}:

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
