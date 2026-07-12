import { describe, expect, it } from 'vitest';
import {
  normalizeUrlPattern,
  urlMatchesPattern,
  urlMatchesRule,
} from './match';

describe('site-rules match', () => {
  it('normalizes bare host', () => {
    expect(normalizeUrlPattern('github.com')).toBe('*://github.com/*');
  });

  it('matches host patterns', () => {
    expect(urlMatchesPattern('https://github.com/foo', 'github.com')).toBe(
      true,
    );
    expect(urlMatchesPattern('https://example.com/', 'github.com')).toBe(
      false,
    );
  });

  it('respects excludeMatches', () => {
    expect(
      urlMatchesRule('https://github.com/settings', {
        matches: 'github.com',
        excludeMatches: ['github.com/settings'],
      }),
    ).toBe(false);
  });
});
