import { describe, expect, it } from 'vitest';
import {
  isSiteEnabled,
  matchDomainPattern,
  toggleHostnameInBlacklist,
  DEFAULT_SITE_CONTROL,
} from './site-control';

describe('site-control', () => {
  it('matches hostname patterns', () => {
    expect(matchDomainPattern('https://www.youtube.com/watch', 'youtube.com')).toBe(
      true,
    );
    expect(matchDomainPattern('https://www.youtube.com/watch', 'example.com')).toBe(
      false,
    );
  });

  it('blacklist disables listed sites', () => {
    const control = {
      mode: 'blacklist' as const,
      blacklistPatterns: ['youtube.com'],
      whitelistPatterns: [],
    };
    expect(isSiteEnabled('https://www.youtube.com/', control)).toBe(false);
    expect(isSiteEnabled('https://vimeo.com/', control)).toBe(true);
  });

  it('toggles hostname into blacklist', () => {
    const next = toggleHostnameInBlacklist(
      DEFAULT_SITE_CONTROL,
      'https://www.youtube.com/watch?v=1',
      true,
    );
    expect(next.blacklistPatterns).toContain('www.youtube.com');
    expect(
      isSiteEnabled('https://www.youtube.com/watch?v=1', next),
    ).toBe(false);
  });
});
