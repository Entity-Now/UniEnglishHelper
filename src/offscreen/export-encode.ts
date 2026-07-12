import { encodeWav } from '../utils/audio';
import { addAudioClip } from '../db';
import type { PcmRingBuffer, AnchorStore } from './pcm-ring';
import { AppError } from '../shared/messages/errors';
import { DEFAULT_APP_CONFIG } from '../shared/domain/types';

export async function exportRangeToWav(input: {
  ring: PcmRingBuffer;
  anchors: AnchorStore;
  startMs: number;
  endMs: number;
  epoch: number;
  sessionId: string;
}): Promise<{ clipId: number; durationMs: number; mimeType: 'audio/wav' }> {
  const { ring, anchors, startMs, endMs, epoch } = input;
  const duration = endMs - startMs;
  if (duration <= 0) {
    throw new AppError('CLIP_TOO_LONG', 'Invalid range');
  }
  if (duration > DEFAULT_APP_CONFIG.recorder.maxClipMs) {
    throw new AppError('CLIP_TOO_LONG', `Clip exceeds ${DEFAULT_APP_CONFIG.recorder.maxClipMs}ms`);
  }

  const startAudio = anchors.mediaToAudio(startMs, epoch);
  const endAudio = anchors.mediaToAudio(endMs, epoch);
  if (endAudio <= startAudio) {
    throw new AppError('CLIP_NOT_IN_RING', 'Mapped audio range empty');
  }

  const samples = ring.sliceByAudioTime(startAudio, endAudio);
  const blob = encodeWav(samples, ring.sampleRate);
  const clipId = await addAudioClip({
    blob,
    mimeType: 'audio/wav',
    durationMs: Math.round((samples.length / ring.sampleRate) * 1000),
    sampleRate: ring.sampleRate,
    startMs,
    endMs,
    epoch,
  });

  return {
    clipId,
    durationMs: Math.round((samples.length / ring.sampleRate) * 1000),
    mimeType: 'audio/wav',
  };
}
