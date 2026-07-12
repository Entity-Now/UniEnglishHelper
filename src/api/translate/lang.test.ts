import { describe, expect, it } from 'vitest';
import { toGoogleLang, toMicrosoftLang, toMyMemoryLang } from './lang';

describe('lang mapping', () => {
  it('maps Chinese variants for Microsoft', () => {
    expect(toMicrosoftLang('zh-CN')).toBe('zh-Hans');
    expect(toMicrosoftLang('zh')).toBe('zh-Hans');
    expect(toMicrosoftLang('zh-TW')).toBe('zh-Hant');
    expect(toMicrosoftLang('en')).toBe('en');
  });

  it('keeps Google/MyMemory style', () => {
    expect(toGoogleLang('zh-CN')).toBe('zh-CN');
    expect(toMyMemoryLang('en')).toBe('en');
  });
});
