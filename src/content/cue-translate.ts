import type { AppConfig, SubtitleCue } from '../shared/domain/types';
import { sendRuntime } from '../shared/messaging/client';

const BATCH_SIZE = 20;
const MAX_RETRIES = 2;

/** Notify page cue list, PiP list, and other listeners. */
export function broadcastCueTranslated(
  cueId: string,
  translation: string,
  extraWindows: (Window | null | undefined)[] = [],
): void {
  const wins = new Set<Window>();
  wins.add(window);
  for (const w of extraWindows) {
    if (w) wins.add(w);
  }
  for (const win of wins) {
    win.dispatchEvent(
      new CustomEvent('ueh:cue-translated', {
        detail: { cueId, translation },
      }),
    );
  }
}

export type CueTranslateHooks = {
  getConfig: () => AppConfig;
  getCues: () => SubtitleCue[];
  extraWindows?: () => (Window | null | undefined)[];
  onTranslated?: (cueId: string, translation: string) => void;
};

/**
 * Background subtitle translation with batching, retries, and cross-window broadcast.
 */
export class CueTranslateScheduler {
  private prefetching = new Set<string>();
  private draining = false;
  private retries = new Map<string, number>();
  private retryTimers = new Set<number>();
  private generation = 0;

  constructor(private hooks: CueTranslateHooks) {}

  /** Cancel any in-flight drain loop or retry timers from a previous video. */
  reset(): void {
    this.generation += 1;
    this.draining = false;
    this.prefetching.clear();
    this.retries.clear();
    for (const id of this.retryTimers) {
      window.clearTimeout(id);
    }
    this.retryTimers.clear();
  }

  private apply(cueId: string, translation: string): void {
    const stored = this.hooks.getCues().find((c) => c.id === cueId);
    if (stored) stored.translation = translation;
    broadcastCueTranslated(
      cueId,
      translation,
      this.hooks.extraWindows?.() ?? [],
    );
    this.hooks.onTranslated?.(cueId, translation);
  }

  async translateMany(cues: SubtitleCue[], gen = this.generation): Promise<void> {
    if (gen !== this.generation) return;
    const pending = cues.filter(
      (c) => !c.translation?.trim() && !this.prefetching.has(c.id),
    );
    if (!pending.length) return;

    for (const c of pending) this.prefetching.add(c.id);
    const config = this.hooks.getConfig();

    try {
      const res = await sendRuntime<{ items: { id: string; text: string }[] }>(
        'translate.cues',
        {
          cues: pending.map((c) => ({ id: c.id, text: c.text })),
          src: config.sourceLang,
          dst: config.targetLang,
        },
        'content',
      );

      if (gen !== this.generation) return;

      if (!res.ok) {
        this.scheduleRetries(pending, gen);
        return;
      }

      const returned = new Set<string>();
      for (const item of res.data.items) {
        const text = item.text?.trim();
        if (!text) continue;
        returned.add(item.id);
        this.apply(item.id, text);
      }

      const missing = pending.filter((c) => !returned.has(c.id));
      if (missing.length) this.scheduleRetries(missing, gen);
    } catch {
      if (gen === this.generation) {
        this.scheduleRetries(pending, gen);
      }
    } finally {
      for (const c of pending) this.prefetching.delete(c.id);
    }
  }

  /**
   * Explicitly translate/re-translate cues on user demand (e.g. PiP "翻译当前句"),
   * bypassing empty-check and returning outcome for UI feedback.
   */
  async translateForce(
    cues: SubtitleCue[],
  ): Promise<{ ok: boolean; count: number; error?: string }> {
    const valid = cues.filter((c) => Boolean(c?.text?.trim()));
    if (!valid.length) return { ok: false, count: 0, error: '当前没有可翻译的字幕文本' };
    const gen = this.generation;
    const config = this.hooks.getConfig();
    try {
      const res = await sendRuntime<{ items: { id: string; text: string }[] }>(
        'translate.cues',
        {
          cues: valid.map((c) => ({ id: c.id, text: c.text })),
          src: config.sourceLang,
          dst: config.targetLang,
        },
        'content',
      );
      if (gen !== this.generation) return { ok: false, count: 0 };
      if (!res.ok) {
        return {
          ok: false,
          count: 0,
          error: res.error?.message || '翻译请求失败',
        };
      }
      let count = 0;
      for (const item of res.data.items) {
        const text = item.text?.trim();
        if (!text) continue;
        this.retries.delete(item.id);
        this.apply(item.id, text);
        count++;
      }
      if (count === 0) {
        return { ok: false, count: 0, error: '翻译服务返回为空' };
      }
      return { ok: true, count };
    } catch (err) {
      return {
        ok: false,
        count: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private scheduleRetries(cues: SubtitleCue[], gen = this.generation): void {
    if (gen !== this.generation) return;
    for (const c of cues) {
      const n = this.retries.get(c.id) ?? 0;
      if (n >= MAX_RETRIES) continue;
      this.retries.set(c.id, n + 1);
      const timerId = window.setTimeout(() => {
        this.retryTimers.delete(timerId);
        if (gen !== this.generation) return;
        void this.translateMany([c], gen);
      }, 1200 * (n + 1));
      this.retryTimers.add(timerId);
    }
  }

  /** Prefetch current + next N cues (playback). */
  prefetchAround(current: SubtitleCue | null, ahead = 8): void {
    if (!current) return;
    const cues = this.hooks.getCues();
    const idx = cues.findIndex((c) => c.id === current.id);
    if (idx < 0) return;
    const batch: SubtitleCue[] = [];
    for (let i = 0; i <= ahead; i++) {
      const c = cues[idx + i];
      if (c && !c.translation?.trim() && !this.prefetching.has(c.id)) {
        batch.push(c);
      }
    }
    if (batch.length) void this.translateMany(batch);
  }

  /** Translate all missing cues in batches (list / full-video prefetch). */
  async drainAll(): Promise<void> {
    if (this.draining) return;
    const gen = this.generation;
    this.draining = true;
    try {
      for (let offset = 0; gen === this.generation; offset += BATCH_SIZE) {
        const cues = this.hooks.getCues();
        if (offset >= cues.length) break;
        const batch = cues
          .slice(offset, offset + BATCH_SIZE)
          .filter((c) => !c.translation?.trim());
        if (batch.length) await this.translateMany(batch, gen);
        if (gen !== this.generation) break;
        await new Promise((r) => setTimeout(r, 80));
      }
    } finally {
      if (gen === this.generation) {
        this.draining = false;
      }
    }
  }
}