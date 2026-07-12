import { DEFAULT_APP_CONFIG } from '../shared/domain/types';
import { PcmRingBuffer } from './pcm-ring';

export interface AudioGraphState {
  ctx: AudioContext;
  stream: MediaStream;
  ring: PcmRingBuffer;
  suspended: boolean;
  loopbackOk: boolean;
  stop: () => void;
}

/**
 * Build tab-capture graph:
 * source → gain(1) → destination (loopback, preserve tab audio)
 * source → scriptProcessor → silent → destination (PCM tap)
 */
export async function createCaptureGraph(
  stream: MediaStream,
  opts?: { ringSeconds?: number; sampleRate?: number },
): Promise<AudioGraphState> {
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('NO_AUDIO_TRACK');
  }

  // Prefer matching hardware rate when possible
  const ctx = new AudioContext({
    sampleRate: opts?.sampleRate ?? DEFAULT_APP_CONFIG.recorder.sampleRate,
  });
  const ring = new PcmRingBuffer(
    ctx.sampleRate,
    opts?.ringSeconds ?? DEFAULT_APP_CONFIG.recorder.ringSeconds,
  );

  const source = ctx.createMediaStreamSource(stream);
  const loopbackGain = ctx.createGain();
  loopbackGain.gain.value = 0; // Disable loopback to prevent double audio / echo (tab is not muted by default)
  source.connect(loopbackGain);

  // ScriptProcessor for broad compatibility in offscreen (AudioWorklet needs separate file URL)
  const bufferSize = 4096;
  const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
  const silent = ctx.createGain();
  silent.gain.value = 0;

  processor.onaudioprocess = (ev) => {
    const input = ev.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input.length);
    copy.set(input);
    const audioTimeMs = ctx.currentTime * 1000;
    ring.push(copy, audioTimeMs);
  };

  source.connect(processor);
  processor.connect(silent);
  silent.connect(ctx.destination);

  const suspended = ctx.state === 'suspended';
  if (suspended) {
    try {
      await ctx.resume();
    } catch {
      // remain suspended until user gesture via resume message
    }
  }

  const stop = () => {
    try {
      processor.disconnect();
      silent.disconnect();
      loopbackGain.disconnect();
      source.disconnect();
    } catch {
      // ignore
    }
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };

  return {
    ctx,
    stream,
    ring,
    suspended: ctx.state === 'suspended',
    loopbackOk: true,
    stop,
  };
}
