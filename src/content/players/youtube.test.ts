import { describe, expect, it } from 'vitest';
import {
  extractYoutubeVideoId,
  isYoutubeHost,
  isYoutubeWatchLikePath,
} from './youtube';

describe('youtube helpers', () => {
  it('extracts video ids', () => {
    expect(
      extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    ).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    );
    expect(
      extractYoutubeVideoId('https://www.youtube.com/shorts/abc123XYZ00'),
    ).toBe('abc123XYZ00');
    expect(
      extractYoutubeVideoId('https://www.youtube.com/live/abc123XYZ00'),
    ).toBe('abc123XYZ00');
  });

  it('detects host', () => {
    expect(isYoutubeHost('www.youtube.com')).toBe(true);
    expect(isYoutubeHost('example.com')).toBe(false);
  });

  it('detects watch-like paths', () => {
    expect(isYoutubeWatchLikePath('/watch')).toBe(true);
    expect(isYoutubeWatchLikePath('/shorts/abc')).toBe(true);
    expect(isYoutubeWatchLikePath('/feed/trending')).toBe(false);
  });
});
