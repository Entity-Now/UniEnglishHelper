import { describe, expect, it } from 'vitest';
import { encodeWav } from './audio';

describe('encodeWav', () => {
  it('produces WAV blob of expected size', () => {
    const samples = new Float32Array(100);
    const blob = encodeWav(samples, 48000);
    expect(blob.type).toBe('audio/wav');
    // 44-byte header + 100 samples * 2 bytes
    expect(blob.size).toBe(44 + 200);
  });
});
