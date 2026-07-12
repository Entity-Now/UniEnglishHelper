import { describe, expect, it } from 'vitest';
import { isClickableWord, segmentWords } from './segmenter';

describe('segmenter', () => {
  it('segments English sentence into word-like tokens', () => {
    const segs = segmentWords("Hello, world!");
    const words = segs.filter(isClickableWord).map((s) => s.text);
    expect(words).toContain('Hello');
    expect(words).toContain('world');
  });
});
