/**
 * Webpage translation controller.
 * Viewport-first batches, session cache, and DOM that inherits host typography.
 */

import type { AppConfig } from '../../shared/domain/types';
import { sendRuntime } from '../../shared/messaging/client';
import { getLanguageDirectionAndLang } from '../../utils/content/language-direction';
import { getEffectiveSiteRule } from '../../utils/site-rules/effective';
import {
  extractTranslatableParagraphs,
  isOwnTranslationNode,
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

const BATCH_SIZE = 16;
const MAX_WORKERS = 2;
const STYLE_TAG_ID = 'ueh-webpage-translate-style';
const ORIGINAL_WRAP_CLASS = 'ueh-original-wrap';

export class WebpageTranslateController {
  private config: AppConfig;
  private status: TranslationStatus = 'idle';
  private viewMode: ViewMode = 'bilingual';
  private progress: TranslationProgress = { total: 0, completed: 0, failed: 0 };
  private listeners = new Set<StatusListener>();
  private mutationObserver: MutationObserver | null = null;
  private mutationDebounceTimer = 0;
  private translatedParagraphs = new Map<string, HTMLElement>();
  private intersectionObserver: IntersectionObserver | null = null;
  private pendingLazyMap = new Map<Element, TranslatableParagraph>();
  private highQueue: TranslatableParagraph[] = [];
  private lowQueue: TranslatableParagraph[] = [];
  private queuedIds = new Set<string>();
  private claimedElements = new Set<HTMLElement>();
  private activeWorkers = 0;
  private idlePrefetchHandle = 0;
  private mutating = false;
  private translationCache = new Map<string, string>();
  private pendingMutationRoots: HTMLElement[] = [];

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

  async translate(options?: {
    force?: boolean;
    root?: HTMLElement | Document;
  }): Promise<void> {
    if (this.viewMode === 'original') {
      this.viewMode = this.config.webPageTranslate?.displayMode ?? 'bilingual';
    }

    this.status = 'translating';
    this.ensureInjectedStyles();
    this.applyViewModeToBody();
    this.notify();

    const siteRule = getEffectiveSiteRule(this.config, location.href);
    const paragraphs = extractTranslatableParagraphs(
      options?.root ?? document.body,
      siteRule,
      {
        minCharacters: this.config.webPageTranslate?.minCharacters ?? 2,
        targetLang: this.config.targetLang || 'zh-CN',
      },
    );

    const fresh = paragraphs.filter((p) => {
      if (p.element.hasAttribute('data-ueh-trans-id')) return false;
      if (this.claimedElements.has(p.element)) return false;
      if (this.pendingLazyMap.has(p.element)) return false;
      return true;
    });
    for (const p of fresh) this.claimedElements.add(p.element);

    if (fresh.length === 0) {
      if (this.activeWorkers === 0 && this.highQueue.length === 0 && this.lowQueue.length === 0) {
        this.status = this.progress.completed > 0 || this.translatedParagraphs.size > 0
          ? 'translated'
          : this.status;
        if (this.status === 'translating' && this.translatedParagraphs.size > 0) {
          this.status = 'translated';
        } else if (this.status === 'translating' && this.pendingLazyMap.size === 0) {
          this.status = 'translated';
        }
        this.notify();
      }
      this.ensureMutationObserver();
      return;
    }

    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight || 800;
    const immediate: TranslatableParagraph[] = [];
    const lazy: TranslatableParagraph[] = [];

    for (const p of fresh) {
      const rect = p.element.getBoundingClientRect();
      const visible =
        rect.width + rect.height > 0 &&
        rect.top < viewportHeight * 1.6 &&
        rect.bottom > -viewportHeight * 0.25;
      if (visible) immediate.push(p);
      else lazy.push(p);
    }

    this.progress = {
      total: this.progress.total + immediate.length + lazy.length,
      completed: this.progress.completed,
      failed: this.progress.failed,
    };

    this.withDomMutation(() => {
      for (const p of immediate) {
        if (this.viewMode === 'translation_only') {
          this.ensureOriginalWrap(p.element);
          p.element.setAttribute('data-ueh-trans-id', p.id);
        } else {
          this.renderLoadingPlaceholder(p);
        }
      }
    });

    this.enqueue(immediate, 'high');

    this.setupIntersectionObserver();
    for (const p of lazy) {
      this.pendingLazyMap.set(p.element, p);
      this.intersectionObserver?.observe(p.element);
    }

    this.notify();
    this.kickWorkers();
    this.ensureMutationObserver();
    this.scheduleIdlePrefetch();
  }

  private enqueue(items: TranslatableParagraph[], priority: 'high' | 'low'): void {
    const target = priority === 'high' ? this.highQueue : this.lowQueue;
    for (const p of items) {
      if (this.queuedIds.has(p.id)) continue;
      this.queuedIds.add(p.id);
      target.push(p);
    }
  }

  private dequeueChunk(): TranslatableParagraph[] | null {
    const source = this.highQueue.length > 0 ? this.highQueue : this.lowQueue;
    if (source.length === 0) return null;
    return source.splice(0, BATCH_SIZE);
  }

  private kickWorkers(): void {
    const idle = MAX_WORKERS - this.activeWorkers;
    for (let i = 0; i < idle; i++) {
      if (this.highQueue.length === 0 && this.lowQueue.length === 0) break;
      void this.runWorker();
    }
  }

  private async runWorker(): Promise<void> {
    this.activeWorkers += 1;
    this.status = 'translating';
    try {
      while (true) {
        const chunk = this.dequeueChunk();
        if (!chunk) break;
        await this.translateChunk(chunk);
      }
    } catch (err) {
      console.error('[UEH] Translation worker failed', err);
      this.status = 'error';
    } finally {
      this.activeWorkers -= 1;
      if (this.activeWorkers === 0 && this.highQueue.length === 0 && this.lowQueue.length === 0) {
        if (this.status !== 'error') this.status = 'translated';
        this.notify();
        this.scheduleIdlePrefetch();
      }
    }
  }

  private setupIntersectionObserver(): void {
    if (this.intersectionObserver) return;

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        const toProcess: TranslatableParagraph[] = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = entry.target as HTMLElement;
          const p = this.pendingLazyMap.get(target);
          if (!p) continue;
          this.intersectionObserver?.unobserve(target);
          this.pendingLazyMap.delete(target);
          toProcess.push(p);
        }
        if (toProcess.length === 0) return;
        this.withDomMutation(() => {
          for (const p of toProcess) {
            if (this.viewMode === 'translation_only') {
              this.ensureOriginalWrap(p.element);
              p.element.setAttribute('data-ueh-trans-id', p.id);
            } else {
              this.renderLoadingPlaceholder(p);
            }
          }
        });
        this.enqueue(toProcess, 'high');
        this.kickWorkers();
      },
      {
        rootMargin: '420px 0px 420px 0px',
        threshold: 0.01,
      },
    );
  }

  private scheduleIdlePrefetch(): void {
    this.cancelIdlePrefetch();
    if (this.pendingLazyMap.size === 0) return;

    const run = (deadline?: IdleDeadline) => {
      if (this.pendingLazyMap.size === 0) return;
      if (deadline && deadline.timeRemaining() < 8) {
        this.scheduleIdlePrefetch();
        return;
      }
      const nextBatch: TranslatableParagraph[] = [];
      for (const [el, p] of this.pendingLazyMap.entries()) {
        this.intersectionObserver?.unobserve(el);
        this.pendingLazyMap.delete(el);
        nextBatch.push(p);
        if (nextBatch.length >= BATCH_SIZE) break;
      }
      if (nextBatch.length === 0) return;
      // Below-the-fold: skip skeleton to avoid extra layout shift; paint once.
      this.enqueue(nextBatch, 'low');
      this.kickWorkers();
      if (this.pendingLazyMap.size > 0) this.scheduleIdlePrefetch();
    };

    if (typeof window.requestIdleCallback === 'function') {
      this.idlePrefetchHandle = window.requestIdleCallback(run, { timeout: 2500 });
    } else {
      this.idlePrefetchHandle = window.setTimeout(() => run(), 1600);
    }
  }

  private cancelIdlePrefetch(): void {
    if (!this.idlePrefetchHandle) return;
    if (typeof window.cancelIdleCallback === 'function') {
      try {
        window.cancelIdleCallback(this.idlePrefetchHandle);
      } catch {
        window.clearTimeout(this.idlePrefetchHandle);
      }
    } else {
      window.clearTimeout(this.idlePrefetchHandle);
    }
    this.idlePrefetchHandle = 0;
  }

  private withDomMutation(fn: () => void): void {
    this.mutating = true;
    try {
      fn();
    } finally {
      this.mutating = false;
    }
  }

  private ensureOriginalWrap(element: HTMLElement): void {
    if (element.querySelector(`:scope > .${ORIGINAL_WRAP_CLASS}`)) return;

    const wrap = document.createElement('span');
    wrap.className = ORIGINAL_WRAP_CLASS;

    const moving: ChildNode[] = [];
    for (const child of Array.from(element.childNodes)) {
      if (
        child instanceof HTMLElement &&
        (child.hasAttribute('data-ueh-translated') ||
          child.classList.contains(ORIGINAL_WRAP_CLASS))
      ) {
        continue;
      }
      moving.push(child);
    }
    for (const node of moving) wrap.appendChild(node);
    element.insertBefore(wrap, element.firstChild);
  }

  private unwrapOriginal(element: HTMLElement): void {
    const wrap = element.querySelector(`:scope > .${ORIGINAL_WRAP_CLASS}`);
    if (!wrap) return;
    const parent = wrap.parentNode;
    if (!parent) {
      wrap.remove();
      return;
    }
    while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
    wrap.remove();
  }

  private skeletonWidth(text: string, inline: boolean): string {
    const units = inline
      ? Math.min(18, Math.max(6, Math.round(text.length * 0.45)))
      : Math.min(52, Math.max(10, Math.round(text.length * 0.55)));
    return `${units}ch`;
  }

  private renderLoadingPlaceholder(p: TranslatableParagraph): void {
    const { element, id, inline, text } = p;
    if (!element.isConnected) return;
    if (element.hasAttribute('data-ueh-trans-id')) return;

    this.ensureOriginalWrap(element);
    element.setAttribute('data-ueh-trans-id', id);

    const block = document.createElement('span');
    block.className = inline
      ? 'ueh-translated-inline ueh-loading'
      : 'ueh-translated-block ueh-loading';
    block.setAttribute('data-ueh-translated', 'true');
    block.setAttribute('aria-hidden', 'true');
    block.style.setProperty('--ueh-skel-width', this.skeletonWidth(text, inline));

    element.appendChild(block);
    this.translatedParagraphs.set(id, block);
  }

  private removeLoadingPlaceholder(element: HTMLElement, id: string): void {
    const block =
      this.translatedParagraphs.get(id) ??
      (element.querySelector('.ueh-translated-block.ueh-loading, .ueh-translated-inline.ueh-loading') as
        | HTMLElement
        | null);
    block?.remove();
    this.translatedParagraphs.delete(id);
    if (!element.querySelector('[data-ueh-translated]')) {
      this.unwrapOriginal(element);
      element.removeAttribute('data-ueh-trans-id');
      this.claimedElements.delete(element);
    }
  }

  private cacheKey(text: string): string {
    return `${this.config.sourceLang || 'auto'}|${this.config.targetLang || 'zh-CN'}|${text}`;
  }

  private rememberTranslation(source: string, translated: string): void {
    this.translationCache.set(this.cacheKey(source), translated);
    if (this.translationCache.size <= 800) return;
    const oldest = this.translationCache.keys().next().value;
    if (oldest) this.translationCache.delete(oldest);
  }

  private async translateChunk(chunk: TranslatableParagraph[]): Promise<void> {
    const live = chunk.filter((p) => p.element.isConnected);
    if (live.length === 0) return;

    const cachedHits: { p: TranslatableParagraph; text: string }[] = [];
    const need: TranslatableParagraph[] = [];

    for (const p of live) {
      const hit = this.translationCache.get(this.cacheKey(p.text));
      if (hit) cachedHits.push({ p, text: hit });
      else need.push(p);
    }

    if (cachedHits.length) {
      this.withDomMutation(() => {
        for (const { p, text } of cachedHits) {
          this.applyTranslation(p, text);
          this.progress.completed += 1;
        }
      });
      this.notify();
    }

    if (need.length === 0) return;

    const cuesPayload = need.map((p) => ({ id: p.id, text: p.text }));
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
        this.withDomMutation(() => {
          for (const p of need) {
            const translatedText = resultMap.get(p.id)?.trim();
            if (translatedText && p.element.isConnected) {
              this.rememberTranslation(p.text, translatedText);
              this.applyTranslation(p, translatedText);
              this.progress.completed += 1;
            } else {
              this.removeLoadingPlaceholder(p.element, p.id);
              this.progress.failed += 1;
            }
          }
        });
      } else {
        this.withDomMutation(() => {
          for (const p of need) this.removeLoadingPlaceholder(p.element, p.id);
        });
        this.progress.failed += need.length;
      }
    } catch {
      this.withDomMutation(() => {
        for (const p of need) this.removeLoadingPlaceholder(p.element, p.id);
      });
      this.progress.failed += need.length;
    }

    this.notify();
  }

  private applyTranslation(p: TranslatableParagraph, translatedText: string): void {
    const { element, id, inline, text } = p;
    if (!element.isConnected) return;

    // Identical output (names, codes) would just duplicate the line.
    if (translatedText === text) {
      this.removeLoadingPlaceholder(element, id);
      return;
    }

    this.ensureOriginalWrap(element);
    element.setAttribute('data-ueh-trans-id', id);

    let transBlock =
      this.translatedParagraphs.get(id) ??
      (element.querySelector(
        '[data-ueh-translated="true"]',
      ) as HTMLElement | null);

    if (!transBlock) {
      transBlock = document.createElement('span');
      transBlock.className = inline ? 'ueh-translated-inline' : 'ueh-translated-block';
      transBlock.setAttribute('data-ueh-translated', 'true');
      element.appendChild(transBlock);
      this.translatedParagraphs.set(id, transBlock);
    }

    const dst = this.config.targetLang || 'zh-CN';
    const { dir, lang } = getLanguageDirectionAndLang(dst);
    transBlock.className = inline ? 'ueh-translated-inline' : 'ueh-translated-block';
    transBlock.classList.remove('ueh-loading');
    transBlock.removeAttribute('aria-hidden');
    transBlock.setAttribute('dir', dir);
    if (lang) transBlock.setAttribute('lang', lang);
    transBlock.style.removeProperty('--ueh-skel-width');
    transBlock.textContent = translatedText;
    element.classList.add('ueh-has-translation');
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

    this.cancelIdlePrefetch();
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
    this.pendingLazyMap.clear();
    this.highQueue = [];
    this.lowQueue = [];
    this.queuedIds.clear();
    this.claimedElements.clear();
    this.pendingMutationRoots = [];

    this.withDomMutation(() => {
      document
        .querySelectorAll('.ueh-translated-block, .ueh-translated-inline')
        .forEach((el) => el.remove());

      document.querySelectorAll(`.${ORIGINAL_WRAP_CLASS}`).forEach((wrap) => {
        const parent = wrap.parentNode;
        if (!parent) {
          wrap.remove();
          return;
        }
        while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
        wrap.remove();
      });

      document.querySelectorAll('[data-ueh-trans-id]').forEach((el) => {
        el.removeAttribute('data-ueh-trans-id');
        el.classList.remove('ueh-has-translation');
      });
    });

    this.translatedParagraphs.clear();
    this.progress = { total: 0, completed: 0, failed: 0 };
    document.body.removeAttribute('data-ueh-view-mode');
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
    const scale = this.config.webPageTranslate?.fontSizeScale ?? 94;
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
    } else {
      document.documentElement.style.removeProperty('--ueh-trans-color');
    }
    document.documentElement.style.removeProperty('--ueh-trans-opacity');
  }

  private ensureMutationObserver(): void {
    if (this.mutationObserver) return;

    this.mutationObserver = new MutationObserver((mutations) => {
      if (this.mutating) return;
      if (this.status !== 'translated' && this.status !== 'translating') return;

      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (isOwnTranslationNode(node)) continue;
          this.pendingMutationRoots.push(node);
        }
      }

      if (this.pendingMutationRoots.length === 0) return;

      window.clearTimeout(this.mutationDebounceTimer);
      this.mutationDebounceTimer = window.setTimeout(() => {
        const roots = this.pendingMutationRoots.splice(0);
        const connected = roots.filter((el) => el.isConnected);
        if (connected.length === 0) return;
        if (connected.length > 12) {
          void this.translate({ root: document.body });
          return;
        }
        for (const root of connected) {
          void this.translate({ root });
        }
      }, 420);
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
    window.clearTimeout(this.mutationDebounceTimer);
    this.restore();
    this.translationCache.clear();
    this.listeners.clear();
  }
}
