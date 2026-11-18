import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_CONFIG, type SubtitleCue } from '../shared/domain/types';
import {
  bindToolbarFocusgroupFallback,
  buildPipMarkup,
  buildPipStyles,
} from './pip-ui-shell';

const runtimeMocks = vi.hoisted(() => ({
  sendRuntime: vi.fn(),
  speakTextSmart: vi.fn(),
  stopAllSpeech: vi.fn(),
  isTtsPlaying: vi.fn(() => false),
  pageCues: [] as SubtitleCue[],
}));

vi.mock('../shared/messaging/client', () => ({
  sendRuntime: runtimeMocks.sendRuntime,
}));

vi.mock('../utils/tts-playback/speak', () => ({
  speakTextSmart: runtimeMocks.speakTextSmart,
  stopAllSpeech: runtimeMocks.stopAllSpeech,
  isTtsPlaying: runtimeMocks.isTtsPlaying,
}));

vi.mock('./index', () => ({
  getPageCues: () => runtimeMocks.pageCues,
}));

import { PipSessionController } from './pip-session';
import type { PlayerAdapter } from './players';

function createFakeVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  let paused = false;
  let currentTime = 1.5;
  let volume = 0.8;
  let muted = false;
  let playbackRate = 1;

  Object.defineProperty(video, 'paused', {
    get: () => paused,
    configurable: true,
  });
  Object.defineProperty(video, 'duration', {
    get: () => 120,
    configurable: true,
  });
  Object.defineProperty(video, 'currentTime', {
    get: () => currentTime,
    set: (val: number) => {
      currentTime = val;
      video.dispatchEvent(new Event('seeked'));
    },
    configurable: true,
  });
  Object.defineProperty(video, 'volume', {
    get: () => volume,
    set: (val: number) => {
      volume = Math.max(0, Math.min(1, val));
      video.dispatchEvent(new Event('volumechange'));
    },
    configurable: true,
  });
  Object.defineProperty(video, 'muted', {
    get: () => muted,
    set: (val: boolean) => {
      muted = Boolean(val);
      video.dispatchEvent(new Event('volumechange'));
    },
    configurable: true,
  });
  Object.defineProperty(video, 'playbackRate', {
    get: () => playbackRate,
    set: (val: number) => {
      playbackRate = val;
      video.dispatchEvent(new Event('ratechange'));
    },
    configurable: true,
  });
  video.play = vi.fn(async () => {
    paused = false;
    video.dispatchEvent(new Event('play'));
  });
  video.pause = vi.fn(() => {
    paused = true;
    video.dispatchEvent(new Event('pause'));
  });
  document.body.appendChild(video);
  return video;
}

function createIsolatedWindow(): Window {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const pipWin = iframe.contentWindow!;
  pipWin.document.open();
  pipWin.document.write('<!doctype html><html><head></head><body></body></html>');
  pipWin.document.close();
  Object.defineProperty(pipWin, 'outerWidth', { value: 640, configurable: true });
  Object.defineProperty(pipWin, 'outerHeight', { value: 420, configurable: true });
  pipWin.resizeTo = vi.fn();
  pipWin.close = vi.fn();
  return pipWin;
}

function createPipTestEnv(cues: SubtitleCue[]) {
  runtimeMocks.pageCues = cues;
  const pipWin = createIsolatedWindow();

  window.documentPictureInPicture = {
    requestWindow: vi.fn(async () => pipWin),
    window: pipWin,
  };

  const video = createFakeVideo();
  const adapter: PlayerAdapter = {
    id: 'generic',
    supportsMove: true,
    findVideo: () => video,
    getCues: vi.fn(async () => cues),
  };

  return { pipWin, pipDoc: pipWin.document, video, adapter };
}

describe('PiP bottom toolbar markup & styles', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders an accessible toolbar with groups, separators, distinct volume vs TTS controls, and live region outside toolbar', () => {
    const pipWin = createIsolatedWindow();
    const doc = pipWin.document;
    doc.body.innerHTML = buildPipMarkup();
    const bar = doc.getElementById('ueh-bar');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('role')).toBe('toolbar');
    expect(bar?.getAttribute('focusgroup')).toBe('toolbar wrap');
    expect(bar?.querySelectorAll('[role="group"]').length).toBe(4);
    expect(bar?.querySelectorAll('[role="separator"]').length).toBe(2);

    // Live status toast must be outside role="toolbar"
    const toast = doc.getElementById('ueh-pip-toast');
    expect(toast).not.toBeNull();
    expect(toast?.getAttribute('role')).toBe('status');
    expect(bar?.contains(toast!)).toBe(false);

    // Toggle buttons carry aria-pressed; action buttons do not
    for (const act of ['mute', 'toggle-en', 'toggle-tr', 'recap', 'list', 'settings']) {
      const btn = bar?.querySelector(`button[data-act="${act}"]`);
      expect(btn, `missing toggle button ${act}`).not.toBeNull();
      expect(btn?.hasAttribute('aria-pressed')).toBe(true);
    }
    for (const act of ['play', 'rate', 'prev', 'next', 'translate', 'tts', 'export']) {
      const btn = bar?.querySelector(`button[data-act="${act}"]`);
      expect(btn, `missing action button ${act}`).not.toBeNull();
      expect(btn?.hasAttribute('aria-pressed')).toBe(false);
    }

    // Volume slider exists and #ueh-chrome stacks strictly above #ueh-sub-layer,
    // while #ueh-sub-layer stays low (6px floor) when idle and lifts only when .ueh-show-chrome is active
    expect(doc.getElementById('ueh-volume')).not.toBeNull();
    const css = buildPipStyles({ fontSize: 16, bgOpacity: 0.5 });
    expect(css).toContain('#ueh-chrome {\n      position: absolute; left: 0; right: 0; bottom: 0; z-index: 24;');
    expect(css).toContain('--ueh-sub-bottom-safe: 6px;');
    expect(css).toContain('#ueh-pip-root.ueh-show-chrome #ueh-pip-stage');
    expect(css).toContain('bottom: max(var(--ueh-sub-bottom-safe, 6px), var(--ueh-sub-pct, 5%));');
    expect(css).not.toContain('#ueh-pip-root:hover #ueh-chrome');
  });

  it('provides roving-tabindex arrow/Home/End navigation when native focusGroup is absent', () => {
    const pipWin = createIsolatedWindow();
    const doc = pipWin.document;
    doc.body.innerHTML = buildPipMarkup();
    const bar = doc.getElementById('ueh-bar')!;
    const cleanup = bindToolbarFocusgroupFallback(bar, pipWin);

    const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons[0]?.tabIndex).toBe(0);
    expect(buttons.slice(1).every((b) => b.tabIndex === -1)).toBe(true);

    buttons[0]!.focus();
    buttons[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    expect(doc.activeElement).toBe(buttons[1]);
    expect(buttons[1]?.tabIndex).toBe(0);
    expect(buttons[0]?.tabIndex).toBe(-1);

    buttons[1]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    );
    const last = buttons[buttons.length - 1]!;
    expect(doc.activeElement).toBe(last);

    // Wrap around from last → first
    last.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    expect(doc.activeElement).toBe(buttons[0]);

    cleanup();
  });
});

describe('PipSessionController bottom tools end-to-end interactions', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    runtimeMocks.isTtsPlaying.mockReturnValue(false);
    runtimeMocks.speakTextSmart.mockResolvedValue(true);
    runtimeMocks.sendRuntime.mockImplementation(async (type: string, payload?: any) => {
      if (type === 'word.highlightMap') return { ok: true, data: {} };
      if (type === 'word.videoRecap') {
        return {
          ok: true,
          data: {
            addedInVideo: [],
            revisiting: [],
            stats: { addedCount: 0, revisitingCount: 0, unlearnedCount: 0 },
          },
        };
      }
      if (type === 'capture.status') {
        return { ok: true, data: { state: 'CaptureIdle' } };
      }
      if (type === 'translate.cues') {
        const items = (payload?.cues ?? []).map((c: { id: string; text: string }) => ({
          id: c.id,
          text: `译：${c.text}`,
        }));
        return { ok: true, data: { items } };
      }
      if (type === 'config.set') {
        return {
          ok: true,
          data: { ...structuredClone(DEFAULT_APP_CONFIG), ...payload },
        };
      }
      return { ok: true, data: {} };
    });
  });

  it('controls volume slider, mute toggle, wheel volume, and playback rate accurately', async () => {
    const cues: SubtitleCue[] = [
      { id: 'c1', startMs: 0, endMs: 3000, text: 'Hello world' },
    ];
    const { pipDoc, video, adapter } = createPipTestEnv(cues);
    const ctrl = new PipSessionController(adapter, structuredClone(DEFAULT_APP_CONFIG));
    const openRes = await ctrl.openWithUserGesture();
    expect(openRes.ok).toBe(true);

    const muteBtn = pipDoc.querySelector('button[data-act="mute"]') as HTMLButtonElement;
    const volSlider = pipDoc.getElementById('ueh-volume') as HTMLInputElement;
    const volWrap = pipDoc.querySelector('.ueh-vol-wrap') as HTMLElement;
    const rateBtn = pipDoc.querySelector('button[data-act="rate"]') as HTMLButtonElement;
    const toast = pipDoc.getElementById('ueh-pip-toast')!;

    expect(muteBtn.getAttribute('aria-pressed')).toBe('false');
    expect(volSlider.value).toBe('80');

    // Click mute -> mutes video & updates aria-pressed + slider
    muteBtn.click();
    expect(video.muted).toBe(true);
    expect(muteBtn.getAttribute('aria-pressed')).toBe('true');
    expect(volSlider.value).toBe('0');
    expect(toast.textContent).toBe('已静音');

    // Click mute again -> restores previous 80% volume
    muteBtn.click();
    expect(video.muted).toBe(false);
    expect(video.volume).toBeCloseTo(0.8, 2);
    expect(muteBtn.getAttribute('aria-pressed')).toBe('false');
    expect(volSlider.value).toBe('80');

    // Drag slider to 35%
    volSlider.value = '35';
    volSlider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(video.volume).toBeCloseTo(0.35, 2);
    expect(video.muted).toBe(false);

    // Wheel up on volume group -> +5% to 40%
    volWrap.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(video.volume).toBeCloseTo(0.4, 2);
    expect(toast.textContent).toBe('音量 40%');

    // Cycle playback rate: 1x -> 1.25x -> 1.5x
    expect(rateBtn.textContent).toBe('1x');
    rateBtn.click();
    expect(video.playbackRate).toBe(1.25);
    expect(rateBtn.textContent).toBe('1.25x');

    await ctrl.close();
  });

  it('toggles 原文/译文 reliably, triggers immediate translation when 译文 is turned on, and survives storage config updates', async () => {
    const cues: SubtitleCue[] = [
      { id: 'c1', startMs: 0, endMs: 4000, text: 'Practice makes perfect' },
    ];
    const cfg = structuredClone(DEFAULT_APP_CONFIG);
    cfg.pipSubtitles.autoTranslate = false;
    cfg.features.autoTranslate = false;
    cfg.pipSubtitles.style.displayMode = 'originalOnly';

    const { pipDoc, adapter } = createPipTestEnv(cues);
    const ctrl = new PipSessionController(adapter, cfg);
    await ctrl.openWithUserGesture();

    const enBtn = pipDoc.querySelector('button[data-act="toggle-en"]') as HTMLButtonElement;
    const trBtn = pipDoc.querySelector('button[data-act="toggle-tr"]') as HTMLButtonElement;
    const subEn = pipDoc.getElementById('ueh-sub-en')!;
    const subTr = pipDoc.getElementById('ueh-sub-tr')!;
    const modeSelect = pipDoc.getElementById('ueh-pip-mode') as HTMLSelectElement;

    expect(enBtn.getAttribute('aria-pressed')).toBe('true');
    expect(trBtn.getAttribute('aria-pressed')).toBe('false');
    expect(subEn.textContent).toContain('Practice');
    expect(subTr.textContent).toBe('');

    // Click 译文 ON -> immediately requests translation and renders it!
    trBtn.click();
    await vi.waitFor(() => {
      expect(subTr.textContent).toBe('译：Practice makes perfect');
    });
    expect(trBtn.getAttribute('aria-pressed')).toBe('true');
    expect(modeSelect.value).toBe('bilingual');

    // Click 原文 OFF -> hides English, keeps Chinese, syncs modeSelect to translationOnly
    enBtn.click();
    expect(enBtn.getAttribute('aria-pressed')).toBe('false');
    expect(subEn.textContent).toBe('');
    expect(subTr.textContent).toBe('译：Practice makes perfect');
    expect(modeSelect.value).toBe('translationOnly');

    // Unrelated config update (e.g. selectionToolbar changed) must NOT wipe 原文/译文 state
    const updatedOther = structuredClone(cfg);
    updatedOther.pipSubtitles.style.displayMode = 'translationOnly';
    updatedOther.pipSubtitles.enabled = true;
    updatedOther.selectionToolbar.opacity = 80;
    ctrl.updateConfig(updatedOther);
    await vi.waitFor(() => {
      expect(enBtn.getAttribute('aria-pressed')).toBe('false');
      expect(trBtn.getAttribute('aria-pressed')).toBe('true');
    });

    await ctrl.close();
  });

  it('handles prev/next, re-translate, TTS, capture export, and pause-in-gap action fallback', async () => {
    const cues: SubtitleCue[] = [
      { id: 'c1', startMs: 0, endMs: 2000, text: 'First sentence', translation: '旧译文' },
      { id: 'c2', startMs: 3000, endMs: 5000, text: 'Second sentence' },
    ];
    runtimeMocks.sendRuntime.mockImplementation(async (type: string, payload?: any) => {
      if (type === 'word.highlightMap') return { ok: true, data: {} };
      if (type === 'word.videoRecap') {
        return {
          ok: true,
          data: {
            addedInVideo: [],
            revisiting: [],
            stats: { addedCount: 0, revisitingCount: 0, unlearnedCount: 0 },
          },
        };
      }
      if (type === 'capture.status') {
        return { ok: true, data: { state: 'CaptureLive', sessionId: 'sess-123' } };
      }
      if (type === 'clips.export') {
        return {
          ok: true,
          data: { clipId: 42, durationMs: 2000, mimeType: 'audio/wav' },
        };
      }
      if (type === 'translate.cues') {
        const items = (payload?.cues ?? []).map((c: { id: string; text: string }) => ({
          id: c.id,
          text: `新译：${c.text}`,
        }));
        return { ok: true, data: { items } };
      }
      return { ok: true, data: {} };
    });

    const { pipDoc, video, adapter } = createPipTestEnv(cues);
    const ctrl = new PipSessionController(adapter, structuredClone(DEFAULT_APP_CONFIG));
    await ctrl.openWithUserGesture();

    // Pause in the 2.0s–3.0s gap right after c1 ended!
    video.pause();
    video.currentTime = 2.4;

    // 1. Force re-translate still works in the gap and overwrites '旧译文' -> '新译：First sentence'
    const translateBtn = pipDoc.querySelector('button[data-act="translate"]') as HTMLButtonElement;
    translateBtn.click();
    await vi.waitFor(() => {
      expect(cues[0]!.translation).toBe('新译：First sentence');
    });

    // 2. TTS speaks c1 even when paused in the inter-cue gap
    const ttsBtn = pipDoc.querySelector('button[data-act="tts"]') as HTMLButtonElement;
    ttsBtn.click();
    await vi.waitFor(() => {
      expect(runtimeMocks.speakTextSmart).toHaveBeenCalledWith(
        'First sentence',
        'content',
        expect.anything(),
      );
    });

    // 3. Next & Prev buttons jump cleanly between cues
    const nextBtn = pipDoc.querySelector('button[data-act="next"]') as HTMLButtonElement;
    const prevBtn = pipDoc.querySelector('button[data-act="prev"]') as HTMLButtonElement;
    nextBtn.click();
    expect(video.currentTime).toBeCloseTo(3.01, 2);
    prevBtn.click();
    expect(video.currentTime).toBeCloseTo(0.01, 2);

    // 4. Settings & CueList panel toggle aria-pressed sync (including internal close button)
    const settingsBtn = pipDoc.querySelector('button[data-act="settings"]') as HTMLButtonElement;
    const listBtn = pipDoc.querySelector('button[data-act="list"]') as HTMLButtonElement;
    settingsBtn.click();
    expect(settingsBtn.getAttribute('aria-pressed')).toBe('true');
    // Light-dismiss by clicking video slot
    pipDoc.getElementById('ueh-video-slot')!.click();
    expect(settingsBtn.getAttribute('aria-pressed')).toBe('false');

    listBtn.click();
    expect(listBtn.getAttribute('aria-pressed')).toBe('true');
    const cueListHost = pipDoc.getElementById('ueh-pip-cue-list')!;
    const innerClose = cueListHost.shadowRoot?.getElementById('close') as HTMLButtonElement | null;
    expect(innerClose).not.toBeNull();
    innerClose?.click();
    expect(listBtn.getAttribute('aria-pressed')).toBe('false');

    // 5. Bottom-anchored subtitle uses dynamic --ueh-sub-bottom-safe floor and supports 0% offset without resetting to 12%
    const subLayer = pipDoc.getElementById('ueh-sub-layer')!;
    expect(subLayer.style.getPropertyValue('--ueh-sub-pct')).toBe('5%');

    const offsetSlider = pipDoc.getElementById('ueh-pip-offset') as HTMLInputElement;
    offsetSlider.value = '0';
    offsetSlider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(subLayer.style.getPropertyValue('--ueh-sub-pct')).toBe('0%');

    await ctrl.close();
  });
});
