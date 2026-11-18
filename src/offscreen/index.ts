import {
  fail,
  isEnvelope,
  ok,
  type Result,
} from '../shared/messages';
import { AppError, toErrorPayload } from '../shared/messages/errors';
import type { MediaTimelineSample } from '../shared/domain/types';
import { createCaptureGraph, type AudioGraphState } from './audio-graph';
import { AnchorStore } from './pcm-ring';
import { exportRangeToWav } from './export-encode';

interface SessionRuntime {
  sessionId: string;
  tabId: number;
  graph: AudioGraphState;
  anchors: AnchorStore;
}

let active: SessionRuntime | null = null;

async function handle(message: unknown): Promise<Result<unknown>> {
  if (!isEnvelope(message)) {
    return fail('INVALID_MESSAGE', 'Not an envelope');
  }
  if (!message.type.startsWith('offscreen.')) {
    return fail('UNSUPPORTED_TYPE', 'Offscreen only handles offscreen.*');
  }

  try {
    return ok(await dispatch(message.type, message.payload));
  } catch (err) {
    const e = toErrorPayload(err);
    return fail(e.code, e.message, e.details);
  }
}

async function dispatch(type: string, payload: unknown): Promise<unknown> {
  const p = (payload ?? {}) as Record<string, unknown>;

  switch (type) {
    case 'offscreen.ping':
      return { alive: true, hasSession: Boolean(active) };

    case 'offscreen.capture.initStream': {
      if (active) {
        active.graph.stop();
        active = null;
      }
      const streamId = String(p.streamId);
      const sessionId = String(p.sessionId);
      const tabId = Number(p.tabId);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // @ts-expect-error chrome constraint
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamId,
          },
        },
        video: false,
      });

      const graph = await createCaptureGraph(stream);
      const runtimeSession: SessionRuntime = {
        sessionId,
        tabId,
        graph,
        anchors: new AnchorStore(),
      };
      active = runtimeSession;

      const track = stream.getAudioTracks()[0];
      if (track) {
        track.addEventListener(
          'ended',
          () => {
            if (active === runtimeSession) {
              active.graph.stop();
              active = null;
            }
          },
          { once: true },
        );
      }

      return {
        loopbackOk: graph.loopbackOk,
        suspended: graph.ctx.state === 'suspended',
      };
    }

    case 'offscreen.capture.resume': {
      if (!active || active.sessionId !== p.sessionId) {
        throw new AppError('OFFSCREEN_FAILED', 'No matching session');
      }
      await active.graph.ctx.resume();
      return { suspended: active.graph.ctx.state === 'suspended' };
    }

    case 'offscreen.capture.stop': {
      if (active && (!p.sessionId || active.sessionId === p.sessionId)) {
        active.graph.stop();
        active = null;
      }
      return {};
    }

    case 'offscreen.capture.status': {
      if (!active) {
        return { state: 'idle', fillRatio: 0 };
      }
      return {
        state: 'live',
        sessionId: active.sessionId,
        fillRatio: active.graph.ring.fillRatio(),
        epoch: active.anchors.currentEpoch,
        suspended: active.graph.ctx.state === 'suspended',
        sampleRate: active.graph.ring.sampleRate,
      };
    }

    case 'offscreen.timeline.anchors': {
      if (!active || active.sessionId !== p.sessionId) {
        return { accepted: 0 };
      }
      const samples = (p.samples as MediaTimelineSample[]) ?? [];
      if (samples.length === 0) return { accepted: 0 };
      const audioTimeMs = active.graph.ctx.currentTime * 1000;
      const wallClockRecvMs = Date.now();
      const latestWall = samples.reduce(
        (max, s) => Math.max(max, s.wallClockMs || 0),
        0,
      );
      const accepted = active.anchors.append(
        samples.map((s) => {
          const ageMs =
            latestWall > 0 && s.wallClockMs
              ? Math.max(0, latestWall - s.wallClockMs)
              : 0;
          return {
            audioTimeMs: Math.max(0, audioTimeMs - ageMs),
            mediaTimeMs: s.mediaTimeMs,
            playbackRate: s.playbackRate,
            paused: s.paused,
            epoch: s.epoch,
            wallClockRecvMs,
          };
        }),
      );
      return { accepted };
    }

    case 'offscreen.clips.export': {
      if (!active || active.sessionId !== p.sessionId) {
        throw new AppError('OFFSCREEN_FAILED', 'No live capture session');
      }
      return exportRangeToWav({
        ring: active.graph.ring,
        anchors: active.anchors,
        startMs: Number(p.startMs),
        endMs: Number(p.endMs),
        epoch: Number(p.epoch),
        sessionId: String(p.sessionId),
      });
    }

    case 'offscreen.job.cancel':
      return {};

    default:
      throw new AppError('UNSUPPORTED_TYPE', type);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Reject foreign extensions and direct content-script messages
  if (sender.id && sender.id !== chrome.runtime.id) {
    return false;
  }
  if (sender.tab != null) {
    return false;
  }
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    typeof (message as { type: string }).type !== 'string' ||
    !(message as { type: string }).type.startsWith('offscreen.')
  ) {
    return false;
  }
  void handle(message).then(sendResponse);
  return true;
});

// Signal ready
console.info('[UEH offscreen] ready');
