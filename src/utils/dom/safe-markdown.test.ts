import { describe, expect, it } from 'vitest';
import { renderSafeMarkdownToElement } from './safe-markdown';

describe('renderSafeMarkdownToElement', () => {
  it('renders standard markdown elements cleanly', () => {
    const div = document.createElement('div');
    renderSafeMarkdownToElement(
      div,
      '## 释义\n\n**单词**；*话语*\n\n- `in a word`\n- [Example](https://example.com)',
    );
    expect(div.querySelector('h2')?.textContent).toBe('释义');
    expect(div.querySelector('strong')?.textContent).toBe('单词');
    expect(div.querySelector('em')?.textContent).toBe('话语');
    expect(div.querySelector('code')?.textContent).toBe('in a word');
    const link = div.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('strips XSS payloads, dangerous tags, inline event handlers, and javascript: URLs', () => {
    const div = document.createElement('div');
    renderSafeMarkdownToElement(
      div,
      `Hello **world**
<script>window.__xss = true;</script>
<img src="x" onerror="alert(1)">
<svg onload="alert(2)"></svg>
<p onclick="alert(3)" data-secret="123">Safe paragraph</p>

[Bad Link](javascript:alert(4))

<a href="javascript:alert(5)">Raw Bad Anchor</a>`,
    );

    expect(div.querySelector('script')).toBeNull();
    expect(div.querySelector('img')).toBeNull();
    expect(div.querySelector('svg')).toBeNull();
    const p = Array.from(div.querySelectorAll('p')).find((el) =>
      el.textContent?.includes('Safe paragraph'),
    );
    expect(p?.getAttribute('onclick')).toBeNull();
    expect(p?.getAttribute('data-secret')).toBeNull();
    const anchors = Array.from(div.querySelectorAll('a'));
    for (const a of anchors) {
      expect(a.getAttribute('href')).toBeNull();
    }
  });
});
