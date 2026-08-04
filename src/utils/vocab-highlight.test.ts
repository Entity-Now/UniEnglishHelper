import { describe, expect, it } from 'vitest';
import {
  decorateWordSpan,
  entryForSurface,
  normalizeWordKey,
  shortGloss,
  statusForSurface,
  type HighlightMap,
} from './vocab-highlight';

describe('vocab-highlight', () => {
  it('normalizes keys case-insensitively', () => {
    expect(normalizeWordKey('Hello')).toBe('hello');
    expect(normalizeWordKey("don't")).toBe("don't");
  });

  it('shortGloss takes first sense and truncates', () => {
    expect(shortGloss('你好；问候', 6)).toBe('你好');
    expect(shortGloss('n. very long definition that should cut', 6)).toBe(
      'very l…',
    );
    expect(shortGloss(undefined)).toBe('');
    // default maxLen is compact (6)
    expect(shortGloss('一二三四五六七')).toBe('一二三四五六…');
  });

  it('entryForSurface returns status + translation', () => {
    const map: HighlightMap = {
      hello: { status: 'new', translation: '你好' },
    };
    expect(statusForSurface(map, 'Hello')).toBe('new');
    expect(entryForSurface(map, 'Hello')?.translation).toBe('你好');
    expect(entryForSurface(map, 'world')).toBeNull();
  });

  it('decorateWordSpan builds under-word gloss', () => {
    const span = document.createElement('span');
    span.className = 'ueh-word';
    const map: HighlightMap = {
      hello: { status: 'learning', translation: '你好；问候' },
    };
    decorateWordSpan(span, 'Hello', map);
    expect(span.classList.contains('ueh-hl-learning')).toBe(true);
    expect(span.classList.contains('ueh-word-has-gloss')).toBe(true);
    expect(span.querySelector('.ueh-word-surface')?.textContent).toBe('Hello');
    expect(span.querySelector('.ueh-word-gloss')?.textContent).toBe('你好');
    expect(span.getAttribute('data-gloss')).toBe('你好；问候');
  });
});
