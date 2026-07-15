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
  decorateWordSpan,
  type HighlightMap,
} from '../utils/vocab-highlight';
import { CueTranslateScheduler } from './cue-translate';
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
  private translateScheduler: CueTranslateScheduler;
  private enabled = true;
  private running = false;

  constructor(adapter: PlayerAdapter, config: AppConfig) {
    this.adapter = adapter;
    this.config = config;
    this.translateScheduler = new CueTranslateScheduler({
      getConfig: () => this.config,
      getCues: () => this.cues,
      onTranslated: (cueId, translation) => {
        if (this.currentId === cueId) {
          const cue = this.cues.find((c) => c.id === cueId) ?? null;
          this.renderCue(cue);
        }
      },
    });
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
    // Force re-render (word underlines, colors) even if cue id unchanged
    this.currentId = '';
    const active = findActiveCue(this.cues, this.mediaTimeMs());
    this.renderCue(active);
    this.applyAutoTranslateNow(active);
  }

  private wantsAutoTranslate(): boolean {
    return (
      this.config.pageSubtitles?.autoTranslate ??
      this.config.features.autoTranslate
    );
  }

  /** After Settings save: translate active cue if auto-translate is enabled. */
  private applyAutoTranslateNow(cue: SubtitleCue | null): void {
    if (!cue || !this.wantsAutoTranslate()) return;
    if (!cue.translation) {
      void this.translateScheduler.translateMany([cue]);
    }
    this.translateScheduler.prefetchAround(cue, 8);
    void this.translateScheduler.drainAll();
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

    if (this.cues.length) {
      this.notifyCuesUpdated();
      if (this.wantsAutoTranslate()) void this.translateScheduler.drainAll();
    }

    // YouTube tracks often arrive after first paint — retry a few times
    if (!this.cues.length) {
      void this.reloadCuesWithRetry(8);
    }
  }

  private async reloadCues(force = false): Promise<void> {
    try {
      if (force) this.adapter.clearCache?.();
      const cues = await this.adapter.getCues();
      if (cues.length) {
        this.cues = cues;
        this.currentId = '';
        this.renderCue(findActiveCue(this.cues, this.mediaTimeMs()));
        this.notifyCuesUpdated();
        if (this.wantsAutoTranslate()) void this.translateScheduler.drainAll();
      }
    } catch (e) {
      console.warn('[UEH] page subtitles reload failed', e);
    }
  }

  /**
   * Force re-fetch captions (ad end, autoplay next video, SPA video switch).
   * Clears stale cues once up front; retries never wipe a successful load.
   */
  async forceReloadCues(): Promise<void> {
    if (!this.running) return;
    // Autoplay-next reuses or replaces the media element — refresh pointer
    this.video = this.adapter.findVideo() ?? this.video;
    this.adapter.clearCache?.();
    // Drop previous video's lines immediately so they don't linger mid-load
    if (this.cues.length) {
      this.cues = [];
      this.currentId = '';
      this.renderCue(null);
    }
    await this.reloadCues(true);
    if (!this.cues.length) {
      void this.reloadCuesWithRetry(10, /* force */ true);
    }
  }

  private async reloadCuesWithRetry(
    attempts: number,
    force = false,
  ): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      if (!this.running) return;
      // Stop once any path (forceReload, loadPageCues, setCues) filled cues
      if (this.cues.length) return;
      await new Promise((r) => setTimeout(r, 1200));
      await this.reloadCues(force);
      if (this.cues.length) return;
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

  /** Update recap toolbar badge (called from content index). */
  setRecapBadge(text: string): void {
    const badge = this.shadow?.getElementById('ueh-page-recap-badge');
    if (!badge) return;
    badge.textContent = text;
    badge.classList.toggle('on', text.length > 0);
  }

  getCues(): SubtitleCue[] {
    return this.cues;
  }

  setCues(cues: SubtitleCue[]): void {
    this.cues = cues;
    this.renderCue(findActiveCue(this.cues, this.mediaTimeMs()));
    if (this.wantsAutoTranslate()) void this.translateScheduler.drainAll();
  }

  private notifyCuesUpdated(): void {
    window.dispatchEvent(
      new CustomEvent('ueh:page-cues-updated', { detail: { cues: this.cues } }),
    );
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
          cursor: pointer; position: relative;
        }
        #ueh-page-recap-btn { padding-right: 10px; }
        .ueh-page-recap-badge {
          display: none;
          margin-left: 4px;
          min-width: 14px; height: 14px;
          padding: 0 3px;
          border-radius: 999px;
          background: oklch(76% 0.12 82);
          color: #1a1a1a;
          font-size: 8px; font-weight: 800;
          line-height: 14px;
          vertical-align: middle;
        }
        .ueh-page-recap-badge.on { display: inline-block; }
      </style>
      <style id="hl"></style>
      <div id="layer">
        <div id="en"></div>
        <div id="tr"></div>
      </div>
      <div id="tools">
        <button type="button" data-act="recap" id="ueh-page-recap-btn">
          生词<span class="ueh-page-recap-badge" id="ueh-page-recap-badge"></span>
        </button>
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
        if (act === 'recap') {
          window.dispatchEvent(new CustomEvent('ueh:toggle-vocab-recap'));
        } else if (act === 'translate') {
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
    const underline = this.config.wordShow?.underlineWords !== false;
    const en = this.shadow.getElementById('en');
    const tr = this.shadow.getElementById('tr');
    const layer = this.shadow.getElementById('layer');
    const baseStyle = this.shadow.getElementById('base');
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
    // Live-update word underline from wordShow.underlineWords
    if (baseStyle) {
      const border = underline
        ? 'border-bottom: 1px dashed rgba(255,255,255,.35);'
        : 'border-bottom: none;';
      // Patch only the .ueh-word rule via a dedicated style tag
      let dyn = this.shadow.getElementById('dyn-word');
      if (!dyn) {
        dyn = document.createElement('style');
        dyn.id = 'dyn-word';
        this.shadow.appendChild(dyn);
      }
      dyn.textContent = `.ueh-word { ${border} }`;
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
      if (cue && this.wantsAutoTranslate()) {
        if (!cue.translation) void this.translateScheduler.translateMany([cue]);
        this.translateScheduler.prefetchAround(cue, 8);
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
          decorateWordSpan(span, seg.text, this.highlightMap, hl);
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
    const active = findActiveCue(this.cues, this.mediaTimeMs());
    const contextTranslation = active?.translation?.trim();
    await showWordExplainPopup(
      surface,
      context,
      this.root?.ownerDocument || document,
      async () => {
        await this.refreshHighlightMap();
        this.renderCue(findActiveCue(this.cues, this.mediaTimeMs()));
      },
      contextTranslation,
    );
  }

  async translateCue(cue: SubtitleCue): Promise<void> {
    await this.translateScheduler.translateMany([cue]);
  }

  drainTranslations(): void {
    if (!this.wantsAutoTranslate()) return;
    void this.translateScheduler.drainAll();
  }
}


