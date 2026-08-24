import { describe, expect, it } from 'vitest';
import {
  decorateWordSpan,
  entryForSurface,
  normalizeWordKey,
  shortGloss,
  statusForSurface,
  type HighlightMap,
} from './vocab-highlight';

describe('vocab-highlight', () => {
  it('normalizes keys case-insensitively', () => {
    expect(normalizeWordKey('Hello')).toBe('hello');
    expect(normalizeWordKey("don't")).toBe("don't");
  });

  it('shortGloss takes first sense and truncates', () => {
    expect(shortGloss('你好；问候', 6)).toBe('你好');
    expect(shortGloss('n. very long definition that should cut', 6)).toBe(
      'very l…',
    );
    expect(shortGloss(undefined)).toBe('');
    // default maxLen is compact (6)
    expect(shortGloss('一二三四五六七')).toBe('一二三四五六…');
  });

  it('shortGloss strips query and definition prefixes', () => {
    expect(shortGloss('查询：单词', 6)).toBe('单词');
    expect(shortGloss('查询: 计算机', 6)).toBe('计算机');
    expect(shortGloss('待查内容：单词', 6)).toBe('单词');
    expect(shortGloss('待查内容: 计算机', 6)).toBe('计算机');
    expect(shortGloss('Query: greeting', 6)).toBe('greeting');
    expect(shortGloss('释义：单词；话语', 6)).toBe('单词');
    expect(shortGloss('中文释义：测试', 6)).toBe('测试');
    expect(shortGloss('n. 释义：单词', 6)).toBe('单词');
  });

  it('shortGloss suppresses gloss when translation is just the surface word', () => {
    expect(shortGloss('查询：word', 6, 'word')).toBe('');
    expect(shortGloss('待查内容：word', 6, 'word')).toBe('');
    expect(shortGloss('Query: Word', 6, 'word')).toBe('');
    expect(shortGloss('word', 6, 'word')).toBe('');
    expect(shortGloss('WORD', 6, 'word')).toBe('');
  });

  it('shortGloss handles multiline markdown definitions', () => {
    expect(
      shortGloss('# word\n\n**[wɜːd]**\n\n## 释义\n单词；话语', 6, 'word'),
    ).toBe('单词');
  });

  it('entryForSurface returns status + translation', () => {
    const map: HighlightMap = {
      hello: { status: 'new', translation: '你好' },
    };
    expect(statusForSurface(map, 'Hello')).toBe('new');
    expect(entryForSurface(map, 'Hello')?.translation).toBe('你好');
    expect(entryForSurface(map, 'world')).toBeNull();
  });

  it('decorateWordSpan builds under-word gloss', () => {
    const span = document.createElement('span');
    span.className = 'ueh-word';
    const map: HighlightMap = {
      hello: { status: 'learning', translation: '你好；问候' },
    };
    decorateWordSpan(span, 'Hello', map);
    expect(span.classList.contains('ueh-hl-learning')).toBe(true);
    expect(span.classList.contains('ueh-word-has-gloss')).toBe(true);
    expect(span.querySelector('.ueh-word-surface')?.textContent).toBe('Hello');
    expect(span.querySelector('.ueh-word-gloss')?.textContent).toBe('你好');
    expect(span.getAttribute('data-gloss')).toBe('你好；问候');
  });
});
