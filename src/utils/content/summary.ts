import { cleanText } from './utils';
import type { AppConfig } from '@/shared/domain/types';
import { chatCompletion } from '@/api/ai-provider';

/**
 * Generate a brief summary of article/video content for translation context.
 * Uses the project's OpenAI-compatible chat client.
 */
export async function generateArticleSummary(
  title: string,
  textContent: string,
  config: AppConfig,
): Promise<string | null> {
  const preparedText = cleanText(textContent);
  if (!preparedText) return null;

  const key = config.ai.apiKeys[config.ai.providerId];
  if (!key) return null;

  try {
    return await chatCompletion(config, [
      {
        role: 'system',
        content:
          'Summarize the following content in 2-3 concise sentences for translation context. Output only the summary.',
      },
      {
        role: 'user',
        content: `Title: ${title}\n\n${preparedText}`,
      },
    ]);
  } catch {
    return null;
  }
}
