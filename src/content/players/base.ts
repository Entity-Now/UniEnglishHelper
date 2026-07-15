import type { SubtitleCue } from '../../shared/domain/types';

/** Options for caption fetch. */
export interface GetCuesOptions {
  /**
   * - `display` (default): full fetch, may wait for pot-bearing timedtext.
   * - `preload`: fetch main-video captions during ads without long pot wait;
   *   result is stored for instant apply when the ad ends.
   */
  purpose?: 'display' | 'preload';
  /**
   * Skip shared ad-time preload cache and re-fetch from network
   * (background revalidate after instant apply).
   */
  bypassPreload?: boolean;
}

export interface PlayerAdapter {
  readonly id: string;
  readonly supportsMove: boolean;
  findVideo(): HTMLVideoElement | null;
  getCues(options?: GetCuesOptions): Promise<SubtitleCue[]>;
  /** Drop in-memory caption cache (e.g. after YouTube ad ends). */
  clearCache?(): void;
  onCuesChanged?(cb: (cues: SubtitleCue[]) => void): () => void;
}

export abstract class BasePlayerAdapter implements PlayerAdapter {
  abstract readonly id: string;
  abstract readonly supportsMove: boolean;
  abstract findVideo(): HTMLVideoElement | null;
  abstract getCues(options?: GetCuesOptions): Promise<SubtitleCue[]>;
}
