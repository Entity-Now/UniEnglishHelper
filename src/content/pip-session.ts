import type {
  AppConfig,
  CaptureState,
  PipMode,
  PipSessionState,
  SubtitleCue,
} from '../shared/domain/types';
import { findActiveCue } from '../utils/subtitles/parser';
import { sendRuntime } from '../shared/messaging/client';
import { fail, ok, type Result } from '../shared/messages';
import { AppError } from '../shared/messages/errors';
import type { PlayerAdapter } from './players';
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
  buildPipMarkup,
  buildPipStyles,
  formatTime,
  ICONS,
} from './pip-ui-shell';
import {
  detectYoutubeAdStatus,
  trySkipYoutubeAd,
  type YoutubeAdPhase,
} from './youtube-ads';
import { getPageCues } from './index';
import {
  buildHighlightCss,
  decorateWordSpan,
  type HighlightMap,
} from '../utils/vocab-highlight';
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
  private lastUiKey = '';
  /** Last cue id we already scheduled translate prefetch for. */
  private lastPrefetchCueId = '';
  /** mousemove chrome reveal throttle */
  private lastChromeShowMs = 0;
  /** Avoid rewriting play SVG every UI tick */
  private lastPlayIconPaused: boolean | null = null;

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
          this.renderCue(this.currentCue);
        }
      },
    });
  }

  getState(): PipSessionState {
    return this.state;
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    this.showOriginalOverride = null;
    this.showTranslationOverride = null;
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
    const fontSize = Math.round(18 * ((vs?.main.fontScale ?? 85) / 100));
    const bgOpacity = (vs?.container.backgroundOpacity ?? 60) / 100;
    return buildPipStyles({
      fontSize,
      bgOpacity,
      displayMode: vs?.displayMode ?? 'bilingual',
      translationPosition: vs?.translationPosition ?? 'below',
      mainColor: vs?.main.color,
      translationColor: vs?.translation.color,
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
    this.renderCue(this.currentCue);
    this.cueList?.setHighlightMap(this.highlightMap);
    void this.refreshRecapBadge();
    if (this.vocabRecap?.isOpen()) void this.vocabRecap.refresh();
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
            this.video.currentTime = ms / 1000 + 0.01;
            void this.video.play().catch(() => undefined);
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

  setCaptureLive(sessionId: string): void {
    this.captureSessionId = sessionId;
    this.captureState = 'CaptureLive';
    if (this.video) this.sampler.attach(this.video);
    this.sampler.start(sessionId);
    this.pushPlaybackState();
    this.toast('info', 'Capture live — you can save sentence audio');
  }

  setCaptureIdle(): void {
    this.captureSessionId = null;
    this.captureState = 'CaptureIdle';
    this.sampler.stop();
    this.pushPlaybackState();
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

      this.bridge = new PipBridge();
      this.bridge.onMessage((msg) => void this.onBridgeMessage(msg));
      this.bridge.connectToPip(this.pipWindow);

      this.sampler.attach(this.video);
      this.startTicker();
      this.bindHotkeys(this.pipWindow);
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
          this.cues = cues;
          this.cueList?.setCues(cues);
          this.vocabRecap?.setCues(cues);
          void this.refreshRecapBadge();
          this.syncCue(true);
          if (wantsAutoTr()) this.startBackgroundTranslate();
          return;
        }

        // Retry fallback
        for (let i = 0; i < 5; i++) {
          cues = await this.adapter.getCues();
          if (cues.length > 0) {
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

        const st = this.pipWindow?.document.getElementById('ueh-status');
        if (st) st.textContent = '无字幕轨';
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
        this.setPagePlayerDimmed(true);
        return 'move';
      } catch (err) {
        console.warn('[UEH] move video failed, falling back to mirror', err);
      }
    }

    this.mirrorHandle = startVideoMirror(source, pipWindow, slot);
    if (this.mirrorHandle.mode !== 'none') {
      // Page still decodes; dim/cover the heavy player chrome to cut compositor work.
      this.setPagePlayerDimmed(true);
      return 'mirror';
    }

    return 'mirror';
  }

  /**
   * While PiP is open, cut compositor work on the opener tab.
   * Does not pause media (mirror still needs decoded frames from <video>).
   */
  private setPagePlayerDimmed(on: boolean): void {
    const STYLE_ID = 'ueh-pip-page-dim';
    if (!on) {
      document.getElementById(STYLE_ID)?.remove();
      document.documentElement.classList.remove('ueh-pip-active');
      return;
    }
    document.documentElement.classList.add('ueh-pip-active');
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    // Hide heavy secondary UI / player chrome while learning in PiP.
    // Keep the <video> itself (required for canvas mirror & timeline).
    style.textContent = `
      html.ueh-pip-active ytd-watch-flexy #secondary,
      html.ueh-pip-active ytd-watch-flexy #below,
      html.ueh-pip-active ytd-watch-flexy #chat,
      html.ueh-pip-active ytd-watch-flexy #comments {
        content-visibility: auto;
        contain-intrinsic-size: 1px 500px;
      }
      html.ueh-pip-active #movie_player .ytp-chrome-top,
      html.ueh-pip-active #movie_player .ytp-chrome-bottom,
      html.ueh-pip-active #movie_player .ytp-gradient-top,
      html.ueh-pip-active #movie_player .ytp-gradient-bottom,
      html.ueh-pip-active #movie_player .ytp-cards-teaser,
      html.ueh-pip-active #movie_player .ytp-ce-element {
        visibility: hidden !important;
        pointer-events: none !important;
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
    this.unbindHotkeys();
    this.bridge?.close();
    this.bridge = null;
    this.teardownVideoMirror();
    this.restoreVideo();
    this.setPagePlayerDimmed(false);
    this.hideClickToOpenBanner();
    this.lastUiPushMs = 0;
    this.lastUiKey = '';
    this.lastPrefetchCueId = '';
    this.lastPlayIconPaused = null;
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
    void this.refreshHighlightMap();
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
    const root = doc.getElementById('ueh-pip-root');
    const progress = doc.getElementById('ueh-progress') as HTMLInputElement | null;

    // Show chrome while interacting (throttle mousemove — fires dozens/sec while dragging/resizing)
    let hideTimer = 0;
    const showChrome = () => {
      const now = performance.now();
      if (now - this.lastChromeShowMs < 120) {
        // Still refresh hide timer lightly without class thrash
        window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
          root?.classList.remove('ueh-show-chrome');
        }, 2500);
        return;
      }
      this.lastChromeShowMs = now;
      root?.classList.add('ueh-show-chrome');
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        root?.classList.remove('ueh-show-chrome');
      }, 2500);
    };
    root?.addEventListener('mousemove', showChrome, { passive: true });
    root?.addEventListener('click', showChrome);
    showChrome();

    // Click video area → play/pause (ignore side panel / buttons)
    doc.getElementById('ueh-video-slot')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button,input,a,#ueh-word-panel')) return;
      this.handleCommandPlayPause();
      this.updatePlayIcon();
    });

    doc.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = (btn as HTMLElement).dataset.act;
        if (act === 'play') {
          this.handleCommandPlayPause();
          this.updatePlayIcon();
        } else if (act === 'export') void this.handleExportClip();
        else if (act === 'tts') void this.handleTts();
        else if (act === 'translate') void this.handleTranslateCurrent();
        else if (act === 'prev') this.seekCue(-1);
        else if (act === 'next') this.seekCue(1);
        else if (act === 'toggle-en') {
          this.showOriginalOverride = !this.resolveShowOriginal();
          this.cycleDisplayFromToggles();
        } else if (act === 'toggle-tr') {
          this.showTranslationOverride = !this.resolveShowTranslation();
          this.cycleDisplayFromToggles();
        } else if (act === 'settings') {
          this.togglePipSettingsPanel(doc);
        } else if (act === 'list') {
          this.toggleCueList();
        } else if (act === 'recap') {
          void this.toggleVocabRecap();
        }
      });
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

    // Scrub → seek original video
    progress?.addEventListener('input', () => {
      if (!this.video || !progress) return;
      const dur = this.video.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      const ratio = Number(progress.value) / 1000;
      this.video.currentTime = ratio * dur;
      this.syncCue(true);
    });

    this.updatePlayIcon();
  }

  private togglePipSettingsPanel(doc: Document): void {
    const panel = doc.getElementById('ueh-pip-settings');
    if (!panel) return;
    const open = panel.classList.toggle('ueh-open');
    if (open) this.syncPipSettingsFields(doc);
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
      });
  }

  private syncPipSettingsFields(doc: Document): void {
    const ps = this.pipSurface();
    const en = doc.getElementById('ueh-pip-en') as HTMLInputElement | null;
    const autoTr = doc.getElementById(
      'ueh-pip-auto-tr',
    ) as HTMLInputElement | null;
    const mode = doc.getElementById('ueh-pip-mode') as HTMLSelectElement | null;
    const pos = doc.getElementById('ueh-pip-pos') as HTMLSelectElement | null;
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
    if (pos) pos.value = ps.style?.translationPosition ?? 'below';
    if (scale) scale.value = String(ps.style?.main.fontScale ?? 85);
    if (bg) bg.value = String(ps.style?.container.backgroundOpacity ?? 60);
    this.updatePipScaleLabels(doc);
  }

  private updatePipScaleLabels(doc: Document): void {
    const scale = doc.getElementById(
      'ueh-pip-scale',
    ) as HTMLInputElement | null;
    const bg = doc.getElementById('ueh-pip-bg') as HTMLInputElement | null;
    const sv = doc.getElementById('ueh-pip-scale-val');
    const bv = doc.getElementById('ueh-pip-bg-val');
    if (scale && sv) sv.textContent = `${scale.value}%`;
    if (bg && bv) bv.textContent = `${bg.value}%`;
  }

  private async applyPipSettingsFromPanel(
    doc: Document,
    persist: boolean,
  ): Promise<boolean> {
    const en = doc.getElementById('ueh-pip-en') as HTMLInputElement;
    const autoTr = doc.getElementById(
      'ueh-pip-auto-tr',
    ) as HTMLInputElement;
    const mode = doc.getElementById('ueh-pip-mode') as HTMLSelectElement;
    const pos = doc.getElementById('ueh-pip-pos') as HTMLSelectElement;
    const scale = doc.getElementById('ueh-pip-scale') as HTMLInputElement;
    const bg = doc.getElementById('ueh-pip-bg') as HTMLInputElement;

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
    };

    this.config = { ...this.config, pipSubtitles: nextPip };
    this.showOriginalOverride = null;
    this.showTranslationOverride = null;
    this.reapplyPipStyles();
    this.renderCue(this.currentCue);

    if (!persist) return true;

    const res = await sendRuntime<AppConfig>(
      'config.set',
      { pipSubtitles: nextPip },
      'content',
    );
    if (res.ok) {
      this.config = res.data;
      this.reapplyPipStyles();
      this.renderCue(this.currentCue);
      return true;
    }
    return false;
  }

  private openWordPanel(): void {
    const root = this.pipWindow?.document.getElementById('ueh-pip-root');
    const panel = this.pipWindow?.document.getElementById('ueh-word-panel');
    root?.classList.add('ueh-word-open');
    panel?.setAttribute('aria-hidden', 'false');
  }

  private closeWordPanel(): void {
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
    const btn = this.pipWindow?.document.querySelector(
      'button[data-act="play"] svg',
    );
    if (!btn || !this.video) return;
    const paused = this.video.paused;
    if (this.lastPlayIconPaused === paused) return;
    this.lastPlayIconPaused = paused;
    btn.innerHTML = paused ? ICONS.play : ICONS.pause;
  }

  private bindHotkeys(win: Window): void {
    this.unbindHotkeys();
    this.keyHandler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.handleCommandPlayPause();
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
    if (!this.video || !this.cues.length) return;
    const t = Math.round(this.video.currentTime * 1000);
    let idx = this.cues.findIndex(
      (c) => t >= c.startMs && t < c.endMs,
    );
    if (idx < 0) {
      idx = this.cues.findIndex((c) => c.startMs > t);
      if (idx < 0) idx = this.cues.length - 1;
      else if (delta < 0) idx = Math.max(0, idx - 1);
    } else {
      idx = Math.max(0, Math.min(this.cues.length - 1, idx + delta));
    }
    const cue = this.cues[idx];
    this.video.currentTime = cue.startMs / 1000 + 0.01;
    this.syncCue(true);
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
    if (!this.video || !this.placeholder || !this.originalParent) return;
    try {
      const v = this.video;
      if (v.dataset.uehPrevStyle !== undefined) {
        if (v.dataset.uehPrevStyle) v.setAttribute('style', v.dataset.uehPrevStyle);
        else v.removeAttribute('style');
        v.controls = v.dataset.uehPrevControls === '1';
        delete v.dataset.uehPrevStyle;
        delete v.dataset.uehPrevControls;
      }
      this.originalParent.insertBefore(v, this.placeholder);
      this.placeholder.remove();
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

    if (status.phase === 'none') {
      root?.classList.remove('ueh-ad-active');
      banner?.classList.remove('ueh-ad-visible', 'ueh-ad-skippable');
      if (skipBtn) skipBtn.disabled = true;
      if (prev !== 'none') {
        // Ad ended — swap to main-video captions (not just re-sync old ad cues)
        void this.reloadCuesAfterAd();
      }
      return;
    }

    root?.classList.add('ueh-ad-active');
    banner?.classList.add('ueh-ad-visible');
    if (status.phase === 'ad_skippable') {
      banner?.classList.add('ueh-ad-skippable');
      if (label) label.textContent = '广告可跳过';
      if (hint) hint.textContent = '点击跳过，或在原标签页操作';
      if (skipBtn) {
        skipBtn.disabled = false;
        skipBtn.textContent = '跳过广告';
      }
      if (prev !== 'ad_skippable') {
        this.toast('info', '广告可跳过 — 点击「跳过广告」');
      }
    } else {
      banner?.classList.remove('ueh-ad-skippable');
      if (label) label.textContent = '广告播放中';
      if (hint) hint.textContent = '暂不可跳过，请稍候或回原页';
      if (skipBtn) {
        skipBtn.disabled = true;
        skipBtn.textContent = '等待跳过…';
      }
      if (prev === 'none') {
        this.toast('warn', 'YouTube 广告播放中');
      }
    }
  }

  private handleSkipAd(): void {
    const ok = trySkipYoutubeAd();
    if (ok) {
      this.toast('info', '已点击跳过广告');
      // Re-check shortly after click
      window.setTimeout(() => this.syncYoutubeAdUi(), 300);
      window.setTimeout(() => this.syncYoutubeAdUi(), 900);
      // Also schedule a caption reload in case phase detection is delayed
      window.setTimeout(() => {
        if (detectYoutubeAdStatus().phase === 'none') {
          void this.reloadCuesAfterAd();
        }
      }, 1200);
    } else {
      this.toast('warn', '未找到跳过按钮，请在原页面点击 Skip');
    }
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
    this.adapter.clearCache?.();
    // YouTube usually reuses the same <video>; still re-resolve + re-attach sampler
    const next = this.adapter.findVideo();
    if (next) {
      this.video = next;
      this.sampler.attach(next);
    }
    this.cues = [];
    this.currentCue = null;
    this.lastPrefetchCueId = '';
    this.cueList?.setCues([]);
    this.vocabRecap?.setCues([]);
    this.renderCue(null);
    const st = this.pipWindow?.document.getElementById('ueh-status');
    if (st) st.textContent = '加载字幕…';
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
    this.cues = cues;
    this.currentCue = null;
    this.lastPrefetchCueId = '';
    this.cueList?.setCues(cues);
    this.vocabRecap?.setCues(cues);
    void this.refreshRecapBadge();
    this.syncCue(true);
    if (cues.length && this.wantsAutoTranslate()) {
      this.startBackgroundTranslate();
    }
    const st = this.pipWindow?.document.getElementById('ueh-status');
    if (st) {
      if (cues.length) st.textContent = '';
      else if (st.textContent === '加载字幕…') st.textContent = '无字幕轨';
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

  private syncCue(force: boolean): void {
    if (!this.video) return;
    // Prefer continuous media time (ms) for tight A/V sync
    const t = Math.round(this.video.currentTime * 1000);
    const cue = findActiveCue(this.cues, t);
    // Only re-render when the *active* cue identity changes
    if (!force && cue?.id === this.currentCue?.id) {
      // Prefetch only once per cue id (was every rAF → wasted work)
      if (
        cue &&
        this.wantsAutoTranslate() &&
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
    // Display ONLY the current cue (no next-line stacking)
    this.renderCue(cue);
    this.bridge?.send({
      type: 'pip.subtitleCue',
      payload: { cue, translation: cue?.translation },
    });

    const autoTr =
      this.pipSurface().autoTranslate ?? this.config.features.autoTranslate;
    if (cue && autoTr) {
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
    enChip?.classList.toggle('off', !showEn);
    trChip?.classList.toggle('off', !showTr);
  }

  private cycleDisplayFromToggles(): void {
    // Keep config style in sync so Settings re-open reflects last PiP choice
    // is not required; runtime only.
    this.syncSubVisibilityChrome();
    this.renderCue(this.currentCue);
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
      return;
    }

    const position =
      this.pipSurface().style?.translationPosition ?? 'below';

    const layer = doc.getElementById('ueh-sub-layer');
    if (layer) {
      layer.style.flexDirection =
        position === 'above' ? 'column-reverse' : 'column';
      const pct = this.pipSurface().position?.percent ?? 12;
      layer.style.bottom = `${Math.max(56, 48 + pct)}px`;
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
          span.textContent = seg.text;
          decorateWordSpan(span, seg.text, this.highlightMap, hlCfg);
          span.addEventListener('click', (e) => {
            e.stopPropagation();
            void this.handleWordClick(seg.text, cue.text);
          });
          en.appendChild(span);
        } else {
          en.appendChild(doc.createTextNode(seg.text));
        }
      }
    }
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

    const status = doc.getElementById('ueh-status');
    if (status && this.captureState === 'CaptureLive') {
      if (status.textContent !== '● REC') status.textContent = '● REC';
    }
  }

  private async onBridgeMessage(msg: BridgeMessage): Promise<void> {
    switch (msg.type) {
      case 'pip.command.playPause':
        this.handleCommandPlayPause();
        break;
      case 'pip.command.seek':
        if (this.video) this.video.currentTime = msg.payload.mediaTimeMs / 1000;
        break;
      case 'pip.command.setRate':
        if (this.video) this.video.playbackRate = msg.payload.rate;
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

  private handleCommandPlayPause(): void {
    if (!this.video) return;
    if (this.video.paused) void this.video.play();
    else this.video.pause();
    this.updatePlayIcon();
  }

  private async translateCue(cue: SubtitleCue): Promise<void> {
    await this.translateScheduler.translateMany([cue]);
  }

  private async handleTranslateCurrent(): Promise<void> {
    if (!this.currentCue) return;
    await this.translateCue(this.currentCue);
  }

  private async handleExportClip(): Promise<void> {
    if (!this.currentCue) {
      this.toast('warn', 'No active subtitle sentence');
      return;
    }
    if (!this.captureSessionId || this.captureState !== 'CaptureLive') {
      this.toast('warn', 'Enable capture in the extension popup first');
      return;
    }
    // pause video slightly for cleaner capture optional — keep playing for continuous ring
    const res = await sendRuntime<{
      clipId: number;
      durationMs: number;
      mimeType: string;
    }>(
      'clips.export',
      {
        sessionId: this.captureSessionId,
        startMs: this.currentCue.startMs,
        endMs: this.currentCue.endMs,
        epoch: this.sampler.getEpoch(),
      },
      'content',
    );
    if (!res.ok) {
      this.toast('error', `${res.error.code}: ${res.error.message}`);
      return;
    }
    this.lastClipId = res.data.clipId;
    this.toast('info', `Saved clip #${res.data.clipId} (${res.data.durationMs}ms)`);
    this.bridge?.send({
      type: 'pip.exportResult',
      payload: { clipId: res.data.clipId, durationMs: res.data.durationMs },
    });
    await this.playClipId(res.data.clipId);
  }

  private async handlePlayLastClip(): Promise<void> {
    if (this.lastClipId == null) {
      this.toast('warn', 'No saved clip yet');
      return;
    }
    await this.playClipId(this.lastClipId);
  }

  private async playClipId(clipId: number): Promise<void> {
    if (this.video && !this.video.paused) this.video.pause();
    await this.clipPlayer.play(clipId, (state, message) => {
      this.bridge?.send({
        type: 'pip.clipPlayState',
        payload: { clipId, state, message },
      });
      if (state === 'error') this.toast('error', message ?? 'Clip play failed');
    });
  }

  private async handleTts(text?: string): Promise<void> {
    const t = text ?? this.currentCue?.text;
    if (!t) {
      this.toast('warn', 'No text to speak');
      return;
    }

    // Edge: sequential base64 chunks (avoids MP3 concat stutter / re-accent)
    if (
      this.config.tts?.engine === 'edge' &&
      this.config.features.enableEdgeTts
    ) {
      const chunksRes = await sendRuntime<{
        mode: string;
        voice: string;
        chunks: Array<{ audioBase64: string; contentType: string }>;
      }>('tts.synthChunks', { text: t }, 'content');
      if (chunksRes.ok && chunksRes.data.chunks?.length) {
        if (this.video && !this.video.paused) this.video.pause();
        const { playTtsAudioChunks, stopTtsPlayback } = await import(
          '../utils/tts-playback/play-chunks'
        );
        stopTtsPlayback();
        const ok = await playTtsAudioChunks(chunksRes.data.chunks);
        if (!ok) this.toast('warn', 'TTS stopped');
        return;
      }
      if (!chunksRes.ok) {
        this.toast('error', chunksRes.error.message);
        return;
      }
    }

    const res = await sendRuntime<{
      mode: string;
      text: string;
      voice: string;
      clipId?: number;
      clipIds?: number[];
    }>('tts.synth', { text: t }, 'content');
    if (!res.ok) {
      this.toast('error', res.error.message);
      return;
    }

    const ids =
      res.data.clipIds?.length
        ? res.data.clipIds
        : res.data.clipId != null
          ? [res.data.clipId]
          : [];

    if (ids.length) {
      this.lastClipId = ids[0]!;
      if (this.video && !this.video.paused) this.video.pause();
      await this.clipPlayer.playSequence(ids, (state, message) => {
        if (state === 'error') this.toast('error', message ?? 'TTS play failed');
      });
      return;
    }

    if (typeof speechSynthesis !== 'undefined') {
      if (this.video && !this.video.paused) this.video.pause();
      const u = new SpeechSynthesisUtterance(res.data.text);
      u.lang = res.data.voice || 'en-US';
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
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
            this.video.currentTime = cue.startMs / 1000 + 0.01;
            void this.video.play().catch(() => undefined);
          }
        },
        doc,
        (word, context) => {
          void this.handleWordClick(word, context);
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
    }
    this.cueList.toggle();
    if (this.cueList.isOpen()) {
      this.cueList.setActiveCueId(this.currentCue?.id ?? null);
      if (this.wantsAutoTranslate()) void this.translateScheduler.drainAll();
    }
  }

  private async handleWordClick(surface: string, context: string): Promise<void> {
    const doc = this.pipWindow?.document;
    if (!doc) return;

    const wordShow = this.config.wordShow;
    if (wordShow?.pauseOnOpen && this.video && !this.video.paused) {
      this.video.pause();
      this.updatePlayIcon();
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
    if (wordShow?.autoExplain !== false) {
      if (body) body.textContent = '查询中…（AI 超时将自动免费翻译）';
      if (title) {
        title.dataset.engine = '';
      }
      const res = await sendRuntime<WordExplainResult & { text?: string }>(
        'word.explain',
        { word: surface, surface, context },
        'content',
      );
      if (res.ok) {
        explain = res.data;
        if (body) {
          body.innerHTML = '';
          // Badge for LLM vs free MT fallback
          const badge = doc.createElement('div');
          badge.style.cssText =
            'display:inline-block;font-size:9px;font-weight:700;padding:1px 6px;border-radius:999px;margin-bottom:6px;';
          if (explain.engine === 'llm') {
            badge.textContent = 'AI 释义';
            badge.style.background = 'color-mix(in srgb, oklch(76% 0.12 82) 35%, transparent)';
            badge.style.color = 'oklch(92% 0.06 82)';
          } else if (explain.engine === 'free_mt') {
            badge.textContent = '免费翻译';
            badge.style.background = 'color-mix(in srgb, oklch(72% 0.14 145) 28%, transparent)';
            badge.style.color = 'oklch(88% 0.08 145)';
          } else {
            badge.textContent = '不可用';
            badge.style.background = 'rgba(255,80,80,.18)';
            badge.style.color = '#ffb4a9';
          }
          body.appendChild(badge);

          if (explain.definition) {
            const def = doc.createElement('div');
            def.style.fontWeight = '600';
            def.style.fontSize = '13px';
            def.textContent = explain.definition;
            body.appendChild(def);
          }
          // Sentence translation only in the top context block (never again in body)
          const sentenceTr =
            explain.contextTranslation?.trim() || cueTranslation;
          renderCtx(sentenceTr);

          if (explain.explanation && explain.engine === 'llm') {
            const full = doc.createElement('pre');
            full.style.marginTop = '6px';
            full.style.whiteSpace = 'pre-wrap';
            full.style.fontFamily = 'inherit';
            full.style.fontSize = '12px';
            full.textContent = explain.explanation;
            body.appendChild(full);
          }
          if (explain.note) {
            const note = doc.createElement('div');
            note.style.cssText =
              'margin-top:8px;font-size:11px;line-height:1.35;padding:5px 7px;border-radius:6px;background:rgba(255,255,255,.06);color:oklch(88% 0.08 82)';
            note.textContent = explain.note;
            body.appendChild(note);
          }
          if (!body.textContent?.trim()) {
            body.textContent = res.data.text || surface;
          }
        }
      } else if (body) {
        body.textContent = res.error.message;
      }
    } else if (body) {
      body.textContent = '点击右上角加入生词本，或等待自动释义。';
    }

    if (headActions) {
      const addBtn = headActions.querySelector(
        '[data-word-act="add"]',
      ) as HTMLButtonElement | null;
      const ttsBtn = headActions.querySelector(
        '[data-word-act="tts"]',
      ) as HTMLButtonElement | null;

      if (addBtn) {
        addBtn.onclick = async (e) => {
          e.stopPropagation();
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
          addBtn.title = '已添加';
          addBtn.setAttribute('aria-label', '已添加');
          addBtn.style.opacity = '0.55';
          this.toast('info', `已加入生词本：${surface}`);
          void this.refreshWordHighlights();
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
    const status = this.pipWindow?.document.getElementById('ueh-status');
    if (status) status.textContent = message;
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
