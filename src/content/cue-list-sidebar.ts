/**
 * Full subtitle list with auto-scroll to active cue.
 * - Page: docks into YouTube secondary / beside player
 * - PiP: injected into PiP document as right panel
 */

import type { SubtitleCue } from '../shared/domain/types';
import { sendRuntime } from '../shared/messaging/client';
import { isClickableWord, segmentWords } from '../utils/segmenter';

export type CueListSeekHandler = (cue: SubtitleCue) => void;
export type CueListWordClickHandler = (word: string, context: string) => void;

const PAGE_ROOT_ID = 'ueh-cue-list-root';

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
    if (this.open) this.renderList();
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
    this.renderList();
    this.highlightActive();
  }

  close(): void {
    this.open = false;
    this.root?.remove();
    this.root = null;
    this.shadow = null;
    if (this.mode === 'page') {
      this.hostDoc.documentElement.classList.remove('ueh-cue-list-open');
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
    // Prefer YouTube secondary column (recommendations)
    const secondary =
      this.hostDoc.querySelector('#secondary-inner') ||
      this.hostDoc.querySelector('#secondary') ||
      this.hostDoc.querySelector('ytd-watch-flexy #secondary');

    const root = this.hostDoc.createElement('div');
    root.id = PAGE_ROOT_ID;
    root.setAttribute('data-ueh-overlay', 'cue-list');

    if (secondary instanceof HTMLElement) {
      root.style.cssText =
        'width:100%;margin-bottom:12px;position:relative;z-index:20;';
      secondary.insertBefore(root, secondary.firstChild);
    } else {
      // Fallback fixed right panel
      root.style.cssText =
        'position:fixed;top:72px;right:12px;width:min(360px,92vw);max-height:70vh;z-index:2147483640;';
      this.hostDoc.documentElement.appendChild(root);
    }

    this.root = root;
    this.shadow = root.attachShadow({ mode: 'open' });
    this.injectChrome();
    this.hostDoc.documentElement.classList.add('ueh-cue-list-open');
  }

  private mountPip(): void {
    const host =
      this.hostDoc.getElementById('ueh-pip-root') || this.hostDoc.body;
    const root = this.hostDoc.createElement('div');
    root.id = 'ueh-pip-cue-list';
    root.style.cssText =
      'position:absolute;top:0;right:0;bottom:0;width:min(280px,42%);z-index:11;pointer-events:auto;';
    host.appendChild(root);
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
        :host, .wrap {
          all: initial;
          font-family: system-ui, -apple-system, sans-serif;
          color: #f0f0f0;
          display: flex;
          flex-direction: column;
          height: 100%;
          max-height: inherit;
          box-sizing: border-box;
        }
        .wrap {
          background: rgba(16,17,22,.97);
          border: 1px solid rgba(255,255,255,.12);
          border-radius: ${this.mode === 'page' ? '12px' : '0'};
          overflow: hidden;
          box-shadow: 0 8px 28px rgba(0,0,0,.35);
        }
        .head {
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
          overflow: auto;
          flex: 1;
          max-height: ${this.mode === 'page' ? 'min(62vh, 640px)' : '100%'};
          padding: 6px;
        }
        .item {
          display: block; width: 100%; text-align: left;
          border: 0; border-radius: 8px;
          background: transparent; color: #e8e8e8;
          padding: 8px 10px; margin: 2px 0;
          cursor: pointer; font-size: 12px; line-height: 1.4;
        }
        .item:hover { background: rgba(255,255,255,.08); }
        .item.active {
          background: color-mix(in srgb, oklch(76% 0.12 82) 28%, transparent);
          outline: 1px solid color-mix(in srgb, oklch(76% 0.12 82) 55%, transparent);
        }
        .t { opacity: .55; font-size: 10px; font-variant-numeric: tabular-nums; margin-bottom: 2px; }
        .txt { word-break: break-word; }
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
        .tr { color: oklch(88% 0.08 82); margin-top: 2px; font-size: 11px; }
        .row-act { display: flex; gap: 6px; margin-top: 6px; }
        .row-act button {
          border: 0; border-radius: 6px; padding: 4px 8px;
          font-size: 11px; font-weight: 600; cursor: pointer;
          background: rgba(255,255,255,.1); color: #fff;
        }
        .row-act button.star {
          background: oklch(76% 0.12 82); color: #1a1a1a;
        }
        .empty { padding: 16px; opacity: .6; font-size: 12px; }
      </style>
      <div class="wrap">
        <div class="head">
          <span>字幕列表</span>
          <button type="button" id="close" title="关闭">×</button>
        </div>
        <div class="list" id="list"></div>
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
  }

  private renderList(): void {
    const list = this.shadow?.getElementById('list');
    if (!list) return;
    list.innerHTML = '';
    if (!this.cues.length) {
      list.innerHTML = '<div class="empty">暂无字幕</div>';
      return;
    }
    for (const cue of this.cues) {
      const item = this.hostDoc.createElement('div');
      item.className = 'item' + (cue.id === this.activeId ? ' active' : '');
      item.dataset.cueId = cue.id;
      const t0 = formatMs(cue.startMs);
      item.innerHTML = `
        <div class="t">${t0}</div>
        <div class="txt"></div>
        <div class="tr"></div>
        <div class="row-act">
          <button type="button" class="jump">跳转</button>
          <button type="button" class="star">★ 收藏句子</button>
        </div>
      `;
      const txtEl = item.querySelector('.txt') as HTMLElement;
      txtEl.innerHTML = '';
      const segments = segmentWords(cue.text);
      for (const seg of segments) {
        if (isClickableWord(seg)) {
          const span = this.hostDoc.createElement('span');
          span.className = 'ueh-word';
          span.textContent = seg.text;
          span.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.onWordClick) {
              this.onWordClick(seg.text, cue.text);
            }
          });
          txtEl.appendChild(span);
        } else {
          txtEl.appendChild(this.hostDoc.createTextNode(seg.text));
        }
      }
      const tr = item.querySelector('.tr') as HTMLElement;
      if (cue.translation) tr.textContent = cue.translation;
      else tr.style.display = 'none';

      item.querySelector('.jump')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onSeek(cue);
      });
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        this.onSeek(cue);
      });
      item.querySelector('.star')?.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.starCue(cue, e.currentTarget as HTMLButtonElement);
      });
      list.appendChild(item);
    }
  }

  private highlightActive(): void {
    if (!this.shadow) return;
    const items = Array.from(
      this.shadow.querySelectorAll<HTMLElement>('.item'),
    );
    let activeEl: HTMLElement | undefined;
    for (const el of items) {
      const on = el.dataset.cueId === this.activeId;
      el.classList.toggle('active', on);
      if (on) activeEl = el;
    }
    activeEl?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
    btn.textContent = res.ok ? '✓ 已收藏' : '失败';
    if (res.ok) {
      window.setTimeout(() => {
        btn.textContent = '★ 收藏句子';
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
    const item = this.shadow.querySelector(`[data-cue-id="${cueId}"]`);
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
