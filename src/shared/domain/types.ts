import type {
  SubtitleSurfaceConfig,
  VideoSubtitlesConfig,
} from '../../types/config/subtitles';
import {
  DEFAULT_PAGE_SUBTITLE_SURFACE,
  DEFAULT_PIP_SUBTITLE_SURFACE,
  DEFAULT_VIDEO_SUBTITLES,
} from '../../types/config/subtitles';
import type { SiteRulesConfig } from '../../types/config/site-rules';
import { DEFAULT_SITE_RULES_CONFIG } from '../../types/config/site-rules';
import type { LangLevel } from '../../utils/prompts/word-explain';
import type { SiteControlConfig } from '../../utils/site-control';
import { DEFAULT_SITE_CONTROL } from '../../utils/site-control';
import type { TTSConfig } from '../../types/config/tts';
import { DEFAULT_TTS_CONFIG } from '../../types/config/tts';

export type CaptureState =
  | 'CaptureIdle'
  | 'CaptureArming'
  | 'CaptureLive'
  | 'CaptureError';

export type PipSessionState =
  | 'Idle'
  | 'Opening'
  | 'ActiveMove'
  | 'ActiveMirror'
  | 'Degraded'
  | 'Restoring'
  | 'Closed';

export type PipMode = 'move' | 'mirror';

export interface SubtitleCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  translation?: string;
}

export interface MediaTimelineSample {
  mediaTimeMs: number;
  playbackRate: number;
  paused: boolean;
  epoch: number;
  wallClockMs: number;
}

export interface MediaTimeAnchor {
  audioTimeMs: number;
  mediaTimeMs: number;
  playbackRate: number;
  paused: boolean;
  epoch: number;
  wallClockRecvMs?: number;
}

export interface WordCreate {
  surface: string;
  /** Original sentence / subtitle line */
  context: string;
  /** Word/phrase definition (target language) */
  translation?: string;
  /** Translated context sentence */
  contextTranslation?: string;
  /** Optional IPA / reading */
  phonetic?: string;
  /** Full AI explanation text (markdown), optional */
  explanation?: string;
  /** How definition was obtained */
  explainEngine?: 'llm' | 'free_mt' | 'manual' | 'none';
  explainProvider?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  cueStartMs?: number;
  cueEndMs?: number;
  audioClipId?: number;
  tags?: string[];
  /** true when saving a whole sentence (cue list star) */
  kind?: 'word' | 'sentence';
}

/** Structured explain API result (no string concatenation). */
export interface WordExplainResult {
  surface: string;
  definition: string;
  phonetic?: string;
  context: string;
  contextTranslation?: string;
  explanation?: string;
  engine: 'llm' | 'free_mt' | 'none';
  provider?: string;
  note?: string;
}

export interface WordQuery {
  q?: string;
  dueOnly?: boolean;
  limit?: number;
  offset?: number;
}

export type ReviewResult = 'again' | 'hard' | 'good' | 'easy';

export interface SkillRecordInput {
  id?: string;
  name: string;
  systemPrompt: string;
  enabled?: boolean;
}

export type FreeMtProviderId =
  | 'auto'
  | 'google'
  | 'microsoft'
  | 'mymemory';

export type TranslateEngineId =
  | 'official_llm'
  | 'cloud_mt'
  | 'browser_translator'
  /** @deprecated use free_mt + freeMtProvider */
  | 'unofficial_free'
  | 'free_mt'
  | 'google_free'
  | 'microsoft_free'
  | 'mymemory_free';

/** Word click / side-panel behaviour (word show). */
export interface WordShowConfig {
  /** Pause video when opening word panel */
  pauseOnOpen: boolean;
  /** Auto-run AI explain on word click */
  autoExplain: boolean;
  /** Show dashed underline on clickable words */
  underlineWords: boolean;
  /** Language level for explain prompt */
  langLevel: LangLevel;
  /** Side panel width (px) */
  panelWidth: number;
}

/** Highlight colors for dictionary words in subtitles. */
export interface VocabHighlightConfig {
  enabled: boolean;
  newColor: string;
  learningColor: string;
  learnedColor: string;
}

/**
 * Selection toolbar on arbitrary pages (read-frog aligned settings).
 * @see https://github.com/mengxi-ream/read-frog — options/selection-toolbar
 */
export interface SelectionToolbarConfig {
  /** Master switch */
  enabled: boolean;
  /**
   * Overlay opacity percent (1–100). Applied to toolbar + result panel.
   * read-frog: selectionToolbar.opacity
   */
  opacity: number;
  /**
   * Host/URL patterns where the toolbar is disabled on this site only.
   * read-frog: disabledSelectionToolbarPatterns
   */
  disabledSelectionToolbarPatterns: string[];
  /**
   * Keyboard shortcut to translate the current selection (e.g. "Alt+T").
   * Empty string disables the shortcut.
   * read-frog: features.translate.shortcut
   */
  translateShortcut: string;
  /** Feature toggles (buttons on the floating bar) */
  showTranslate: boolean;
  showTts: boolean;
  showDictionary: boolean;
  showAddWord: boolean;
  /**
   * Show custom AI Skill buttons on the selection bar.
   * Skills come from the same Skill 体系 as「自定义 AI 指令」.
   */
  showSkills: boolean;
  /**
   * Skill IDs pinned on the bar (order = display order).
   * Empty = all enabled skills except study-only built-ins.
   */
  pinnedSkillIds: string[];
}

/** In-page video subtitle overlay (YouTube / HTML5, not only PiP). */
export interface PageSubtitlesConfig extends SubtitleSurfaceConfig {
  autoStartOnYoutube: boolean;
}

/** PiP-window subtitle appearance (independent of page overlay). */
export type PipSubtitlesConfig = SubtitleSurfaceConfig;

export interface AppConfig {
  configVersion: number;
  targetLang: string;
  sourceLang: string;
  translateEngine: TranslateEngineId;
  /**
   * Free MT channel when translateEngine is free_mt / unofficial_free,
   * or as LLM fallback when enableUnofficialFreeMt is true.
   * auto = Microsoft → Google → MyMemory failover.
   */
  freeMtProvider: FreeMtProviderId;
  hostAccessMode: 'per_site' | 'global';
  ai: {
    providerId: string;
    model: string;
    apiKeys: Record<string, string>;
    baseUrls?: Record<string, string>;
  };
  /**
   * Text-to-speech (read-frog aligned).
   * `voice` is kept as a legacy alias of `defaultVoice` for older callers.
   */
  tts: TTSConfig & {
    /** @deprecated use defaultVoice */
    voice?: string;
  };
  pip: {
    width: number;
    height: number;
    /** @deprecated use pipSubtitles.style */
    subtitleFontSize: number;
    /** @deprecated use pipSubtitles.style.container.backgroundOpacity */
    subtitleBgOpacity: number;
    preferMove: boolean;
  };
  /**
   * Shared engine-level subtitle pipeline (batch, prompts, AI segmentation).
   * Appearance lives in pageSubtitles / pipSubtitles.
   */
  videoSubtitles: VideoSubtitlesConfig;
  /** Word click / dictionary panel. */
  wordShow: WordShowConfig;
  /** Subtitle highlight for saved vocabulary. */
  vocabHighlight: VocabHighlightConfig;
  /** Floating selection toolbar on any page. */
  selectionToolbar: SelectionToolbarConfig;
  /** Fullscreen / page player overlay. */
  pageSubtitles: PageSubtitlesConfig;
  /** Document PiP overlay (separate scale/style). */
  pipSubtitles: PipSubtitlesConfig;
  /** Enable/disable extension per site (blacklist default). */
  siteControl: SiteControlConfig;
  /** Per-site DOM walk rules (optional page features). */
  siteRules: SiteRulesConfig;
  recorder: {
    ringSeconds: number;
    sampleRate: number;
    mimeType: 'audio/wav';
    maxClipMs: number;
    supportedRates: number[];
  };
  features: {
    /**
     * Legacy global auto-translate. Prefer pageSubtitles.autoTranslate /
     * pipSubtitles.autoTranslate. Kept as fallback when surface fields missing.
     */
    autoTranslate: boolean;
    prefetchCues: number;
    enableLlmTranslate: boolean;
    enableUnofficialFreeMt: boolean;
    enableTabCapture: boolean;
    enableEdgeTts: boolean;
    enableYoutubeAdapter: boolean;
    captureOnDemand: boolean;
    subtitleProgressEvents: boolean;
  };
}

export const DEFAULT_WORD_SHOW: WordShowConfig = {
  pauseOnOpen: false,
  autoExplain: true,
  underlineWords: true,
  langLevel: 'intermediate',
  panelWidth: 280,
};

export const DEFAULT_VOCAB_HIGHLIGHT: VocabHighlightConfig = {
  enabled: true,
  newColor: '#F5C542',
  learningColor: '#5B9FFF',
  learnedColor: '#3DDC97',
};

export const DEFAULT_SELECTION_TOOLBAR: SelectionToolbarConfig = {
  enabled: true,
  opacity: 100,
  disabledSelectionToolbarPatterns: [],
  translateShortcut: 'Alt+T',
  showTranslate: true,
  showTts: true,
  showDictionary: true,
  showAddWord: true,
  showSkills: true,
  pinnedSkillIds: [],
};

/** Opacity bounds (read-frog selection constants). */
export const MIN_SELECTION_OVERLAY_OPACITY = 1;
export const MAX_SELECTION_OVERLAY_OPACITY = 100;

export const DEFAULT_PAGE_SUBTITLES: PageSubtitlesConfig = {
  ...structuredClone(DEFAULT_PAGE_SUBTITLE_SURFACE),
  autoStartOnYoutube: true,
};

export const DEFAULT_PIP_SUBTITLES: PipSubtitlesConfig = structuredClone(
  DEFAULT_PIP_SUBTITLE_SURFACE,
);

export const DEFAULT_APP_CONFIG: AppConfig = {
  configVersion: 13,
  targetLang: 'zh-CN',
  sourceLang: 'en',
  translateEngine: 'free_mt',
  freeMtProvider: 'auto',
  hostAccessMode: 'global',
  ai: {
    providerId: 'openai-compatible',
    model: 'gpt-4o-mini',
    apiKeys: {},
    baseUrls: {},
  },
  tts: {
    ...structuredClone(DEFAULT_TTS_CONFIG),
    // English-learning default: Edge neural + enable flag still gates network use
    engine: 'edge',
    voice: DEFAULT_TTS_CONFIG.defaultVoice,
  },
  pip: {
    width: 720,
    height: 480,
    subtitleFontSize: 18,
    subtitleBgOpacity: 0.55,
    preferMove: true,
  },
  videoSubtitles: structuredClone(DEFAULT_VIDEO_SUBTITLES),
  wordShow: { ...DEFAULT_WORD_SHOW },
  vocabHighlight: { ...DEFAULT_VOCAB_HIGHLIGHT },
  selectionToolbar: { ...DEFAULT_SELECTION_TOOLBAR },
  pageSubtitles: structuredClone(DEFAULT_PAGE_SUBTITLES),
  pipSubtitles: structuredClone(DEFAULT_PIP_SUBTITLES),
  siteControl: { ...DEFAULT_SITE_CONTROL, blacklistPatterns: [], whitelistPatterns: [] },
  siteRules: structuredClone(DEFAULT_SITE_RULES_CONFIG),
  recorder: {
    ringSeconds: 45,
    sampleRate: 48000,
    mimeType: 'audio/wav',
    maxClipMs: 30_000,
    supportedRates: [0.75, 1, 1.25],
  },
  features: {
    autoTranslate: true,
    prefetchCues: 3,
    enableLlmTranslate: true,
    enableUnofficialFreeMt: true,
    enableTabCapture: true,
    enableEdgeTts: true,
    enableYoutubeAdapter: true,
    captureOnDemand: false,
    subtitleProgressEvents: false,
  },
};
