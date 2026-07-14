import { isEnvelope, ok, fail, type Result } from '../shared/messages';
import { sendRuntime } from '../shared/messaging/client';
import type { AppConfig, SubtitleCue } from '../shared/domain/types';
import { DEFAULT_APP_CONFIG } from '../shared/domain/types';
import { createPlayerAdapter } from './players';
import { PipSessionController } from './pip-session';
import { isYoutubeHost, isYoutubeWatchLikePath } from './players/youtube';
import { PlayerChromeButton } from './player-chrome-button';
import { SelectionToolbar } from './selection-toolbar';
import { PageSubtitlesOverlay } from './page-subtitles';
import { CueListSidebar } from './cue-list-sidebar';
import { VideoVocabRecap } from './video-vocab-recap';
import { showWordExplainPopup } from './word-explain-popup';
import {
  buildCueWordKeys,
  formatRecapBadge,
  normalizeVideoKey,
  type VideoVocabRecapResult,
} from '../utils/video-vocab-recap';
import { CONFIG_STORAGE_KEY } from '../shared/constants';
import { isSiteEnabled } from '../utils/site-control';
import {
  detectYoutubeAdStatus,
  type YoutubeAdPhase,
} from './youtube-ads';

declare global {
  interface Window {
    __UEH_CONTENT_LOADED__?: boolean;
  }
}

if (window.__UEH_CONTENT_LOADED__) {
  // re-inject no-op
} else {
  window.__UEH_CONTENT_LOADED__ = true;
  void main();
}

let config: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
let controller: PipSessionController | null = null;
let booting: Promise<void> | null = null;
let chromeBtn: PlayerChromeButton | null = null;
let selectionToolbar: SelectionToolbar | null = null;
let pageSubs: PageSubtitlesOverlay | null = null;
let pageCueList: CueListSidebar | null = null;
let pageVocabRecap: VideoVocabRecap | null = null;
let pageCues: SubtitleCue[] = [];
let activeCueId = '';
let cueTick = 0;
let storageListening = false;
let navObserving = false;
let hotkeysBound = false;
let siteDisabled = false;
let adWatchTimer = 0;
let lastAdPhase: YoutubeAdPhase = 'none';
let reloadingAfterAd = false;

async function ensureController(): Promise<PipSessionController> {
  if (siteDisabled) {
    throw new Error('Extension disabled on this site');
  }
  if (controller) return controller;
  if (!booting) {
    booting = boot().finally(() => {
      booting = null;
    });
  }
  await booting;
  if (!controller) {
    controller = new PipSessionController(createPlayerAdapter(config), config);
  }
  return controller;
}

function tearDownAll(): void {
  chromeBtn?.stop();
  chromeBtn = null;
  selectionToolbar?.stop();
  selectionToolbar = null;
  pageSubs?.stop();
  pageSubs = null;
  pageCueList?.destroy();
  pageCueList = null;
  pageVocabRecap?.destroy();
  pageVocabRecap = null;
  controller = null;
  if (cueTick) {
    cancelAnimationFrame(cueTick);
    cueTick = 0;
  }
  stopAdWatcher();
  lastAdPhase = 'none';
}

async function applyConfigLive(next: AppConfig): Promise<void> {
  config = next;
  const enabled = isSiteEnabled(location.href, config.siteControl);
  if (!enabled) {
    siteDisabled = true;
    tearDownAll();
    return;
  }
  siteDisabled = false;

  // Propagate full AppConfig (features / wordShow / surfaces) to every live surface
  controller?.updateConfig(config);
  selectionToolbar?.updateConfig(config);
  chromeBtn?.updateConfig(config);

  if (!shouldRunPageSubtitles(config)) {
    pageSubs?.stop();
    pageSubs = null;
  } else if (!pageSubs) {
    pageSubs = new PageSubtitlesOverlay(createPlayerAdapter(config), config);
    await pageSubs.start();
  } else {
    pageSubs.updateConfig(config);
    if (!pageSubs.isRunning()) await pageSubs.start();
  }

  // Keep sidebar cue list in sync if open (translations may arrive after config flip)
  if (pageCueList?.isOpen() && pageCues.length) {
    pageCueList.setCues(pageCues);
  }
  pageVocabRecap?.setVocabHighlight(config.vocabHighlight);
  if (pageCues.length) {
    pageVocabRecap?.setCues(pageCues);
    void refreshPageRecapBadge();
  }

  console.info('[UEH] config applied live', {
    pageAutoTr: config.pageSubtitles?.autoTranslate,
    pipAutoTr: config.pipSubtitles?.autoTranslate,
    llmTr: config.features?.enableLlmTranslate,
    autoExplain: config.wordShow?.autoExplain,
  });
}

function shouldRunPageSubtitles(c: AppConfig): boolean {
  return c.pageSubtitles?.enabled !== false;
}

async function boot(): Promise<void> {
  const res = await sendRuntime<AppConfig>('config.get', {}, 'content');
  if (res.ok) config = res.data;

  if (!isSiteEnabled(location.href, config.siteControl)) {
    siteDisabled = true;
    tearDownAll();
    ensureStorageListener();
    if (isYoutubeHost()) ensureNavObserver();
    return;
  }
  siteDisabled = false;

  if (isYoutubeHost()) {
    void sendRuntime('youtube.injectMain', {}, 'content');
  }

  const adapter = createPlayerAdapter(config);
  if (!controller) {
    controller = new PipSessionController(adapter, config);
  } else {
    controller.updateConfig(config);
  }

  mountPlayerButton();
  ensureSelectionToolbar();
  await ensurePageSubtitles();
  void loadPageCues();
  startPageCueTicker();
  ensureStorageListener();
  if (isYoutubeHost()) {
    ensureNavObserver();
    ensureAdWatcher();
  }
  ensureHotkeys();
}

/**
 * Watch YouTube ad chrome. When an ad ends (skip or natural), force-reload
 * main-video captions so we don't keep showing ad timedtext.
 */
function ensureAdWatcher(): void {
  if (!isYoutubeHost() || adWatchTimer) return;
  lastAdPhase = detectYoutubeAdStatus().phase;
  adWatchTimer = window.setInterval(() => {
    const phase = detectYoutubeAdStatus().phase;
    const prev = lastAdPhase;
    lastAdPhase = phase;
    if (prev !== 'none' && phase === 'none') {
      void reloadCuesAfterAd();
    }
  }, 450);
}

function stopAdWatcher(): void {
  if (adWatchTimer) {
    clearInterval(adWatchTimer);
    adWatchTimer = 0;
  }
}

async function reloadCuesAfterAd(): Promise<void> {
  if (reloadingAfterAd || siteDisabled) return;
  reloadingAfterAd = true;
  console.info('[UEH] YouTube ad ended — reloading main video captions');
  try {
    // Small delay so the player swaps back to the main stream / pot URLs
    await new Promise((r) => setTimeout(r, 350));

    const adapter = createPlayerAdapter(config);
    adapter.clearCache?.();

    // Prefer overlay path (keeps its adapter cache in sync)
    if (pageSubs?.isRunning()) {
      await pageSubs.forceReloadCues();
    }

    // Always refresh page cue list + shared pageCues used by PiP
    pageCues = [];
    await loadPageCues(8);
    controller?.onMainCuesReloaded?.(pageCues);
  } catch (e) {
    console.warn('[UEH] reload after ad failed', e);
  } finally {
    reloadingAfterAd = false;
  }
}

async function loadPageCues(retryCount = 10): Promise<void> {
  const isVideoPage = !isYoutubeHost() || isYoutubeWatchLikePath();
  if (!isVideoPage) {
    pageCues = [];
    pageCueList?.setCues([]);
    return;
  }

  try {
    // Ensure MAIN interceptor early (captions / pot capture)
    if (isYoutubeHost()) {
      void sendRuntime('youtube.injectMain', {}, 'content');
    }

    const adapter = createPlayerAdapter(config);
    const video = adapter.findVideo();
    if (!video) {
      throw new Error('Video element not found yet');
    }
    pageCues = await adapter.getCues();
    pageCueList?.setCues(pageCues);
    if (pageCues.length > 0) {
      if (pageSubs) {
        pageSubs.setCues(pageCues);
      } else if (shouldRunPageSubtitles(config)) {
        pageSubs = new PageSubtitlesOverlay(adapter, config);
        await pageSubs.start();
        pageSubs.setCues(pageCues);
      }
      if (pageSubs && !pageSubs.isRunning()) {
        void pageSubs.start();
      }
      pageVocabRecap?.setCues(pageCues);
      pageSubs?.drainTranslations();
      void refreshPageRecapBadge();
      console.info('[UEH] page cues ready', pageCues.length);
      return;
    }
  } catch (e) {
    console.warn('[UEH] load cues attempt failed', e);
  }

  if (retryCount > 0) {
    window.setTimeout(() => {
      void loadPageCues(retryCount - 1);
    }, 1200);
  } else {
    console.warn('[UEH] page cues exhausted retries (0 cues)');
  }
}

export function getPageCues(): SubtitleCue[] {
  return pageCues;
}

function startPageCueTicker(): void {
  if (cueTick) {
    cancelAnimationFrame(cueTick);
    cueTick = 0;
  }
  // 5 Hz is enough for sidebar active-cue highlight; avoid creating adapters every frame.
  let lastMs = 0;
  const loop = (now: number) => {
    if (now - lastMs >= 200) {
      lastMs = now;
      // Skip page list work while Document PiP is active (PiP has its own ticker)
      const pipBusy =
        controller &&
        controller.getState() !== 'Idle' &&
        controller.getState() !== 'Closed';
      if (!pipBusy && pageCues.length && pageCueList?.isOpen()) {
        const video = createPlayerAdapter(config).findVideo();
        if (video) {
          const t = Math.round(video.currentTime * 1000);
          const cue = pageCues.find((c) => t >= c.startMs && t < c.endMs);
          const id = cue?.id ?? '';
          if (id !== activeCueId) {
            activeCueId = id;
            pageCueList.setActiveCueId(id || null);
          }
        }
      }
    }
    cueTick = requestAnimationFrame(loop);
  };
  cueTick = requestAnimationFrame(loop);
}

async function refreshPageRecapBadge(): Promise<void> {
  const cues = pageCues.length
    ? pageCues
    : (pageSubs?.getCues() ?? []);
  const res = await sendRuntime<VideoVocabRecapResult>(
    'word.videoRecap',
    {
      videoKey: normalizeVideoKey(location.href),
      cueWordKeys: buildCueWordKeys(cues),
    },
    'content',
  );
  if (!res.ok) return;
  pageSubs?.setRecapBadge(formatRecapBadge(res.data.stats));
}

async function speakPageWord(text: string): Promise<void> {
  const res = await sendRuntime<{
    mode: string;
    text?: string;
    voice?: string;
  }>('tts.synth', { text }, 'content');
  if (!res.ok) return;
  if (res.data.mode === 'web-speech' && res.data.text) {
    const u = new SpeechSynthesisUtterance(res.data.text);
    u.lang = res.data.voice || 'en-US';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
}

function togglePageVocabRecap(): void {
  const cues = pageCues.length
    ? pageCues
    : (pageSubs?.getCues() ?? []);
  if (!pageVocabRecap) {
    pageVocabRecap = new VideoVocabRecap('page', document, {
      getVideoKey: () => normalizeVideoKey(location.href),
      onSeek: (ms) => {
        const video = createPlayerAdapter(config).findVideo();
        if (video) {
          video.currentTime = ms / 1000 + 0.01;
          void video.play().catch(() => undefined);
        }
      },
      onExplain: (surface, context) => {
        const cueTr = pageCues.find((c) => c.text === context)?.translation?.trim();
        void showWordExplainPopup(
          surface,
          context,
          document,
          () => {
            if (pageSubs?.isRunning()) void pageSubs.refreshHighlights();
            void pageCueList?.refreshHighlights();
            void refreshPageRecapBadge();
            if (pageVocabRecap?.isOpen()) void pageVocabRecap.refresh();
          },
          cueTr,
        );
      },
      onTts: (surface) => {
        void speakPageWord(surface);
      },
      onMarkLearned: async (id) => {
        await sendRuntime(
          'word.setStatus',
          { id, learningStatus: 'learned' },
          'content',
        );
        if (pageSubs?.isRunning()) void pageSubs.refreshHighlights();
        void pageCueList?.refreshHighlights();
        void refreshPageRecapBadge();
      },
      onStatsChange: (stats) => {
        pageSubs?.setRecapBadge(formatRecapBadge(stats));
      },
    });
    pageVocabRecap.setVocabHighlight(config.vocabHighlight);
    pageVocabRecap.setCues(cues);
  } else {
    pageVocabRecap.setCues(cues);
  }
  pageVocabRecap.toggle();
}

function togglePageCueList(): void {
  if (pageCues.length === 0) {
    void loadPageCues(3);
  }
  if (!pageCueList) {
    pageCueList = new CueListSidebar(
      'page',
      (cue) => {
        const video = createPlayerAdapter(config).findVideo();
        if (video) {
          video.currentTime = cue.startMs / 1000 + 0.01;
          void video.play().catch(() => undefined);
        }
      },
      document,
      (word, context) => {
        const cueTr = pageCues.find((c) => c.text === context)?.translation?.trim();
        void showWordExplainPopup(
          word,
          context,
          document,
          () => {
            if (pageSubs && pageSubs.isRunning()) {
              void pageSubs.refreshHighlights();
            }
            void pageCueList?.refreshHighlights();
            void refreshPageRecapBadge();
            if (pageVocabRecap?.isOpen()) void pageVocabRecap.refresh();
          },
          cueTr,
        );
      }
    );
    pageCueList.setCues(pageCues);
    pageCueList.setVocabHighlight(config.vocabHighlight);
    void pageCueList.refreshHighlights();
  }
  pageCueList.toggle();
  if (pageCueList.isOpen()) {
    pageCueList.setActiveCueId(activeCueId || null);
    void pageCueList.refreshHighlights();
    pageSubs?.drainTranslations();
  }
}

function mountPlayerButton(): void {
  chromeBtn?.stop();
  chromeBtn = new PlayerChromeButton(
    config,
    () => {
      void ensureController().then((c) => c.openWithUserGesture());
    },
    (next) => applyConfigLive(next),
    () => togglePageCueList(),
    () => {
      if (pageCues.length === 0) {
        void loadPageCues(3);
      }
    }
  );
  chromeBtn.start();
}

function ensureSelectionToolbar(): void {
  if (!selectionToolbar) {
    selectionToolbar = new SelectionToolbar(config);
    selectionToolbar.start();
  } else {
    selectionToolbar.updateConfig(config);
  }
}

async function ensurePageSubtitles(): Promise<void> {
  if (!shouldRunPageSubtitles(config)) {
    pageSubs?.stop();
    pageSubs = null;
    return;
  }
  if (
    isYoutubeHost() &&
    config.pageSubtitles?.autoStartOnYoutube === false &&
    !pageSubs?.isRunning()
  ) {
    return;
  }
  if (!pageSubs) {
    pageSubs = new PageSubtitlesOverlay(createPlayerAdapter(config), config);
    window.setTimeout(() => {
      void pageSubs?.start();
    }, 600);
  } else {
    pageSubs.updateConfig(config);
  }
}

function ensureStorageListener(): void {
  if (storageListening) return;
  storageListening = true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes[CONFIG_STORAGE_KEY]) return;
    void (async () => {
      const c = await sendRuntime<AppConfig>('config.get', {}, 'content');
      if (!c.ok) return;
      const wasDisabled = siteDisabled;
      await applyConfigLive(c.data);
      // Re-boot UI when re-enabled
      if (wasDisabled && !siteDisabled) {
        void boot();
      }
    })();
  });
}

function ensureNavObserver(): void {
  if (navObserving) return;
  navObserving = true;
  let last = location.href;
  const check = () => {
    if (location.href !== last) {
      last = location.href;
      tearDownAll();
      // Small delay so ytInitialPlayerResponse / player settle after SPA nav
      window.setTimeout(() => {
        void boot();
      }, 400);
    }
  };
  setInterval(check, 800);
  window.addEventListener('yt-navigate-finish', check as EventListener);
  window.addEventListener('yt-page-data-updated', check as EventListener);
}

function onPageCuesUpdated(cues: SubtitleCue[]): void {
  pageCues = cues;
  pageCueList?.setCues(cues);
  pageVocabRecap?.setCues(cues);
  controller?.onMainCuesReloaded?.(cues);
  void refreshPageRecapBadge();
}

function ensureHotkeys(): void {
  if (hotkeysBound) return;
  hotkeysBound = true;
  window.addEventListener('ueh:page-cues-updated', (e) => {
    const cues = (e as CustomEvent<{ cues: SubtitleCue[] }>).detail?.cues;
    if (cues?.length) onPageCuesUpdated(cues);
  });
  window.addEventListener('keydown', (e) => {
    if (siteDisabled) return;
    if (e.altKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
      e.preventDefault();
      void ensureController().then((c) => c.openWithUserGesture());
    }
    if (e.altKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
      e.preventDefault();
      togglePageCueList();
    }
  });
  window.addEventListener('ueh:open-pip', () => {
    if (siteDisabled) return;
    void ensureController().then((c) => c.openWithUserGesture());
  });
  window.addEventListener('ueh:toggle-cue-list', () => {
    if (siteDisabled) return;
    togglePageCueList();
  });
  window.addEventListener('ueh:toggle-vocab-recap', () => {
    if (siteDisabled) return;
    togglePageVocabRecap();
  });
}

function main(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isEnvelope(message)) return false;

    if (message.type === 'content.openPip') {
      void (async () => {
        try {
          if (siteDisabled) {
            sendResponse({
              ok: false,
              error: {
                code: 'SITE_DISABLED',
                message: 'Extension disabled on this site',
              },
            });
            return;
          }
          const c = await ensureController();
          const result = await c.open();
          sendResponse(result);
        } catch (err) {
          sendResponse({
            ok: false,
            error: {
              code: 'PIP_OPEN_FAILED',
              message: err instanceof Error ? err.message : String(err),
            },
          });
        }
      })();
      return true;
    }

    if (message.type === 'content.captureLive') {
      const sessionId = (message.payload as { sessionId: string }).sessionId;
      void ensureController().then((c) => {
        c.setCaptureLive(sessionId);
        sendResponse(ok({}));
      });
      return true;
    }

    if (message.type === 'content.captureStop') {
      controller?.setCaptureIdle();
      sendResponse(ok({}));
      return true;
    }

    return false;
  });

  void boot().catch((err) => {
    console.warn('[UEH] content boot failed', err);
  });
}

export type ContentResult = Result<unknown>;
void fail;
