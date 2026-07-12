/**
 * Prompt for AI subtitle re-segmentation (from read-frog).
 */
export function getSubtitlesSegmentationPrompt(input: string): {
  systemPrompt: string;
  prompt: string;
} {
  return {
    systemPrompt: `You re-segment video subtitle lines into natural spoken sentences.
Rules:
1. Output only the resegmented lines, one sentence per line.
2. Do not translate.
3. Preserve original wording; only merge/split for readability.
4. Keep roughly the same total content.`,
    prompt: `Resegment the following subtitle lines:\n\n${input}`,
  };
}
