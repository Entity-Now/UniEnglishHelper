import { describe, expect, it } from 'vitest';
import { extractYoutubeVideoId, isYoutubeHost } from './youtube';

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
  });

  it('detects host', () => {
    expect(isYoutubeHost('www.youtube.com')).toBe(true);
    expect(isYoutubeHost('example.com')).toBe(false);
  });
});
