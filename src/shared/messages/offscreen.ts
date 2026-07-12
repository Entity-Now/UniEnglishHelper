import type { MediaTimelineSample } from '../domain/types';
import type { Envelope } from './envelope';

export type OffscreenRequest =
  | Envelope<'offscreen.ping', Record<string, never>>
  | Envelope<
      'offscreen.capture.initStream',
      { streamId: string; sessionId: string; tabId: number }
    >
  | Envelope<'offscreen.capture.stop', { sessionId: string }>
  | Envelope<'offscreen.capture.status', { sessionId?: string }>
  | Envelope<'offscreen.capture.resume', { sessionId: string }>
  | Envelope<
      'offscreen.timeline.anchors',
      { sessionId: string; samples: MediaTimelineSample[] }
    >
  | Envelope<
      'offscreen.clips.export',
      { sessionId: string; startMs: number; endMs: number; epoch: number }
    >
  | Envelope<
      'offscreen.clips.readChunk',
      { clipId: number; index: number; chunkSize: number }
    >
  | Envelope<'offscreen.job.cancel', { jobId: string }>;

export type OffscreenType = OffscreenRequest['type'];
