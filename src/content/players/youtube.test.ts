import { describe, expect, it } from 'vitest';
import {
  clearPreloadedMainCues,
  createAutoTranslatedTrack,
  extractYoutubeVideoId,
  filterTimedtextForVideo,
  isLanguageMatching,
  isTimedtextMatchingTrack,
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

  describe('language matching and track selection', () => {
    it('isLanguageMatching correctly matches tags and base subtags', () => {
      expect(isLanguageMatching('en', 'en')).toBe(true);
      expect(isLanguageMatching('en-US', 'en')).toBe(true);
      expect(isLanguageMatching('en_US', 'en')).toBe(true);
      expect(isLanguageMatching('en', 'en-GB')).toBe(true);
      expect(isLanguageMatching('zh-Hans', 'zh-CN')).toBe(true);
      expect(isLanguageMatching('zh-TW', 'zh-HK')).toBe(true);
      expect(isLanguageMatching('fr', 'en')).toBe(false);
      expect(isLanguageMatching('ja', 'en')).toBe(false);
      expect(isLanguageMatching(null, 'en')).toBe(false);
      expect(isLanguageMatching('en', undefined)).toBe(false);
    });

    it('selectTrack prioritizes English even if YouTube player has selected French or Chinese', () => {
      const vid = 'vid-yt-1';
      const playerData = {
        videoId: vid,
        captionTracks: [
          {
            baseUrl: `https://www.youtube.com/api/timedtext?v=${vid}&lang=fr`,
            languageCode: 'fr',
            vssId: '.fr',
          },
          {
            baseUrl: `https://www.youtube.com/api/timedtext?v=${vid}&lang=en`,
            languageCode: 'en',
            kind: 'asr',
            vssId: 'a.en',
          },
        ],
        audioCaptionTracks: [],
        device: null,
        cver: null,
        playerState: 1,
        selectedTrackLanguageCode: 'fr',
        selectedTrackVssId: '.fr',
        cachedTimedtextUrl: null,
      };

      // Even though selectedTrack is French, it must choose English ASR
      const selected = selectTrack(playerData, vid, 'en');
      expect(selected).not.toBeNull();
      expect(selected?.languageCode).toBe('en');
      expect(selected?.vssId).toBe('a.en');
    });

    it('selectTrack prioritizes English ASR over human French or Chinese subtitles on English video', () => {
      const vid = 'vid-yt-2';
      const playerData = {
        videoId: vid,
        captionTracks: [
          {
            baseUrl: `https://www.youtube.com/api/timedtext?v=${vid}&lang=zh-Hans`,
            languageCode: 'zh-Hans',
            vssId: '.zh-Hans',
          },
          {
            baseUrl: `https://www.youtube.com/api/timedtext?v=${vid}&lang=en`,
            languageCode: 'en',
            kind: 'asr',
            vssId: 'a.en',
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

      const selected = selectTrack(playerData, vid, 'en');
      expect(selected?.languageCode).toBe('en');
      expect(selected?.vssId).toBe('a.en');
    });

    it('selectTrack prefers human English over ASR English when available', () => {
      const vid = 'vid-yt-3';
      const playerData = {
        videoId: vid,
        captionTracks: [
          {
            baseUrl: `https://www.youtube.com/api/timedtext?v=${vid}&lang=en`,
            languageCode: 'en',
            kind: 'asr',
            vssId: 'a.en',
          },
          {
            baseUrl: `https://www.youtube.com/api/timedtext?v=${vid}&lang=en`,
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

      const selected = selectTrack(playerData, vid, 'en');
      expect(selected?.vssId).toBe('.en');
    });

    it('selectTrack honors user-selected English variant if player selected an English track', () => {
      const vid = 'vid-yt-4';
      const playerData = {
        videoId: vid,
        captionTracks: [
          {
            baseUrl: `https://www.youtube.com/api/timedtext?v=${vid}&lang=en-US`,
            languageCode: 'en-US',
            vssId: '.en-US',
          },
          {
            baseUrl: `https://www.youtube.com/api/timedtext?v=${vid}&lang=en-GB`,
            languageCode: 'en-GB',
            vssId: '.en-GB',
          },
        ],
        audioCaptionTracks: [],
        device: null,
        cver: null,
        playerState: 1,
        selectedTrackLanguageCode: 'en-GB',
        selectedTrackVssId: '.en-GB',
        cachedTimedtextUrl: null,
      };

      const selected = selectTrack(playerData, vid, 'en');
      expect(selected?.vssId).toBe('.en-GB');
    });

    it('selectTrack auto-translates to English via tlang when video has no English caption track', () => {
      const vid = 'vid-yt-5';
      const playerData = {
        videoId: vid,
        captionTracks: [
          {
            baseUrl: `https://www.youtube.com/api/timedtext?v=${vid}&lang=ja`,
            languageCode: 'ja',
            vssId: '.ja',
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

      const selected = selectTrack(playerData, vid, 'en');
      expect(selected).not.toBeNull();
      expect(selected?.languageCode).toBe('en');
      expect(selected?.baseUrl).toContain('tlang=en');
      expect(selected?.vssId).toBe('.ja.en');
    });

    it('isTimedtextMatchingTrack rejects timedtext URLs with mismatched languages', () => {
      const track = {
        baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en',
        languageCode: 'en',
        vssId: '.en',
      };

      // Same language
      expect(
        isTimedtextMatchingTrack(
          'https://www.youtube.com/api/timedtext?v=abc&lang=en&pot=123',
          track,
        ),
      ).toBe(true);

      // Different language (e.g. French / Chinese player request)
      expect(
        isTimedtextMatchingTrack(
          'https://www.youtube.com/api/timedtext?v=abc&lang=fr&pot=123',
          track,
        ),
      ).toBe(false);
      expect(
        isTimedtextMatchingTrack(
          'https://www.youtube.com/api/timedtext?v=abc&lang=zh-Hans&pot=123',
          track,
        ),
      ).toBe(false);

      // Mismatched tlang
      expect(
        isTimedtextMatchingTrack(
          'https://www.youtube.com/api/timedtext?v=abc&lang=en&tlang=zh-Hans&pot=123',
          track,
        ),
      ).toBe(false);
    });
  });
});
