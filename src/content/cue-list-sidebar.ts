/**
 * Full subtitle list with auto-scroll to active cue.
 * - Page: docks into YouTube secondary / beside player (overlay reserves gutter)
 * - PiP: injected into PiP document as right panel
 * - Long videos: virtualized list (only visible rows are mounted)
 */

import type { SubtitleCue, VocabHighlightConfig } from '../shared/domain/types';
import { DEFAULT_VOCAB_HIGHLIGHT } from '../shared/domain/types';
import { sendRuntime } from '../shared/messaging/client';
import { isClickableWord, segmentWords } from '../utils/segmenter';
import {
  buildHighlightCss,
  decorateWordSpan,
  syncEnGlossClass,
  type HighlightMap,
} from '../utils/vocab-highlight';
import {
  ensurePageSideLayoutStyles,
  setCueListOverlayMode,
} from './page-side-layout';
import { ICON_BTN_CSS, iconActionButton } from './ui-icons';

export type CueListSeekHandler = (cue: SubtitleCue) => void;
export type CueListWordClickHandler = (
  word: string,
  context: string,
  targetEl?: HTMLElement,
) => void;

const PAGE_ROOT_ID = 'ueh-cue-list-root';

/** Estimated row height for virtual window (px). Variable text is OK — overscan covers it. */
const ROW_EST_PX = 78;
const OVERSCAN = 10;
/** Full DOM only when list is short enough that virtualization costs more. */
const VIRTUALIZE_THRESHOLD = 80;

export class CueListSidebar {
  private root: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private cues: SubtitleCue[] = [];
  private activeId = '';
  private open = false;
  private onSeek: CueListSeekHandler;
  private mode: 'page' | 'pip';
  private hostDoc: Document;
  private onWordClick?: CueListWordClickHandler;
  private highlightMap: HighlightMap = {};
  private vocabHighlight: VocabHighlightConfig = DEFAULT_VOCAB_HIGHLIGHT;
  /** Page mode: true when fixed overlay (not docked to #secondary). */
  private pageOverlay = false;
  private virtualStart = 0;
  private virtualEnd = 0;
  private scrollRaf = 0;
  private onListScroll = (): void => {
    if (this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      this.renderVirtualWindow(false);
    });
  };

  private translationListener = (e: Event) => {
    const { cueId, translation } = (e as CustomEvent).detail;
    this.updateCueTranslation(cueId, translation);
  };

  constructor(
    mode: 'page' | 'pip',
    onSeek: CueListSeekHandler,
    hostDoc: Document = document,
    onWordClick?: CueListWordClickHandler,
  ) {
    this.mode = mode;
    this.onSeek = onSeek;
    this.hostDoc = hostDoc;
    this.onWordClick = onWordClick;

    const win = this.hostDoc.defaultView || window;
    win.addEventListener('ueh:cue-translated', this.translationListener);
  }

  setCues(cues: SubtitleCue[]): void {
    this.cues = cues;
    if (this.open) this.renderList(true);
  }

  setHighlightMap(map: HighlightMap): void {
    this.highlightMap = map;
    if (this.open) this.renderList(true);
  }

  setVocabHighlight(cfg: VocabHighlightConfig): void {
    this.vocabHighlight = cfg;
    this.injectHighlightCss();
    if (this.open) this.renderList(true);
  }

  async refreshHighlights(): Promise<void> {
    const res = await sendRuntime<HighlightMap>(
      'word.highlightMap',
      {},
      'content',
    );
    if (res.ok) this.setHighlightMap(res.data);
  }

  setActiveCueId(id: string | null): void {
    const next = id ?? '';
    if (next === this.activeId) return;
    this.activeId = next;
    this.highlightActive();
  }

  isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    this.open = true;
    this.mount();
    this.renderList(true);
    this.highlightActive();
  }

  close(): void {
    this.open = false;
    this.unbindListScroll();
    this.root?.remove();
    this.root = null;
    this.shadow = null;
    this.virtualStart = 0;
    this.virtualEnd = 0;
    if (this.mode === 'page') {
      this.hostDoc.documentElement.classList.remove('ueh-cue-list-open');
      setCueListOverlayMode(false, this.hostDoc);
      this.pageOverlay = false;
    } else {
      this.hostDoc
        .getElementById('ueh-pip-root')
        ?.classList.remove('ueh-cue-list-open');
    }
  }

  destroy(): void {
    this.close();
    const win = this.hostDoc.defaultView || window;
    win.removeEventListener('ueh:cue-translated', this.translationListener);
  }

  private mount(): void {
    if (this.root) return;

    if (this.mode === 'page') {
      this.mountPage();
    } else {
      this.mountPip();
    }
  }

  private mountPage(): void {
    ensurePageSideLayoutStyles(this.hostDoc);

    // Prefer YouTube secondary column (recommendations) — does not cover video
    const secondary =
      this.hostDoc.querySelector('#secondary-inner') ||
      this.hostDoc.querySelector('#secondary') ||
      this.hostDoc.querySelector('ytd-watch-flexy #secondary');

    const root = this.hostDoc.createElement('div');
    root.id = PAGE_ROOT_ID;
    root.setAttribute('data-ueh-overlay', 'cue-list');

    if (secondary instanceof HTMLElement) {
      this.pageOverlay = false;
      root.classList.remove('ueh-page-dock-overlay');
      root.style.cssText =
        'width:100%;margin-bottom:12px;position:relative;z-index:20;';
      secondary.insertBefore(root, secondary.firstChild);
      setCueListOverlayMode(false, this.hostDoc);
    } else {
      // Fixed right gutter — page layout CSS reserves space so video is not covered
      this.pageOverlay = true;
      root.classList.add('ueh-page-dock-overlay');
      root.style.cssText = '';
      this.hostDoc.documentElement.appendChild(root);
      setCueListOverlayMode(true, this.hostDoc);
    }

    this.root = root;
    this.shadow = root.attachShadow({ mode: 'open' });
    this.injectChrome();
    this.hostDoc.documentElement.classList.add('ueh-cue-list-open');
  }

  private mountPip(): void {
    const slot =
      this.hostDoc.getElementById('ueh-pip-cuelist-slot') ||
      this.hostDoc.getElementById('ueh-pip-root') ||
      this.hostDoc.body;
    const root = this.hostDoc.createElement('div');
    root.id = 'ueh-pip-cue-list';
    root.style.cssText =
      'width:100%;height:100%;min-height:0;pointer-events:auto;';
    slot.appendChild(root);
    this.root = root;
    this.shadow = root.attachShadow({ mode: 'open' });
    this.injectChrome();
    this.hostDoc
      .getElementById('ueh-pip-root')
      ?.classList.add('ueh-cue-list-open');
  }

  private injectChrome(): void {
    if (!this.shadow) return;
    this.shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          display: block;
          height: 100%;
          max-height: inherit;
          box-sizing: border-box;
          /* Contain scroll chaining so page/PiP never rubber-bands under the panel */
          overscroll-behavior: contain;
        }
        .wrap {
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
          color: #f0f0f0;
          display: flex;
          flex-direction: column;
          height: 100%;
          max-height: inherit;
          min-height: 0;
          box-sizing: border-box;
          background: rgba(16,17,22,.97);
          border: 1px solid rgba(255,255,255,.12);
          border-radius: ${this.mode === 'page' && !this.pageOverlay ? '12px' : '0'};
          overflow: hidden;
          box-shadow: 0 8px 28px rgba(0,0,0,.35);
        }
        .head {
          flex: 0 0 auto;
          display: flex; align-items: center; gap: 8px;
          padding: 10px 12px;
          border-bottom: 1px solid rgba(255,255,255,.08);
          font-size: 13px; font-weight: 700;
          color: oklch(88% 0.08 82);
        }
        .head button {
          margin-left: auto; border: 0; background: rgba(255,255,255,.08);
          color: #fff; border-radius: 8px; width: 28px; height: 28px;
          cursor: pointer; font-size: 14px;
        }
        .list {
          flex: 1 1 auto;
          min-height: 0;
          max-height: ${
            this.mode === 'page' && !this.pageOverlay
              ? 'min(62vh, 640px)'
              : 'none'
          };
          padding: 6px 4px 6px 6px;
          overflow-x: hidden;
          overflow-y: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          scrollbar-gutter: stable;
          /* Firefox: hairline, nearly invisible until hover */
          scrollbar-width: thin;
          scrollbar-color: transparent transparent;
        }
        .list:hover,
        .list:focus-within {
          scrollbar-color: rgba(255,255,255,.28) transparent;
        }
        /* Chromium / Safari: hide thick OS scrollbar; show thin overlay thumb on hover */
        .list::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        .list::-webkit-scrollbar-track {
          background: transparent;
        }
        .list::-webkit-scrollbar-thumb {
          background: transparent;
          border-radius: 999px;
        }
        .list:hover::-webkit-scrollbar-thumb,
        .list:focus-within::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,.22);
        }
        .list::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,.38);
        }
        .list::-webkit-scrollbar-corner {
          background: transparent;
        }
        .v-spacer {
          width: 100%;
          pointer-events: none;
          flex-shrink: 0;
        }
        .item {
          display: block; width: 100%; text-align: left;
          border: 0; border-radius: 8px;
          background: transparent; color: #e8e8e8;
          padding: 8px 10px; margin: 2px 0;
          cursor: pointer; font-size: 12px; line-height: 1.4;
          box-sizing: border-box;
        }
        .item:hover { background: rgba(255,255,255,.08); }
        .item.active {
          background: color-mix(in srgb, oklch(76% 0.12 82) 28%, transparent);
          outline: 1px solid color-mix(in srgb, oklch(76% 0.12 82) 55%, transparent);
        }
        .item-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          margin-bottom: 2px;
          min-height: 20px;
        }
        .t {
          opacity: .55;
          font-size: 10px;
          font-variant-numeric: tabular-nums;
          margin: 0;
          flex: 1 1 auto;
          min-width: 0;
        }
        .txt { word-break: break-word; overflow-wrap: anywhere; }
        .ueh-word {
          cursor: pointer;
          border-bottom: 1px dashed rgba(255,255,255,.35);
          padding: 0 1px;
        }
        .ueh-word:hover {
          filter: brightness(1.1);
          background: rgba(255, 255, 255, 0.15);
          border-radius: 2px;
        }
        .tr { color: oklch(88% 0.08 82); margin-top: 2px; font-size: 11px; word-break: break-word; }
        .row-act {
          margin: 0;
          flex: 0 0 auto;
          gap: 4px;
          opacity: .72;
        }
        .item:hover .row-act,
        .item.active .row-act {
          opacity: 1;
        }
        ${ICON_BTN_CSS}
        /* Compact action icons — top-right of each cue */
        .item .ueh-ibtn {
          width: 20px;
          height: 20px;
          border-radius: 5px;
          background: rgba(255,255,255,.08);
        }
        .item .ueh-ibtn:hover {
          background: rgba(255,255,255,.16);
        }
        .item .ueh-ibtn svg {
          width: 11px;
          height: 11px;
          stroke-width: 2.2;
        }
        .item .ueh-ibtn.star {
          background: color-mix(in srgb, oklch(76% 0.12 82) 70%, transparent);
        }
        .empty { padding: 16px; opacity: .6; font-size: 12px; }
      </style>
      <style id="hl"></style>
      <div class="wrap">
        <div class="head">
          <span>字幕列表</span>
          <button type="button" id="close" title="关闭">×</button>
        </div>
        <div class="list" id="list" tabindex="-1"></div>
      </div>
    `;
    this.shadow.getElementById('close')?.addEventListener('click', () => {
      this.close();
      if (this.mode === 'pip') {
        this.hostDoc
          .getElementById('ueh-pip-root')
          ?.classList.remove('ueh-cue-list-open');
      }
    });

    // Block scroll chaining at edges (overscroll-behavior is not enough on all hosts)
    const list = this.shadow.getElementById('list');
    list?.addEventListener(
      'wheel',
      (e) => {
        const el = e.currentTarget as HTMLElement;
        const dy = e.deltaY;
        if (dy === 0) return;
        const max = el.scrollHeight - el.clientHeight;
        if (max <= 0) {
          e.preventDefault();
          return;
        }
        const top = el.scrollTop;
        const atTop = top <= 0 && dy < 0;
        const atBottom = top >= max - 0.5 && dy > 0;
        if (atTop || atBottom) e.preventDefault();
      },
      { passive: false },
    );
    this.injectHighlightCss();
  }

  private injectHighlightCss(): void {
    const el = this.shadow?.getElementById('hl');
    if (!el) return;
    el.textContent = buildHighlightCss(this.vocabHighlight);
  }

  private useVirtual(): boolean {
    return this.cues.length > VIRTUALIZE_THRESHOLD;
  }

  private bindListScroll(list: HTMLElement): void {
    list.removeEventListener('scroll', this.onListScroll);
    if (this.useVirtual()) {
      list.addEventListener('scroll', this.onListScroll, { passive: true });
    }
  }

  private unbindListScroll(): void {
    const list = this.shadow?.getElementById('list');
    list?.removeEventListener('scroll', this.onListScroll);
    if (this.scrollRaf) {
      cancelAnimationFrame(this.scrollRaf);
      this.scrollRaf = 0;
    }
  }

  private renderList(force = false): void {
    const list = this.shadow?.getElementById('list');
    if (!list) return;

    if (!this.cues.length) {
      this.unbindListScroll();
      list.innerHTML = '<div class="empty">暂无字幕</div>';
      this.virtualStart = 0;
      this.virtualEnd = 0;
      return;
    }

    if (!this.useVirtual()) {
      this.unbindListScroll();
      this.renderFullList(list);
      return;
    }

    this.bindListScroll(list);
    this.renderVirtualWindow(force);
  }

  private renderFullList(list: HTMLElement): void {
    const frag = this.hostDoc.createDocumentFragment();
    for (const cue of this.cues) {
      frag.appendChild(this.buildItem(cue));
    }
    list.replaceChildren(frag);
    this.virtualStart = 0;
    this.virtualEnd = this.cues.length;
  }

  private computeWindow(list: HTMLElement): { start: number; end: number } {
    const n = this.cues.length;
    const viewH = Math.max(list.clientHeight, 1);
    const scrollTop = list.scrollTop;
    const start = Math.max(
      0,
      Math.floor(scrollTop / ROW_EST_PX) - OVERSCAN,
    );
    const visible = Math.ceil(viewH / ROW_EST_PX) + OVERSCAN * 2;
    const end = Math.min(n, start + visible);
    return { start, end };
  }

  private renderVirtualWindow(force: boolean): void {
    const list = this.shadow?.getElementById('list');
    if (!list || !this.cues.length) return;

    const { start, end } = this.computeWindow(list);
    if (
      !force &&
      start === this.virtualStart &&
      end === this.virtualEnd &&
      list.querySelector('.item')
    ) {
      return;
    }

    this.virtualStart = start;
    this.virtualEnd = end;

    const topH = start * ROW_EST_PX;
    const bottomH = Math.max(0, (this.cues.length - end) * ROW_EST_PX);

    const frag = this.hostDoc.createDocumentFragment();
    const top = this.hostDoc.createElement('div');
    top.className = 'v-spacer';
    top.style.height = `${topH}px`;
    top.setAttribute('aria-hidden', 'true');
    frag.appendChild(top);

    for (let i = start; i < end; i++) {
      const cue = this.cues[i];
      if (cue) frag.appendChild(this.buildItem(cue));
    }

    const bottom = this.hostDoc.createElement('div');
    bottom.className = 'v-spacer';
    bottom.style.height = `${bottomH}px`;
    bottom.setAttribute('aria-hidden', 'true');
    frag.appendChild(bottom);

    list.replaceChildren(frag);
  }

  private buildItem(cue: SubtitleCue): HTMLElement {
    const item = this.hostDoc.createElement('div');
    item.className = 'item' + (cue.id === this.activeId ? ' active' : '');
    item.dataset.cueId = cue.id;
    const t0 = formatMs(cue.startMs);
    item.innerHTML = `
      <div class="item-head">
        <div class="t">${t0}</div>
        <div class="row-act ueh-ibtn-row">
          ${iconActionButton('jump', '跳转到此句', '', { 'data-cue-act': 'jump' })}
          ${iconActionButton('star', '收藏句子', 'star', { 'data-cue-act': 'star' })}
        </div>
      </div>
      <div class="txt"></div>
      <div class="tr"></div>
    `;
    const txtEl = item.querySelector('.txt') as HTMLElement;
    txtEl.innerHTML = '';
    const segments = segmentWords(cue.text);
    for (const seg of segments) {
      if (isClickableWord(seg)) {
        const span = this.hostDoc.createElement('span');
        span.className = 'ueh-word';
        decorateWordSpan(span, seg.text, this.highlightMap, this.vocabHighlight);
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.onWordClick) {
            this.onWordClick(seg.text, cue.text, span);
          }
        });
        txtEl.appendChild(span);
      } else {
        txtEl.appendChild(this.hostDoc.createTextNode(seg.text));
      }
    }
    syncEnGlossClass(txtEl);
    const tr = item.querySelector('.tr') as HTMLElement;
    if (cue.translation) tr.textContent = cue.translation;
    else tr.style.display = 'none';

    item.querySelector('[data-cue-act="jump"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onSeek(cue);
    });
    item.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.onSeek(cue);
    });
    item.querySelector('[data-cue-act="star"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.starCue(cue, e.currentTarget as HTMLButtonElement);
    });
    return item;
  }

  private highlightActive(): void {
    if (!this.shadow) return;
    const list = this.shadow.getElementById('list');
    if (!list) return;

    // Virtual list: ensure active cue is in the mounted window, then scroll
    if (this.useVirtual() && this.activeId) {
      const idx = this.cues.findIndex((c) => c.id === this.activeId);
      if (idx >= 0) {
        const targetTop = Math.max(0, idx * ROW_EST_PX - list.clientHeight * 0.35);
        const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
        const nextTop = Math.min(targetTop, maxScroll);
        // Only jump when active row is outside a comfortable band
        const activeEl = list.querySelector(
          `.item[data-cue-id="${cssEscape(this.activeId)}"]`,
        ) as HTMLElement | null;
        if (!activeEl) {
          list.scrollTop = nextTop;
          this.renderVirtualWindow(true);
        } else {
          scrollChildIntoListView(list, activeEl);
        }
      }
    }

    const items = Array.from(
      this.shadow.querySelectorAll<HTMLElement>('.item'),
    );
    let activeEl: HTMLElement | undefined;
    for (const el of items) {
      const on = el.dataset.cueId === this.activeId;
      el.classList.toggle('active', on);
      if (on) activeEl = el;
    }
    if (!activeEl || !list) return;
    // Only scroll when the active cue is outside the visible list — avoids
    // constant smooth-scroll / overscroll bounce while playing.
    scrollChildIntoListView(list, activeEl);
  }

  private async starCue(
    cue: SubtitleCue,
    btn: HTMLButtonElement,
  ): Promise<void> {
    btn.disabled = true;
    const res = await sendRuntime(
      'word.add',
      {
        surface: cue.text.slice(0, 80),
        context: cue.text,
        contextTranslation: cue.translation,
        translation: cue.translation,
        kind: 'sentence',
        cueStartMs: cue.startMs,
        cueEndMs: cue.endMs,
        sourceUrl: this.hostDoc.defaultView?.location.href ?? location.href,
        sourceTitle: this.hostDoc.title || document.title,
        explainEngine: 'manual',
      },
      'content',
    );
    btn.title = res.ok ? '已收藏' : '收藏失败';
    btn.setAttribute('aria-label', btn.title);
    if (res.ok) {
      window.setTimeout(() => {
        btn.title = '收藏句子';
        btn.setAttribute('aria-label', '收藏句子');
        btn.disabled = false;
      }, 1600);
    } else {
      btn.disabled = false;
    }
  }

  updateCueTranslation(cueId: string, translation: string): void {
    const stored = this.cues.find((c) => c.id === cueId);
    if (stored) stored.translation = translation;

    if (!this.shadow) return;
    const item = this.shadow.querySelector(
      `[data-cue-id="${cssEscape(cueId)}"]`,
    );
    if (item) {
      const tr = item.querySelector('.tr') as HTMLElement;
      if (tr) {
        tr.textContent = translation;
        tr.style.display = 'block';
      }
    }
  }
}

function formatMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * Scroll `child` into `list` only if clipped. Uses list.scrollBy instead of
 * scrollIntoView so outer ancestors (page / PiP root) never move.
 */
function scrollChildIntoListView(
  list: HTMLElement,
  child: HTMLElement,
  margin = 8,
): void {
  const listRect = list.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();

  if (
    childRect.top >= listRect.top + margin &&
    childRect.bottom <= listRect.bottom - margin
  ) {
    return;
  }

  let delta = 0;
  if (childRect.top < listRect.top + margin) {
    delta = childRect.top - listRect.top - margin;
  } else if (childRect.bottom > listRect.bottom - margin) {
    delta = childRect.bottom - listRect.bottom + margin;
  }
  if (delta === 0) return;

  list.scrollBy({
    top: delta,
    behavior: Math.abs(delta) < list.clientHeight * 1.5 ? 'smooth' : 'auto',
  });
}
