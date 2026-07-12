import type { MediaTimelineSample } from '../shared/domain/types';
import { NFR } from '../shared/nfr';
import { sendRuntime } from '../shared/messaging/client';

export class MediaTimelineSampler {
  private video: HTMLVideoElement | null = null;
  private sessionId: string | null = null;
  private epoch = 0;
  private timer: number | null = null;
  private batch: MediaTimelineSample[] = [];
  private running = false;

  getEpoch(): number {
    return this.epoch;
  }

  attach(video: HTMLVideoElement): void {
    if (this.video === video) return;
    this.detachVideoListeners();
    this.video = video;
    this.epoch += 1;
    this.bindVideoListeners();
  }

  start(sessionId: string): void {
    this.sessionId = sessionId;
    this.running = true;
    this.tick();
    if (this.timer != null) window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), NFR.anchorIntervalMs);
  }

  stop(): void {
    this.running = false;
    this.sessionId = null;
    if (this.timer != null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.batch = [];
  }

  bumpEpoch(): void {
    this.epoch += 1;
    void this.flush(true);
  }

  private bindVideoListeners(): void {
    if (!this.video) return;
    const v = this.video;
    const onSeek = () => this.bumpEpoch();
    const onRate = () => void this.flush(true);
    const onPlayPause = () => void this.flush(true);
    v.addEventListener('seeked', onSeek);
    v.addEventListener('ratechange', onRate);
    v.addEventListener('play', onPlayPause);
    v.addEventListener('pause', onPlayPause);
    v.addEventListener('emptied', onSeek);
    (this as unknown as { _cleanup?: () => void })._cleanup = () => {
      v.removeEventListener('seeked', onSeek);
      v.removeEventListener('ratechange', onRate);
      v.removeEventListener('play', onPlayPause);
      v.removeEventListener('pause', onPlayPause);
      v.removeEventListener('emptied', onSeek);
    };
  }

  private detachVideoListeners(): void {
    (this as unknown as { _cleanup?: () => void })._cleanup?.();
  }

  private sample(): MediaTimelineSample | null {
    const v = this.video;
    if (!v) return null;
    return {
      mediaTimeMs: Math.round(v.currentTime * 1000),
      playbackRate: v.playbackRate,
      paused: v.paused,
      epoch: this.epoch,
      wallClockMs: Date.now(),
    };
  }

  private tick(): void {
    if (!this.running) return;
    const s = this.sample();
    if (s) this.batch.push(s);
    if (this.batch.length >= 3) void this.flush(false);
  }

  private async flush(force: boolean): Promise<void> {
    if (!this.sessionId) return;
    if (!force && this.batch.length === 0) return;
    const s = this.sample();
    if (s) this.batch.push(s);
    const samples = this.batch.splice(0, this.batch.length);
    if (!samples.length) return;
    await sendRuntime(
      'capture.anchors',
      { sessionId: this.sessionId, samples },
      'content',
    );
  }
}
