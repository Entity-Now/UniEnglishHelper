export interface WebPagePromptContext {
  webTitle?: string | null;
  webDescription?: string | null;
  webContent?: string | null;
  webSummary?: string | null;
}

export interface SubtitlePromptContext {
  webTitle?: string | null;
  webDescription?: string | null;
  videoSummary?: string | null;
}
