import { describe, expect, it } from 'vitest';
import type { WordRecord } from '../db/schema';
import {
  buildCueWordKeys,
  classifyVideoVocab,
  normalizeVideoKey,
} from './video-vocab-recap';

function word(
  partial: Partial<WordRecord> & Pick<WordRecord, 'surface' | 'sourceUrl'>,
): WordRecord {
  return {
    wordKey: partial.surface.toLowerCase(),
    context: 'ctx',
    learningStatus: 'new',
    reviewStage: 0,
    nextReviewAt: Date.now() + 60_000,
    createdAt: partial.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    kind: 'word',
    ...partial,
  };
}

describe('normalizeVideoKey', () => {
  it('normalizes YouTube watch URLs', () => {
    expect(
      normalizeVideoKey('https://www.youtube.com/watch?v=abc123XYZ00'),
    ).toBe('yt:abc123XYZ00');
  });
});

describe('classifyVideoVocab', () => {
  const videoKey = 'yt:abc123XYZ00';
  const cueWordKeys = buildCueWordKeys([
    { id: '1', startMs: 0, endMs: 1000, text: 'Hello world again.' },
  ]);

  it('puts current-video words in addedHere', () => {
    const rows = [
      word({
        surface: 'hello',
        sourceUrl: 'https://www.youtube.com/watch?v=abc123XYZ00',
      }),
    ];
    const res = classifyVideoVocab(rows, videoKey, cueWordKeys);
    expect(res.addedHere).toHaveLength(1);
    expect(res.revisiting).toHaveLength(0);
  });

  it('puts cross-video subtitle hits in revisiting', () => {
    const rows = [
      word({
        surface: 'world',
        sourceUrl: 'https://www.youtube.com/watch?v=otherVideo1',
        createdAt: 1,
      }),
    ];
    const res = classifyVideoVocab(rows, videoKey, cueWordKeys);
    expect(res.addedHere).toHaveLength(0);
    expect(res.revisiting).toHaveLength(1);
    expect(res.revisiting[0]?.surface).toBe('world');
  });

  it('keeps addedHere and revisiting mutually exclusive', () => {
    const rows = [
      word({
        surface: 'again',
        sourceUrl: 'https://www.youtube.com/watch?v=abc123XYZ00',
      }),
    ];
    const res = classifyVideoVocab(rows, videoKey, cueWordKeys);
    expect(res.addedHere).toHaveLength(1);
    expect(res.revisiting).toHaveLength(0);
  });
});