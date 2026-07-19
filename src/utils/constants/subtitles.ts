// Timing
export const NAVIGATION_HANDLER_DELAY = 1000;
export const FETCH_CHECK_INTERVAL = 100;
export const FETCH_SUBTITLES_TIMEOUT = 10_000;
export const MAX_GAP_MS = 2_000;
export const PAUSE_TIMEOUT_MS = 1_000;

// Segmentation
export const MAX_WORDS = 15;
export const MAX_CHARS_CJK = 30;
export const SENTENCE_END_PATTERN = /[,.。?？！!；;…؟۔\n]$/;

// On-demand translation
export const TRANSLATION_BATCH_SIZE = 5;
export const TRANSLATE_LOOK_AHEAD_MS = 30_000;
export const PROCESS_LOOK_AHEAD_MS = 60_000;

// Style constants
export const MIN_FONT_SCALE = 30;
export const MAX_FONT_SCALE = 200;
export const DEFAULT_FONT_SCALE = 100;
export const MIN_FONT_WEIGHT = 300;
export const MAX_FONT_WEIGHT = 700;
export const DEFAULT_FONT_WEIGHT = 400;
export const MIN_BACKGROUND_OPACITY = 0;
export const MAX_BACKGROUND_OPACITY = 100;
export const DEFAULT_BACKGROUND_OPACITY = 75;
export const DEFAULT_FONT_FAMILY = 'system' as const;
export const DEFAULT_SUBTITLE_COLOR = '#FFFFFF';
export const DEFAULT_DISPLAY_MODE = 'bilingual' as const;
export const DEFAULT_TRANSLATION_POSITION = 'below' as const;
export const DEFAULT_SUBTITLES_LAYOUT = 'stacked' as const;
/** Edge offset range for position.percent (percent of player height). */
export const MIN_POSITION_PERCENT = 0;
export const MAX_POSITION_PERCENT = 45;
export const DEFAULT_CONTROLS_HEIGHT = 60;
export const DEFAULT_SUBTITLE_POSITION = { percent: 10, anchor: 'bottom' as const };

export const SUBTITLE_FONT_FAMILIES: Record<string, string> = {
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  roboto: 'Roboto, sans-serif',
  'noto-sans': '"Noto Sans", "Noto Sans SC", "Noto Sans JP", "Noto Sans KR", sans-serif',
  'noto-serif': '"Noto Serif", "Noto Serif SC", "Noto Serif JP", "Noto Serif KR", serif',
};
