// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_CONFIG } from '../shared/domain/types';

const sendRuntimeMock = vi.fn();

vi.mock('../shared/messaging/client', () => ({
  sendRuntime: (...args: unknown[]) => sendRuntimeMock(...args),
}));

vi.mock('../utils/tts-playback/speak', () => ({
  speakTextSmart: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./stream-client', () => ({
  streamWordExplain: vi.fn(),
}));

import { SelectionToolbar } from './selection-toolbar';

function mockSelection(text: string, rect = { left: 120, bottom: 160, width: 80, height: 18, top: 142, right: 200 }) {
  const domRect = {
    ...rect,
    x: rect.left,
    y: rect.top,
    toJSON: () => rect,
  } as DOMRect;
  const fakeRange = {
    getClientRects: () => [domRect],
    getBoundingClientRect: () => domRect,
    cloneRange: () => ({
      collapse: () => {},
      getBoundingClientRect: () => domRect,
    }),
  };
  vi.spyOn(window, 'getSelection').mockReturnValue({
    toString: () => text,
    rangeCount: text ? 1 : 0,
    getRangeAt: () => fakeRange,
  } as unknown as Selection);
}

describe('SelectionToolbar UX enhancements', () => {
  let toolbar: SelectionToolbar;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<p id="outside">Hello world</p>';
    sendRuntimeMock.mockReset();
    sendRuntimeMock.mockImplementation(async (type: string, payload: Record<string, unknown>) => {
      if (type === 'skill.list') {
        return { ok: true, data: [] };
      }
      if (type === 'translate.cues') {
        const cues = payload.cues as Array<{ id: string; text: string }>;
        return {
          ok: true,
          data: {
            items: cues.map((c) => ({ id: c.id, text: `译:${c.text}` })),
          },
        };
      }
      return { ok: true, data: {} };
    });

    toolbar = new SelectionToolbar(structuredClone(DEFAULT_APP_CONFIG));
    toolbar.start();
  });

  afterEach(() => {
    toolbar.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function openWithSelection(text: string) {
    mockSelection(text);
    const p = document.getElementById('outside')!;
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();
    const host = document.getElementById('ueh-selection-host')!;
    return { host, shadow: host.shadowRoot! };
  }

  it('auto-dismisses when unpinned and clicking outside, but stays open when pinned', async () => {
    const { shadow } = await openWithSelection('hello');
    const wrap = shadow.getElementById('wrap') as HTMLElement;
    expect(wrap.style.display).toBe('flex');

    // Click pin button
    const pinBtn = shadow.querySelector('.ueh-ibtn.pin') as HTMLButtonElement;
    expect(pinBtn).toBeTruthy();
    expect(pinBtn.getAttribute('aria-pressed')).toBe('false');
    pinBtn.click();
    expect(pinBtn.getAttribute('aria-pressed')).toBe('true');
    expect(wrap.classList.contains('pinned')).toBe(true);

    // Click outside while pinned -> window MUST stay visible
    mockSelection('');
    const outside = document.getElementById('outside')!;
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    outside.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(20);
    expect(wrap.style.display).toBe('flex');

    // Escape while pinned -> stays visible
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(wrap.style.display).toBe('flex');

    // Unpin -> clicking outside now auto-dismisses immediately
    pinBtn.click();
    expect(pinBtn.getAttribute('aria-pressed')).toBe('false');
    expect(wrap.classList.contains('pinned')).toBe(false);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(wrap.style.display).toBe('none');
  });

  it('keeps pinned position and auto-refreshes open panel when selecting new text', async () => {
    const { shadow } = await openWithSelection('apple');
    const wrap = shadow.getElementById('wrap') as HTMLElement;
    const translateBtn = shadow.querySelector('[data-mode="translate"]') as HTMLButtonElement;
    translateBtn.click();
    await vi.advanceTimersByTimeAsync(20);

    const panel = shadow.getElementById('panel') as HTMLElement;
    expect(panel.classList.contains('open')).toBe(true);
    expect(panel.textContent).toContain('译:apple');

    // Pin the window
    const pinBtn = shadow.querySelector('.ueh-ibtn.pin') as HTMLButtonElement;
    pinBtn.click();
    const pinnedLeft = wrap.style.left;
    const pinnedTop = wrap.style.top;

    // Select a different word elsewhere on the page
    mockSelection('banana', { left: 400, bottom: 500, width: 60, height: 18, top: 482, right: 460 });
    const outside = document.getElementById('outside')!;
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    outside.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(30);

    // Position stays anchored and translation refreshes to new selection
    expect(wrap.style.display).toBe('flex');
    expect(wrap.style.left).toBe(pinnedLeft);
    expect(wrap.style.top).toBe(pinnedTop);
    expect(panel.textContent).toContain('译:banana');

    // Explicit Close button closes even when pinned
    const closeBtn = shadow.querySelector('.ueh-ibtn.close') as HTMLButtonElement;
    closeBtn.click();
    expect(wrap.style.display).toBe('none');
  });

  it('supports dragging via grip handle and panel copy/retry/long-text collapse', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const longText = 'A'.repeat(160);
    const { shadow } = await openWithSelection(longText);
    const wrap = shadow.getElementById('wrap') as HTMLElement;

    // Drag via grip handle
    const grip = shadow.querySelector('.drag-handle') as HTMLElement;
    expect(grip).toBeTruthy();
    vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 100,
      width: 200,
      height: 36,
      right: 300,
      bottom: 136,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);

    grip.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 110, clientY: 110, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 190, clientY: 160, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(wrap.style.left).toBe('180px');
    expect(wrap.style.top).toBe('150px');

    // Open translate panel -> verify long orig collapse, copy, and retry
    const translateBtn = shadow.querySelector('[data-mode="translate"]') as HTMLButtonElement;
    translateBtn.click();
    await vi.advanceTimersByTimeAsync(20);

    const origEl = shadow.querySelector('.panel .orig') as HTMLElement;
    const toggleBtn = shadow.querySelector('.panel .orig-toggle') as HTMLButtonElement;
    expect(origEl.classList.contains('clamped')).toBe(true);
    expect(toggleBtn.textContent).toBe('展开全文');
    toggleBtn.click();
    expect(origEl.classList.contains('clamped')).toBe(false);
    expect(toggleBtn.textContent).toBe('收起');

    const copyBtn = shadow.querySelector('.panel-act-btn[title="复制结果"]') as HTMLButtonElement;
    copyBtn.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(`译:${longText}`);

    const callsBeforeRetry = sendRuntimeMock.mock.calls.filter((c) => c[0] === 'translate.cues').length;
    const retryBtn = shadow.querySelector('.panel-act-btn[title="重新生成"]') as HTMLButtonElement;
    retryBtn.click();
    await vi.advanceTimersByTimeAsync(20);
    const callsAfterRetry = sendRuntimeMock.mock.calls.filter((c) => c[0] === 'translate.cues').length;
    expect(callsAfterRetry).toBe(callsBeforeRetry + 1);
  });
});
