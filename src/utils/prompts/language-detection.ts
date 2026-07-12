import { logger } from '@/utils/logger';

const COMMON_LANGS: Record<string, string> = {
  eng: 'English',
  cmn: 'Mandarin Chinese',
  jpn: 'Japanese',
  kor: 'Korean',
  fra: 'French',
  deu: 'German',
  spa: 'Spanish',
  rus: 'Russian',
  por: 'Portuguese',
  ita: 'Italian',
  ara: 'Arabic',
  hin: 'Hindi',
  und: 'Undetermined',
};

export interface LanguageDetectionOutput {
  reason?: string;
  code: string;
}

export function getLanguageDetectionSystemPrompt(): string {
  const list = Object.entries(COMMON_LANGS)
    .map(([code, name]) => `- ${code}: ${name}`)
    .join('\n');

  return `You are a language detection assistant. Identify the language of text and give its ISO 639-3 language code.

## Output format

Return a raw JSON string:
{
  "reason": "brief reason",
  "code": "eng"
}

Supported codes (examples):
${list}

If unsure, use "und".
`;
}

export function parseDetectedLanguageCode(raw: string): string {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return 'und';
    const parsed = JSON.parse(jsonMatch[0]) as LanguageDetectionOutput;
    if (typeof parsed.code === 'string' && parsed.code.trim()) {
      return parsed.code.trim().toLowerCase();
    }
  } catch (err) {
    logger.warn('Failed to parse language detection output', err);
  }
  return 'und';
}
