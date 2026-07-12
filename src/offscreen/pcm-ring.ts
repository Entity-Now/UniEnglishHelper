import type { MediaTimeAnchor } from '../shared/domain/types';
import { SUPPORTED_PLAYBACK_RATES } from '../shared/constants';
import { AppError } from '../shared/messages/errors';

export class PcmRingBuffer {
  readonly sampleRate: number;
  readonly capacitySamples: number;
  private buffer: Float32Array;
  private writeIndex = 0;
  private filled = 0;
  /** audioTimeMs corresponding to the sample just before writeIndex (newest) */
  private newestAudioTimeMs = 0;
  private hasTime = false;

  constructor(sampleRate: number, ringSeconds: number) {
    this.sampleRate = sampleRate;
    this.capacitySamples = Math.max(1, Math.floor(sampleRate * ringSeconds));
    this.buffer = new Float32Array(this.capacitySamples);
  }

  push(frames: Float32Array, audioTimeMsEnd: number): void {
    for (let i = 0; i < frames.length; i++) {
      this.buffer[this.writeIndex] = frames[i];
      this.writeIndex = (this.writeIndex + 1) % this.capacitySamples;
      if (this.filled < this.capacitySamples) this.filled += 1;
    }
    this.newestAudioTimeMs = audioTimeMsEnd;
    this.hasTime = true;
  }

  /** Oldest sample audio time currently in ring */
  oldestAudioTimeMs(): number | null {
    if (!this.hasTime || this.filled === 0) return null;
    const durationMs = (this.filled / this.sampleRate) * 1000;
    return this.newestAudioTimeMs - durationMs;
  }

  newestTimeMs(): number | null {
    return this.hasTime ? this.newestAudioTimeMs : null;
  }

  fillRatio(): number {
    return this.filled / this.capacitySamples;
  }

  /**
   * Slice samples covering [startAudioMs, endAudioMs] inclusive-ish.
   */
  sliceByAudioTime(startAudioMs: number, endAudioMs: number): Float32Array {
    if (!this.hasTime || this.filled === 0) {
      throw new AppError('CLIP_NOT_IN_RING', 'Ring is empty');
    }
    const oldest = this.oldestAudioTimeMs()!;
    const newest = this.newestAudioTimeMs;
    if (startAudioMs < oldest - 5 || endAudioMs > newest + 5) {
      throw new AppError(
        'CLIP_NOT_IN_RING',
        `Range [${startAudioMs},${endAudioMs}] outside ring [${oldest},${newest}]`,
      );
    }

    const startOffsetMs = Math.max(0, startAudioMs - oldest);
    const endOffsetMs = Math.min(newest - oldest, endAudioMs - oldest);
    const startSample = Math.floor((startOffsetMs / 1000) * this.sampleRate);
    const endSample = Math.ceil((endOffsetMs / 1000) * this.sampleRate);
    const length = Math.max(0, endSample - startSample);
    const out = new Float32Array(length);

    // Physical index of oldest sample
    const oldestIndex =
      (this.writeIndex - this.filled + this.capacitySamples) % this.capacitySamples;

    for (let i = 0; i < length; i++) {
      const idx = (oldestIndex + startSample + i) % this.capacitySamples;
      out[i] = this.buffer[idx];
    }
    return out;
  }
}

export class AnchorStore {
  private anchors: MediaTimeAnchor[] = [];
  private epoch = 0;

  get currentEpoch(): number {
    return this.epoch;
  }

  clear(): void {
    this.anchors = [];
    this.epoch = 0;
  }

  append(anchors: MediaTimeAnchor[]): number {
    for (const a of anchors) {
      if (a.epoch !== this.epoch && this.anchors.length === 0) {
        this.epoch = a.epoch;
      }
      if (a.epoch !== this.epoch) {
        // epoch jump — drop old anchors
        this.epoch = a.epoch;
        this.anchors = [];
      }
      this.anchors.push(a);
      // keep last ~500 anchors
      if (this.anchors.length > 500) {
        this.anchors.splice(0, this.anchors.length - 500);
      }
    }
    return anchors.length;
  }

  mediaToAudio(mediaTimeMs: number, epoch: number): number {
    if (epoch !== this.epoch) {
      throw new AppError('CLIP_EPOCH_MISMATCH', 'Epoch mismatch');
    }
    const list = this.anchors;
    if (list.length < 2) {
      throw new AppError('CLIP_NOT_IN_RING', 'Not enough anchors');
    }

    // find bracketing anchors with same epoch
    let i = 0;
    while (i < list.length - 1 && list[i + 1].mediaTimeMs < mediaTimeMs) {
      i += 1;
    }
    const a = list[Math.max(0, i)];
    const b = list[Math.min(list.length - 1, i + 1)];

    if (!SUPPORTED_PLAYBACK_RATES.includes(a.playbackRate as 0.75 | 1 | 1.25)) {
      throw new AppError(
        'CLIP_RATE_UNSUPPORTED',
        `Unsupported rate ${a.playbackRate}`,
      );
    }

    if (a.mediaTimeMs === b.mediaTimeMs) return a.audioTimeMs;
    const t =
      (mediaTimeMs - a.mediaTimeMs) / (b.mediaTimeMs - a.mediaTimeMs);
    return a.audioTimeMs + t * (b.audioTimeMs - a.audioTimeMs);
  }
}
