/** Subtitle display / style types (aligned with read-frog videoSubtitles). */

/** `off` hides both original and translation lines in PiP. */
export type SubtitlesDisplayMode =
  | 'bilingual'
  | 'originalOnly'
  | 'translationOnly'
  | 'off';
/**
 * Relative placement of the translation line.
 * - stacked: above/below the original inside one block
 * - split: which video edge the translation sits on (`above`=top, `below`=bottom)
 */
export type SubtitlesTranslationPosition = 'above' | 'below';
/**
 * - stacked: original + translation share one block (classic bilingual cue)
 * - split: original and translation on opposite vertical edges of the video
 */
export type SubtitlesLayout = 'stacked' | 'split';
export type SubtitlesFontFamily = 'system' | 'roboto' | 'noto-sans' | 'noto-serif';

export interface SubtitleTextStyle {
  fontFamily: SubtitlesFontFamily;
  /** Percent of base size (30–200). */
  fontScale: number;
  color: string;
  fontWeight: number;
}

export interface SubtitleContainerStyle {
  /** 0–100 */
  backgroundOpacity: number;
}

export interface SubtitlesStyle {
  displayMode: SubtitlesDisplayMode;
  /** stacked (default) or split to opposite edges */
  layout: SubtitlesLayout;
  translationPosition: SubtitlesTranslationPosition;
  main: SubtitleTextStyle;
  translation: SubtitleTextStyle;
  container: SubtitleContainerStyle;
}

/**
 * Vertical placement for the stacked block (ignored for edge offsets in split:
 * split uses `percent` from both top and bottom edges).
 */
export interface SubtitlePosition {
  /** Distance from the chosen edge, 0–45 (% of player height). */
  percent: number;
  anchor: 'top' | 'bottom';
}

export interface RequestQueueConfig {
  rate: number;
  capacity: number;
  timeoutMs: number;
  maxRetries: number;
  baseRetryDelayMs: number;
}

export interface BatchQueueConfig {
  maxCharactersPerBatch: number;
  maxItemsPerBatch: number;
  batchDelay: number;
}

export interface CustomPromptPattern {
  id: string;
  name: string;
  systemPrompt: string;
  prompt: string;
}

export interface CustomPromptsConfig {
  promptId: string | null;
  patterns: CustomPromptPattern[];
}

export interface VideoSubtitlesConfig {
  enabled: boolean;
  autoStart: boolean;
  providerId: string;
  style: SubtitlesStyle;
  aiSegmentation: boolean;
  requestQueueConfig: RequestQueueConfig;
  batchQueueConfig: BatchQueueConfig;
  customPromptsConfig: CustomPromptsConfig;
  position: SubtitlePosition;
}

/**
 * Appearance + translate behaviour for one surface (page overlay or PiP).
 * Kept separate because page is usually fullscreen while PiP is small.
 */
export interface SubtitleSurfaceConfig {
  /** Master visibility for this surface */
  enabled: boolean;
  /** Auto-translate new cues on this surface */
  autoTranslate: boolean;
  style: SubtitlesStyle;
  position: SubtitlePosition;
}

export const DEFAULT_SUBTITLE_TEXT_STYLE: SubtitleTextStyle = {
  fontFamily: 'system',
  fontScale: 100,
  color: '#FFFFFF',
  fontWeight: 600,
};

export const DEFAULT_PAGE_SUBTITLE_SURFACE: SubtitleSurfaceConfig = {
  enabled: true,
  autoTranslate: true,
  style: {
    displayMode: 'bilingual',
    layout: 'stacked',
    translationPosition: 'below',
    main: { ...DEFAULT_SUBTITLE_TEXT_STYLE, fontScale: 110, fontWeight: 600 },
    translation: {
      fontFamily: 'system',
      fontScale: 96,
      color: '#E8D5A3',
      fontWeight: 500,
    },
    container: { backgroundOpacity: 50 },
  },
  position: { percent: 10, anchor: 'bottom' },
};

/** Smaller base scale for PiP window */
export const DEFAULT_PIP_SUBTITLE_SURFACE: SubtitleSurfaceConfig = {
  enabled: true,
  autoTranslate: true,
  style: {
    displayMode: 'bilingual',
    layout: 'stacked',
    translationPosition: 'below',
    main: { ...DEFAULT_SUBTITLE_TEXT_STYLE, fontScale: 85, fontWeight: 600 },
    translation: {
      fontFamily: 'system',
      fontScale: 75,
      color: '#E8D5A3',
      fontWeight: 500,
    },
    container: { backgroundOpacity: 60 },
  },
  position: { percent: 12, anchor: 'bottom' },
};

export const DEFAULT_SUBTITLES_STYLE: SubtitlesStyle = {
  displayMode: 'bilingual',
  layout: 'stacked',
  translationPosition: 'below',
  main: { ...DEFAULT_SUBTITLE_TEXT_STYLE, fontWeight: 600 },
  translation: {
    fontFamily: 'system',
    fontScale: 88,
    color: '#E8D5A3',
    fontWeight: 500,
  },
  container: { backgroundOpacity: 55 },
};

export const DEFAULT_REQUEST_QUEUE_CONFIG: RequestQueueConfig = {
  rate: 4,
  capacity: 8,
  timeoutMs: 30_000,
  maxRetries: 2,
  baseRetryDelayMs: 800,
};

export const DEFAULT_BATCH_QUEUE_CONFIG: BatchQueueConfig = {
  maxCharactersPerBatch: 1800,
  maxItemsPerBatch: 8,
  batchDelay: 120,
};

export const DEFAULT_CUSTOM_PROMPTS_CONFIG: CustomPromptsConfig = {
  promptId: null,
  patterns: [],
};

export const DEFAULT_VIDEO_SUBTITLES: VideoSubtitlesConfig = {
  enabled: true,
  autoStart: true,
  providerId: 'default',
  style: DEFAULT_SUBTITLES_STYLE,
  aiSegmentation: false,
  requestQueueConfig: DEFAULT_REQUEST_QUEUE_CONFIG,
  batchQueueConfig: DEFAULT_BATCH_QUEUE_CONFIG,
  customPromptsConfig: DEFAULT_CUSTOM_PROMPTS_CONFIG,
  position: { percent: 10, anchor: 'bottom' },
};
