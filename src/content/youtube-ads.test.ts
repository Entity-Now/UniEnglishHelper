import { describe, expect, it } from 'vitest';
import { detectYoutubeAdStatus } from './youtube-ads';

describe('youtube-ads', () => {
  it('returns none on non-youtube host', () => {
    // jsdom location is about:blank / localhost — not youtube
    const status = detectYoutubeAdStatus();
    expect(status.phase).toBe('none');
    expect(status.canSkip).toBe(false);
  });
});
