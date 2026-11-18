import type {
  AppConfig,
  CaptureState,
  PipMode,
  PipSessionState,
  SubtitleCue,
} from '../shared/domain/types';
import type { SubtitlesDisplayMode } from '../types/config/subtitles';
import { findActiveCue } from '../utils/subtitles/parser';
import { sendRuntime } from '../shared/messaging/client';
import { fail, ok, type Result } from '../shared/messages';
import { AppError } from '../shared/messages/errors';
import type { PlayerAdapter } from './players';
import { isYoutubeHost } from './players/youtube';
import { PipBridge } from './bridge';
import { MediaTimelineSampler } from './media-timeline';
import { ClipPlayer } from './clip-player';
import type { BridgeMessage } from '../shared/messages/bridge';
import { isClickableWord, segmentWords } from '../utils/segmenter';
import {
  startVideoMirror,
  type MirrorHandle,
} from './video-mirror';
import {
  bindToolbarFocusgroupFallback,
  buildPipMarkup,
  buildPipStyles,
  clampPipOuterSize,
  formatTime,
  ICONS,
  pipSidePanelExtraPx,
} from './pip-ui-shell';
import {
  isTtsPlaying,
  speakTextSmart,
  stopAllSpeech,
} from '../utils/tts-playback/speak';
import {
  detectYoutubeAdStatus,
  trySkipYoutubeAd,
  type YoutubeAdPhase,
} from './youtube-ads';
import { getPageCues } from './index';
import {
  buildHighlightCss,
  decorateWordSpan,
  syncEnGlossClass,
  type HighlightMap,
} from '../utils/vocab-highlight';
import {
  applySubtitleLayerLayout,
  resolveSubtitlePlacement,
} from '../utils/subtitles/layout';
import { SUBTITLE_FONT_FAMILIES } from '../utils/constants/subtitles';
import { CueListSidebar } from './cue-list-sidebar';
import { CueTranslateScheduler } from './cue-translate';
import {
  VideoVocabRecap,
  formatRecapBadgeFromStats,
} from './video-vocab-recap';
import {
  buildCueWordKeys,
  formatRecapBadge,
  normalizeVideoKey,
  type VideoVocabRecapResult,
} from '../utils/video-vocab-recap';
import type { WordExplainResult } from '../shared/domain/types';
import { renderSafeMarkdownToElement } from '../utils/dom/safe-markdown';
import {
  streamWordExplain,
  type StreamExplainSession,
} from './stream-client';

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow: (options?: {
        width?: number;
        height?: number;
      }) => Promise<Window>;
      window?: Window | null;
    };
  }
}

export class PipSessionController {
  private state: PipSessionState = 'Idle';
  private mode: PipMode = 'mirror';
  private pipWindow: Window | null = null;
  private bridge: PipBridge | null = null;
  private video: HTMLVideoElement | null = null;
  private placeholder: Comment | null = null;
  private originalParent: Node | null = null;
  private cues: SubtitleCue[] = [];
  private currentCue: SubtitleCue | null = null;
  /** Most recent non-null cue so pause-after-line actions (translate/TTS/export/toggle) always work. */
  private lastActiveCue: SubtitleCue | null = null;
  private captureState: CaptureState = 'CaptureIdle';
  private captureSessionId: string | null = null;
  private sampler = new MediaTimelineSampler();
  private clipPlayer = new ClipPlayer();
  private raf = 0;
  private config: AppConfig;
  private lastClipId: number | null = null;
  private translateScheduler: CueTranslateScheduler;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private gestureBanner: HTMLElement | null = null;
  private mirrorHandle: MirrorHandle | null = null;
  private adPollTimer = 0;
  private adPhase: YoutubeAdPhase = 'none';
  /** Runtime overrides for subtitle lines (null = follow config). */
  private showOriginalOverride: boolean | null = null;
  private showTranslationOverride: boolean | null = null;
  private highlightMap: HighlightMap = {};
  private cueList: CueListSidebar | null = null;
  private vocabRecap: VideoVocabRecap | null = null;
  /** Throttle PiP chrome / bridge UI updates (ms timestamp). */
  private lastUiPushMs = 0;
  /** Last cue id painted in PiP — used to replay the enter animation. */
  private lastPipCueId = '';
  /** PiP outer width minus side-panel extras (video stage). */
  private pipBaseOuterWidth = 0;
  /** Extra pixels currently added for recap / cue-list rails. */
  private pipPanelExtraPx = 0;
  private syncingPipSize = false;
  private lastUiKey = '';
  /** Last cue id we already scheduled translate prefetch for. */
  private lastPrefetchCueId = '';
  /** mousemove chrome reveal throttle */
  private lastChromeShowMs = 0;
  /** Avoid rewriting play SVG every UI tick */
  private lastPlayIconPaused: boolean | null = null;
  /** Measured height of #ueh-chrome + gap so subtitles never sit behind wrapped toolbar rows */
  private chromeClearancePx = 78;
  private chromeResizeObserver: ResizeObserver | null = null;
  private unbindToolbarFallback: (() => void) | null = null;
  private unbindVideoEvents: (() => void) | null = null;
  private toastHideTimer = 0;
  private togglePersistTimer = 0;
  private lastVolumeBeforeMute = 1;
  private lastVolumeIconKey = '';
  private ttsBusy = false;
  private translatingBusy = false;
  private activeWordStreamSession: StreamExplainSession | null = null;

  constructor(
    private adapter: PlayerAdapter,
    config: AppConfig,
  ) {
    this.config = config;
    this.translateScheduler = new CueTranslateScheduler({
      getConfig: () => this.config,
      getCues: () => this.cues,
      extraWindows: () => [this.pipWindow],
      onTranslated: (cueId, translation) => {
        if (this.currentCue?.id === cueId) {
          this.currentCue.translation = translation;
        }
        if (this.lastActiveCue?.id === cueId) {
          this.lastActiveCue.translation = translation;
        }
        const displayed = this.getRenderedCue();
        if (displayed?.id === cueId) {
          this.renderCue(displayed);
        }
      },
    });
  }

  getState(): PipSessionState {
    return this.state;
  }

  updateConfig(config: AppConfig): void {
    const prevMode = this.config.pipSubtitles?.style?.displayMode;
    const prevEnabled = this.config.pipSubtitles?.enabled;
    this.config = config;
    // Only reset runtime overrides when pipSubtitles display settings actually changed externally
    if (
      config.pipSubtitles?.style?.displayMode !== prevMode ||
      config.pipSubtitles?.enabled !== prevEnabled
    ) {
      this.showOriginalOverride = null;
      this.showTranslationOverride = null;
    }
    void this.refreshHighlightMap().then(() => {
      this.reapplyPipStyles();
      this.syncSubVisibilityChrome();
      this.injectHighlightCss();
      if (this.config.vocabHighlight) {
        this.cueList?.setVocabHighlight(this.config.vocabHighlight);
        this.vocabRecap?.setVocabHighlight(this.config.vocabHighlight);
      }
      this.cueList?.setHighlightMap(this.highlightMap);
      if (this.pipWindow?.document) {
        this.syncPipSettingsFields(this.pipWindow.document);
      }
      // Force cue re-sync so autoTranslate / display mode / word underlines
      // take effect immediately after Settings save (not only on next cue).
      this.syncCue(true);
      this.applyAutoTranslateNow();
    });
  }

  /** If auto-translate is on and the active cue has no translation, request it. */
  private applyAutoTranslateNow(): void {
    const autoTr =
      this.pipSurface().autoTranslate ?? this.config.features.autoTranslate;
    if (!autoTr) return;
    const cue =
      this.currentCue ??
      (this.video
        ? findActiveCue(
            this.cues,
            Math.round(this.video.currentTime * 1000),
          )
        : null);
    if (cue && !cue.translation) {
      void this.translateScheduler.translateMany([cue]);
    }
    if (cue) this.translateScheduler.prefetchAround(cue, 8);
  }

  private wantsAutoTranslate(): boolean {
    return (
      this.pipSurface().autoTranslate ?? this.config.features.autoTranslate
    );
  }

  private startBackgroundTranslate(): void {
    if (!this.wantsAutoTranslate() || !this.cues.length) return;
    void this.translateScheduler.drainAll();
  }

  private pipSurface() {
    return (
      this.config.pipSubtitles ?? {
        enabled: true,
        autoTranslate: this.config.features.autoTranslate,
        style: this.config.videoSubtitles?.style,
        position: this.config.videoSubtitles?.position,
      }
    );
  }

  private buildPipStyleSheet(): string {
    const vs = this.pipSurface().style;
    const mainScale = vs?.main.fontScale ?? 90;
    const fontSize = Math.round(18 * (mainScale / 100));
    const trScale = vs?.translation.fontScale ?? Math.round(mainScale * 0.86);
    const bgOpacity = (vs?.container.backgroundOpacity ?? 48) / 100;
    const fontFamily =
      SUBTITLE_FONT_FAMILIES[vs?.main.fontFamily ?? 'system'] ??
      SUBTITLE_FONT_FAMILIES.system;
    return buildPipStyles({
      fontSize,
      bgOpacity,
      displayMode: vs?.displayMode ?? 'bilingual',
      translationPosition: vs?.translationPosition ?? 'below',
      mainColor: vs?.main.color,
      translationColor: vs?.translation.color,
      translationFontSize: Math.round(18 * (trScale / 100)),
      mainWeight: vs?.main.fontWeight ?? 600,
      translationWeight: vs?.translation.fontWeight ?? 500,
      fontFamily,
      underlineWords: this.config.wordShow?.underlineWords !== false,
      panelWidth: this.config.wordShow?.panelWidth ?? 280,
    });
  }

  private reapplyPipStyles(): void {
    const doc = this.pipWindow?.document;
    if (!doc) return;
    const el = doc.getElementById('ueh-pip-base-style');
    if (el) el.textContent = this.buildPipStyleSheet();
  }

  private async refreshHighlightMap(): Promise<void> {
    const res = await sendRuntime<HighlightMap>(
      'word.highlightMap',
      {},
      'content',
    );
    if (res.ok) this.highlightMap = res.data;
  }

  /** Refresh highlight map and re-render subtitle panel + cue list. */
  private async refreshWordHighlights(): Promise<void> {
    await this.refreshHighlightMap();
    this.injectHighlightCss();
    this.renderCue(this.getRenderedCue());
    this.cueList?.setHighlightMap(this.highlightMap);
    void this.refreshRecapBadge();
    if (this.vocabRecap?.isOpen()) void this.vocabRecap.refresh();
  }

  /** Public entry for content-script storage listeners (vocab book changes). */
  refreshHighlightsFromStorage(): void {
    void this.refreshWordHighlights();
  }

  private async refreshRecapBadge(): Promise<void> {
    const doc = this.pipWindow?.document;
    if (!doc) return;
    const badge = doc.getElementById('ueh-recap-badge');
    if (!badge) return;
    const res = await sendRuntime<VideoVocabRecapResult>(
      'word.videoRecap',
      {
        videoKey: normalizeVideoKey(location.href),
        cueWordKeys: buildCueWordKeys(this.cues),
      },
      'content',
    );
    if (!res.ok) return;
    const text = formatRecapBadge(res.data.stats);
    badge.textContent = text;
    badge.classList.toggle('on', text.length > 0);
  }

  private async toggleVocabRecap(): Promise<void> {
    const doc = this.pipWindow?.document;
    if (!doc) return;

    if (!this.vocabRecap) {
      this.vocabRecap = new VideoVocabRecap('pip', doc, {
        getVideoKey: () => normalizeVideoKey(location.href),
        onSeek: (ms) => {
          if (this.video) {
            const targetSec = ms / 1000 + 0.01;
            this.video.currentTime = targetSec;
            if (isYoutubeHost()) {
              this.postYoutubePlayerCommand({ action: 'seekTo', seconds: targetSec });
            }
            this.mirrorHandle?.requestFrame?.();
            this.resumePlayback();
          }
        },
        onExplain: (surface, context) => {
          void this.handleWordClick(surface, context);
        },
        onTts: (surface) => {
          void this.handleTts(surface);
        },
        onMarkLearned: async (id) => {
          await sendRuntime(
            'word.setStatus',
            { id, learningStatus: 'learned' },
            'content',
          );
          void this.refreshWordHighlights();
        },
        onStatsChange: (stats) => {
          const badge = doc.getElementById('ueh-recap-badge');
          if (!badge) return;
          const text = formatRecapBadgeFromStats(stats);
          badge.textContent = text;
          badge.classList.toggle('on', text.length > 0);
        },
        onOpenChange: () => {
          this.syncPipSidePanelWindow();
          this.syncPanelToggleButtons();
        },
      });
      this.vocabRecap.setVocabHighlight(
        this.config.vocabHighlight ?? {
          enabled: true,
          newColor: '#F5C542',
          learningColor: '#5B9FFF',
          learnedColor: '#3DDC97',
        },
      );
      this.vocabRecap.setCues(this.cues);
    } else {
      this.vocabRecap.setCues(this.cues);
    }

    this.vocabRecap.toggle();
    this.syncPipSidePanelWindow();
    this.syncPanelToggleButtons();
  }

  private syncPipSidePanelTimer = 0;

  /**
   * Grow / shrink the Document PiP window so recap / cue-list rails sit
   * beside the video instead of covering it.
   */
  private syncPipSidePanelWindow(): void {
    const win = this.pipWindow;
    if (!win) return;
    const root = win.document.getElementById('ueh-pip-root');
    const extra = pipSidePanelExtraPx({
      recapOpen: root?.classList.contains('ueh-recap-open'),
      cueListOpen: root?.classList.contains('ueh-cue-list-open'),
    });
    if (!this.pipBaseOuterWidth) {
      this.pipBaseOuterWidth = Math.max(480, win.outerWidth - this.pipPanelExtraPx);
    }
    const availW = (win.screen.availWidth || win.screen.width || 1280) - 16;
    const availH = (win.screen.availHeight || win.screen.height || 720) - 16;
    const opening = extra > this.pipPanelExtraPx;
    const next = clampPipOuterSize({
      width: this.pipBaseOuterWidth + extra,
      height: opening ? Math.max(win.outerHeight, 420) : win.outerHeight,
      availWidth: availW,
      availHeight: availH,
    });
    this.syncingPipSize = true;
    this.pipPanelExtraPx = extra;
    try {
      win.resizeTo(next.width, next.height);
    } catch {
      // Document PiP may ignore resizeTo on some hosts; layout still won't overlay.
    }
    window.clearTimeout(this.syncPipSidePanelTimer);
    this.syncPipSidePanelTimer = window.setTimeout(() => {
      this.syncingPipSize = false;
    }, 200);
  }

  private injectHighlightCss(): void {
    const doc = this.pipWindow?.document;
    if (!doc) return;
    let el = doc.getElementById('ueh-hl-style');
    if (!el) {
      el = doc.createElement('style');
      el.id = 'ueh-hl-style';
      doc.head.appendChild(el);
    }
    el.textContent = buildHighlightCss(
      this.config.vocabHighlight ?? {
        enabled: true,
        newColor: '#F5C542',
        learningColor: '#5B9FFF',
        learnedColor: '#3DDC97',
      },
    );
  }

  setCaptureLive(sessionId: string, silent = false): void {
    this.captureSessionId = sessionId;
    this.captureState = 'CaptureLive';
    if (this.video) this.sampler.attach(this.video);
    this.sampler.start(sessionId);
    this.syncCaptureChrome();
    this.pushPlaybackState();
    if (!silent) {
      this.toast('info', '原声采集已就绪，可点击保存按钮截取当前句原声');
    }
  }

  setCaptureIdle(): void {
    this.captureSessionId = null;
    this.captureState = 'CaptureIdle';
    this.sampler.stop();
    this.syncCaptureChrome();
    this.pushPlaybackState();
  }

  private syncCaptureChrome(): void {
    const doc = this.pipWindow?.document;
    if (!doc) return;
    const dot = doc.getElementById('ueh-rec-dot');
    const live = Boolean(this.captureSessionId && this.captureState === 'CaptureLive');
    dot?.classList.toggle('on', live);
  }

  private async syncCaptureStatusFromBackground(): Promise<boolean> {
    try {
      const res = await sendRuntime<{
        state: CaptureState;
        sessionId?: string;
      }>('capture.status', {}, 'content');
      if (res.ok && res.data.state === 'CaptureLive' && res.data.sessionId) {
        if (this.captureSessionId !== res.data.sessionId || this.captureState !== 'CaptureLive') {
          this.setCaptureLive(res.data.sessionId, true);
        } else {
          this.syncCaptureChrome();
        }
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }

  private bindVideoMediaListeners(video: HTMLVideoElement): void {
    this.unbindVideoEvents?.();
    const onVolume = () => this.syncVolumeChrome();
    const onRate = () => this.syncRateChrome();
    const onPlayPause = () => {
      this.updatePlayIcon();
      this.renderCue(this.getRenderedCue());
    };
    video.addEventListener('volumechange', onVolume);
    video.addEventListener('ratechange', onRate);
    video.addEventListener('play', onPlayPause);
    video.addEventListener('pause', onPlayPause);
    this.unbindVideoEvents = () => {
      video.removeEventListener('volumechange', onVolume);
      video.removeEventListener('ratechange', onRate);
      video.removeEventListener('play', onPlayPause);
      video.removeEventListener('pause', onPlayPause);
    };
  }

  private postYoutubePlayerCommand(payload: Record<string, unknown>): void {
    if (!isYoutubeHost()) return;
    try {
      window.postMessage(
        {
          type: 'UEH_PLAYER_COMMAND',
          requestId: `pip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          ...payload,
        },
        window.location.origin,
      );
    } catch {
      // ignore
    }
  }

  private getEffectiveAudioState(): { volume: number; muted: boolean } {
    if (this.mirrorHandle?.getAudioState) {
      return this.mirrorHandle.getAudioState();
    }
    const v = this.video;
    if (!v) return { volume: 1, muted: false };
    return {
      volume: Number.isFinite(v.volume) ? Math.max(0, Math.min(1, v.volume)) : 1,
      muted: Boolean(v.muted),
    };
  }

  private applyAudioState(
    opts: { volume?: number; muted?: boolean },
    announce = true,
  ): void {
    const cur = this.getEffectiveAudioState();
    const nextVol =
      typeof opts.volume === 'number' && Number.isFinite(opts.volume)
        ? Math.max(0, Math.min(1, opts.volume))
        : cur.volume;
    const nextMuted =
      typeof opts.muted === 'boolean' ? opts.muted : cur.muted;

    if (nextVol > 0.02) {
      this.lastVolumeBeforeMute = nextVol;
    }

    if (this.mirrorHandle?.setAudioState) {
      this.mirrorHandle.setAudioState({ volume: nextVol, muted: nextMuted });
    } else if (this.video) {
      try {
        this.video.volume = nextVol;
        this.video.muted = nextMuted;
      } catch {
        // ignore
      }
    }

    if (isYoutubeHost()) {
      this.postYoutubePlayerCommand({
        action: 'setVolume',
        volume: Math.round(nextVol * 100),
        muted: nextMuted,
      });
    }

    this.syncVolumeChrome();
    if (announce) {
      const pct = Math.round(nextVol * 100);
      this.toast('info', nextMuted || pct === 0 ? '已静音' : `音量 ${pct}%`);
    }
  }

  private toggleMute(): void {
    const { volume, muted } = this.getEffectiveAudioState();
    if (muted || volume <= 0.01) {
      const restore =
        this.lastVolumeBeforeMute > 0.02 ? this.lastVolumeBeforeMute : 0.8;
      this.applyAudioState({ volume: restore, muted: false }, true);
    } else {
      this.lastVolumeBeforeMute = volume;
      this.applyAudioState({ volume, muted: true }, true);
    }
  }

  private adjustVolumeBy(delta: number): void {
    const { volume, muted } = this.getEffectiveAudioState();
    const base = muted ? 0 : volume;
    const next = Math.round(Math.max(0, Math.min(1, base + delta)) * 100) / 100;
    this.applyAudioState({ volume: next, muted: next <= 0 }, true);
  }

  private syncVolumeChrome(): void {
    const doc = this.pipWindow?.document;
    if (!doc) return;
    const { volume, muted } = this.getEffectiveAudioState();
    const effectivePct = muted ? 0 : Math.round(volume * 100);

    const muteBtn = doc.querySelector(
      'button[data-act="mute"]',
    ) as HTMLButtonElement | null;
    if (muteBtn) {
      const isMutedState = muted || effectivePct === 0;
      muteBtn.setAttribute('aria-pressed', isMutedState ? 'true' : 'false');
      const iconKey = isMutedState
        ? 'mute'
        : effectivePct <= 50
          ? 'low'
          : 'high';
      if (iconKey !== this.lastVolumeIconKey) {
        this.lastVolumeIconKey = iconKey;
        const svg = muteBtn.querySelector('svg');
        if (svg) {
          svg.innerHTML =
            iconKey === 'mute'
              ? ICONS.volumeMute
              : iconKey === 'low'
                ? ICONS.volumeLow
                : ICONS.volume;
        }
      }
    }

    const slider = doc.getElementById('ueh-volume') as HTMLInputElement | null;
    if (slider && doc.activeElement !== slider) {
      const nextStr = String(effectivePct);
      if (slider.value !== nextStr) slider.value = nextStr;
    }
  }

  private cyclePlaybackRate(): void {
    if (!this.video) return;
    const rates = [0.75, 1, 1.25, 1.5, 2];
    const cur = this.video.playbackRate || 1;
    let idx = rates.findIndex((r) => Math.abs(r - cur) < 0.04);
    if (idx < 0) idx = 1;
    const next = rates[(idx + 1) % rates.length]!;
    try {
      this.video.playbackRate = next;
    } catch {
      // ignore
    }
    if (isYoutubeHost()) {
      this.postYoutubePlayerCommand({ action: 'setPlaybackRate', rate: next });
    }
    this.syncRateChrome();
    this.toast('info', `播放倍速：${next}x`);
  }

  private syncRateChrome(): void {
    const doc = this.pipWindow?.document;
    if (!doc) return;
    const btn = doc.querySelector(
      'button[data-act="rate"]',
    ) as HTMLButtonElement | null;
    if (!btn) return;
    const rate = this.video?.playbackRate || 1;
    const label = `${Number(rate.toFixed(2))}x`;
    if (btn.textContent !== label) btn.textContent = label;
  }

  private syncPanelToggleButtons(): void {
    const doc = this.pipWindow?.document;
    if (!doc) return;
    const root = doc.getElementById('ueh-pip-root');
    const settingsOpen = Boolean(
      doc.getElementById('ueh-pip-settings')?.classList.contains('ueh-open'),
    );
    const listOpen = Boolean(
      this.cueList?.isOpen() || root?.classList.contains('ueh-cue-list-open'),
    );
    const recapOpen = Boolean(
      this.vocabRecap?.isOpen() || root?.classList.contains('ueh-recap-open'),
    );

    doc
      .querySelector('button[data-act="settings"]')
      ?.setAttribute('aria-pressed', settingsOpen ? 'true' : 'false');
    doc
      .querySelector('button[data-act="list"]')
      ?.setAttribute('aria-pressed', listOpen ? 'true' : 'false');
    doc
      .querySelector('button[data-act="recap"]')
      ?.setAttribute('aria-pressed', recapOpen ? 'true' : 'false');
  }

  /**
   * Open Document PiP.
   *
   * Chrome requires a *page* user activation (click/tap/key) to call
   * `documentPictureInPicture.requestWindow`. Clicks inside the extension
   * popup do NOT count — that is not a browser-version issue.
   *
   * - If the call is already inside a user gesture (page FAB / hotkey), open now.
   * - Otherwise show an in-page banner and wait for one click.
   */
  async open(): Promise<Result<{ mode: PipMode | 'pending_gesture' }>> {
    if (!window.documentPictureInPicture) {
      return fail(
        'PIP_UNSUPPORTED',
        'Document PiP not supported. Need Chrome/Edge 116+ with Document Picture-in-Picture enabled.',
      );
    }
    if (this.state !== 'Idle' && this.state !== 'Closed') {
      return ok({ mode: this.mode });
    }

    this.video = this.adapter.findVideo();
    if (!this.video) {
      return fail('VIDEO_NOT_FOUND', 'No video element found on page');
    }

    if (!hasPageUserActivation()) {
      this.showClickToOpenBanner();
      return ok({ mode: 'pending_gesture' });
    }

    return this.openWithUserGesture();
  }

  /** Must be invoked from a click/keydown handler on the page. */
  async openWithUserGesture(): Promise<Result<{ mode: PipMode }>> {
    if (!window.documentPictureInPicture) {
      return fail(
        'PIP_UNSUPPORTED',
        'Document PiP not supported (need Chrome/Edge 116+)',
      );
    }
    if (this.state !== 'Idle' && this.state !== 'Closed') {
      return ok({ mode: this.mode });
    }

    this.hideClickToOpenBanner();
    this.state = 'Opening';
    this.video = this.adapter.findVideo();
    if (!this.video) {
      this.state = 'Idle';
      return fail('VIDEO_NOT_FOUND', 'No video element found on page');
    }

    try {
      // requestWindow FIRST (keep user gesture). Do not await getCues() before this.
      this.pipWindow = await window.documentPictureInPicture.requestWindow({
        width: Math.max(480, this.config.pip.width),
        height: Math.max(360, this.config.pip.height),
      });

      this.injectPipShell(this.pipWindow);
      this.mode = this.setupVideoInPip(this.pipWindow, this.video);
      this.state = this.mode === 'move' ? 'ActiveMove' : 'ActiveMirror';
      this.bindVideoMediaListeners(this.video);
      this.syncVolumeChrome();
      this.syncRateChrome();
      this.syncCaptureChrome();

      if (isYoutubeHost()) {
        void sendRuntime('youtube.injectMain', {}, 'content');
      }
      void this.syncCaptureStatusFromBackground();

      this.bridge = new PipBridge();
      this.bridge.onMessage((msg) => void this.onBridgeMessage(msg));
      this.bridge.connectToPip(this.pipWindow);

      this.sampler.attach(this.video);
      this.startTicker();
      this.bindHotkeys(this.pipWindow);
      this.pipBaseOuterWidth = this.pipWindow.outerWidth;
      this.pipPanelExtraPx = 0;
      this.pipWindow.addEventListener('resize', () => {
        if (this.syncingPipSize || !this.pipWindow) return;
        this.pipBaseOuterWidth = Math.max(
          480,
          this.pipWindow.outerWidth - this.pipPanelExtraPx,
        );
      });
      this.pipWindow.addEventListener('pagehide', () => {
        void this.close();
      });

      this.bridge.send({
        type: 'pip.sessionState',
        payload: { state: this.state, mode: this.mode },
      });

      const loadCuesForPip = async () => {
        const wantsAutoTr = () =>
          this.pipSurface().autoTranslate ??
          this.config.features.autoTranslate;

        let cues = getPageCues();
        if (cues.length > 0) {
          this.translateScheduler.reset();
          this.cues = cues;
          this.cueList?.setCues(cues);
          this.vocabRecap?.setCues(cues);
          void this.refreshRecapBadge();
          this.syncCue(true);
          if (wantsAutoTr()) this.startBackgroundTranslate();
          return;
        }

        // Retry fallback (pass explicit video ref so move-mode HTML5 players still resolve <track>/textTracks)
        for (let i = 0; i < 5; i++) {
          cues = await this.adapter.getCues({ video: this.video });
          if (cues.length > 0) {
            this.translateScheduler.reset();
            this.cues = cues;
            this.cueList?.setCues(cues);
            this.vocabRecap?.setCues(cues);
            void this.refreshRecapBadge();
            this.syncCue(true);
            if (wantsAutoTr()) this.startBackgroundTranslate();
            return;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }

        this.toast('warn', '当前视频暂无可用字幕轨');
      };
      void loadCuesForPip();

      this.syncCue(true);
      return ok({ mode: this.mode });
    } catch (err) {
      this.state = 'Idle';
      this.teardownVideoMirror();
      const msg = err instanceof Error ? err.message : String(err);
      if (/user activation/i.test(msg)) {
        this.showClickToOpenBanner();
        return fail(
          'PIP_OPEN_FAILED',
          '需要在网页内点击「学习」按钮打开画中画（扩展弹窗点击无效）。',
        );
      }
      return fail('PIP_OPEN_FAILED', msg);
    }
  }

  /**
   * Fill video slot so PiP is never empty black.
   *
   * Prefer **moving** the real <video> into PiP when the adapter allows it
   * (generic HTML5). That avoids dual decode + canvas copy and is far smoother
   * on resize/move. YouTube cannot move the node safely → low-res canvas mirror.
   */
  private setupVideoInPip(
    pipWindow: Window,
    source: HTMLVideoElement,
  ): PipMode {
    const slot = pipWindow.document.getElementById('ueh-video-slot');
    if (!slot) return 'mirror';

    this.teardownVideoMirror();

    // Prefer real node transfer when safe — biggest perf win (no dual render).
    if (this.adapter.supportsMove && this.config.pip.preferMove !== false) {
      try {
        this.moveVideoToPip(source, pipWindow);
        this.setPagePlayerDimmed(true, false);
        return 'move';
      } catch (err) {
        console.warn('[UEH] move video failed, falling back to mirror', err);
      }
    }

    this.mirrorHandle = startVideoMirror(source, pipWindow, slot);
    if (this.mirrorHandle.mode !== 'none') {
      // Page still decodes; dim/cover the heavy player chrome to cut compositor work.
      this.setPagePlayerDimmed(true, true);
      return 'mirror';
    }

    return 'mirror';
  }

  /**
   * Render an energy-saving standby overlay on the host player container.
   * This covers the host player so the user has clear status and the browser avoids dual rasterization.
   */
  private renderPageStandbyOverlay(on: boolean): void {
    const existing = document.getElementById('ueh-pip-page-standby');
    const strayPip = this.pipWindow?.document.getElementById('ueh-pip-page-standby');
    if (!on) {
      existing?.remove();
      strayPip?.remove();
      return;
    }
    strayPip?.remove();
    if (existing) return;

    // Never resolve parent from this.video when <video> has been moved into pipWindow.document!
    const hostParent =
      this.originalParent instanceof HTMLElement &&
      this.originalParent.ownerDocument === document &&
      this.originalParent.isConnected
        ? this.originalParent.closest('.html5-video-player') || this.originalParent
        : null;
    const videoInPage =
      this.video && this.video.ownerDocument === document ? this.video : null;
    const player =
      hostParent ||
      videoInPage?.closest('.html5-video-player') ||
      videoInPage?.parentElement ||
      document.querySelector('#movie_player, .video-stream')?.parentElement;
    if (!player || player.ownerDocument !== document) return;

    const compPos = getComputedStyle(player).position;
    if (compPos === 'static') {
      (player as HTMLElement).style.position = 'relative';
    }

    const overlay = document.createElement('div');
    overlay.id = 'ueh-pip-page-standby';
    overlay.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 2147483640;
      background: #0b0d14;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #f0f3f8;
      font-family: system-ui, -apple-system, sans-serif;
      user-select: none;
      padding: 24px;
      box-sizing: border-box;
      text-align: center;
    `;

    overlay.innerHTML = `
      <div style="font-size:36px;margin-bottom:12px;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.5));">📺</div>
      <div style="font-size:18px;font-weight:700;margin-bottom:6px;letter-spacing:0.3px;">画中画 (PiP) 学习模式运行中</div>
      <div style="font-size:13px;color:#9aa5b8;max-width:380px;line-height:1.5;margin-bottom:20px;">
        已休眠原页面视频画面渲染与字幕计算以节省硬件能耗与电量
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">
        <button type="button" id="ueh-standby-skip-ad" style="
          display: none;
          padding:8px 18px;border-radius:8px;border:0;
          background:oklch(72% 0.14 145);color:#1a1a1a;font-size:13px;font-weight:600;cursor:pointer;
          box-shadow:0 2px 8px rgba(0,0,0,0.25);
        ">⚡ 跳过广告</button>
        <button type="button" id="ueh-standby-focus" style="
          padding:8px 18px;border-radius:8px;border:0;
          background:oklch(76% 0.12 82);color:#1a1a1a;font-size:13px;font-weight:600;cursor:pointer;
          box-shadow:0 2px 8px rgba(0,0,0,0.25);transition:transform 0.1s ease;
        ">聚焦画中画窗口</button>
        <button type="button" id="ueh-standby-close" style="
          padding:8px 18px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);
          background:rgba(255,255,255,0.08);color:#fff;font-size:13px;font-weight:500;cursor:pointer;
          transition:background 0.1s ease;
        ">退出画中画</button>
      </div>
    `;

    overlay.querySelector('#ueh-standby-skip-ad')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleSkipAd();
    });

    overlay.querySelector('#ueh-standby-focus')?.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        this.pipWindow?.focus();
      } catch {
        // ignore
      }
    });

    overlay.querySelector('#ueh-standby-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.close();
    });

    player.appendChild(overlay);
  }

  /**
   * While PiP is open, cut compositor work on the opener tab.
   * Does not pause media (mirror still needs decoded frames from <video>).
   */
  private setPagePlayerDimmed(on: boolean, isMirror = false): void {
    const STYLE_ID = 'ueh-pip-page-dim';
    if (!on) {
      document.getElementById(STYLE_ID)?.remove();
      this.renderPageStandbyOverlay(false);
      document.documentElement.classList.remove('ueh-pip-active', 'ueh-pip-mirroring');
      return;
    }
    document.documentElement.classList.add('ueh-pip-active');
    if (isMirror) {
      document.documentElement.classList.add('ueh-pip-mirroring');
    }
    this.renderPageStandbyOverlay(true);

    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Hide YouTube player controls and overlay popups over the video area */
      html.ueh-pip-active #movie_player .ytp-chrome-top,
      html.ueh-pip-active #movie_player .ytp-chrome-bottom,
      html.ueh-pip-active #movie_player .ytp-gradient-top,
      html.ueh-pip-active #movie_player .ytp-gradient-bottom,
      html.ueh-pip-active #movie_player .ytp-cards-teaser,
      html.ueh-pip-active #movie_player .ytp-ce-element,
      html.ueh-pip-active #movie_player .ytp-bezel,
      html.ueh-pip-active #movie_player .ytp-spinner {
        visibility: hidden !important;
        pointer-events: none !important;
      }
      /* Hide in-page subtitles overlay when PiP is active */
      html.ueh-pip-active #ueh-page-subs-root {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  private teardownVideoMirror(): void {
    try {
      this.mirrorHandle?.stop();
    } catch {
      // ignore
    }
    this.mirrorHandle = null;
  }

  private showClickToOpenBanner(): void {
    this.hideClickToOpenBanner();
    const el = document.createElement('div');
    el.id = 'ueh-pip-gesture-banner';
    el.setAttribute('role', 'dialog');
    Object.assign(el.style, {
      position: 'fixed',
      left: '50%',
      top: '20%',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      maxWidth: '420px',
      padding: '16px 18px',
      borderRadius: '14px',
      background: 'rgba(15, 18, 28, 0.96)',
      color: '#f5f7fb',
      boxShadow: '0 16px 48px rgba(0,0,0,.45)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      border: '1px solid rgba(255,255,255,.12)',
    } as CSSStyleDeclaration);

    el.innerHTML = `
      <div style="font-weight:700;font-size:15px;margin-bottom:8px;">打开学习画中画</div>
      <div style="font-size:13px;line-height:1.5;opacity:.85;margin-bottom:12px;">
        浏览器规定：Document PiP 必须由<strong>网页内的点击</strong>触发。
        扩展弹窗里的按钮无法直接打开（这不是版本不支持）。
        请点击下方按钮继续。
      </div>
      <button type="button" id="ueh-pip-gesture-go" style="
        width:100%;padding:10px 12px;border:0;border-radius:10px;
        background:#1f6feb;color:#fff;font-weight:600;font-size:14px;cursor:pointer;">
        点击打开画中画
      </button>
      <button type="button" id="ueh-pip-gesture-dismiss" style="
        width:100%;margin-top:8px;padding:8px;border:0;border-radius:10px;
        background:transparent;color:#9ecbff;font-size:12px;cursor:pointer;">
        取消
      </button>
    `;

    const go = el.querySelector('#ueh-pip-gesture-go') as HTMLButtonElement;
    const dismiss = el.querySelector(
      '#ueh-pip-gesture-dismiss',
    ) as HTMLButtonElement;

    // Critical: requestWindow must run in this click stack (no await before it)
    go.addEventListener('click', () => {
      void this.openWithUserGesture().then((res) => {
        if (!res.ok) {
          go.textContent = res.error.message.slice(0, 80);
        }
      });
    });
    dismiss.addEventListener('click', () => this.hideClickToOpenBanner());

    document.documentElement.appendChild(el);
    this.gestureBanner = el;
  }

  private hideClickToOpenBanner(): void {
    this.gestureBanner?.remove();
    this.gestureBanner = null;
    document.getElementById('ueh-pip-gesture-banner')?.remove();
  }

  async close(): Promise<void> {
    if (this.state === 'Idle' || this.state === 'Closed') return;
    this.state = 'Restoring';
    try {
      cancelAnimationFrame(this.raf);
    } catch {
      // ignore
    }
    try {
      this.pipWindow?.cancelAnimationFrame(this.raf);
    } catch {
      // ignore
    }
    this.raf = 0;
    this.stopAdWatch();
    this.adPhase = 'none';
    this.cueList?.destroy();
    this.cueList = null;
    this.vocabRecap?.destroy();
    this.vocabRecap = null;
    this.clipPlayer.stop();
    stopAllSpeech(this.pipWindow ?? window);
    this.ttsBusy = false;
    this.translatingBusy = false;
    this.unbindHotkeys();
    this.unbindToolbarFallback?.();
    this.unbindToolbarFallback = null;
    this.unbindVideoEvents?.();
    this.unbindVideoEvents = null;
    this.chromeResizeObserver?.disconnect();
    this.chromeResizeObserver = null;
    this.chromeClearancePx = 78;
    window.clearTimeout(this.toastHideTimer);
    this.toastHideTimer = 0;
    window.clearTimeout(this.togglePersistTimer);
    this.togglePersistTimer = 0;
    this.bridge?.close();
    this.bridge = null;
    this.teardownVideoMirror();
    this.restoreVideo();
    this.setPagePlayerDimmed(false);
    this.hideClickToOpenBanner();
    this.lastUiPushMs = 0;
    this.lastPipCueId = '';
    this.lastActiveCue = null;
    this.pipBaseOuterWidth = 0;
    this.pipPanelExtraPx = 0;
    this.syncingPipSize = false;
    window.clearTimeout(this.syncPipSidePanelTimer);
    this.syncPipSidePanelTimer = 0;
    this.lastUiKey = '';
    this.lastPrefetchCueId = '';
    this.lastPlayIconPaused = null;
    this.lastVolumeIconKey = '';
    this.lastChromeShowMs = 0;
    try {
      this.pipWindow?.close();
    } catch {
      // ignore
    }
    this.pipWindow = null;
    this.state = 'Idle';
  }

  private injectPipShell(win: Window): void {
    // Load map ASAP; re-render when it arrives so first cue is not blank of highlights
    void this.refreshHighlightMap().then(() => {
      this.injectHighlightCss();
      this.renderCue(this.currentCue);
      this.cueList?.setHighlightMap(this.highlightMap);
    });
    const doc = win.document;

    // Keep a single body (double-body caused black screen)
    const bodies = Array.from(doc.querySelectorAll('body'));
    for (let i = 1; i < bodies.length; i++) bodies[i].remove();
    const body = doc.body ?? doc.createElement('body');
    if (!doc.body) doc.documentElement.appendChild(body);
    if (!doc.head) {
      doc.documentElement.insertBefore(doc.createElement('head'), body);
    }
    doc.head.replaceChildren();
    body.replaceChildren();

    const style = doc.createElement('style');
    style.id = 'ueh-pip-base-style';
    style.textContent = this.buildPipStyleSheet();
    doc.head.appendChild(style);
    body.innerHTML = buildPipMarkup();
    this.injectHighlightCss();

    // Wire controls → original page video
    this.bindPipChrome(doc);
    this.bindPipSettingsPanel(doc);
    this.syncPipSettingsFields(doc);

    // Final body merge guard
    const allBodies = Array.from(doc.querySelectorAll('body'));
    if (allBodies.length > 1) {
      const primary = allBodies[0];
      for (let i = 1; i < allBodies.length; i++) {
        while (allBodies[i].firstChild) {
          primary.appendChild(allBodies[i].firstChild!);
        }
        allBodies[i].remove();
      }
    }
  }

  private bindPipChrome(doc: Document): void {
    const win = doc.defaultView ?? this.pipWindow ?? window;
    const root = doc.getElementById('ueh-pip-root');
    const stage = doc.getElementById('ueh-pip-stage');
    const chromeEl = doc.getElementById('ueh-chrome');
    const bar = doc.getElementById('ueh-bar');
    const progress = doc.getElementById('ueh-progress') as HTMLInputElement | null;
    const volumeSlider = doc.getElementById('ueh-volume') as HTMLInputElement | null;
    const volWrap = doc.querySelector('.ueh-vol-wrap') as HTMLElement | null;

    if (bar) {
      this.unbindToolbarFallback?.();
      this.unbindToolbarFallback = bindToolbarFocusgroupFallback(bar, win);
    }

    // Dynamically track #ueh-chrome height so wrapped toolbar rows never cover subtitles or popovers
    const updateChromeClearance = () => {
      if (!chromeEl || !stage) return;
      const h = Math.round(chromeEl.getBoundingClientRect().height || chromeEl.offsetHeight || 0);
      const nextClearance = Math.max(78, h + 10);
      if (nextClearance !== this.chromeClearancePx) {
        this.chromeClearancePx = nextClearance;
        stage.style.setProperty('--ueh-chrome-h', `${nextClearance}px`);
        const layer = doc.getElementById('ueh-sub-layer');
        const en = doc.getElementById('ueh-sub-en');
        const tr = doc.getElementById('ueh-sub-tr');
        if (layer && en && tr && this.getRenderedCue()) {
          this.applyPipSubtitleLayout(layer, en, tr);
        }
      }
    };
    this.chromeResizeObserver?.disconnect();
    const ResizeObs =
      (win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ??
      (typeof ResizeObserver !== 'undefined' ? ResizeObserver : undefined);
    if (ResizeObs && chromeEl) {
      this.chromeResizeObserver = new ResizeObs(() => updateChromeClearance());
      this.chromeResizeObserver.observe(chromeEl);
    }
    updateChromeClearance();

    // Show chrome while interacting (use PiP window timers so backgrounded opener tab never stalls it)
    let hideTimer = 0;
    let pointerInsideChrome = false;
    chromeEl?.addEventListener('pointerenter', () => {
      pointerInsideChrome = true;
      win.clearTimeout(hideTimer);
      root?.classList.add('ueh-show-chrome');
    });
    chromeEl?.addEventListener('pointerleave', () => {
      pointerInsideChrome = false;
      scheduleHideChrome();
    });

    const scheduleHideChrome = () => {
      win.clearTimeout(hideTimer);
      hideTimer = win.setTimeout(() => {
        const settingsOpen = doc
          .getElementById('ueh-pip-settings')
          ?.classList.contains('ueh-open');
        if (pointerInsideChrome || settingsOpen || this.video?.paused) return;
        root?.classList.remove('ueh-show-chrome');
      }, 2800);
    };

    const showChrome = () => {
      const now = performance.now();
      if (now - this.lastChromeShowMs >= 100) {
        this.lastChromeShowMs = now;
        root?.classList.add('ueh-show-chrome');
      }
      scheduleHideChrome();
    };
    root?.addEventListener('pointermove', showChrome, { passive: true });
    root?.addEventListener('pointerdown', showChrome, { passive: true });
    root?.addEventListener('focusin', showChrome);
    showChrome();

    // Light-dismiss settings panel when clicking outside #ueh-pip-settings and settings button
    doc.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const settingsPanel = doc.getElementById('ueh-pip-settings');
      if (
        settingsPanel?.classList.contains('ueh-open') &&
        !settingsPanel.contains(target) &&
        !target.closest('button[data-act="settings"]')
      ) {
        settingsPanel.classList.remove('ueh-open');
        this.syncPanelToggleButtons();
      }
    });

    // Click video area → play/pause (ignore chrome / panels / buttons)
    doc.getElementById('ueh-video-slot')?.addEventListener('click', (e) => {
      if (
        (e.target as HTMLElement).closest(
          'button,input,select,a,#ueh-chrome,#ueh-word-panel,#ueh-pip-settings',
        )
      ) {
        return;
      }
      this.handleCommandPlayPause();
      this.updatePlayIcon();
    });

    // Click subtitle area (outside of word chip) → play/pause
    doc.getElementById('ueh-sub-layer')?.addEventListener('click', (e) => {
      if (
        (e.target as HTMLElement).closest(
          'button,input,select,a,#ueh-chrome,#ueh-word-panel,#ueh-pip-settings,.ueh-word',
        )
      ) {
        return;
      }
      this.handleCommandPlayPause();
      this.updatePlayIcon();
    });

    doc.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showChrome();
        const act = (btn as HTMLElement).dataset.act;
        if (act === 'play') {
          this.handleCommandPlayPause();
          this.updatePlayIcon();
        } else if (act === 'mute') {
          this.toggleMute();
        } else if (act === 'rate') {
          this.cyclePlaybackRate();
        } else if (act === 'export') {
          void this.handleExportClip();
        } else if (act === 'tts') {
          void this.handleTts();
        } else if (act === 'translate') {
          void this.handleTranslateCurrent();
        } else if (act === 'prev') {
          this.seekCue(-1);
        } else if (act === 'next') {
          this.seekCue(1);
        } else if (act === 'toggle-en') {
          this.toggleSubtitleLine('en');
        } else if (act === 'toggle-tr') {
          this.toggleSubtitleLine('tr');
        } else if (act === 'settings') {
          this.togglePipSettingsPanel(doc);
        } else if (act === 'list') {
          this.toggleCueList();
        } else if (act === 'recap') {
          void this.toggleVocabRecap();
        }
      });
    });

    // Volume slider drag + wheel adjust on speaker/slider group
    const onVolumeInput = () => {
      if (!volumeSlider) return;
      const pct = Math.max(0, Math.min(100, Number(volumeSlider.value) || 0));
      const nextVol = pct / 100;
      this.applyAudioState({ volume: nextVol, muted: pct === 0 }, false);
    };
    volumeSlider?.addEventListener('input', (e) => {
      e.stopPropagation();
      onVolumeInput();
    });
    volumeSlider?.addEventListener('change', (e) => {
      e.stopPropagation();
      if (!volumeSlider) return;
      const pct = Math.max(0, Math.min(100, Number(volumeSlider.value) || 0));
      this.toast('info', pct === 0 ? '已静音' : `音量 ${pct}%`);
    });
    volumeSlider?.addEventListener('click', (e) => e.stopPropagation());

    let volWheelTimer = 0;
    volWrap?.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY < 0 ? 0.05 : -0.05;
        this.adjustVolumeBy(delta);
        volWrap.classList.add('ueh-vol-active');
        win.clearTimeout(volWheelTimer);
        volWheelTimer = win.setTimeout(() => {
          volWrap.classList.remove('ueh-vol-active');
        }, 1200);
      },
      { passive: false },
    );

    // Allow ArrowUp / ArrowDown on mute button to adjust volume cleanly for keyboard users
    doc
      .querySelector('button[data-act="mute"]')
      ?.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'ArrowUp' || ke.key === 'ArrowDown') {
          ke.preventDefault();
          ke.stopPropagation();
          this.adjustVolumeBy(ke.key === 'ArrowUp' ? 0.05 : -0.05);
        }
      });

    void this.refreshRecapBadge();

    // YouTube ad skip from PiP
    doc.getElementById('ueh-ad-skip')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleSkipAd();
    });

    // Side word panel close
    doc.getElementById('ueh-word-panel-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeWordPanel();
    });

    this.syncSubVisibilityChrome();
    this.syncVolumeChrome();
    this.syncRateChrome();
    this.syncPanelToggleButtons();
    this.syncCaptureChrome();

    // Scrub → seek original video (update time readout + paused mirror frame immediately)
    const onScrub = (commitYoutube: boolean) => {
      if (!this.video || !progress) return;
      const dur = this.video.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      const ratio = Number(progress.value) / 1000;
      const targetSec = ratio * dur;
      this.video.currentTime = targetSec;
      if (commitYoutube && isYoutubeHost()) {
        this.postYoutubePlayerCommand({ action: 'seekTo', seconds: targetSec });
      }
      const timeEl = doc.getElementById('ueh-time');
      if (timeEl) {
        timeEl.textContent = `${formatTime(targetSec)} / ${formatTime(dur)}`;
      }
      this.mirrorHandle?.requestFrame?.();
      this.syncCue(true);
    };
    progress?.addEventListener('input', () => onScrub(false));
    progress?.addEventListener('change', () => onScrub(true));
    progress?.addEventListener('click', (e) => e.stopPropagation());

    this.updatePlayIcon();
  }

  private togglePipSettingsPanel(doc: Document): void {
    const panel = doc.getElementById('ueh-pip-settings');
    if (!panel) return;
    const open = panel.classList.toggle('ueh-open');
    if (open) {
      this.closeWordPanel();
      this.syncPipSettingsFields(doc);
    }
    this.syncPanelToggleButtons();
  }

  private bindPipSettingsPanel(doc: Document): void {
    const apply = (persist: boolean) =>
      void this.applyPipSettingsFromPanel(doc, persist);
    doc
      .getElementById('ueh-pip-en')
      ?.addEventListener('change', () => apply(false));
    doc
      .getElementById('ueh-pip-auto-tr')
      ?.addEventListener('change', () => apply(false));
    doc
      .getElementById('ueh-pip-mode')
      ?.addEventListener('change', () => apply(false));
    doc
      .getElementById('ueh-pip-pos')
      ?.addEventListener('change', () => apply(false));
    doc
      .getElementById('ueh-pip-layout')
      ?.addEventListener('change', () => apply(false));
    doc
      .getElementById('ueh-pip-anchor')
      ?.addEventListener('change', () => apply(false));
    doc.getElementById('ueh-pip-offset')?.addEventListener('input', () => {
      this.updatePipScaleLabels(doc);
      apply(false);
    });
    doc.getElementById('ueh-pip-scale')?.addEventListener('input', () => {
      this.updatePipScaleLabels(doc);
      apply(false);
    });
    doc.getElementById('ueh-pip-bg')?.addEventListener('input', () => {
      this.updatePipScaleLabels(doc);
      apply(false);
    });
    doc.getElementById('ueh-pip-save')?.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.applyPipSettingsFromPanel(doc, true).then((ok) => {
        const st = doc.getElementById('ueh-pip-settings-status');
        if (st) st.textContent = ok ? '✓ 已保存到设置' : '保存失败';
      });
    });
    doc
      .getElementById('ueh-pip-settings-close')
      ?.addEventListener('click', (e) => {
        e.stopPropagation();
        doc.getElementById('ueh-pip-settings')?.classList.remove('ueh-open');
        this.syncPanelToggleButtons();
      });
  }

  private syncPipSettingsFields(doc: Document): void {
    const ps = this.pipSurface();
    const en = doc.getElementById('ueh-pip-en') as HTMLInputElement | null;
    const autoTr = doc.getElementById(
      'ueh-pip-auto-tr',
    ) as HTMLInputElement | null;
    const mode = doc.getElementById('ueh-pip-mode') as HTMLSelectElement | null;
    const layout = doc.getElementById(
      'ueh-pip-layout',
    ) as HTMLSelectElement | null;
    const pos = doc.getElementById('ueh-pip-pos') as HTMLSelectElement | null;
    const anchor = doc.getElementById(
      'ueh-pip-anchor',
    ) as HTMLSelectElement | null;
    const offset = doc.getElementById(
      'ueh-pip-offset',
    ) as HTMLInputElement | null;
    const scale = doc.getElementById(
      'ueh-pip-scale',
    ) as HTMLInputElement | null;
    const bg = doc.getElementById('ueh-pip-bg') as HTMLInputElement | null;
    if (en)
      en.checked = ps.enabled !== false && ps.style?.displayMode !== 'off';
    if (autoTr)
      autoTr.checked =
        ps.autoTranslate ?? this.config.features.autoTranslate !== false;
    if (mode) mode.value = ps.style?.displayMode ?? 'bilingual';
    if (layout) layout.value = ps.style?.layout ?? 'stacked';
    if (pos) pos.value = ps.style?.translationPosition ?? 'below';
    if (anchor) anchor.value = ps.position?.anchor ?? 'bottom';
    if (offset) offset.value = String(ps.position?.percent ?? 12);
    if (scale) scale.value = String(ps.style?.main.fontScale ?? 85);
    if (bg) bg.value = String(ps.style?.container.backgroundOpacity ?? 60);
    this.updatePipScaleLabels(doc);
  }

  private updatePipScaleLabels(doc: Document): void {
    const scale = doc.getElementById(
      'ueh-pip-scale',
    ) as HTMLInputElement | null;
    const bg = doc.getElementById('ueh-pip-bg') as HTMLInputElement | null;
    const offset = doc.getElementById(
      'ueh-pip-offset',
    ) as HTMLInputElement | null;
    const sv = doc.getElementById('ueh-pip-scale-val');
    const bv = doc.getElementById('ueh-pip-bg-val');
    const ov = doc.getElementById('ueh-pip-offset-val');
    if (scale && sv) sv.textContent = `${scale.value}%`;
    if (bg && bv) bv.textContent = `${bg.value}%`;
    if (offset && ov) ov.textContent = `${offset.value}%`;
  }

  private async applyPipSettingsFromPanel(
    doc: Document,
    persist: boolean,
  ): Promise<boolean> {
    const en = doc.getElementById('ueh-pip-en') as HTMLInputElement | null;
    const autoTr = doc.getElementById(
      'ueh-pip-auto-tr',
    ) as HTMLInputElement | null;
    const mode = doc.getElementById('ueh-pip-mode') as HTMLSelectElement | null;
    const layout = doc.getElementById(
      'ueh-pip-layout',
    ) as HTMLSelectElement | null;
    const pos = doc.getElementById('ueh-pip-pos') as HTMLSelectElement | null;
    const anchor = doc.getElementById(
      'ueh-pip-anchor',
    ) as HTMLSelectElement | null;
    const offset = doc.getElementById(
      'ueh-pip-offset',
    ) as HTMLInputElement | null;
    const scale = doc.getElementById(
      'ueh-pip-scale',
    ) as HTMLInputElement | null;
    const bg = doc.getElementById('ueh-pip-bg') as HTMLInputElement | null;
    if (!en || !autoTr || !mode || !pos || !scale || !bg) return false;

    const fontScale = Number(scale.value) || 85;
    let displayMode = mode.value as
      | 'bilingual'
      | 'originalOnly'
      | 'translationOnly'
      | 'off';
    if (!en.checked) displayMode = 'off';

    const prev = this.config.pipSubtitles;
    const nextPip = {
      ...prev,
      enabled: en.checked && displayMode !== 'off',
      autoTranslate: autoTr.checked,
      style: {
        ...prev.style,
        displayMode,
        layout: (layout?.value === 'split' ? 'split' : 'stacked') as
          | 'stacked'
          | 'split',
        translationPosition: pos.value as 'above' | 'below',
        main: { ...prev.style.main, fontScale },
        translation: {
          ...prev.style.translation,
          fontScale: Math.round(fontScale * 0.88),
        },
        container: {
          ...prev.style.container,
          backgroundOpacity: Number(bg.value) || 60,
        },
      },
      position: {
        percent: Number(offset?.value) || 12,
        anchor: (anchor?.value === 'top' ? 'top' : 'bottom') as 'top' | 'bottom',
      },
    };

    this.config = { ...this.config, pipSubtitles: nextPip };
    this.showOriginalOverride = null;
    this.showTranslationOverride = null;
    this.reapplyPipStyles();
    this.syncSubVisibilityChrome();
    this.renderCue(this.getRenderedCue());
    if (nextPip.autoTranslate) this.applyAutoTranslateNow();

    if (!persist) return true;

    const res = await sendRuntime<AppConfig>(
      'config.set',
      { pipSubtitles: nextPip },
      'content',
    );
    if (res.ok) {
      this.config = res.data;
      this.reapplyPipStyles();
      this.syncSubVisibilityChrome();
      this.renderCue(this.getRenderedCue());
      return true;
    }
    return false;
  }

  private openWordPanel(): void {
    const doc = this.pipWindow?.document;
    doc?.getElementById('ueh-pip-settings')?.classList.remove('ueh-open');
    this.syncPanelToggleButtons();
    const root = doc?.getElementById('ueh-pip-root');
    const panel = doc?.getElementById('ueh-word-panel');
    root?.classList.add('ueh-word-open');
    panel?.setAttribute('aria-hidden', 'false');
  }

  private closeWordPanel(): void {
    this.activeWordStreamSession?.abort();
    this.activeWordStreamSession = null;
    const doc = this.pipWindow?.document;
    const root = doc?.getElementById('ueh-pip-root');
    const panel = doc?.getElementById('ueh-word-panel');
    root?.classList.remove('ueh-word-open');
    panel?.setAttribute('aria-hidden', 'true');
    if (doc) this.resetWordPanelActions(doc);
  }

  /** Restore action buttons to default when the word panel closes or switches word. */
  private resetWordPanelActions(doc: Document): void {
    const addBtn = doc.querySelector(
      '#ueh-word-panel-head-actions [data-word-act="add"], #ueh-word-panel [data-word-act="add"]',
    ) as HTMLButtonElement | null;
    if (addBtn) {
      addBtn.title = '加生词本';
      addBtn.setAttribute('aria-label', '加生词本');
      addBtn.disabled = false;
      addBtn.style.opacity = '';
    }
  }

  private updatePlayIcon(): void {
    const doc = this.pipWindow?.document;
    const btn = doc?.querySelector('button[data-act="play"] svg');
    if (!doc || !this.video) return;
    const paused = this.video.paused;
    doc.getElementById('ueh-pip-root')?.classList.toggle('ueh-paused', paused);
    if (!btn || this.lastPlayIconPaused === paused) return;
    this.lastPlayIconPaused = paused;
    btn.innerHTML = paused ? ICONS.play : ICONS.pause;
  }

  private bindHotkeys(win: Window): void {
    this.unbindHotkeys();
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const doc = this.pipWindow?.document;
        const settingsEl = doc?.getElementById('ueh-pip-settings');
        const rootEl = doc?.getElementById('ueh-pip-root');
        if (settingsEl?.classList.contains('ueh-open')) {
          e.preventDefault();
          settingsEl.classList.remove('ueh-open');
          this.syncPanelToggleButtons();
          return;
        }
        if (rootEl?.classList.contains('ueh-word-open')) {
          e.preventDefault();
          this.closeWordPanel();
          return;
        }
      }
      const targetEl = e.target as HTMLElement | null;
      const tag = targetEl?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        targetEl?.isContentEditable
      ) {
        return;
      }
      // Never hijack Space when a toolbar/panel button is focused (let native button click fire)
      if (e.code === 'Space') {
        if (tag === 'BUTTON' || targetEl?.closest?.('button')) return;
        e.preventDefault();
        this.handleCommandPlayPause();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        this.toggleMute();
      } else if (e.key === '[' || e.code === 'BracketLeft') {
        e.preventDefault();
        this.seekCue(-1);
      } else if (e.key === ']' || e.code === 'BracketRight') {
        e.preventDefault();
        this.seekCue(1);
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        void this.handleExportClip();
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        void this.handlePlayLastClip();
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        void this.handleTts();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        void this.handleTranslateCurrent();
      } else if (
        (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
        !targetEl?.closest?.(
          '#ueh-word-panel,#ueh-pip-settings,#ueh-pip-cuelist-slot,#ueh-pip-recap-slot',
        )
      ) {
        e.preventDefault();
        this.adjustVolumeBy(e.key === 'ArrowUp' ? 0.05 : -0.05);
      }
    };
    win.addEventListener('keydown', this.keyHandler);
  }

  private unbindHotkeys(): void {
    if (this.keyHandler && this.pipWindow) {
      this.pipWindow.removeEventListener('keydown', this.keyHandler);
    }
    this.keyHandler = null;
  }

  private seekCue(delta: number): void {
    if (!this.video) return;
    if (!this.cues.length) {
      // Fallback when no subtitle track is available: step ±5s and retry loading captions
      const dur = Number.isFinite(this.video.duration) ? this.video.duration : Infinity;
      const nextSec = Math.max(0, Math.min(dur, this.video.currentTime + delta * 5));
      this.video.currentTime = nextSec;
      if (isYoutubeHost()) {
        this.postYoutubePlayerCommand({ action: 'seekTo', seconds: nextSec });
      }
      this.mirrorHandle?.requestFrame?.();
      this.pushPlaybackState();
      this.toast('info', delta < 0 ? '快退 5 秒（暂无字幕轨）' : '快进 5 秒（暂无字幕轨）');
      void this.reloadCuesForCurrentVideo({ retries: 1 });
      return;
    }
    const t = Math.round(this.video.currentTime * 1000);
    let idx = this.cues.findIndex(
      (c) => t >= c.startMs && t < c.endMs,
    );
    if (idx < 0) {
      const nextIdx = this.cues.findIndex((c) => c.startMs > t);
      if (nextIdx < 0) {
        idx = delta < 0 ? Math.max(0, this.cues.length - 1) : this.cues.length - 1;
      } else {
        idx = delta < 0 ? Math.max(0, nextIdx - 1) : nextIdx;
      }
    } else {
      const next = idx + delta;
      if (next < 0) {
        idx = 0;
        this.toast('info', '已是第一句');
      } else if (next >= this.cues.length) {
        idx = this.cues.length - 1;
        this.toast('info', '已是最后一句');
      } else {
        idx = next;
      }
    }
    const cue = this.cues[idx];
    const targetSec = cue.startMs / 1000 + 0.01;
    this.video.currentTime = targetSec;
    if (isYoutubeHost()) {
      this.postYoutubePlayerCommand({ action: 'seekTo', seconds: targetSec });
    }
    this.mirrorHandle?.requestFrame?.();
    this.syncCue(true);
    this.pushPlaybackState();
  }

  private moveVideoToPip(video: HTMLVideoElement, pipWindow: Window): void {
    this.originalParent = video.parentNode;
    this.placeholder = document.createComment('ueh-video-placeholder');
    this.originalParent?.insertBefore(this.placeholder, video);
    const slot = pipWindow.document.getElementById('ueh-video-slot');
    if (!slot) throw new AppError('MOVE_FAILED', 'No video slot in PiP');
    slot.innerHTML = '';
    // Preserve inline styles so restore is clean
    if (!video.dataset.uehPrevStyle) {
      video.dataset.uehPrevStyle = video.getAttribute('style') ?? '';
      video.dataset.uehPrevControls = video.controls ? '1' : '0';
    }
    slot.appendChild(video);
    video.style.cssText =
      'width:100% !important;height:100% !important;max-width:100%;max-height:100%;object-fit:contain;display:block;background:#000;';
    // Custom chrome already provides controls; native controls add hit-test cost
    video.controls = false;
    void video.play().catch(() => undefined);
  }

  private restoreVideo(): void {
    if (!this.video) {
      this.placeholder = null;
      this.originalParent = null;
      return;
    }
    const v = this.video;
    try {
      if (v.dataset.uehPrevStyle !== undefined) {
        if (v.dataset.uehPrevStyle) v.setAttribute('style', v.dataset.uehPrevStyle);
        else v.removeAttribute('style');
        v.controls = v.dataset.uehPrevControls === '1';
        delete v.dataset.uehPrevStyle;
        delete v.dataset.uehPrevControls;
      }
      if (
        this.originalParent &&
        this.originalParent.isConnected &&
        this.placeholder &&
        this.placeholder.parentNode === this.originalParent
      ) {
        this.originalParent.insertBefore(v, this.placeholder);
        this.placeholder.remove();
      } else if (this.originalParent instanceof HTMLElement && this.originalParent.isConnected) {
        this.originalParent.appendChild(v);
        this.placeholder?.remove();
      } else {
        const fallbackContainer = document.querySelector<HTMLElement>(
          '.html5-video-player, [data-video-container], main, article',
        ) ?? document.body;
        if (v.ownerDocument !== document && fallbackContainer) {
          fallbackContainer.appendChild(v);
        }
        this.placeholder?.remove();
      }
    } catch {
      // node may be gone
    }
    this.placeholder = null;
    this.originalParent = null;
  }

  private startTicker(): void {
    // Drive ticker from PiP window when possible so cue sync stays timely
    // while the opener tab is backgrounded (page rAF is heavily throttled).
    const animWin = this.pipWindow ?? window;
    const schedule = (cb: FrameRequestCallback) => {
      try {
        return animWin.requestAnimationFrame(cb);
      } catch {
        return requestAnimationFrame(cb);
      }
    };
    const loop = (now: number) => {
      this.syncCue(false);
      // UI + bridge at ~8 Hz — full 60 Hz DOM/MessagePort spam is a major lag source
      if (now - this.lastUiPushMs >= 125) {
        this.lastUiPushMs = now;
        this.pushPlaybackState();
      }
      this.raf = schedule(loop);
    };
    this.raf = schedule(loop);
    this.startAdWatch();
  }

  private startAdWatch(): void {
    this.stopAdWatch();
    // Poll host page for YouTube ad chrome (PiP has no ad UI of its own)
    this.adPollTimer = window.setInterval(() => {
      this.syncYoutubeAdUi();
    }, 400);
    this.syncYoutubeAdUi();
  }

  private stopAdWatch(): void {
    if (this.adPollTimer) {
      clearInterval(this.adPollTimer);
      this.adPollTimer = 0;
    }
  }

  private syncYoutubeAdUi(): void {
    const doc = this.pipWindow?.document;
    if (!doc) return;
    const status = detectYoutubeAdStatus();
    const prev = this.adPhase;
    this.adPhase = status.phase;

    const root = doc.getElementById('ueh-pip-root');
    const banner = doc.getElementById('ueh-ad-banner');
    const label = doc.getElementById('ueh-ad-label');
    const hint = doc.getElementById('ueh-ad-hint');
    const skipBtn = doc.getElementById('ueh-ad-skip') as HTMLButtonElement | null;
    const hostSkipBtn = document.getElementById('ueh-standby-skip-ad') as HTMLButtonElement | null;

    if (status.phase === 'none') {
      root?.classList.remove('ueh-ad-active');
      banner?.classList.remove('ueh-ad-visible', 'ueh-ad-skippable');
      if (skipBtn) skipBtn.disabled = true;
      if (hostSkipBtn) hostSkipBtn.style.display = 'none';
      if (prev !== 'none') {
        // Ad ended — swap to main-video captions (not just re-sync old ad cues)
        void this.reloadCuesAfterAd();
      }
      return;
    }

    root?.classList.add('ueh-ad-active');
    banner?.classList.add('ueh-ad-visible');
    if (hostSkipBtn) hostSkipBtn.style.display = 'inline-block';

    if (status.phase === 'ad_skippable') {
      banner?.classList.add('ueh-ad-skippable');
      if (label) label.textContent = '广告可跳过';
      if (hint) hint.textContent = '点击「跳过广告」或快进';
      if (skipBtn) {
        skipBtn.disabled = false;
        skipBtn.textContent = '跳过广告';
      }
      if (prev !== 'ad_skippable') {
        this.toast('info', '广告可跳过 — 点击「跳过广告」');
      }
    } else {
      banner?.classList.add('ueh-ad-skippable');
      if (label) label.textContent = '广告播放中';
      if (hint) hint.textContent = '点击「跳过广告」可直接跳过';
      if (skipBtn) {
        skipBtn.disabled = false;
        skipBtn.textContent = '跳过广告';
      }
      if (prev === 'none') {
        this.toast('warn', 'YouTube 广告播放中，可点击跳过');
      }
    }
  }

  private handleSkipAd(): void {
    const ok = trySkipYoutubeAd();
    if (ok) {
      this.toast('info', '已执行跳过广告');
    } else {
      this.toast('info', '正在跳过广告…');
    }
    // Re-check shortly after click
    window.setTimeout(() => this.syncYoutubeAdUi(), 200);
    window.setTimeout(() => this.syncYoutubeAdUi(), 600);
    window.setTimeout(() => this.syncYoutubeAdUi(), 1200);
    // Also schedule a caption reload in case phase detection is delayed
    window.setTimeout(() => {
      if (detectYoutubeAdStatus().phase === 'none') {
        void this.reloadCuesAfterAd();
      }
    }, 1500);
  }

  private isPipActive(): boolean {
    return (
      this.state !== 'Idle' &&
      this.state !== 'Closed' &&
      this.state !== 'Restoring' &&
      !!this.pipWindow
    );
  }

  /**
   * Host page switched video (autoplay next / playlist) while PiP is open.
   * Clears stale captions immediately; follow with {@link onMainCuesReloaded}
   * or {@link reloadCuesForCurrentVideo} once timedtext is available.
   */
  onMainVideoSwitching(): void {
    if (!this.isPipActive()) return;
    this.translateScheduler.reset();
    this.adapter.clearCache?.();
    const prevVideo = this.video;
    // YouTube usually reuses the same <video>; if SPA swapped the element, rebind mirror too
    const next = this.adapter.findVideo();
    if (next) {
      this.video = next;
      this.sampler.attach(next);
      this.bindVideoMediaListeners(next);
      if (next !== prevVideo && this.pipWindow) {
        this.mode = this.setupVideoInPip(this.pipWindow, next);
        this.syncVolumeChrome();
        this.syncRateChrome();
      }
    }
    this.cues = [];
    this.currentCue = null;
    this.lastActiveCue = null;
    this.lastPrefetchCueId = '';
    this.cueList?.setCues([]);
    this.vocabRecap?.setCues([]);
    this.renderCue(null);
    this.toast('info', '正在加载下一集字幕…');
  }

  /**
   * Apply cues from the content script (after ad end, autoplay next, or SPA nav).
   * Empty array clears the previous video's lines so they never stick.
   */
  onMainCuesReloaded(cues: SubtitleCue[]): void {
    if (!this.isPipActive() && this.state !== 'Opening') {
      // Still accept while opening so host-page load can race in
      if (this.state === 'Idle' || this.state === 'Closed') return;
    }
    this.translateScheduler.reset();
    this.cues = cues;
    this.currentCue = null;
    this.lastActiveCue = null;
    this.lastPrefetchCueId = '';
    this.cueList?.setCues(cues);
    this.vocabRecap?.setCues(cues);
    void this.refreshRecapBadge();
    this.syncCue(true);
    if (cues.length && (this.wantsAutoTranslate() || this.resolveShowTranslation())) {
      this.startBackgroundTranslate();
    }
  }

  /**
   * Self-fetch captions when host page could not supply them yet
   * (autoplay next, ad end). Prefers shared page cues, then adapter.
   */
  async reloadCuesForCurrentVideo(opts?: {
    toastOnSuccess?: string;
    retries?: number;
  }): Promise<void> {
    if (!this.isPipActive()) return;
    const retries = opts?.retries ?? 6;
    try {
      const next = this.adapter.findVideo();
      if (next) {
        this.video = next;
        this.sampler.attach(next);
      }

      // Prefer host-page cues / ad-time preload before network
      let cues = getPageCues();
      if (!cues.length) {
        cues = await this.adapter.getCues({ purpose: 'display' });
      }
      if (!cues.length) {
        for (let i = 0; i < retries; i++) {
          if (!this.isPipActive()) return;
          await new Promise((r) => setTimeout(r, 900));
          cues = getPageCues();
          if (!cues.length) {
            // Soft retry — getCues still hits shared preload if warmed during ad
            cues = await this.adapter.getCues({ purpose: 'display' });
          }
          if (cues.length) break;
        }
      }
      if (cues.length) {
        this.onMainCuesReloaded(cues);
        if (opts?.toastOnSuccess) this.toast('info', opts.toastOnSuccess);
      } else {
        this.onMainCuesReloaded([]);
        this.syncCue(true);
      }
    } catch (e) {
      console.warn('[UEH] PiP reload cues failed', e);
      this.syncCue(true);
    }
  }

  private async reloadCuesAfterAd(): Promise<void> {
    await this.reloadCuesForCurrentVideo({
      toastOnSuccess: '已切换到正片字幕',
      retries: 4,
    });
  }

  /**
   *Cue currently displayed on screen: active cue during playback, or last active
   * cue when paused in a short inter-sentence gap so toggling 原文/译文 or clicking
   * words/actions right after pausing works naturally.
   */
  private getRenderedCue(): SubtitleCue | null {
    if (this.currentCue) return this.currentCue;
    if (this.video?.paused && this.lastActiveCue) {
      const nowMs = Math.round(this.video.currentTime * 1000);
      if (
        nowMs >= this.lastActiveCue.startMs - 500 &&
        nowMs <= this.lastActiveCue.endMs + 8000
      ) {
        return this.lastActiveCue;
      }
    }
    return null;
  }

  /**
   * Target cue for toolbar actions (翻译当前句 / 朗读 / 保存原声).
   * Falls back to lastActiveCue or nearest cue when between subtitle lines.
   */
  private getActionCue(): SubtitleCue | null {
    if (this.currentCue) return this.currentCue;
    if (!this.cues.length) return null;
    const nowMs = Math.round((this.video?.currentTime ?? 0) * 1000);
    const active = findActiveCue(this.cues, nowMs);
    if (active) return active;
    if (
      this.lastActiveCue &&
      nowMs >= this.lastActiveCue.startMs - 1000 &&
      nowMs <= this.lastActiveCue.endMs + 10_000
    ) {
      return this.lastActiveCue;
    }
    // Find latest cue that started before nowMs, else the first upcoming cue
    for (let i = this.cues.length - 1; i >= 0; i--) {
      if (this.cues[i]!.startMs <= nowMs) return this.cues[i]!;
    }
    return this.cues[0] ?? null;
  }

  private syncCue(force: boolean): void {
    if (!this.video) return;
    // Prefer continuous media time (ms) for tight A/V sync
    const t = Math.round(this.video.currentTime * 1000);
    const cue = findActiveCue(this.cues, t);
    if (cue) {
      this.lastActiveCue = cue;
    }
    const shouldAutoTranslate =
      this.wantsAutoTranslate() || this.showTranslationOverride === true;
    // Only re-render when the *active* cue identity changes
    if (!force && cue?.id === this.currentCue?.id) {
      // Prefetch only once per cue id (was every rAF → wasted work)
      if (
        cue &&
        shouldAutoTranslate &&
        cue.id !== this.lastPrefetchCueId
      ) {
        this.lastPrefetchCueId = cue.id;
        const ahead = Math.max(5, this.config.features.prefetchCues ?? 3);
        this.translateScheduler.prefetchAround(cue, ahead);
        if (!cue.translation) void this.translateScheduler.translateMany([cue]);
      }
      return;
    }
    this.currentCue = cue;
    this.cueList?.setActiveCueId(cue?.id ?? null);
    const displayed = this.getRenderedCue();
    this.renderCue(displayed);
    this.bridge?.send({
      type: 'pip.subtitleCue',
      payload: { cue: displayed, translation: displayed?.translation },
    });

    if (cue && shouldAutoTranslate) {
      this.lastPrefetchCueId = cue.id;
      if (!cue.translation) void this.translateScheduler.translateMany([cue]);
      const ahead = Math.max(5, this.config.features.prefetchCues ?? 3);
      this.translateScheduler.prefetchAround(cue, ahead);
    }
  }

  private resolveShowOriginal(): boolean {
    if (this.showOriginalOverride != null) return this.showOriginalOverride;
    const ps = this.pipSurface();
    if (ps.enabled === false) return false;
    const mode = ps.style?.displayMode ?? 'bilingual';
    return mode !== 'off' && mode !== 'translationOnly';
  }

  private resolveShowTranslation(): boolean {
    if (this.showTranslationOverride != null)
      return this.showTranslationOverride;
    const ps = this.pipSurface();
    if (ps.enabled === false) return false;
    const mode = ps.style?.displayMode ?? 'bilingual';
    return mode !== 'off' && mode !== 'originalOnly';
  }

  private syncSubVisibilityChrome(): void {
    const doc = this.pipWindow?.document;
    if (!doc) return;
    const root = doc.getElementById('ueh-pip-root');
    const showEn = this.resolveShowOriginal();
    const showTr = this.resolveShowTranslation();
    if (!showEn && !showTr) root?.classList.add('ueh-subs-off');
    else root?.classList.remove('ueh-subs-off');

    const enChip = doc.querySelector(
      'button[data-act="toggle-en"]',
    ) as HTMLElement | null;
    const trChip = doc.querySelector(
      'button[data-act="toggle-tr"]',
    ) as HTMLElement | null;
    enChip?.setAttribute('aria-pressed', showEn ? 'true' : 'false');
    trChip?.setAttribute('aria-pressed', showTr ? 'true' : 'false');
  }

  private toggleSubtitleLine(which: 'en' | 'tr'): void {
    const curEn = this.resolveShowOriginal();
    const curTr = this.resolveShowTranslation();
    const nextEn = which === 'en' ? !curEn : curEn;
    const nextTr = which === 'tr' ? !curTr : curTr;

    const nextMode: SubtitlesDisplayMode =
      nextEn && nextTr
        ? 'bilingual'
        : nextEn
          ? 'originalOnly'
          : nextTr
            ? 'translationOnly'
            : 'off';

    this.showOriginalOverride = nextEn;
    this.showTranslationOverride = nextTr;

    // Sync config.pipSubtitles + settings popover so UI surfaces never diverge or reset
    const prev = this.config.pipSubtitles;
    const nextPip = {
      ...prev,
      enabled: nextMode !== 'off',
      autoTranslate:
        which === 'tr' && nextTr ? true : (prev?.autoTranslate ?? true),
      style: {
        ...prev.style,
        displayMode: nextMode,
      },
    };
    this.config = { ...this.config, pipSubtitles: nextPip };

    const doc = this.pipWindow?.document;
    if (doc) this.syncPipSettingsFields(doc);
    this.syncSubVisibilityChrome();
    this.renderCue(this.getRenderedCue());

    // Debounce persisting pipSubtitles so page storage echo won't thrash rapid clicks
    window.clearTimeout(this.togglePersistTimer);
    this.togglePersistTimer = window.setTimeout(() => {
      void sendRuntime('config.set', { pipSubtitles: nextPip }, 'content');
    }, 250);

    // When user turns 译文 ON, immediately translate current/nearby cues if missing!
    if (nextTr) {
      const target = this.getActionCue();
      if (target && !target.translation?.trim()) {
        void this.translateScheduler.translateForce([target]).then((res) => {
          if (!res.ok && res.error) {
            this.toast('warn', `译文获取失败：${res.error}`);
          }
        });
      }
      if (target) this.translateScheduler.prefetchAround(target, 8);
      if (this.cues.length) void this.translateScheduler.drainAll();
    }

    if (!this.cues.length) {
      const modeLabel =
        nextMode === 'bilingual'
          ? '双语'
          : nextMode === 'originalOnly'
            ? '仅原文'
            : nextMode === 'translationOnly'
              ? '仅译文'
              : '隐藏字幕';
      this.toast('warn', `已切换为「${modeLabel}」（暂无字幕轨，正在重试加载…）`);
      void this.reloadCuesForCurrentVideo({ retries: 2 });
      return;
    }

    const modeMsg =
      nextMode === 'bilingual'
        ? '字幕显示：双语'
        : nextMode === 'originalOnly'
          ? '字幕显示：仅原文'
          : nextMode === 'translationOnly'
            ? '字幕显示：仅译文'
            : '字幕已隐藏';
    this.toast('info', modeMsg);
  }

  private applyPipSubtitleLayout(
    layer: HTMLElement,
    en: HTMLElement,
    tr: HTMLElement,
  ): void {
    const surface = this.pipSurface();
    const placement = resolveSubtitlePlacement({
      layout: surface.style?.layout,
      translationPosition: surface.style?.translationPosition,
      position: surface.position,
    });
    const baseBottomPx = Math.max(78, this.chromeClearancePx);
    const stackedBottomPx =
      placement.layout === 'stacked' && placement.stackAnchor === 'bottom'
        ? Math.max(baseBottomPx, baseBottomPx + placement.percent * 1.2)
        : null;
    applySubtitleLayerLayout(layer, en, tr, {
      placement,
      bottomExtraPx: baseBottomPx,
      stackedBottomPx,
    });
  }

  private renderCue(cue: SubtitleCue | null): void {
    const doc = this.pipWindow?.document;
    if (!doc) return;
    const en = doc.getElementById('ueh-sub-en');
    const tr = doc.getElementById('ueh-sub-tr');
    if (!en || !tr) return;

    this.syncSubVisibilityChrome();

    if (!cue || this.adPhase !== 'none') {
      en.textContent = '';
      tr.textContent = '';
      syncEnGlossClass(en);
      this.lastPipCueId = '';
      return;
    }

    const layer = doc.getElementById('ueh-sub-layer');
    if (layer) {
      this.applyPipSubtitleLayout(layer, en, tr);
    }

    const card = doc.getElementById('ueh-sub-card');
    if (card && cue.id !== this.lastPipCueId) {
      this.lastPipCueId = cue.id;
      card.classList.remove('ueh-cue-in');
      requestAnimationFrame(() => {
        card.classList.add('ueh-cue-in');
      });
    }

    const showOriginal = this.resolveShowOriginal();
    const showTranslation = this.resolveShowTranslation();

    en.innerHTML = '';
    const hlCfg = this.config.vocabHighlight;
    if (showOriginal) {
      for (const seg of segmentWords(cue.text)) {
        if (isClickableWord(seg)) {
          const span = doc.createElement('span');
          span.className = 'ueh-word';
          decorateWordSpan(span, seg.text, this.highlightMap, hlCfg);
          span.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (this.config.wordShow?.pauseOnOpen !== false) {
              this.pausePlayback();
            }
            void this.handleWordClick(seg.text, cue.text);
          });
          // Avoid player focus/pause side-effects when interacting with words
          span.addEventListener('mousedown', (e) => e.stopPropagation());
          en.appendChild(span);
        } else {
          en.appendChild(doc.createTextNode(seg.text));
        }
      }
    }
    syncEnGlossClass(en);
    tr.textContent =
      showTranslation && cue.translation?.trim() ? cue.translation : '';
  }

  private pushPlaybackState(): void {
    if (!this.video) return;
    const mediaTimeMs = Math.round(this.video.currentTime * 1000);
    const paused = this.video.paused;
    const rate = this.video.playbackRate;
    const epoch = this.sampler.getEpoch();
    // Skip identical bridge payloads (MessagePort traffic during drag/resize hurts)
    const key = `${mediaTimeMs}|${paused ? 1 : 0}|${rate}|${this.captureState}|${epoch}`;
    if (key !== this.lastUiKey) {
      this.lastUiKey = key;
      this.bridge?.send({
        type: 'pip.playbackState',
        payload: {
          mediaTimeMs,
          paused,
          rate,
          captureState: this.captureState,
          sessionId: this.captureSessionId ?? undefined,
          epoch,
        },
      });
    }

    const doc = this.pipWindow?.document;
    if (!doc) return;

    // Progress + time (drive UI from original / moved video)
    const progress = doc.getElementById('ueh-progress') as HTMLInputElement | null;
    const timeEl = doc.getElementById('ueh-time');
    const dur = this.video.duration;
    const cur = this.video.currentTime;
    if (progress && Number.isFinite(dur) && dur > 0) {
      // Avoid fighting user scrub if focused
      if (doc.activeElement !== progress) {
        const next = String(Math.round((cur / dur) * 1000));
        if (progress.value !== next) progress.value = next;
      }
    }
    if (timeEl) {
      const text = `${formatTime(cur)} / ${formatTime(
        Number.isFinite(dur) ? dur : 0,
      )}`;
      if (timeEl.textContent !== text) timeEl.textContent = text;
    }
    this.updatePlayIcon();
    this.syncVolumeChrome();
    this.syncRateChrome();
    this.syncCaptureChrome();
  }

  private async onBridgeMessage(msg: BridgeMessage): Promise<void> {
    switch (msg.type) {
      case 'pip.command.playPause':
        this.handleCommandPlayPause();
        break;
      case 'pip.command.seek':
        if (this.video) {
          this.video.currentTime = msg.payload.mediaTimeMs / 1000;
          this.mirrorHandle?.requestFrame?.();
        }
        break;
      case 'pip.command.setRate':
        if (this.video) {
          this.video.playbackRate = msg.payload.rate;
          if (isYoutubeHost()) {
            this.postYoutubePlayerCommand({
              action: 'setPlaybackRate',
              rate: msg.payload.rate,
            });
          }
          this.syncRateChrome();
        }
        break;
      case 'pip.ui.exportClip':
        await this.handleExportClip();
        break;
      case 'pip.ui.playClip':
        await this.playClipId(msg.payload.clipId);
        break;
      case 'pip.ui.stopClip':
        this.clipPlayer.stop();
        break;
      case 'pip.ui.tts':
        await this.handleTts(msg.payload.text);
        break;
      case 'pip.ui.explainWord':
        await this.handleWordClick(msg.payload.surface, msg.payload.context);
        break;
      case 'pip.ui.addWord':
        await sendRuntime(
          'word.add',
          {
            ...msg.payload,
            audioClipId: this.lastClipId ?? undefined,
            sourceUrl: location.href,
            sourceTitle: document.title,
          },
          'content',
        );
        this.toast('info', `Added: ${msg.payload.surface}`);
        void this.refreshWordHighlights();
        break;
      case 'pip.ui.translateRequest':
        if (this.currentCue) await this.translateCue(this.currentCue);
        break;
      default:
        break;
    }
  }

  private pausePlayback(): void {
    const video = (this.video && (this.mode === 'move' || document.contains(this.video)))
      ? this.video
      : (this.adapter.findVideo() ?? this.video);
    if (video) this.video = video;

    if (this.video) {
      try {
        this.video.pause();
      } catch {
        // ignore
      }
    }

    try {
      document.querySelectorAll('video').forEach((v) => {
        if (!v.paused) {
          try { v.pause(); } catch {}
        }
      });
    } catch {}

    // Only pause PiP <video> directly in 'move' mode (in av-mirror mode, pipVideo plays live MediaStream)
    if (this.pipWindow && this.mode === 'move') {
      try {
        this.pipWindow.document.querySelectorAll('video').forEach((v) => {
          if (!v.paused) {
            try { v.pause(); } catch {}
          }
        });
      } catch {}
    }

    if (isYoutubeHost()) {
      this.postYoutubePlayerCommand({ action: 'pause' });
    }

    this.updatePlayIcon();
    this.renderCue(this.getRenderedCue());
    this.pushPlaybackState();
  }

  private resumePlayback(): void {
    const video = (this.video && (this.mode === 'move' || document.contains(this.video)))
      ? this.video
      : (this.adapter.findVideo() ?? this.video);
    if (video) this.video = video;

    if (isYoutubeHost()) {
      this.postYoutubePlayerCommand({ action: 'play' });
    }
    if (this.video) {
      void this.video.play().catch(() => undefined);
    }
    this.mirrorHandle?.resumePlayback?.();

    this.updatePlayIcon();
    this.pushPlaybackState();
  }

  private isPlaybackPaused(): boolean {
    if (this.video) return this.video.paused;
    const playing = Array.from(document.querySelectorAll('video')).some((v) => !v.paused);
    return !playing;
  }

  private handleCommandPlayPause(): void {
    if (this.isPlaybackPaused()) {
      this.resumePlayback();
    } else {
      this.pausePlayback();
    }
  }

  private async translateCue(cue: SubtitleCue): Promise<void> {
    await this.translateScheduler.translateForce([cue]);
  }

  private async handleTranslateCurrent(): Promise<void> {
    if (this.translatingBusy) return;
    if (!this.cues.length) {
      this.toast('warn', '当前暂无字幕轨，正在尝试加载…');
      await this.reloadCuesForCurrentVideo({
        toastOnSuccess: '字幕已加载',
        retries: 2,
      });
    }
    const cue = this.getActionCue();
    if (!cue) {
      this.toast('warn', '当前位置暂无可翻译的字幕句');
      return;
    }

    // Ensure translation line is visible so user sees the result immediately
    if (!this.resolveShowTranslation()) {
      this.toggleSubtitleLine('tr');
    }

    const doc = this.pipWindow?.document;
    const trBtn = doc?.querySelector('button[data-act="translate"]');
    this.translatingBusy = true;
    trBtn?.classList.add('is-busy');
    this.toast('info', '正在翻译当前句…');
    try {
      const res = await this.translateScheduler.translateForce([cue]);
      if (res.ok) {
        this.renderCue(this.getRenderedCue() ?? cue);
        this.toast('info', '已更新当前句译文');
      } else {
        this.toast('error', `翻译失败：${res.error || '请检查翻译设置或网络'}`);
      }
    } finally {
      this.translatingBusy = false;
      trBtn?.classList.remove('is-busy');
    }
  }

  private async handleExportClip(): Promise<void> {
    const cue = this.getActionCue();
    if (!cue) {
      this.toast('warn', '当前暂无可保存原声的字幕句');
      return;
    }
    if (!this.captureSessionId || this.captureState !== 'CaptureLive') {
      const synced = await this.syncCaptureStatusFromBackground();
      if (!synced || !this.captureSessionId) {
        this.toast(
          'warn',
          '请先点击浏览器右上角扩展图标 → 开启「音频采集」后再保存原声',
        );
        return;
      }
    }
    const doc = this.pipWindow?.document;
    const expBtn = doc?.querySelector('button[data-act="export"]');
    expBtn?.classList.add('is-busy');
    try {
      const res = await sendRuntime<{
        clipId: number;
        durationMs: number;
        mimeType: string;
      }>(
        'clips.export',
        {
          sessionId: this.captureSessionId,
          startMs: cue.startMs,
          endMs: cue.endMs,
          epoch: this.sampler.getEpoch(),
        },
        'content',
      );
      if (!res.ok) {
        this.toast('error', `保存原声失败：${res.error.message}`);
        return;
      }
      this.lastClipId = res.data.clipId;
      this.toast(
        'info',
        `已保存原声片段 #${res.data.clipId}（${(res.data.durationMs / 1000).toFixed(1)}s）`,
      );
      this.bridge?.send({
        type: 'pip.exportResult',
        payload: { clipId: res.data.clipId, durationMs: res.data.durationMs },
      });
      await this.playClipId(res.data.clipId);
    } finally {
      expBtn?.classList.remove('is-busy');
    }
  }

  private async handlePlayLastClip(): Promise<void> {
    if (this.lastClipId == null) {
      this.toast('warn', '尚未保存任何原声片段');
      return;
    }
    await this.playClipId(this.lastClipId);
  }

  private async playClipId(clipId: number): Promise<void> {
    if (this.video && !this.video.paused) this.pausePlayback();
    await this.clipPlayer.play(clipId, (state, message) => {
      this.bridge?.send({
        type: 'pip.clipPlayState',
        payload: { clipId, state, message },
      });
      if (state === 'error') this.toast('error', message ?? '原声回放失败');
    });
  }

  private async handleTts(text?: string): Promise<void> {
    const hostWin = this.pipWindow && !this.pipWindow.closed ? this.pipWindow : window;
    // Clicking 朗读 while already speaking stops TTS cleanly
    if (!text && (this.ttsBusy || isTtsPlaying())) {
      stopAllSpeech(hostWin);
      this.clipPlayer.stop();
      this.ttsBusy = false;
      this.pipWindow?.document
        .querySelector('button[data-act="tts"]')
        ?.classList.remove('is-busy');
      this.toast('info', '已停止朗读');
      return;
    }

    const t = (text ?? this.getActionCue()?.text)?.trim();
    if (!t) {
      this.toast('warn', '当前暂无可朗读的字幕句');
      return;
    }

    if (this.video && !this.video.paused) {
      this.pausePlayback();
    }

    const ttsBtn = this.pipWindow?.document.querySelector(
      'button[data-act="tts"]',
    );
    this.ttsBusy = true;
    ttsBtn?.classList.add('is-busy');
    this.toast('info', '正在朗读…');

    try {
      const ok = await speakTextSmart(t, 'content', hostWin);
      if (!ok && this.ttsBusy) {
        this.toast('error', '朗读失败，请检查语音合成设置或网络连接');
      }
    } catch (err) {
      this.toast(
        'error',
        `朗读异常：${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.ttsBusy = false;
      ttsBtn?.classList.remove('is-busy');
    }
  }

  private toggleCueList(): void {
    const doc = this.pipWindow?.document;
    if (!doc) return;
    if (!this.cueList) {
      this.cueList = new CueListSidebar(
        'pip',
        (cue) => {
          if (this.video) {
            const targetSec = cue.startMs / 1000 + 0.01;
            this.video.currentTime = targetSec;
            if (isYoutubeHost()) {
              this.postYoutubePlayerCommand({ action: 'seekTo', seconds: targetSec });
            }
            this.mirrorHandle?.requestFrame?.();
            this.resumePlayback();
          }
        },
        doc,
        (word, context) => {
          void this.handleWordClick(word, context);
        },
        () => {
          this.syncPipSidePanelWindow();
          this.syncPanelToggleButtons();
        },
      );
      this.cueList.setCues(this.cues);
      this.cueList.setVocabHighlight(
        this.config.vocabHighlight ?? {
          enabled: true,
          newColor: '#F5C542',
          learningColor: '#5B9FFF',
          learnedColor: '#3DDC97',
        },
      );
      this.cueList.setHighlightMap(this.highlightMap);
    } else {
      this.cueList.setCues(this.cues);
    }
    this.cueList.toggle();
    this.syncPipSidePanelWindow();
    this.syncPanelToggleButtons();
    if (this.cueList.isOpen()) {
      this.cueList.setActiveCueId(this.currentCue?.id ?? null);
      if (this.wantsAutoTranslate() || this.resolveShowTranslation()) {
        void this.translateScheduler.drainAll();
      }
      if (!this.cues.length) {
        void this.reloadCuesForCurrentVideo({ retries: 2 });
      }
    }
  }

  private async handleWordClick(surface: string, context: string): Promise<void> {
    const doc = this.pipWindow?.document;
    if (!doc) return;

    const wordShow = this.config.wordShow;
    if (wordShow?.pauseOnOpen !== false) {
      this.pausePlayback();
    }

    const title = doc.getElementById('ueh-word-panel-title');
    const ctxEl = doc.getElementById('ueh-word-panel-ctx');
    const body = doc.getElementById('ueh-word-panel-body');
    const headActions =
      doc.getElementById('ueh-word-panel-head-actions') ||
      doc.getElementById('ueh-word-panel');

    this.resetWordPanelActions(doc);

    if (title) title.textContent = surface;
    const cueTranslation = this.currentCue?.translation?.trim();

    const renderCtx = (tr?: string) => {
      if (!ctxEl) return;
      if (!context) {
        ctxEl.replaceChildren();
        ctxEl.style.display = 'none';
        return;
      }
      ctxEl.style.display = '';
      ctxEl.replaceChildren();
      const orig = doc.createElement('div');
      orig.textContent = `原文：${context}`;
      ctxEl.appendChild(orig);
      const line = (tr ?? cueTranslation)?.trim();
      if (line) {
        const trEl = doc.createElement('div');
        trEl.className = 'tr-line';
        trEl.textContent = `译文：${line}`;
        ctxEl.appendChild(trEl);
      }
    };
    renderCtx();

    this.openWordPanel();

    let explain: WordExplainResult | null = null;

    const fetchExplain = async (forceLlm = false) => {
      this.activeWordStreamSession?.abort();

      if (!body) return;
      body.innerHTML = '';

      if (title) {
        title.dataset.engine = '';
      }

      const badge = doc.createElement('div');
      badge.style.cssText =
        'display:inline-block;font-size:9px;font-weight:700;padding:1px 6px;border-radius:999px;margin-bottom:6px;';
      badge.textContent = forceLlm ? 'AI 重新翻译中…' : 'AI 正在分析…';
      badge.style.background = 'color-mix(in srgb, oklch(76% 0.12 82) 25%, transparent)';
      badge.style.color = 'oklch(92% 0.06 82)';
      body.appendChild(badge);

      const contentWrap = doc.createElement('div');
      contentWrap.className = 'md-body';
      contentWrap.innerHTML = `
        <div class="loading-hint">
          <span>⏳</span> ${forceLlm ? '正在调用 AI 重新翻译…' : '正在连接 AI 生成释义…'}
        </div>
      `;
      body.appendChild(contentWrap);

      const session = streamWordExplain(
        {
          word: surface,
          surface,
          context,
          forceLlm,
        },
        (_chunk, accumulated) => {
          if (!doc.contains(body)) return;
          const clean = accumulated.trim();
          if (!clean) {
            contentWrap.innerHTML = '<div class="loading-hint"><span>🧠</span> AI 正在思考中…</div>';
            return;
          }
          badge.textContent = 'AI 实时输出中…';
          badge.style.background = 'color-mix(in srgb, oklch(76% 0.12 82) 35%, transparent)';
          badge.style.color = 'oklch(92% 0.06 82)';
          renderSafeMarkdownToElement(contentWrap, accumulated);
        },
      );
      this.activeWordStreamSession = session;

      try {
        const res = await session.promise;
        explain = res;
        if (!doc.contains(body)) return;

        body.innerHTML = '';

        // Badge for LLM vs free MT fallback
        if (res.engine === 'llm') {
          badge.textContent = 'AI 释义';
          badge.style.background = 'color-mix(in srgb, oklch(76% 0.12 82) 35%, transparent)';
          badge.style.color = 'oklch(92% 0.06 82)';
        } else if (res.engine === 'free_mt') {
          badge.textContent = '免费翻译';
          badge.style.background = 'color-mix(in srgb, oklch(72% 0.14 145) 28%, transparent)';
          badge.style.color = 'oklch(88% 0.08 145)';
        } else {
          badge.textContent = '不可用';
          badge.style.background = 'rgba(255,80,80,.18)';
          badge.style.color = '#ffb4a9';
        }
        body.appendChild(badge);

        const rawMarkdown = res.explanation || (!res.definition ? res.text : '');
        if (res.definition && (!rawMarkdown || res.engine !== 'llm')) {
          const def = doc.createElement('div');
          def.className = 'def';
          def.textContent = res.definition;
          body.appendChild(def);
        }

        const sentenceTr = res.contextTranslation?.trim() || cueTranslation;
        renderCtx(sentenceTr);

        if (rawMarkdown) {
          const full = doc.createElement('div');
          full.className = 'md-body';
          renderSafeMarkdownToElement(full, rawMarkdown);
          body.appendChild(full);
        }

        if (res.note) {
          const note = doc.createElement('div');
          note.style.cssText =
            'margin-top:8px;font-size:11px;line-height:1.35;padding:5px 7px;border-radius:6px;background:rgba(255,255,255,.06);color:oklch(88% 0.08 82)';
          note.textContent = res.note;
          body.appendChild(note);
        }

        if (!body.textContent?.trim()) {
          body.textContent = res.text || surface;
        }

        if (forceLlm) {
          const key = surface.trim().toLowerCase();
          if (this.highlightMap[key]) {
            await sendRuntime(
              'word.add',
              {
                surface,
                context,
                translation: res.definition || undefined,
                contextTranslation:
                  res.contextTranslation || this.currentCue?.translation,
                explanation: res.explanation,
                explainEngine: res.engine ?? 'none',
                explainProvider: res.provider,
                kind: 'word',
                cueStartMs: this.currentCue?.startMs,
                cueEndMs: this.currentCue?.endMs,
                audioClipId: this.lastClipId ?? undefined,
                sourceUrl: location.href,
                sourceTitle: document.title,
              },
              'content',
            );
          }
          void this.refreshWordHighlights();
        }
      } catch (err: any) {
        if (!doc.contains(body)) return;
        body.innerHTML = '';
        badge.textContent = '查询失败';
        badge.style.background = 'rgba(255,80,80,.18)';
        badge.style.color = '#ffb4a9';
        body.appendChild(badge);
        const errEl = doc.createElement('div');
        errEl.style.color = '#ffb4a9';
        errEl.style.fontSize = '12px';
        errEl.textContent = `查询异常: ${err?.message || String(err)}`;
        body.appendChild(errEl);
      }
    };

    if (wordShow?.autoExplain !== false) {
      void fetchExplain(false);
    } else if (body) {
      body.textContent = '自动释义已关闭，点击右上角「重新翻译」查询 AI 或直接加入生词本。';
    }

    if (headActions) {
      const addBtn = headActions.querySelector(
        '[data-word-act="add"]',
      ) as HTMLButtonElement | null;
      const retranslateBtn = headActions.querySelector(
        '[data-word-act="retranslate"]',
      ) as HTMLButtonElement | null;
      const ttsBtn = headActions.querySelector(
        '[data-word-act="tts"]',
      ) as HTMLButtonElement | null;

      if (retranslateBtn) {
        retranslateBtn.onclick = (e) => {
          e.stopPropagation();
          void fetchExplain(true);
        };
      }

      if (addBtn) {
        addBtn.onclick = async (e) => {
          e.stopPropagation();
          addBtn.disabled = true;
          if (this.activeWordStreamSession && !explain) {
            addBtn.title = '正在等待 AI 释义完成…';
            try {
              const res = await this.activeWordStreamSession.promise;
              if (res) explain = res;
            } catch {
              // ignore stream abort/error
            }
          }
          await sendRuntime(
            'word.add',
            {
              surface,
              context,
              translation: explain?.definition || undefined,
              contextTranslation:
                explain?.contextTranslation || this.currentCue?.translation,
              explanation: explain?.explanation,
              explainEngine: explain?.engine ?? 'none',
              explainProvider: explain?.provider,
              kind: 'word',
              cueStartMs: this.currentCue?.startMs,
              cueEndMs: this.currentCue?.endMs,
              audioClipId: this.lastClipId ?? undefined,
              sourceUrl: location.href,
              sourceTitle: document.title,
            },
            'content',
          );
          addBtn.disabled = false;
          addBtn.title = '已保存';
          addBtn.setAttribute('aria-label', '已保存');
          addBtn.style.opacity = '0.55';
          this.toast('info', `已保存至生词本：${surface}`);
          await this.refreshWordHighlights();
        };
      }
      if (ttsBtn) {
        ttsBtn.onclick = (e) => {
          e.stopPropagation();
          void this.handleTts(surface);
        };
      }
    }
  }

  private toast(level: 'info' | 'warn' | 'error', message: string): void {
    this.bridge?.send({ type: 'pip.toast', payload: { level, message } });
    const win = this.pipWindow && !this.pipWindow.closed ? this.pipWindow : window;
    const toastEl = win.document?.getElementById('ueh-pip-toast');
    if (toastEl) {
      toastEl.dataset.level = level;
      toastEl.textContent = message;
      toastEl.classList.add('ueh-toast-on');
      try {
        win.clearTimeout(this.toastHideTimer);
      } catch {
        window.clearTimeout(this.toastHideTimer);
      }
      const durationMs = level === 'info' ? 2200 : 3400;
      this.toastHideTimer = win.setTimeout(() => {
        toastEl.classList.remove('ueh-toast-on');
      }, durationMs);
    }
    console[level === 'error' ? 'error' : 'log']('[UEH]', message);
  }
}

/** Page-level user activation (click/key). Extension popup clicks do not count. */
function hasPageUserActivation(): boolean {
  try {
    const ua = (
      navigator as Navigator & {
        userActivation?: { isActive?: boolean; hasBeenActive?: boolean };
      }
    ).userActivation;
    return Boolean(ua?.isActive);
  } catch {
    return false;
  }
}
