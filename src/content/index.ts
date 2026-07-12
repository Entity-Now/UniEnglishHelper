import { isEnvelope, ok, fail, type Result } from '../shared/messages';
import { sendRuntime } from '../shared/messaging/client';
import type { AppConfig, SubtitleCue } from '../shared/domain/types';
import { DEFAULT_APP_CONFIG } from '../shared/domain/types';
import { createPlayerAdapter } from './players';
import { PipSessionController } from './pip-session';
import { isYoutubeHost } from './players/youtube';
import { PlayerChromeButton } from './player-chrome-button';
import { SelectionToolbar } from './selection-toolbar';
import { PageSubtitlesOverlay } from './page-subtitles';
import { CueListSidebar } from './cue-list-sidebar';
import { showWordExplainPopup } from './word-explain-popup';
import { CONFIG_STORAGE_KEY } from '../shared/constants';
import { isSiteEnabled } from '../utils/site-control';

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
let pageCues: SubtitleCue[] = [];
let activeCueId = '';
let cueTick = 0;
let storageListening = false;
let navObserving = false;
let hotkeysBound = false;
let siteDisabled = false;

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
  controller = null;
  if (cueTick) {
    cancelAnimationFrame(cueTick);
    cueTick = 0;
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
  if (isYoutubeHost()) ensureNavObserver();
  ensureHotkeys();
}

async function loadPageCues(retryCount = 5): Promise<void> {
  const isVideoPage = !isYoutubeHost() || location.pathname === '/watch';
  if (!isVideoPage) {
    pageCues = [];
    pageCueList?.setCues([]);
    return;
  }

  try {
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
      }
      if (pageSubs && !pageSubs.isRunning()) {
        void pageSubs.start();
      }
      return;
    }
  } catch (e) {
    console.warn('[UEH] load cues attempt failed', e);
  }

  if (retryCount > 0) {
    window.setTimeout(() => {
      void loadPageCues(retryCount - 1);
    }, 1500);
  }
}

export function getPageCues(): SubtitleCue[] {
  return pageCues;
}

function startPageCueTicker(): void {
  if (cueTick) cancelAnimationFrame(cueTick);
  const loop = () => {
    const video = createPlayerAdapter(config).findVideo();
    if (video && pageCues.length) {
      const t = Math.round(video.currentTime * 1000);
      const cue = pageCues.find((c) => t >= c.startMs && t < c.endMs);
      const id = cue?.id ?? '';
      if (id !== activeCueId) {
        activeCueId = id;
        pageCueList?.setActiveCueId(id || null);
      }
    }
    cueTick = requestAnimationFrame(loop);
  };
  cueTick = requestAnimationFrame(loop);
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
        void showWordExplainPopup(word, context, document, () => {
          if (pageSubs && pageSubs.isRunning()) {
            void pageSubs.refreshHighlights();
          }
        });
      }
    );
    pageCueList.setCues(pageCues);
  }
  pageCueList.toggle();
  if (pageCueList.isOpen()) {
    pageCueList.setActiveCueId(activeCueId || null);
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
      void boot();
    }
  };
  setInterval(check, 1000);
  window.addEventListener('yt-navigate-finish', check as EventListener);
}

function ensureHotkeys(): void {
  if (hotkeysBound) return;
  hotkeysBound = true;
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
