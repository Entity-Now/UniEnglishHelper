/**
 * Webpage Translation Controller.
 * Coordinates DOM extraction, translation batch requests, rendering, and mode switching.
 */

import type { AppConfig, WebPageTranslateDisplayMode } from '../../shared/domain/types';
import { sendRuntime } from '../../shared/messaging/client';
import { getEffectiveSiteRule } from '../../utils/site-rules/effective';
import {
  extractTranslatableParagraphs,
  type TranslatableParagraph,
} from './dom-walker';
import { WEBPAGE_TRANSLATION_INJECTED_CSS } from './styles';

export type TranslationStatus =
  | 'idle'
  | 'translating'
  | 'translated'
  | 'restored'
  | 'error';

export type ViewMode = 'bilingual' | 'translation_only' | 'original';

export interface TranslationProgress {
  total: number;
  completed: number;
  failed: number;
}

export type StatusListener = (
  status: TranslationStatus,
  progress: TranslationProgress,
  viewMode: ViewMode,
) => void;

const BATCH_SIZE = 10;
const STYLE_TAG_ID = 'ueh-webpage-translate-style';

export class WebpageTranslateController {
  private config: AppConfig;
  private status: TranslationStatus = 'idle';
  private viewMode: ViewMode = 'bilingual';
  private progress: TranslationProgress = { total: 0, completed: 0, failed: 0 };
  private listeners = new Set<StatusListener>();
  private mutationObserver: MutationObserver | null = null;
  private mutationDebounceTimer = 0;
  private isTranslatingBatch = false;
  private translatedParagraphs = new Map<string, HTMLElement>();
  private intersectionObserver: IntersectionObserver | null = null;
  private pendingLazyMap = new Map<Element, TranslatableParagraph>();
  private lazyQueue: TranslatableParagraph[] = [];
  private isProcessingLazyQueue = false;
  private idlePrefetchTimer = 0;

  constructor(config: AppConfig) {
    this.config = config;
    this.viewMode = config.webPageTranslate?.displayMode ?? 'bilingual';
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    this.applyCustomStyles();
  }

  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status, this.progress, this.viewMode);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.status, this.progress, this.viewMode);
      } catch (err) {
        console.error('[UEH] StatusListener error', err);
      }
    }
  }

  getStatus(): {
    status: TranslationStatus;
    progress: TranslationProgress;
    viewMode: ViewMode;
  } {
    return {
      status: this.status,
      progress: this.progress,
      viewMode: this.viewMode,
    };
  }

  async translate(options?: { force?: boolean }): Promise<void> {
    if (this.isTranslatingBatch && !options?.force) return;

    if (this.viewMode === 'original') {
      this.viewMode = this.config.webPageTranslate?.displayMode ?? 'bilingual';
    }

    this.status = 'translating';
    this.ensureInjectedStyles();
    this.applyViewModeToBody();
    this.notify();

    const siteRule = getEffectiveSiteRule(this.config, location.href);
    const paragraphs = extractTranslatableParagraphs(
      document.body,
      siteRule,
      this.config.webPageTranslate?.minCharacters ?? 2,
    );

    // Filter out already processed/tagged paragraphs
    const newParagraphs = paragraphs.filter(
      (p) => !p.element.hasAttribute('data-ueh-trans-id'),
    );

    if (newParagraphs.length === 0) {
      this.status = 'translated';
      this.notify();
      this.ensureMutationObserver();
      return;
    }

    // Partition: First 30 paragraphs or all visible paragraphs get immediate loading pills
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight || 800;
    const immediateParagraphs: TranslatableParagraph[] = [];
    const lazyParagraphs: TranslatableParagraph[] = [];

    for (let i = 0; i < newParagraphs.length; i++) {
      const p = newParagraphs[i];
      const rect = p.element.getBoundingClientRect();
      const isVisibleInViewport =
        rect.top < viewportHeight * 2.0 &&
        rect.bottom > -viewportHeight * 0.5;

      if (isVisibleInViewport || i < 20) {
        immediateParagraphs.push(p);
      } else {
        lazyParagraphs.push(p);
      }
    }

    // If no paragraphs were marked immediate, take first 20
    if (immediateParagraphs.length === 0 && lazyParagraphs.length > 0) {
      immediateParagraphs.push(...lazyParagraphs.splice(0, 20));
    }

    // 1. Immediately render visible loading indicators so user sees active translation feedback
    for (const p of immediateParagraphs) {
      this.renderLoadingPlaceholder(p.element, p.id);
    }

    this.progress = {
      total: this.progress.total + immediateParagraphs.length + lazyParagraphs.length,
      completed: this.progress.completed,
      failed: this.progress.failed,
    };
    this.notify();

    // 2. Setup IntersectionObserver for lazy paragraphs
    this.setupIntersectionObserver();
    for (const p of lazyParagraphs) {
      this.pendingLazyMap.set(p.element, p);
      this.intersectionObserver?.observe(p.element);
    }

    // 3. Process Viewport Batch Immediately (Priority #1)
    this.isTranslatingBatch = true;
    try {
      for (let i = 0; i < immediateParagraphs.length; i += BATCH_SIZE) {
        const chunk = immediateParagraphs.slice(i, i + BATCH_SIZE);
        await this.translateChunk(chunk);
      }
      this.status = 'translated';
    } catch (err) {
      console.error('[UEH] Viewport translation failed', err);
      this.status = 'error';
    } finally {
      this.isTranslatingBatch = false;
      this.notify();
      this.ensureMutationObserver();
      this.scheduleIdlePrefetch();
    }
  }

  private setupIntersectionObserver(): void {
    if (this.intersectionObserver) return;

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        const toProcess: TranslatableParagraph[] = [];

        for (const entry of entries) {
          if (entry.isIntersecting) {
            const target = entry.target as HTMLElement;
            const p = this.pendingLazyMap.get(target);
            if (p) {
              this.intersectionObserver?.unobserve(target);
              this.pendingLazyMap.delete(target);
              toProcess.push(p);
            }
          }
        }

        if (toProcess.length > 0) {
          this.enqueueLazyParagraphs(toProcess);
        }
      },
      {
        rootMargin: '500px 0px 500px 0px',
        threshold: 0.01,
      },
    );
  }

  private enqueueLazyParagraphs(paragraphs: TranslatableParagraph[]): void {
    for (const p of paragraphs) {
      this.renderLoadingPlaceholder(p.element, p.id);
      this.lazyQueue.push(p);
    }
    void this.processLazyQueue();
  }

  private async processLazyQueue(): Promise<void> {
    if (this.isProcessingLazyQueue) return;
    this.isProcessingLazyQueue = true;

    try {
      while (this.lazyQueue.length > 0) {
        const chunk = this.lazyQueue.splice(0, BATCH_SIZE);
        await this.translateChunk(chunk);
      }
    } finally {
      this.isProcessingLazyQueue = false;
      this.notify();
    }
  }

  private scheduleIdlePrefetch(): void {
    window.clearTimeout(this.idlePrefetchTimer);
    this.idlePrefetchTimer = window.setTimeout(() => {
      if (this.pendingLazyMap.size === 0) return;

      // Extract next small batch from pending lazy map to prefetch during user idle
      const nextBatch: TranslatableParagraph[] = [];
      for (const [el, p] of this.pendingLazyMap.entries()) {
        this.intersectionObserver?.unobserve(el);
        this.pendingLazyMap.delete(el);
        nextBatch.push(p);
        if (nextBatch.length >= BATCH_SIZE) break;
      }

      if (nextBatch.length > 0) {
        this.enqueueLazyParagraphs(nextBatch);
        this.scheduleIdlePrefetch();
      }
    }, 2000);
  }

  private renderLoadingPlaceholder(element: HTMLElement, id: string): void {
    if (!element.isConnected) return;
    if (element.hasAttribute('data-ueh-trans-id')) return;

    element.setAttribute('data-ueh-trans-id', id);

    const block = document.createElement('div');
    block.className = 'ueh-translated-block ueh-loading';
    block.setAttribute('data-ueh-translated', 'true');
    block.setAttribute('dir', 'auto');

    const bar = document.createElement('span');
    bar.className = 'ueh-loading-bar';
    block.appendChild(bar);

    const text = document.createElement('span');
    text.className = 'ueh-loading-text';
    text.textContent = '翻译中';
    block.appendChild(text);

    const dots = document.createElement('span');
    dots.className = 'ueh-loading-dots';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'ueh-loading-dot';
      dots.appendChild(dot);
    }
    block.appendChild(dots);

    element.appendChild(block);
    this.translatedParagraphs.set(id, block);
  }

  private removeLoadingPlaceholder(element: HTMLElement, id: string): void {
    element.removeAttribute('data-ueh-trans-id');
    const block =
      this.translatedParagraphs.get(id) ??
      (element.querySelector('.ueh-translated-block.ueh-loading') as HTMLElement | null);
    block?.remove();
    this.translatedParagraphs.delete(id);
  }

  private async translateChunk(chunk: TranslatableParagraph[]): Promise<void> {
    const cuesPayload = chunk.map((p) => ({ id: p.id, text: p.text }));
    const src = this.config.sourceLang || 'auto';
    const dst = this.config.targetLang || 'zh-CN';

    try {
      const res = await sendRuntime<{
        items: { id: string; text: string; provider?: string }[];
      }>(
        'translate.cues',
        { cues: cuesPayload, src, dst, mode: 'mt' },
        'content',
      );

      if (res.ok && Array.isArray(res.data?.items)) {
        const resultMap = new Map(res.data.items.map((it) => [it.id, it.text]));

        for (const p of chunk) {
          const translatedText = resultMap.get(p.id);
          if (translatedText && p.element.isConnected) {
            this.renderTranslatedNode(p.element, p.id, translatedText);
            this.progress.completed += 1;
          } else {
            this.removeLoadingPlaceholder(p.element, p.id);
            this.progress.failed += 1;
          }
        }
      } else {
        for (const p of chunk) {
          this.removeLoadingPlaceholder(p.element, p.id);
        }
        this.progress.failed += chunk.length;
      }
    } catch {
      for (const p of chunk) {
        this.removeLoadingPlaceholder(p.element, p.id);
      }
      this.progress.failed += chunk.length;
    }

    this.notify();
  }

  private renderTranslatedNode(
    element: HTMLElement,
    id: string,
    translatedText: string,
  ): void {
    if (!element.isConnected) return;

    element.setAttribute('data-ueh-trans-id', id);

    let transBlock =
      this.translatedParagraphs.get(id) ??
      (element.querySelector(
        '.ueh-translated-block[data-ueh-translated="true"]',
      ) as HTMLElement | null);

    if (!transBlock) {
      transBlock = document.createElement('div');
      transBlock.className = 'ueh-translated-block';
      transBlock.setAttribute('data-ueh-translated', 'true');
      transBlock.setAttribute('dir', 'auto');
      element.appendChild(transBlock);
      this.translatedParagraphs.set(id, transBlock);
    }

    transBlock.classList.remove('ueh-loading');
    transBlock.textContent = translatedText;
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.applyViewModeToBody();
    this.notify();
  }

  private applyViewModeToBody(): void {
    document.body.setAttribute('data-ueh-view-mode', this.viewMode);
  }

  restore(): void {
    this.status = 'restored';
    this.viewMode = 'original';
    this.applyViewModeToBody();

    window.clearTimeout(this.idlePrefetchTimer);
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
    this.pendingLazyMap.clear();
    this.lazyQueue = [];

    // Remove all translated elements
    const elements = document.querySelectorAll('.ueh-translated-block, .ueh-translated-inline');
    elements.forEach((el) => el.remove());

    const tagged = document.querySelectorAll('[data-ueh-trans-id]');
    tagged.forEach((el) => el.removeAttribute('data-ueh-trans-id'));

    this.translatedParagraphs.clear();
    this.progress = { total: 0, completed: 0, failed: 0 };
    this.notify();
  }

  private ensureInjectedStyles(): void {
    let style = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_TAG_ID;
      document.head.appendChild(style);
    }

    const siteRule = getEffectiveSiteRule(this.config, location.href);
    const customInjectedCss = siteRule.injectedCss ?? '';

    style.textContent = `${WEBPAGE_TRANSLATION_INJECTED_CSS}\n${customInjectedCss}`;
    this.applyCustomStyles();
  }

  private applyCustomStyles(): void {
    const scale = this.config.webPageTranslate?.fontSizeScale ?? 88;
    const color = this.config.webPageTranslate?.translationColor?.trim();

    if (scale !== 100) {
      document.documentElement.style.setProperty(
        '--ueh-trans-font-size',
        `${scale / 100}em`,
      );
    } else {
      document.documentElement.style.removeProperty('--ueh-trans-font-size');
    }

    if (color) {
      document.documentElement.style.setProperty('--ueh-trans-color', color);
      document.documentElement.style.setProperty('--ueh-trans-opacity', '0.95');
    } else {
      document.documentElement.style.removeProperty('--ueh-trans-color');
      document.documentElement.style.removeProperty('--ueh-trans-opacity');
    }
  }

  private ensureMutationObserver(): void {
    if (this.mutationObserver) return;

    this.mutationObserver = new MutationObserver(() => {
      if (this.status !== 'translated' && this.status !== 'translating') return;
      if (this.isTranslatingBatch) return;

      window.clearTimeout(this.mutationDebounceTimer);
      this.mutationDebounceTimer = window.setTimeout(() => {
        void this.translate({ force: false });
      }, 700);
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  destroy(): void {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    this.restore();
    this.listeners.clear();
  }
}
