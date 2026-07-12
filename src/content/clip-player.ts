import { PORT_CLIP } from '../shared/constants';
import { concatArrayBuffers } from '../utils/audio';
import type { ClipPortServerMessage } from '../shared/messages/ports';

export class ClipPlayer {
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private stopRequested = false;

  stop(): void {
    this.stopRequested = true;
    if (this.audio) {
      this.audio.pause();
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  async play(
    clipId: number,
    onState: (
      state: 'loading' | 'playing' | 'ended' | 'error',
      message?: string,
    ) => void,
  ): Promise<void> {
    return this.playSequence([clipId], onState);
  }

  /**
   * Play multiple clips in order (Edge TTS multi-chunk).
   * Sequential Audio elements avoid MP3 binary-concat glitches.
   */
  async playSequence(
    clipIds: number[],
    onState: (
      state: 'loading' | 'playing' | 'ended' | 'error',
      message?: string,
    ) => void,
  ): Promise<void> {
    this.stop();
    this.stopRequested = false;
    if (!clipIds.length) {
      onState('error', 'No clips to play');
      return;
    }

    onState('loading');

    try {
      for (let i = 0; i < clipIds.length; i++) {
        if (this.stopRequested) return;
        const clipId = clipIds[i]!;
        const blob = await this.fetchClipBlob(clipId);
        if (this.stopRequested) return;

        await this.playBlob(blob);
        if (i === 0) onState('playing');
      }
      if (!this.stopRequested) onState('ended');
    } catch (err) {
      if (!this.stopRequested) {
        onState('error', err instanceof Error ? err.message : String(err));
      }
    }
  }

  private playBlob(blob: Blob): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.objectUrl) {
        URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
      }
      if (this.audio) {
        this.audio.onended = null;
        this.audio.onerror = null;
        this.audio.pause();
      }

      this.objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(this.objectUrl);
      this.audio = audio;

      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('Audio element error'));
      void audio.play().catch(reject);
    });
  }

  fetchClipBlob(clipId: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: PORT_CLIP });
      const requestId = crypto.randomUUID();
      const chunks: ArrayBuffer[] = [];
      let mimeType = 'audio/mpeg';
      let expectedTotal = 0;

      const timer = window.setTimeout(() => {
        port.disconnect();
        reject(new Error('Clip fetch timeout'));
      }, 30_000);

      port.onMessage.addListener((msg: ClipPortServerMessage) => {
        if (msg.requestId !== requestId) return;
        if (msg.type === 'clips.blobChunk') {
          chunks[msg.index] = msg.bytes;
          expectedTotal = msg.total || expectedTotal;
        } else if (msg.type === 'clips.blobEnd') {
          window.clearTimeout(timer);
          mimeType = msg.mimeType || mimeType;
          // Preserve order by index; do not use filter(Boolean) which drops
          // empty-looking buffers incorrectly if sparse.
          const ordered: ArrayBuffer[] = [];
          const total = Math.max(expectedTotal, chunks.length);
          for (let i = 0; i < total; i++) {
            if (chunks[i]) ordered.push(chunks[i]!);
          }
          port.disconnect();
          if (!ordered.length) {
            reject(new Error('Empty clip audio'));
            return;
          }
          const buffer = concatArrayBuffers(ordered);
          resolve(new Blob([buffer], { type: mimeType }));
        } else if (msg.type === 'clips.blobError') {
          window.clearTimeout(timer);
          port.disconnect();
          reject(new Error(msg.message));
        }
      });

      port.postMessage({
        type: 'clips.getBlobChunks',
        requestId,
        clipId,
      });
    });
  }
}
