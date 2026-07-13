/**
 * In-page bilingual subtitle overlay for YouTube / HTML5 video (non-PiP).
 * Reuses player adapters + translate + vocab highlight.
 */

import type { AppConfig, SubtitleCue } from '../shared/domain/types';
import { sendRuntime } from '../shared/messaging/client';
import { showWordExplainPopup } from './word-explain-popup';
import { findActiveCue } from '../utils/subtitles/parser';
import { isClickableWord, segmentWords } from '../utils/segmenter';
import {
  buildHighlightCss,
  colorForStatus,
  highlightClass,
  statusForSurface,
  type HighlightMap,
} from '../utils/vocab-highlight';
import type { PlayerAdapter } from './players';

const ROOT_ID = 'ueh-page-subs-root';

export class PageSubtitlesOverlay {
  private root: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private cues: SubtitleCue[] = [];
  private currentId = '';
  private raf = 0;
  private config: AppConfig;
  private adapter: PlayerAdapter;
  private video: HTMLVideoElement | null = null;
  private highlightMap: HighlightMap = {};
  private prefetching = new Set<string>();
  private enabled = true;
  private running = false;

  constructor(adapter: PlayerAdapter, config: AppConfig) {
    this.adapter = adapter;
    this.config = config;
  }

  isRunning(): boolean {
    return this.running && !!this.root;
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    if (!config.pageSubtitles?.enabled) {
      this.stop();
      return;
    }
    // Master enabled — ensure overlay exists
    if (!this.running || !this.root) {
      void this.start();
      return;
    }
    this.applyStyles();
    this.enabled = this.computeVisible(config);
    this.setEnabled(this.enabled);
    this.renderCue(findActiveCue(this.cues, this.mediaTimeMs()));
  }

  private computeVisible(cfg: AppConfig): boolean {
    const ps = cfg.pageSubtitles;
    if (!ps || !ps.enabled) return false;
    return ps.style?.displayMode !== 'off';
  }

  async start(): Promise<void> {
    if (!this.config.pageSubtitles?.enabled) return;

    this.video = this.adapter.findVideo();
    if (!this.video) return;

    // Avoid double RAF loops
    if (this.running && this.root) {
      this.applyStyles();
      // Refresh cues if previously empty
      if (!this.cues.length) {
        void this.reloadCues();
      }
      return;
    }

    try {
      this.cues = await this.adapter.getCues();
    } catch (e) {
      console.warn('[UEH] page subtitles load failed', e);
      this.cues = [];
    }

    await this.refreshHighlightMap();
    this.mount();
    this.enabled = this.computeVisible(this.config);
    this.setEnabled(this.enabled);
    this.running = true;
    this.tick();

    // YouTube tracks often arrive after first paint — retry a few times
    if (!this.cues.length) {
      void this.reloadCuesWithRetry(8);
    }
  }

  private async reloadCues(): Promise<void> {
    try {
      const cues = await this.adapter.getCues();
      if (cues.length) {
        this.cues = cues;
        this.renderCue(findActiveCue(this.cues, this.mediaTimeMs()));
      }
    } catch (e) {
      console.warn('[UEH] page subtitles reload failed', e);
    }
  }

  private async reloadCuesWithRetry(attempts: number): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      if (!this.running) return;
      if (this.cues.length) return;
      await new Promise((r) => setTimeout(r, 1200));
      await this.reloadCues();
    }
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.running = false;
    this.root?.remove();
    this.root = null;
    this.shadow = null;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    const layer = this.shadow?.getElementById('layer');
    if (layer) layer.style.display = on ? 'flex' : 'none';
  }

  async refreshHighlightMap(): Promise<void> {
    const res = await sendRuntime<HighlightMap>(
      'word.highlightMap',
      {},
      'content',
    );
    if (res.ok) this.highlightMap = res.data;
  }

  async refreshHighlights(): Promise<void> {
    await this.refreshHighlightMap();
    this.renderCue(findActiveCue(this.cues, this.mediaTimeMs()));
  }

  setCues(cues: SubtitleCue[]): void {
    this.cues = cues;
    this.renderCue(findActiveCue(this.cues, this.mediaTimeMs()));
  }

  private mediaTimeMs(): number {
    return Math.round((this.video?.currentTime ?? 0) * 1000);
  }

  private mount(): void {
    this.root?.remove();
    const host =
      this.video?.closest('.html5-video-player') ||
      this.video?.parentElement ||
      document.body;

    // Prefer absolute positioning over player container
    const container =
      (host instanceof HTMLElement ? host : null) || document.body;
    const style = getComputedStyle(container);
    if (style.position === 'static') {
      container.style.position = 'relative';
    }

    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('data-ueh-overlay', 'page-subs');
    root.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:40;';
    container.appendChild(root);
    this.root = root;
    this.shadow = root.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `
      <style id="base">
        #layer {
          position: absolute; left: 0; right: 0; bottom: 12%;
          display: flex; flex-direction: column; align-items: center;
          gap: 4px; padding: 0 12px; pointer-events: none;
        }
        #en, #tr {
          max-width: min(900px, 94%);
          text-align: center;
          line-height: 1.35;
          padding: 4px 10px;
          border-radius: 6px;
          pointer-events: auto;
          text-shadow: 0 1px 2px rgba(0,0,0,.85);
        }
        #en:empty, #tr:empty { display: none; padding: 0; background: transparent; }
        .ueh-word {
          cursor: pointer;
          border-bottom: 1px dashed rgba(255,255,255,.35);
          padding: 0 1px;
        }
        .ueh-word:hover {
          filter: brightness(1.1);
        }
        #tools {
          position: absolute; right: 10px; bottom: 8%;
          display: flex; gap: 6px; pointer-events: auto;
          opacity: 0; transition: opacity .15s;
        }
        :host(:hover) #tools, #tools:focus-within { opacity: 1; }
        #tools button {
          border: 0; border-radius: 8px;
          background: rgba(0,0,0,.72); color: #fff;
          padding: 6px 8px; font-size: 11px; font-weight: 600;
          cursor: pointer;
        }
      </style>
      <style id="hl"></style>
      <div id="layer">
        <div id="en"></div>
        <div id="tr"></div>
      </div>
      <div id="tools">
        <button type="button" data-act="translate">译</button>
        <button type="button" data-act="toggle">隐</button>
        <button type="button" data-act="pip">PiP</button>
      </div>
    `;
    this.applyStyles();
    this.shadow.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = (btn as HTMLElement).dataset.act;
        if (act === 'translate') {
          const cue = findActiveCue(this.cues, this.mediaTimeMs());
          if (cue) void this.translateCue(cue);
        } else if (act === 'toggle') {
          this.setEnabled(!this.enabled);
        } else if (act === 'pip') {
          window.dispatchEvent(new CustomEvent('ueh:open-pip'));
        }
      });
    });
  }

  private applyStyles(): void {
    if (!this.shadow) return;
    const vs = this.config.pageSubtitles?.style;
    const fontSize = Math.round(18 * ((vs?.main.fontScale ?? 110) / 100));
    const bg = (vs?.container.backgroundOpacity ?? 50) / 100;
    const en = this.shadow.getElementById('en');
    const tr = this.shadow.getElementById('tr');
    const layer = this.shadow.getElementById('layer');
    if (en) {
      en.style.fontSize = `${fontSize}px`;
      en.style.fontWeight = String(vs?.main.fontWeight ?? 600);
      en.style.color = vs?.main.color ?? '#fff';
      en.style.background = `rgba(0,0,0,${bg})`;
    }
    if (tr) {
      const trScale = vs?.translation.fontScale ?? Math.round((vs?.main.fontScale ?? 110) * 0.88);
      tr.style.fontSize = `${Math.round(18 * (trScale / 100))}px`;
      tr.style.fontWeight = String(vs?.translation.fontWeight ?? 500);
      tr.style.color = vs?.translation.color ?? '#E8D5A3';
      tr.style.background = `rgba(0,0,0,${bg})`;
    }
    if (layer) {
      layer.style.flexDirection =
        vs?.translationPosition === 'above' ? 'column-reverse' : 'column';
      const pct = this.config.pageSubtitles?.position?.percent ?? 10;
      layer.style.bottom = `${Math.max(8, pct)}%`;
    }
    const hl = this.shadow.getElementById('hl');
    if (hl) {
      hl.textContent = buildHighlightCss(
        this.config.vocabHighlight ?? {
          enabled: true,
          newColor: '#F5C542',
          learningColor: '#5B9FFF',
          learnedColor: '#3DDC97',
        },
      );
    }
  }

  private tick = (): void => {
    if (!this.video || !this.shadow) return;
    // Re-find video if SPA swapped it
    if (!document.contains(this.video)) {
      this.video = this.adapter.findVideo();
    }
    const t = this.mediaTimeMs();
    const cueIndex = this.cues.findIndex((c) => t >= c.startMs && t < c.endMs);
    const cue = cueIndex >= 0 ? this.cues[cueIndex] : null;

    if (cue?.id !== this.currentId) {
      this.currentId = cue?.id ?? '';
      this.renderCue(cue);
      const autoTr =
        this.config.pageSubtitles?.autoTranslate ??
        this.config.features.autoTranslate;
      if (cue && autoTr) {
        if (!cue.translation) {
          void this.translateCue(cue);
        }
        // Pre-fetch next 3 cues
        for (let i = 1; i <= 3; i++) {
          const nextCue = this.cues[cueIndex + i];
          if (nextCue && !nextCue.translation) {
            void this.translateCue(nextCue);
          }
        }
      }
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private renderCue(cue: SubtitleCue | null): void {
    if (!this.shadow) return;
    const en = this.shadow.getElementById('en');
    const tr = this.shadow.getElementById('tr');
    if (!en || !tr) return;

    const mode =
      this.config.pageSubtitles?.style?.displayMode ?? 'bilingual';
    const masterOn = this.config.pageSubtitles?.enabled !== false;

    if (!cue || !this.enabled || !masterOn || mode === 'off') {
      en.textContent = '';
      tr.textContent = '';
      return;
    }

    const showOriginal = mode !== 'translationOnly';
    const showTranslation = mode !== 'originalOnly';
    const hl = this.config.vocabHighlight;

    en.innerHTML = '';
    if (showOriginal) {
      for (const seg of segmentWords(cue.text)) {
        if (isClickableWord(seg)) {
          const span = document.createElement('span');
          span.className = 'ueh-word';
          span.textContent = seg.text;
          if (hl?.enabled) {
            const st = statusForSurface(this.highlightMap, seg.text);
            const cls = highlightClass(st);
            if (cls) {
              span.classList.add(cls);
              span.style.boxShadow = `inset 0 -2px 0 ${colorForStatus(st!, hl)}`;
            }
          }
          span.addEventListener('click', (e) => {
            e.stopPropagation();
            void this.onWordClick(seg.text, cue.text);
          });
          en.appendChild(span);
        } else {
          en.appendChild(document.createTextNode(seg.text));
        }
      }
    }
    tr.textContent =
      showTranslation && cue.translation?.trim() ? cue.translation : '';
  }

  private async onWordClick(surface: string, context: string): Promise<void> {
    await showWordExplainPopup(surface, context, this.root?.ownerDocument || document, async () => {
      await this.refreshHighlightMap();
      this.renderCue(findActiveCue(this.cues, this.mediaTimeMs()));
    });
  }

  private async translateCue(cue: SubtitleCue): Promise<void> {
    if (this.prefetching.has(cue.id)) return;
    this.prefetching.add(cue.id);
    try {
      const res = await sendRuntime<{ items: { id: string; text: string }[] }>(
        'translate.cues',
        {
          cues: [{ id: cue.id, text: cue.text }],
          src: this.config.sourceLang,
          dst: this.config.targetLang,
          mode: 'mt',
        },
        'content',
      );
      if (!res.ok) return;
      const item = res.data.items[0];
      if (!item) return;
      const stored = this.cues.find((c) => c.id === item.id);
      if (stored) {
        stored.translation = item.text;
        const win = this.root?.ownerDocument.defaultView || window;
        win.dispatchEvent(
          new CustomEvent('ueh:cue-translated', {
            detail: { cueId: item.id, translation: item.text },
          })
        );
      }
      if (this.currentId === item.id) {
        this.renderCue(stored ?? cue);
      }
    } finally {
      this.prefetching.delete(cue.id);
    }
  }
}


