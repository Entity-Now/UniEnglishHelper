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

  constructor(private hooks: CueTranslateHooks) {}

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

  async translateMany(cues: SubtitleCue[]): Promise<void> {
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

      if (!res.ok) {
        this.scheduleRetries(pending);
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
      if (missing.length) this.scheduleRetries(missing);
    } catch {
      this.scheduleRetries(pending);
    } finally {
      for (const c of pending) this.prefetching.delete(c.id);
    }
  }

  private scheduleRetries(cues: SubtitleCue[]): void {
    for (const c of cues) {
      const n = this.retries.get(c.id) ?? 0;
      if (n >= MAX_RETRIES) continue;
      this.retries.set(c.id, n + 1);
      window.setTimeout(
        () => void this.translateMany([c]),
        1200 * (n + 1),
      );
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
    this.draining = true;
    try {
      const cues = this.hooks.getCues();
      for (let offset = 0; offset < cues.length; offset += BATCH_SIZE) {
        const batch = cues
          .slice(offset, offset + BATCH_SIZE)
          .filter((c) => !c.translation?.trim());
        if (batch.length) await this.translateMany(batch);
        await new Promise((r) => setTimeout(r, 80));
      }
    } finally {
      this.draining = false;
    }
  }
}