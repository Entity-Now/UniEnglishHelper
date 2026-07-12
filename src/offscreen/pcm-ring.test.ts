import { describe, expect, it } from 'vitest';
import { AnchorStore, PcmRingBuffer } from './pcm-ring';

describe('PcmRingBuffer', () => {
  it('stores and slices by audio time', () => {
    const ring = new PcmRingBuffer(1000, 2); // 2 seconds @ 1kHz
    const block = new Float32Array(500);
    for (let i = 0; i < block.length; i++) block[i] = i / 500;
    ring.push(block, 500); // end at 500ms
    ring.push(block, 1000);
    const slice = ring.sliceByAudioTime(200, 400);
    expect(slice.length).toBeGreaterThan(0);
  });
});

describe('AnchorStore', () => {
  it('interpolates media to audio time', () => {
    const store = new AnchorStore();
    store.append([
      {
        audioTimeMs: 1000,
        mediaTimeMs: 0,
        playbackRate: 1,
        paused: false,
        epoch: 0,
      },
      {
        audioTimeMs: 2000,
        mediaTimeMs: 1000,
        playbackRate: 1,
        paused: false,
        epoch: 0,
      },
    ]);
    expect(store.mediaToAudio(500, 0)).toBe(1500);
  });

  it('resets on epoch change', () => {
    const store = new AnchorStore();
    store.append([
      {
        audioTimeMs: 0,
        mediaTimeMs: 0,
        playbackRate: 1,
        paused: false,
        epoch: 0,
      },
    ]);
    store.append([
      {
        audioTimeMs: 50,
        mediaTimeMs: 0,
        playbackRate: 1,
        paused: false,
        epoch: 1,
      },
      {
        audioTimeMs: 150,
        mediaTimeMs: 100,
        playbackRate: 1,
        paused: false,
        epoch: 1,
      },
    ]);
    expect(store.mediaToAudio(50, 1)).toBe(100);
  });
});
