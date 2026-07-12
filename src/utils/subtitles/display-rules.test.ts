import { describe, expect, it } from 'vitest';
import {
  hasRenderableSubtitleByMode,
  pickSubtitleLines,
} from './display-rules';

describe('display-rules', () => {
  it('requires translation for translationOnly', () => {
    expect(
      hasRenderableSubtitleByMode(
        { text: 'hi', start: 0, end: 1 },
        'translationOnly',
      ),
    ).toBe(false);
    expect(
      hasRenderableSubtitleByMode(
        { text: 'hi', start: 0, end: 1, translation: '你好' },
        'translationOnly',
      ),
    ).toBe(true);
  });

  it('picks lines by mode', () => {
    const frag = {
      text: 'hello',
      start: 0,
      end: 1000,
      translation: '你好',
    };
    expect(pickSubtitleLines(frag, 'originalOnly')).toEqual({
      original: 'hello',
    });
    expect(pickSubtitleLines(frag, 'translationOnly')).toEqual({
      translation: '你好',
    });
    expect(pickSubtitleLines(frag, 'bilingual')).toEqual({
      original: 'hello',
      translation: '你好',
    });
    expect(pickSubtitleLines(frag, 'off')).toEqual({});
  });

  it('hides everything when mode is off', () => {
    expect(
      hasRenderableSubtitleByMode(
        { text: 'hi', start: 0, end: 1, translation: '你好' },
        'off',
      ),
    ).toBe(false);
  });
});
