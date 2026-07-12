/**
 * Sequential Edge TTS chunk playback (read-frog style).
 * Playing separate Audio elements in order avoids MP3 frame-boundary glitches
 * that appear when binary-concatenating multi-chunk MP3 responses.
 */

import { DOMAudioPlaybackController } from './dom-audio-controller';

export interface PlayableAudioChunk {
  audioBase64: string;
  contentType: string;
}

const controller = new DOMAudioPlaybackController(
  'Failed to play synthesized speech',
);

let activeRequestId: string | null = null;

function newRequestId(): string {
  return crypto.randomUUID();
}

export function stopTtsPlayback(): void {
  const id = activeRequestId;
  activeRequestId = null;
  controller.stop({ requestId: id ?? undefined, reason: 'stopped' });
}

/**
 * Play audio chunks one after another. Resolves when all finished or stopped.
 * Returns false if interrupted/stopped before natural end.
 */
export async function playTtsAudioChunks(
  chunks: PlayableAudioChunk[],
): Promise<boolean> {
  stopTtsPlayback();
  const requestId = newRequestId();
  activeRequestId = requestId;

  for (const chunk of chunks) {
    if (activeRequestId !== requestId) return false;
    if (!chunk.audioBase64) continue;

    const result = await controller.play({
      requestId,
      audioBase64: chunk.audioBase64,
      contentType: chunk.contentType || 'audio/mpeg',
    });

    if (!result.ok) {
      return false;
    }
  }

  if (activeRequestId === requestId) {
    activeRequestId = null;
  }
  return true;
}

export async function playTtsAudioBase64(
  audioBase64: string,
  contentType = 'audio/mpeg',
): Promise<boolean> {
  return playTtsAudioChunks([{ audioBase64, contentType }]);
}

export async function playClipIdsSequentially(
  clipIds: number[],
  fetchBlob: (clipId: number) => Promise<Blob>,
): Promise<boolean> {
  stopTtsPlayback();
  const requestId = newRequestId();
  activeRequestId = requestId;

  for (const clipId of clipIds) {
    if (activeRequestId !== requestId) return false;
    const blob = await fetchBlob(clipId);
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    const audioBase64 = btoa(binary);
    const result = await controller.play({
      requestId,
      audioBase64,
      contentType: blob.type || 'audio/mpeg',
    });
    if (!result.ok) return false;
  }

  if (activeRequestId === requestId) {
    activeRequestId = null;
  }
  return true;
}
