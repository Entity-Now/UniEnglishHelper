import { describe, expect, it } from 'vitest';
import {
  extractYoutubeVideoId,
  filterTimedtextForVideo,
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

  it('filterTimedtextForVideo rejects ad (other video) URLs', () => {
    const main = 'dQw4w9WgXcQ';
    const mainUrl =
      'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en&pot=abc';
    const adUrl =
      'https://www.youtube.com/api/timedtext?v=ADVIDEO12345&lang=en&pot=xyz';
    const potOnly =
      'https://www.youtube.com/api/timedtext?lang=en&pot=onlypot&fmt=json3';

    expect(filterTimedtextForVideo(mainUrl, main)).toContain(main);
    expect(filterTimedtextForVideo(adUrl, main)).toBeNull();
    // pot-only (no v) is allowed as pot carrier
    expect(filterTimedtextForVideo(potOnly, main)).toContain('pot=onlypot');
    expect(filterTimedtextForVideo(null, main)).toBeNull();
    expect(filterTimedtextForVideo(undefined, main)).toBeNull();
  });
});
