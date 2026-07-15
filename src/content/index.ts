import { isEnvelope, ok, fail, type Result } from '../shared/messages';
import { sendRuntime } from '../shared/messaging/client';
import type { AppConfig, SubtitleCue } from '../shared/domain/types';
import { DEFAULT_APP_CONFIG } from '../shared/domain/types';
import { createPlayerAdapter } from './players';
import { PipSessionController } from './pip-session';
import {
  clearPreloadedMainCues,
  extractYoutubeVideoId,
  isYoutubeHost,
  isYoutubeWatchLikePath,
  peekPreloadedMainCues,
  storePreloadedMainCues,
  YoutubeAdapter,
} from './players/youtube';
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
/** In-flight main-caption prefetch while an ad is playing */
let prefetchingDuringAd = false;
let lastPrefetchVideoId: string | null = null;
/** Full location.href last seen by the nav watcher */
let lastNavHref = '';
/** YouTube video id last seen (autoplay next may change v= without full remount) */
let lastNavVideoId: string | null = null;
/** Debounced navigation / video-switch handler */
let navHandleTimer = 0;
/** Serializes soft video-switch reloads */
let videoSwitching = false;
/** Bound main video element for emptied/loadstart monitoring */
let watchedMainVideo: HTMLVideoElement | null = null;
/** Bumps on video switch so in-flight loadPageCues retries are abandoned */
let cueLoadGeneration = 0;
const onMainVideoMediaReset = (): void => {
  scheduleYoutubeNavHandle('video-media-reset');
};

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
  // Close Document PiP cleanly (do not orphan an open window on SPA leave)
  const pip = controller;
  controller = null;
  if (pip) {
    void pip.close().catch(() => undefined);
  }
  pageCues = [];
  activeCueId = '';
  cueLoadGeneration += 1;
  if (cueTick) {
    cancelAnimationFrame(cueTick);
    cueTick = 0;
  }
  stopAdWatcher();
  lastAdPhase = 'none';
  // Keep media listeners only if element still valid; rebind on next boot
  if (watchedMainVideo) {
    watchedMainVideo.removeEventListener('emptied', onMainVideoMediaReset);
    watchedMainVideo.removeEventListener('loadstart', onMainVideoMediaReset);
    watchedMainVideo.removeEventListener(
      'loadedmetadata',
      onMainVideoMediaReset,
    );
    watchedMainVideo = null;
  }
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
    ensureMainVideoWatch();
    // Keep video-id cursor in sync after full boot / reboot
    lastNavHref = location.href;
    lastNavVideoId = extractYoutubeVideoId();
  }
  ensureHotkeys();
}

/**
 * Watch YouTube ad chrome:
 * - Ad starts → prefetch main-video captions in the background (no long pot wait)
 * - Ad ends → apply preloaded cues instantly; fall back to full reload if cold
 */
function ensureAdWatcher(): void {
  if (!isYoutubeHost() || adWatchTimer) return;
  lastAdPhase = detectYoutubeAdStatus().phase;
  // Already in an ad on boot (pre-roll) — warm captions immediately
  if (lastAdPhase !== 'none') {
    void prefetchMainCuesDuringAd();
  }
  adWatchTimer = window.setInterval(() => {
    const phase = detectYoutubeAdStatus().phase;
    const prev = lastAdPhase;
    lastAdPhase = phase;
    if (prev === 'none' && phase !== 'none') {
      void prefetchMainCuesDuringAd();
    } else if (prev !== 'none' && phase === 'none') {
      void reloadCuesAfterAd();
    } else if (phase !== 'none') {
      // Stay warm if video id changed mid-ad or first prefetch missed
      const vid = extractYoutubeVideoId();
      if (vid && !peekPreloadedMainCues(vid) && !prefetchingDuringAd) {
        void prefetchMainCuesDuringAd();
      }
    }
  }, 450);
}

function stopAdWatcher(): void {
  if (adWatchTimer) {
    clearInterval(adWatchTimer);
    adWatchTimer = 0;
  }
  prefetchingDuringAd = false;
}

/**
 * While an ad plays, fetch main-video timedtext via playerResponse track
 * baseUrl (no long pot wait). Result lands in shared preload cache.
 * Do not mount onto the overlay yet — ad timeline ≠ main cue times.
 */
async function prefetchMainCuesDuringAd(): Promise<void> {
  if (!isYoutubeHost() || siteDisabled || prefetchingDuringAd) return;
  const videoId = extractYoutubeVideoId();
  if (!videoId || !isYoutubeWatchLikePath()) return;

  // Already warm for this video
  if (peekPreloadedMainCues(videoId)?.length) return;
  if (
    pageCues.length &&
    pageCues[0]?.id?.startsWith(`${videoId}-`)
  ) {
    storePreloadedMainCues(videoId, pageCues, `${videoId}:page`);
    return;
  }

  prefetchingDuringAd = true;
  lastPrefetchVideoId = videoId;
  console.info('[UEH] prefetching main captions during ad', videoId);
  try {
    void sendRuntime('youtube.injectMain', {}, 'content');
    const adapter = createPlayerAdapter(config);
    // Do not clearPreload — we are filling it
    const cues = await adapter.getCues({ purpose: 'preload' });
    if (extractYoutubeVideoId() !== videoId) return;
    if (cues.length) {
      console.info('[UEH] main captions prefetched during ad', cues.length);
    } else {
      console.warn('[UEH] ad-time caption prefetch returned 0 cues');
    }
  } catch (e) {
    console.warn('[UEH] ad-time caption prefetch failed', e);
  } finally {
    prefetchingDuringAd = false;
  }
}

/** Push cues to page overlay, list, recap, and open PiP. */
function applyPageCues(cues: SubtitleCue[]): void {
  pageCues = cues;
  pageCueList?.setCues(cues);
  pageVocabRecap?.setCues(cues);
  if (cues.length) {
    if (pageSubs) {
      pageSubs.setCues(cues);
      if (!pageSubs.isRunning()) void pageSubs.start();
    } else if (shouldRunPageSubtitles(config)) {
      pageSubs = new PageSubtitlesOverlay(createPlayerAdapter(config), config);
      void pageSubs.start().then(() => pageSubs?.setCues(cues));
    }
    pageSubs?.drainTranslations();
    void refreshPageRecapBadge();
  }
  controller?.onMainCuesReloaded?.(cues);
}

async function reloadCuesAfterAd(): Promise<void> {
  if (reloadingAfterAd || siteDisabled) return;
  reloadingAfterAd = true;
  const videoId = extractYoutubeVideoId();
  console.info('[UEH] YouTube ad ended — applying main video captions');
  try {
    // Fast path: cues prefetched while the ad was playing
    const preloaded =
      videoId != null ? peekPreloadedMainCues(videoId) : null;
    if (videoId && preloaded?.length) {
      console.info(
        '[UEH] applying preloaded captions after ad',
        preloaded.length,
      );
      const adapter = createPlayerAdapter(config);
      if (adapter instanceof YoutubeAdapter) {
        adapter.adoptPreloaded(videoId);
      }
      applyPageCues(preloaded);
      // Optional quiet revalidate in background (does not block first paint)
      void revalidateCuesAfterAd(videoId);
      return;
    }

    // Cold path: wait briefly for main stream / pot, then full reload
    await new Promise((r) => setTimeout(r, 350));

    const adapter = createPlayerAdapter(config);
    adapter.clearCache?.();

    if (pageSubs?.isRunning()) {
      await pageSubs.forceReloadCues();
    }

    pageCues = [];
    await loadPageCues(8);
    controller?.onMainCuesReloaded?.(pageCues);
  } catch (e) {
    console.warn('[UEH] reload after ad failed', e);
  } finally {
    reloadingAfterAd = false;
  }
}

/**
 * After instant preload apply: optionally refresh with pot-enriched timedtext.
 * Only replaces UI if a richer/valid set returns for the same video.
 */
async function revalidateCuesAfterAd(videoId: string): Promise<void> {
  try {
    await new Promise((r) => setTimeout(r, 1200));
    if (extractYoutubeVideoId() !== videoId) return;
    if (detectYoutubeAdStatus().phase !== 'none') return;
    const adapter = createPlayerAdapter(config);
    // Soft refresh: re-fetch with pot; do not short-circuit on ad-time preload
    adapter.clearCache?.();
    const cues = await adapter.getCues({
      purpose: 'display',
      bypassPreload: true,
    });
    if (extractYoutubeVideoId() !== videoId) return;
    if (cues.length && cues.length >= (pageCues.length || 0) * 0.8) {
      applyPageCues(cues);
    }
  } catch {
    // keep preloaded set
  }
}

async function loadPageCues(
  retryCount = 10,
  generation?: number,
): Promise<void> {
  const gen = generation ?? cueLoadGeneration;
  // Abandoned after video switch / full reboot invalidated this attempt
  if (gen !== cueLoadGeneration) return;

  const isVideoPage = !isYoutubeHost() || isYoutubeWatchLikePath();
  if (!isVideoPage) {
    pageCues = [];
    pageCueList?.setCues([]);
    return;
  }

  const expectedVideoId = isYoutubeHost() ? extractYoutubeVideoId() : null;
  const inAd =
    isYoutubeHost() && detectYoutubeAdStatus().phase !== 'none';

  try {
    // Ensure MAIN interceptor early (captions / pot capture)
    if (isYoutubeHost()) {
      void sendRuntime('youtube.injectMain', {}, 'content');
    }

    // Ad playing: warm main captions into preload cache; do not paint on
    // overlay yet (ad currentTime ≠ main cue times). Ad-end applies them.
    if (inAd && expectedVideoId) {
      const pre = peekPreloadedMainCues(expectedVideoId);
      if (pre?.length) {
        console.info('[UEH] main captions already preloaded during ad', pre.length);
        return;
      }
      void prefetchMainCuesDuringAd();
      // Keep retrying lightly while ad runs so a late playerResponse still warms
      if (retryCount > 0 && gen === cueLoadGeneration) {
        window.setTimeout(() => {
          void loadPageCues(retryCount - 1, gen);
        }, 1500);
      }
      return;
    }

    const adapter = createPlayerAdapter(config);
    const video = adapter.findVideo();
    if (!video) {
      throw new Error('Video element not found yet');
    }
    // Prefer instant preload if ad just ended and cache is warm
    let cues: SubtitleCue[] = [];
    if (expectedVideoId && adapter instanceof YoutubeAdapter) {
      const adopted = adapter.adoptPreloaded(expectedVideoId);
      if (adopted?.length) cues = adopted;
    }
    if (!cues.length) {
      cues = await adapter.getCues({ purpose: 'display' });
    }
    if (gen !== cueLoadGeneration) return;
    // Reject cues if SPA already moved to another video mid-fetch
    if (
      expectedVideoId &&
      extractYoutubeVideoId() &&
      extractYoutubeVideoId() !== expectedVideoId
    ) {
      return;
    }
    if (cues.length && expectedVideoId) {
      storePreloadedMainCues(
        expectedVideoId,
        cues,
        `${expectedVideoId}:loaded`,
      );
    }
    applyPageCues(cues);
    if (pageCues.length > 0) {
      console.info('[UEH] page cues ready', pageCues.length, expectedVideoId);
      return;
    }
  } catch (e) {
    if (gen !== cueLoadGeneration) return;
    console.warn('[UEH] load cues attempt failed', e);
  }

  if (retryCount > 0 && gen === cueLoadGeneration) {
    window.setTimeout(() => {
      void loadPageCues(retryCount - 1, gen);
    }, 1200);
  } else if (retryCount <= 0) {
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

/**
 * Watch YouTube SPA navigation + autoplay-next.
 *
 * Full `location.href` alone is not enough: continuous play / playlist next
 * changes `v=` (and fires media reset on the same <video>) while staying on
 * /watch. We track video id separately and soft-reload captions without
 * tearing down the whole UI when only the video changes.
 */
function ensureNavObserver(): void {
  if (navObserving) return;
  navObserving = true;
  lastNavHref = location.href;
  lastNavVideoId = extractYoutubeVideoId();

  const poll = () => {
    const href = location.href;
    const videoId = extractYoutubeVideoId();
    if (href === lastNavHref && videoId === lastNavVideoId) return;
    scheduleYoutubeNavHandle('poll');
  };

  // Faster than before so autoplay-next is caught promptly
  setInterval(poll, 500);
  window.addEventListener('yt-navigate-start', () =>
    scheduleYoutubeNavHandle('yt-navigate-start'),
  );
  window.addEventListener('yt-navigate-finish', () =>
    scheduleYoutubeNavHandle('yt-navigate-finish'),
  );
  window.addEventListener('yt-page-data-updated', () =>
    scheduleYoutubeNavHandle('yt-page-data-updated'),
  );
  window.addEventListener('popstate', () =>
    scheduleYoutubeNavHandle('popstate'),
  );

  ensureMainVideoWatch();
}

function scheduleYoutubeNavHandle(reason: string): void {
  if (navHandleTimer) window.clearTimeout(navHandleTimer);
  // Debounce rapid SPA events (navigate-start → page-data → navigate-finish)
  navHandleTimer = window.setTimeout(() => {
    navHandleTimer = 0;
    void handleYoutubeNavigation(reason);
  }, 280);
}

function wasWatchPath(href: string): boolean {
  try {
    return isYoutubeWatchLikePath(new URL(href).pathname);
  } catch {
    return false;
  }
}

async function handleYoutubeNavigation(reason: string): Promise<void> {
  if (!isYoutubeHost()) return;

  const href = location.href;
  const videoId = extractYoutubeVideoId();
  const prevHref = lastNavHref;
  const prevVideoId = lastNavVideoId;

  // Nothing meaningful changed
  if (href === prevHref && videoId === prevVideoId) {
    ensureMainVideoWatch();
    return;
  }

  const stillWatch = isYoutubeWatchLikePath();
  const wasWatch = wasWatchPath(prevHref || href);
  const videoChanged = Boolean(videoId && videoId !== prevVideoId);
  const leftOrEnteredWatch = wasWatch !== stillWatch;

  if (siteDisabled) {
    lastNavHref = href;
    lastNavVideoId = videoId;
    ensureMainVideoWatch();
    return;
  }

  // Same video, only secondary query params (t=, index, …) — keep UI, rebind video
  if (!videoChanged && !leftOrEnteredWatch && stillWatch) {
    lastNavHref = href;
    ensureMainVideoWatch();
    return;
  }

  // Leave/enter watch-like surface, or leave YouTube watch entirely → full reboot
  if (leftOrEnteredWatch || !stillWatch) {
    lastNavHref = href;
    lastNavVideoId = videoId;
    console.info('[UEH] YouTube nav full reboot', { reason, href, videoId });
    tearDownAll();
    window.setTimeout(() => {
      void boot();
    }, 450);
    return;
  }

  // Still on a watch-like page but video id changed (autoplay next / playlist)
  if (videoChanged && stillWatch && videoId) {
    // Commit cursor to the target id so polls for the same id don't pile up.
    // If a newer id appears mid-flight, handleYoutubeVideoSwitch re-schedules.
    lastNavHref = href;
    lastNavVideoId = videoId;
    await handleYoutubeVideoSwitch(videoId, prevVideoId, reason);
    return;
  }

  lastNavHref = href;
  lastNavVideoId = videoId;
  ensureMainVideoWatch();
}

/**
 * Soft-switch captions when YouTube loads the next video on the same page.
 * Clears stale cues first so previous-episode lines never stick.
 */
async function handleYoutubeVideoSwitch(
  videoId: string,
  prevVideoId: string | null,
  reason: string,
): Promise<void> {
  if (videoSwitching) {
    // Another switch is in flight — re-check after it settles so we don't
    // lose a B→C transition that arrived while loading B.
    window.setTimeout(() => {
      const latest = extractYoutubeVideoId();
      if (latest && latest !== lastNavVideoId) {
        scheduleYoutubeNavHandle('video-switch-retry');
      } else if (latest && latest === lastNavVideoId) {
        // Cursor already points at latest; force a follow-up load if cues empty
        // or still from a previous id (cues prefix is videoId-).
        const cuePrefix = pageCues[0]?.id?.split('-')[0];
        if (!pageCues.length || (cuePrefix && cuePrefix !== latest)) {
          lastNavVideoId = null;
          scheduleYoutubeNavHandle('video-switch-retry-force');
        }
      }
    }, 700);
    return;
  }
  videoSwitching = true;
  // Invalidate in-flight loadPageCues retries from the previous video
  const loadGen = ++cueLoadGeneration;
  // Drop previous video's preloaded captions
  if (prevVideoId) clearPreloadedMainCues(prevVideoId);
  lastPrefetchVideoId = null;
  console.info('[UEH] YouTube video switched — reloading captions', {
    from: prevVideoId,
    to: videoId,
    reason,
  });

  try {
    // Drop stale state immediately (page + open PiP)
    pageCues = [];
    activeCueId = '';
    pageCueList?.setCues([]);
    pageVocabRecap?.setCues([]);
    controller?.onMainVideoSwitching?.();

    void sendRuntime('youtube.injectMain', {}, 'content');

    const adapter = createPlayerAdapter(config);
    adapter.clearCache?.();

    // Next episode often starts with a pre-roll — prefetch during ad
    if (detectYoutubeAdStatus().phase !== 'none') {
      void prefetchMainCuesDuringAd();
    }

    // Prefer overlay path (keeps its adapter cache + UI in sync)
    if (pageSubs?.isRunning()) {
      pageSubs.setCues([]);
      if (detectYoutubeAdStatus().phase === 'none') {
        await pageSubs.forceReloadCues();
      }
    } else if (
      shouldRunPageSubtitles(config) &&
      detectYoutubeAdStatus().phase === 'none'
    ) {
      // Overlay may have been stopped; recreate for the new video
      pageSubs = new PageSubtitlesOverlay(adapter, config);
      await pageSubs.start();
    }

    if (loadGen !== cueLoadGeneration) return;

    // Shared page cues + PiP / sidebar (extra retries for SPA player settle)
    pageCues = [];
    await loadPageCues(12, loadGen);
    if (loadGen !== cueLoadGeneration) return;

    if (pageCues.length) {
      controller?.onMainCuesReloaded?.(pageCues);
    } else if (detectYoutubeAdStatus().phase !== 'none') {
      // Still in ad — PiP stays empty until ad-end applies preload
      controller?.onMainVideoSwitching?.();
    } else {
      // Page path empty — PiP self-fetches so an open learning window still updates
      void controller?.reloadCuesForCurrentVideo?.({
        toastOnSuccess: '已加载下一集字幕',
        retries: 8,
      });
    }
    void refreshPageRecapBadge();
    ensureMainVideoWatch();
    ensureAdWatcher();
  } catch (e) {
    console.warn('[UEH] video switch caption reload failed', e);
    // Fallback: full reboot if soft path fails hard
    tearDownAll();
    window.setTimeout(() => {
      void boot();
    }, 500);
  } finally {
    videoSwitching = false;
    // If the user/autoplay moved on while we were loading, catch up
    const latest = extractYoutubeVideoId();
    if (latest && latest !== videoId) {
      lastNavVideoId = videoId;
      scheduleYoutubeNavHandle('video-switch-followup');
    }
  }
}

/**
 * Bind emptied/loadstart/loadedmetadata on the main <video>.
 * Autoplay-next reuses the element; media reset often arrives before or with URL update.
 */
function ensureMainVideoWatch(): void {
  if (!isYoutubeHost()) return;
  const video = createPlayerAdapter(config).findVideo();
  if (!video) return;
  if (watchedMainVideo === video) return;

  if (watchedMainVideo) {
    watchedMainVideo.removeEventListener('emptied', onMainVideoMediaReset);
    watchedMainVideo.removeEventListener('loadstart', onMainVideoMediaReset);
    watchedMainVideo.removeEventListener(
      'loadedmetadata',
      onMainVideoMediaReset,
    );
  }

  watchedMainVideo = video;
  video.addEventListener('emptied', onMainVideoMediaReset);
  video.addEventListener('loadstart', onMainVideoMediaReset);
  video.addEventListener('loadedmetadata', onMainVideoMediaReset);
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
