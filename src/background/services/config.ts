import {
  DEFAULT_APP_CONFIG,
  DEFAULT_PAGE_SUBTITLES,
  DEFAULT_PIP_SUBTITLES,
  type AppConfig,
} from '../../shared/domain/types';
import { CONFIG_STORAGE_KEY } from '../../shared/constants';
import { AppError } from '../../shared/messages/errors';
import {
  createDefaultTTSLanguageVoices,
  DEFAULT_TTS_CONFIG,
  EDGE_TTS_FALLBACK_VOICE,
  prosodyNumberFromConfig,
} from '../../types/config/tts';

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function deepMerge<T extends object>(base: T, partial: Partial<T>): T {
  const out = { ...base } as T;
  for (const key of Object.keys(partial) as (keyof T)[]) {
    const pv = partial[key];
    const bv = base[key];
    // Use nullish check so `false` / `0` / `''` still overwrite (critical for
    // feature flags like enableLlmTranslate / autoExplain / autoTranslate).
    if (
      pv !== null &&
      typeof pv === 'object' &&
      !Array.isArray(pv) &&
      bv !== null &&
      typeof bv === 'object' &&
      !Array.isArray(bv)
    ) {
      out[key] = deepMerge(bv as object, pv as object) as T[keyof T];
    } else if (pv !== undefined) {
      out[key] = pv as T[keyof T];
    }
  }
  return out;
}

function migrateToV9(merged: AppConfig, raw: Partial<AppConfig>): AppConfig {
  // Split shared videoSubtitles appearance into page / pip surfaces
  if (!raw.pipSubtitles) {
    const style = structuredClone(
      merged.videoSubtitles?.style ?? DEFAULT_PIP_SUBTITLES.style,
    );
    // Prefer legacy pip font size if present
    if (raw.pip?.subtitleFontSize && raw.pip.subtitleFontSize !== 18) {
      style.main.fontScale = Math.round(
        (raw.pip.subtitleFontSize / 18) * 100,
      );
      style.translation.fontScale = Math.round(style.main.fontScale * 0.88);
    } else {
      style.main.fontScale = DEFAULT_PIP_SUBTITLES.style.main.fontScale;
      style.translation.fontScale =
        DEFAULT_PIP_SUBTITLES.style.translation.fontScale;
    }
    if (raw.pip?.subtitleBgOpacity != null) {
      style.container.backgroundOpacity = Math.round(
        raw.pip.subtitleBgOpacity * 100,
      );
    }
    merged.pipSubtitles = {
      enabled: true,
      autoTranslate:
        merged.features?.autoTranslate ?? DEFAULT_PIP_SUBTITLES.autoTranslate,
      style,
      position: structuredClone(
        merged.videoSubtitles?.position ?? DEFAULT_PIP_SUBTITLES.position,
      ),
    };
  }

  if (!raw.pageSubtitles || !('style' in (raw.pageSubtitles as object))) {
    const base = deepMerge(
      DEFAULT_PAGE_SUBTITLES,
      (raw.pageSubtitles as Partial<AppConfig['pageSubtitles']>) ?? {},
    );
    if (!base.style || !raw.pageSubtitles || !('style' in raw.pageSubtitles)) {
      base.style = structuredClone(
        merged.videoSubtitles?.style ?? DEFAULT_PAGE_SUBTITLES.style,
      );
      // Page defaults slightly larger
      if (base.style.main.fontScale < 100) {
        base.style.main.fontScale = DEFAULT_PAGE_SUBTITLES.style.main.fontScale;
        base.style.translation.fontScale =
          DEFAULT_PAGE_SUBTITLES.style.translation.fontScale;
      }
    }
    if (base.autoTranslate == null) {
      base.autoTranslate =
        merged.features?.autoTranslate ?? DEFAULT_PAGE_SUBTITLES.autoTranslate;
    }
    if (!base.position) {
      base.position = structuredClone(
        merged.videoSubtitles?.position ?? DEFAULT_PAGE_SUBTITLES.position,
      );
    }
    if (base.enabled == null) base.enabled = true;
    merged.pageSubtitles = base as AppConfig['pageSubtitles'];
  }

  return merged;
}

/** v11: read-frog style TTS (numeric prosody + languageVoices + defaultVoice). */
function migrateTtsConfig(merged: AppConfig): AppConfig {
  const rawTts = (merged.tts ?? {}) as unknown as Record<string, unknown>;
  const defaults = structuredClone(DEFAULT_TTS_CONFIG);

  const defaultVoice =
    (typeof rawTts.defaultVoice === 'string' && rawTts.defaultVoice.trim()) ||
    (typeof rawTts.voice === 'string' &&
    rawTts.voice.trim() &&
    !/^[a-z]{2}(-[A-Z]{2})?$/.test(rawTts.voice)
      ? rawTts.voice
      : '') ||
    EDGE_TTS_FALLBACK_VOICE;

  const languageVoices = {
    ...createDefaultTTSLanguageVoices(defaultVoice),
    ...(typeof rawTts.languageVoices === 'object' && rawTts.languageVoices
      ? (rawTts.languageVoices as Record<string, string>)
      : {}),
  };

  const engine =
    rawTts.engine === 'web-speech' ||
    rawTts.engine === 'edge' ||
    rawTts.engine === 'azure'
      ? rawTts.engine
      : defaults.engine;

  merged.tts = {
    engine,
    defaultVoice,
    languageVoices,
    rate: prosodyNumberFromConfig(rawTts.rate as string | number | undefined, '%'),
    pitch: prosodyNumberFromConfig(
      rawTts.pitch as string | number | undefined,
      'Hz',
    ),
    volume: prosodyNumberFromConfig(
      rawTts.volume as string | number | undefined,
      '%',
    ),
    // Keep legacy field in sync for older UI code paths
    voice: defaultVoice,
  };

  return merged;
}

export async function getConfig(): Promise<AppConfig> {
  const stored = await chrome.storage.local.get(CONFIG_STORAGE_KEY);
  const raw = stored[CONFIG_STORAGE_KEY] as Partial<AppConfig> | undefined;
  if (!raw) return structuredClone(DEFAULT_APP_CONFIG);
  let merged = deepMerge(DEFAULT_APP_CONFIG, raw);

  if (!merged.freeMtProvider) merged.freeMtProvider = 'auto';
  if (merged.translateEngine === 'unofficial_free') {
    merged.translateEngine = 'free_mt';
  }
  if (!merged.videoSubtitles) {
    merged.videoSubtitles = structuredClone(DEFAULT_APP_CONFIG.videoSubtitles);
  }
  if (!merged.wordShow) merged.wordShow = { ...DEFAULT_APP_CONFIG.wordShow };
  if (!merged.siteRules) {
    merged.siteRules = structuredClone(DEFAULT_APP_CONFIG.siteRules);
  }
  if (!merged.vocabHighlight) {
    merged.vocabHighlight = { ...DEFAULT_APP_CONFIG.vocabHighlight };
  }
  // selection toolbar (v12+ opacity/sites/shortcut; v13 skill pins)
  merged.selectionToolbar = {
    ...DEFAULT_APP_CONFIG.selectionToolbar,
    ...(merged.selectionToolbar ?? {}),
    disabledSelectionToolbarPatterns: Array.isArray(
      merged.selectionToolbar?.disabledSelectionToolbarPatterns,
    )
      ? merged.selectionToolbar!.disabledSelectionToolbarPatterns
      : [],
    opacity: clampInt(
      merged.selectionToolbar?.opacity ??
        DEFAULT_APP_CONFIG.selectionToolbar.opacity,
      1,
      100,
    ),
    translateShortcut:
      typeof merged.selectionToolbar?.translateShortcut === 'string'
        ? merged.selectionToolbar.translateShortcut
        : DEFAULT_APP_CONFIG.selectionToolbar.translateShortcut,
    showSkills:
      typeof merged.selectionToolbar?.showSkills === 'boolean'
        ? merged.selectionToolbar.showSkills
        : DEFAULT_APP_CONFIG.selectionToolbar.showSkills,
    pinnedSkillIds: Array.isArray(merged.selectionToolbar?.pinnedSkillIds)
      ? merged.selectionToolbar!.pinnedSkillIds.filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        )
      : [],
  };
  if (!merged.pageSubtitles) {
    merged.pageSubtitles = structuredClone(DEFAULT_PAGE_SUBTITLES);
  }
  if (!merged.pipSubtitles) {
    merged.pipSubtitles = structuredClone(DEFAULT_PIP_SUBTITLES);
  }
  if (!merged.siteControl) {
    merged.siteControl = structuredClone(DEFAULT_APP_CONFIG.siteControl);
  }

  // v9: separate page vs pip subtitle surfaces
  if ((raw.configVersion ?? 0) < 9 || !raw.pipSubtitles) {
    merged = migrateToV9(merged, raw);
  }

  // Always normalize TTS shape (legacy string prosody → numbers)
  merged = migrateTtsConfig(merged);

  // Ensure layout / position fields exist on older saves (pre-split layout)
  for (const surface of [merged.pageSubtitles, merged.pipSubtitles] as const) {
    if (!surface?.style) continue;
    if (surface.style.layout !== 'split' && surface.style.layout !== 'stacked') {
      surface.style.layout = 'stacked';
    }
    if (!surface.position) {
      surface.position = { percent: 10, anchor: 'bottom' };
    } else {
      if (surface.position.anchor !== 'top' && surface.position.anchor !== 'bottom') {
        surface.position.anchor = 'bottom';
      }
      if (!Number.isFinite(surface.position.percent)) {
        surface.position.percent = 10;
      } else {
        surface.position.percent = Math.max(
          0,
          Math.min(45, surface.position.percent),
        );
      }
    }
    // Cap font scale to the new 200% ceiling (legacy max was 150)
    if (surface.style.main?.fontScale != null) {
      surface.style.main.fontScale = Math.max(
        30,
        Math.min(200, surface.style.main.fontScale),
      );
    }
    if (surface.style.translation?.fontScale != null) {
      surface.style.translation.fontScale = Math.max(
        30,
        Math.min(200, surface.style.translation.fontScale),
      );
    }
  }

  // Sync deprecated pip.subtitleFontSize from pipSubtitles for old readers
  if (merged.pipSubtitles?.style) {
    merged.pip.subtitleFontSize = Math.round(
      (18 * (merged.pipSubtitles.style.main.fontScale ?? 100)) / 100,
    );
    merged.pip.subtitleBgOpacity =
      (merged.pipSubtitles.style.container.backgroundOpacity ?? 55) / 100;
  }

  return merged;
}

export async function setConfig(
  partial: Partial<AppConfig>,
): Promise<AppConfig> {
  const current = await getConfig();
  const next = deepMerge(current, partial);
  if (next.configVersion < 1) {
    throw new AppError('CONFIG_INVALID', 'Invalid configVersion');
  }
  next.configVersion = Math.max(
    next.configVersion,
    DEFAULT_APP_CONFIG.configVersion,
  );
  // Keep legacy pip font fields in sync when pipSubtitles changes
  if (partial.pipSubtitles && next.pipSubtitles?.style) {
    next.pip.subtitleFontSize = Math.round(
      (18 * (next.pipSubtitles.style.main.fontScale ?? 100)) / 100,
    );
    next.pip.subtitleBgOpacity =
      (next.pipSubtitles.style.container.backgroundOpacity ?? 55) / 100;
  }
  // Keep TTS legacy `voice` alias in sync
  if (partial.tts) {
    const tts = migrateTtsConfig(next).tts;
    if (tts.defaultVoice && !tts.voice) tts.voice = tts.defaultVoice;
    if (tts.voice && !tts.defaultVoice) tts.defaultVoice = tts.voice;
    next.tts = tts;
  }
  await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: next });
  return next;
}

/**
 * CHECK only — never call chrome.permissions.request from the service worker.
 * Request must happen in Popup/Options during a user gesture
 * (see src/shared/permissions.ts).
 */
export async function ensureHostAccess(origin: string): Promise<boolean> {
  const config = await getConfig();
  if (config.hostAccessMode === 'global') {
    return chrome.permissions.contains({
      origins: ['http://*/*', 'https://*/*'],
    });
  }
  const originPattern = origin.endsWith('/') ? `${origin}*` : `${origin}/*`;
  const patterns = originPattern.includes('*')
    ? [originPattern]
    : [`${origin}/*`];
  return chrome.permissions.contains({ origins: patterns });
}
