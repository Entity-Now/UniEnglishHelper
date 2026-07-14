/**
 * Video vocabulary recap sidebar — words added in this video + revisiting from past videos.
 * Used in PiP (left panel) and page overlay (left dock).
 */

import type { SubtitleCue } from '../shared/domain/types';
import type { WordRecord } from '../db/schema';
import { sendRuntime } from '../shared/messaging/client';
import {
  buildCueWordKeys,
  findFirstCueForWord,
  formatRecapBadge,
  type VideoVocabRecapResult,
  type VideoVocabRecapStats,
} from '../utils/video-vocab-recap';
import { buildHighlightCss, highlightClass } from '../utils/vocab-highlight';
import { DEFAULT_VOCAB_HIGHLIGHT } from '../shared/domain/types';
import type { VocabHighlightConfig } from '../shared/domain/types';
import {
  ICON_BTN_CSS,
  iconActionButton,
  openOptionsRoute,
} from './ui-icons';

export type VideoVocabRecapHandlers = {
  getVideoKey: () => string;
  onSeek: (cueStartMs: number) => void;
  onExplain: (surface: string, context: string) => void;
  onTts: (surface: string) => void;
  onMarkLearned: (wordId: number) => Promise<void>;
  onStatsChange?: (stats: VideoVocabRecapStats) => void;
};

const PAGE_ROOT_ID = 'ueh-vocab-recap-root';

const STATUS_LABEL: Record<string, string> = {
  new: '新词',
  learning: '学习中',
  learned: '已掌握',
};

export class VideoVocabRecap {
  private root: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private cues: SubtitleCue[] = [];
  private open = false;
  private mode: 'page' | 'pip';
  private hostDoc: Document;
  private handlers: VideoVocabRecapHandlers;
  private data: VideoVocabRecapResult | null = null;
  private vocabHighlight: VocabHighlightConfig = DEFAULT_VOCAB_HIGHLIGHT;
  private collapsed = { added: false, revisiting: false };

  constructor(
    mode: 'page' | 'pip',
    hostDoc: Document,
    handlers: VideoVocabRecapHandlers,
  ) {
    this.mode = mode;
    this.hostDoc = hostDoc;
    this.handlers = handlers;
  }

  isOpen(): boolean {
    return this.open;
  }

  setCues(cues: SubtitleCue[]): void {
    this.cues = cues;
    if (this.open) void this.refresh();
  }

  setVocabHighlight(cfg: VocabHighlightConfig): void {
    this.vocabHighlight = cfg;
    this.injectHighlightCss();
  }

  getStats(): VideoVocabRecapStats | null {
    return this.data?.stats ?? null;
  }

  toggle(): void {
    if (this.open) this.close();
    else void this.show();
  }

  async show(): Promise<void> {
    this.open = true;
    this.mount();
    await this.refresh();
    this.setRootClass(true);
  }

  close(): void {
    this.open = false;
    this.root?.remove();
    this.root = null;
    this.shadow = null;
    this.setRootClass(false);
  }

  destroy(): void {
    this.close();
  }

  async refresh(): Promise<void> {
    const videoKey = this.handlers.getVideoKey();
    const cueWordKeys = buildCueWordKeys(this.cues);
    const res = await sendRuntime<VideoVocabRecapResult>(
      'word.videoRecap',
      { videoKey, cueWordKeys },
      'content',
    );
    if (!res.ok) return;
    this.data = res.data;
    this.handlers.onStatsChange?.(res.data.stats);
    this.render();
  }

  private setRootClass(on: boolean): void {
    if (this.mode === 'pip') {
      this.hostDoc
        .getElementById('ueh-pip-root')
        ?.classList.toggle('ueh-recap-open', on);
    } else {
      this.hostDoc.documentElement.classList.toggle('ueh-recap-open', on);
    }
  }

  private mount(): void {
    if (this.root) return;

    if (this.mode === 'pip') {
      const host =
        this.hostDoc.getElementById('ueh-pip-root') || this.hostDoc.body;
      const root = this.hostDoc.createElement('div');
      root.id = 'ueh-pip-vocab-recap';
      root.style.cssText =
        'position:absolute;top:0;left:0;bottom:0;width:min(260px,38%);z-index:11;pointer-events:auto;';
      host.appendChild(root);
      this.root = root;
    } else {
      const root = this.hostDoc.createElement('div');
      root.id = PAGE_ROOT_ID;
      root.style.cssText =
        'position:fixed;top:72px;left:12px;width:min(280px,92vw);max-height:70vh;z-index:2147483638;';
      this.hostDoc.documentElement.appendChild(root);
      this.root = root;
    }

    this.shadow = this.root.attachShadow({ mode: 'open' });
    this.injectChrome();
  }

  private injectChrome(): void {
    if (!this.shadow) return;
    this.shadow.innerHTML = `
      <style>
        :host, :host * { box-sizing: border-box; }
        .wrap {
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
          color: #f0f0f0;
          display: flex;
          flex-direction: column;
          height: 100%;
          max-height: inherit;
          min-height: 0;
          background: rgba(16,17,22,.97);
          border: 1px solid rgba(255,255,255,.12);
          border-radius: ${this.mode === 'page' ? '12px' : '0'};
          overflow: hidden;
          box-shadow: 0 8px 28px rgba(0,0,0,.35);
        }
        .head {
          flex: 0 0 auto;
          padding: 8px 10px;
          border-bottom: 1px solid rgba(255,255,255,.08);
        }
        .head-row {
          display: flex; align-items: center; gap: 6px;
        }
        .head-title {
          font-size: 13px; font-weight: 700;
          color: oklch(88% 0.08 82);
          flex: 1 1 auto;
          min-width: 0;
        }
        .head-stats {
          font-size: 11px; opacity: .65; margin-top: 4px;
        }
        .head-actions {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: 0 0 auto;
          margin-left: auto;
        }
        .head button.close {
          border: 0; background: rgba(255,255,255,.08);
          color: #fff; border-radius: 6px; width: 24px; height: 24px;
          cursor: pointer; font-size: 14px; line-height: 1;
          display: inline-flex; align-items: center; justify-content: center;
          padding: 0;
        }
        .head button.close:hover { background: rgba(255,255,255,.16); }
        /* Compact header action icons */
        .head-actions .ueh-ibtn {
          width: 24px;
          height: 24px;
          border-radius: 6px;
        }
        .head-actions .ueh-ibtn svg {
          width: 13px;
          height: 13px;
        }
        .body {
          flex: 1 1 auto; min-height: 0;
          overflow-x: hidden; overflow-y: auto;
          overscroll-behavior: contain;
          padding: 6px 8px 10px;
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,.22) transparent;
        }
        .section { margin-bottom: 10px; }
        .section-head {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 4px; cursor: pointer; user-select: none;
          font-size: 12px; font-weight: 700;
          color: oklch(88% 0.08 82);
        }
        .section-head .hint {
          font-weight: 400; font-size: 10px; opacity: .55; flex: 1;
        }
        .section-head .chev { opacity: .5; font-size: 10px; }
        .empty {
          padding: 10px 8px; font-size: 11px; line-height: 1.45;
          opacity: .55;
        }
        .card {
          border-radius: 10px;
          background: rgba(255,255,255,.05);
          border: 1px solid rgba(255,255,255,.08);
          padding: 7px 8px;
          margin: 4px 0;
        }
        .card-top {
          display: flex;
          align-items: flex-start;
          gap: 6px;
        }
        .card-meta {
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 5px;
          flex-wrap: wrap;
        }
        .surface {
          font-size: 13px; font-weight: 700;
          color: oklch(92% 0.06 82);
          cursor: pointer;
          line-height: 1.3;
        }
        .surface:hover { text-decoration: underline; }
        .badge {
          font-size: 9px; font-weight: 700;
          padding: 1px 5px; border-radius: 999px;
          line-height: 1.3;
        }
        .badge.new {
          background: color-mix(in srgb, #F5C542 35%, transparent);
          color: #F5C542;
        }
        .badge.learning {
          background: color-mix(in srgb, #5B9FFF 30%, transparent);
          color: #5B9FFF;
        }
        .badge.learned {
          background: color-mix(in srgb, #3DDC97 28%, transparent);
          color: #3DDC97;
        }
        .due { font-size: 10px; line-height: 1; }
        .time {
          font-size: 10px; opacity: .55;
          font-variant-numeric: tabular-nums; cursor: pointer;
        }
        .def {
          margin-top: 3px; font-size: 11px; line-height: 1.35;
          opacity: .85; display: -webkit-box;
          -webkit-line-clamp: 2; -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .src {
          margin-top: 3px; font-size: 10px; opacity: .5;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        /* Compact per-word actions — top-right, no extra row */
        .acts {
          flex: 0 0 auto;
          margin: 0;
          gap: 3px;
          opacity: .72;
        }
        .card:hover .acts { opacity: 1; }
        .card .ueh-ibtn {
          width: 20px;
          height: 20px;
          border-radius: 5px;
          background: rgba(255,255,255,.08);
        }
        .card .ueh-ibtn:hover { background: rgba(255,255,255,.16); }
        .card .ueh-ibtn svg {
          width: 11px;
          height: 11px;
          stroke-width: 2.2;
        }
        .card .ueh-ibtn.primary {
          background: color-mix(in srgb, oklch(76% 0.12 82) 75%, transparent);
        }
        ${ICON_BTN_CSS}
      </style>
      <style id="hl"></style>
      <div class="wrap">
        <div class="head">
          <div class="head-row">
            <span class="head-title">生词回顾</span>
            <div class="head-actions">
              ${iconActionButton('study', '开始复习', 'primary', { id: 'open-study' })}
              ${iconActionButton('dictionary', '生词本', '', { id: 'open-dict' })}
              <button type="button" class="close" id="close" title="关闭" aria-label="关闭">×</button>
            </div>
          </div>
          <div class="head-stats" id="stats"></div>
        </div>
        <div class="body" id="body"></div>
      </div>
    `;

    this.shadow.getElementById('close')?.addEventListener('click', () => {
      this.close();
    });
    this.shadow.getElementById('open-study')?.addEventListener('click', () => {
      void openOptionsRoute('study');
    });
    this.shadow.getElementById('open-dict')?.addEventListener('click', () => {
      void openOptionsRoute('dictionary');
    });

    const body = this.shadow.getElementById('body');
    body?.addEventListener(
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
        if ((top <= 0 && dy < 0) || (top >= max - 0.5 && dy > 0)) {
          e.preventDefault();
        }
      },
      { passive: false },
    );

    this.injectHighlightCss();
  }

  private injectHighlightCss(): void {
    const el = this.shadow?.getElementById('hl');
    if (el) el.textContent = buildHighlightCss(this.vocabHighlight);
  }

  private render(): void {
    const body = this.shadow?.getElementById('body');
    const statsEl = this.shadow?.getElementById('stats');
    if (!body || !this.data) return;

    const { addedHere, revisiting, stats } = this.data;
    const totalInSubs = stats.addedHereCount + stats.revisitingCount;

    if (statsEl) {
      statsEl.textContent =
        totalInSubs > 0
          ? `本片字幕中共 ${totalInSubs} 个生词${stats.dueCount > 0 ? ` · ${stats.dueCount} 个待复习` : ''}`
          : '点击字幕单词添加生词';
    }

    body.replaceChildren();

    body.appendChild(
      this.renderSection(
        'added',
        '本集新词',
        String(stats.addedHereCount),
        '刚在本视频添加，建议看完前过一遍',
        addedHere,
        '还没有添加生词，点击字幕中的单词即可添加',
        true,
      ),
    );
    body.appendChild(
      this.renderSection(
        'revisiting',
        '复习词',
        String(stats.revisitingCount),
        '以前学过，在本片字幕中再次出现',
        revisiting,
        '本片字幕中没有出现你之前学过的词',
        false,
      ),
    );
  }

  private renderSection(
    key: 'added' | 'revisiting',
    title: string,
    count: string,
    hint: string,
    words: WordRecord[],
    emptyText: string,
    isAddedHere: boolean,
  ): HTMLElement {
    const section = this.hostDoc.createElement('div');
    section.className = 'section';

    const head = this.hostDoc.createElement('div');
    head.className = 'section-head';
    head.innerHTML = `
      <span class="chev">${this.collapsed[key] ? '▶' : '▼'}</span>
      <span>${title} (${count})</span>
      <span class="hint">${hint}</span>
    `;
    head.addEventListener('click', () => {
      this.collapsed[key] = !this.collapsed[key];
      this.render();
    });
    section.appendChild(head);

    if (this.collapsed[key]) return section;

    if (!words.length) {
      const empty = this.hostDoc.createElement('div');
      empty.className = 'empty';
      empty.textContent = emptyText;
      section.appendChild(empty);
      return section;
    }

    const now = Date.now();
    for (const w of words) {
      section.appendChild(this.renderCard(w, isAddedHere, now));
    }
    return section;
  }

  private renderCard(
    w: WordRecord,
    isAddedHere: boolean,
    now: number,
  ): HTMLElement {
    const card = this.hostDoc.createElement('div');
    card.className = 'card';

    const status = w.learningStatus ?? 'new';
    const hlCls = highlightClass(status);
    const isDue = !isAddedHere && w.nextReviewAt <= now;

    const cue = findFirstCueForWord(this.cues, w.surface);
    const timeLabel = cue ? formatMs(cue.startMs) : '';

    const top = this.hostDoc.createElement('div');
    top.className = 'card-top';

    const meta = this.hostDoc.createElement('div');
    meta.className = 'card-meta';

    const surface = this.hostDoc.createElement('span');
    surface.className = `surface${hlCls ? ` ${hlCls}` : ''}`;
    surface.textContent = w.surface;
    if (cue) {
      surface.addEventListener('click', () => {
        this.handlers.onSeek(cue.startMs);
      });
    }
    meta.appendChild(surface);

    const badge = this.hostDoc.createElement('span');
    badge.className = `badge ${status}`;
    badge.textContent = STATUS_LABEL[status] ?? status;
    meta.appendChild(badge);

    if (isDue) {
      const due = this.hostDoc.createElement('span');
      due.className = 'due';
      due.textContent = '⏰';
      due.title = '待复习';
      meta.appendChild(due);
    }

    if (timeLabel) {
      const time = this.hostDoc.createElement('span');
      time.className = 'time';
      time.textContent = timeLabel;
      time.title = '跳转到此句';
      time.addEventListener('click', () => {
        if (cue) this.handlers.onSeek(cue.startMs);
      });
      meta.appendChild(time);
    }

    top.appendChild(meta);

    const acts = this.hostDoc.createElement('div');
    acts.className = 'acts ueh-ibtn-row';
    acts.innerHTML = `
      ${iconActionButton('tts', '朗读', '', { 'data-recap-act': 'tts' })}
      ${iconActionButton('explain', '释义', '', { 'data-recap-act': 'explain' })}
      ${status !== 'learned' && w.id != null ? iconActionButton('learned', '标记掌握', 'primary', { 'data-recap-act': 'learned' }) : ''}
    `;
    acts.querySelector('[data-recap-act="tts"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onTts(w.surface);
    });
    acts.querySelector('[data-recap-act="explain"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const ctx = cue?.text ?? w.context ?? w.surface;
      this.handlers.onExplain(w.surface, ctx);
    });
    acts.querySelector('[data-recap-act="learned"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (w.id != null) {
        void this.handlers.onMarkLearned(w.id).then(() => this.refresh());
      }
    });
    top.appendChild(acts);

    card.appendChild(top);

    const defText = w.translation?.trim();
    if (defText) {
      const def = this.hostDoc.createElement('div');
      def.className = 'def';
      def.textContent = defText;
      card.appendChild(def);
    }

    if (!isAddedHere && w.sourceTitle) {
      const src = this.hostDoc.createElement('div');
      src.className = 'src';
      src.textContent = `来自：${w.sourceTitle}`;
      src.title = w.sourceUrl ?? w.sourceTitle;
      card.appendChild(src);
    }

    return card;
  }
}

export function formatRecapBadgeFromStats(
  stats: VideoVocabRecapStats | null,
): string {
  if (!stats) return '';
  return formatRecapBadge(stats);
}

function formatMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}