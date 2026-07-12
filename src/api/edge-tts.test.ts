import { describe, expect, it } from 'vitest';
import { extractAudioFromBinaryMessage } from './edge-tts';

describe('extractAudioFromBinaryMessage', () => {
  it('extracts payload after header length + Path:audio', () => {
    const header = 'Content-Type:audio/mpeg\r\nPath:audio\r\n';
    const headerBytes = new TextEncoder().encode(header);
    const audio = new Uint8Array([1, 2, 3, 4, 5]);
    const buf = new ArrayBuffer(2 + headerBytes.length + audio.length);
    const view = new DataView(buf);
    view.setUint16(0, headerBytes.length, false);
    new Uint8Array(buf, 2, headerBytes.length).set(headerBytes);
    new Uint8Array(buf, 2 + headerBytes.length).set(audio);

    const out = extractAudioFromBinaryMessage(buf);
    expect(out).not.toBeNull();
    expect(new Uint8Array(out!)).toEqual(audio);
  });

  it('returns null for non-audio path', () => {
    const header = 'Path:metadata\r\n';
    const headerBytes = new TextEncoder().encode(header);
    const buf = new ArrayBuffer(2 + headerBytes.length + 4);
    const view = new DataView(buf);
    view.setUint16(0, headerBytes.length, false);
    new Uint8Array(buf, 2, headerBytes.length).set(headerBytes);
    expect(extractAudioFromBinaryMessage(buf)).toBeNull();
  });
});
