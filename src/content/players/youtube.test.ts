import { describe, expect, it } from 'vitest';
import {
  clearPreloadedMainCues,
  extractYoutubeVideoId,
  filterTimedtextForVideo,
  isTimedtextUrlForVideo,
  isTrackMatchingVideo,
  isYoutubeHost,
  isYoutubeWatchLikePath,
  peekPreloadedMainCues,
  selectTrack,
  storePreloadedMainCues,
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

  it('isTimedtextUrlForVideo strictly requires videoId parameter match', () => {
    const vid = 'dQw4w9WgXcQ';
    expect(
      isTimedtextUrlForVideo(
        'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en',
        vid,
      ),
    ).toBe(true);
    expect(
      isTimedtextUrlForVideo(
        'https://www.youtube.com/api/timedtext?video_id=dQw4w9WgXcQ&lang=en',
        vid,
      ),
    ).toBe(true);
    expect(
      isTimedtextUrlForVideo(
        'https://www.youtube.com/api/timedtext?v=OTHER_VIDEO&lang=en',
        vid,
      ),
    ).toBe(false);
    // pot-only without video ID cannot be directly used as timedtext body
    expect(
      isTimedtextUrlForVideo(
        'https://www.youtube.com/api/timedtext?pot=token123&lang=en',
        vid,
      ),
    ).toBe(false);
    expect(isTimedtextUrlForVideo(null, vid)).toBe(false);
  });

  it('isTrackMatchingVideo validates track baseUrl videoId', () => {
    const vid = 'vid-123';
    expect(
      isTrackMatchingVideo(
        { baseUrl: 'https://www.youtube.com/api/timedtext?v=vid-123', languageCode: 'en', vssId: '.en' },
        vid,
      ),
    ).toBe(true);
    expect(
      isTrackMatchingVideo(
        { baseUrl: 'https://www.youtube.com/api/timedtext?v=other-456', languageCode: 'en', vssId: '.en' },
        vid,
      ),
    ).toBe(false);
  });

  it('selectTrack rejects tracks from other videos', () => {
    const currentVid = 'current-video';
    const oldVid = 'old-video';
    const playerData = {
      videoId: currentVid,
      captionTracks: [
        {
          baseUrl: `https://www.youtube.com/api/timedtext?v=${oldVid}&lang=en`,
          languageCode: 'en',
          vssId: '.en',
        },
      ],
      audioCaptionTracks: [],
      device: null,
      cver: null,
      playerState: 1,
      selectedTrackLanguageCode: null,
      selectedTrackVssId: null,
      cachedTimedtextUrl: null,
    };
    expect(selectTrack(playerData, currentVid)).toBeNull();

    const validPlayerData = {
      ...playerData,
      captionTracks: [
        {
          baseUrl: `https://www.youtube.com/api/timedtext?v=${currentVid}&lang=en`,
          languageCode: 'en',
          vssId: '.en',
        },
      ],
    };
    expect(selectTrack(validPlayerData, currentVid)?.baseUrl).toContain(currentVid);
  });

  it('storePreloadedMainCues and peekPreloadedMainCues reject mismatched cues', () => {
    const vidA = 'video-A';
    const vidB = 'video-B';
    const cuesA = [
      { id: `${vidA}-0`, startMs: 0, endMs: 1000, text: 'Hello from video A' },
    ];

    // Try to store vidA cues under vidB
    storePreloadedMainCues(vidB, cuesA, `${vidB}:en::.en`);
    expect(peekPreloadedMainCues(vidB)).toBeNull();

    // Store vidA cues under vidA
    storePreloadedMainCues(vidA, cuesA, `${vidA}:en::.en`);
    expect(peekPreloadedMainCues(vidA)).toHaveLength(1);
    expect(peekPreloadedMainCues(vidA)?.[0]?.text).toBe('Hello from video A');

    clearPreloadedMainCues(vidA);
    expect(peekPreloadedMainCues(vidA)).toBeNull();
  });
});
