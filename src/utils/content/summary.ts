import { cleanText } from './utils';
import type { AppConfig } from '@/shared/domain/types';
import { chatCompletion, hasLlmCredentials } from '@/api/ai-provider';

/**
 * Generate a brief summary of article/video content for translation context.
 * Uses the project's multi-protocol LLM chat client.
 */
export async function generateArticleSummary(
  title: string,
  textContent: string,
  config: AppConfig,
): Promise<string | null> {
  const preparedText = cleanText(textContent);
  if (!preparedText) return null;

  if (!hasLlmCredentials(config)) return null;

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
