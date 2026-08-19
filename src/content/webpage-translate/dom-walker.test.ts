import { describe, expect, it, beforeEach } from 'vitest';
import { EMPTY_RESOLVED_SITE_RULE } from '../../utils/site-rules/resolve';
import {
  extractTranslatableParagraphs,
  isOwnTranslationNode,
  looksLikeTargetLanguage,
} from './dom-walker';

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

describe('looksLikeTargetLanguage', () => {
  it('detects Chinese when targeting zh', () => {
    expect(looksLikeTargetLanguage('这是一段已经是中文的网页正文', 'zh-CN')).toBe(
      true,
    );
    expect(
      looksLikeTargetLanguage(
        'Stay hungry, stay foolish. The rest of this paragraph is English.',
        'zh-CN',
      ),
    ).toBe(false);
  });

  it('detects English when targeting en', () => {
    expect(
      looksLikeTargetLanguage('This paragraph is clearly English copy.', 'en'),
    ).toBe(true);
    expect(looksLikeTargetLanguage('这段文字主要是中文内容。', 'en')).toBe(false);
  });
});

describe('extractTranslatableParagraphs', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('picks leaf paragraphs and headings, not wrappers', () => {
    mount(`
      <article>
        <div class="wrap">
          <h1>Hello world heading</h1>
          <p>First paragraph of the article.</p>
          <p>Second paragraph of the article.</p>
        </div>
      </article>
    `);
    const found = extractTranslatableParagraphs(
      document.body,
      EMPTY_RESOLVED_SITE_RULE,
      2,
    );
    expect(found.map((p) => p.text)).toEqual([
      'Hello world heading',
      'First paragraph of the article.',
      'Second paragraph of the article.',
    ]);
    expect(found.every((p) => !p.inline)).toBe(true);
  });

  it('skips nav, code, pre, and notranslate', () => {
    mount(`
      <nav><p>Home About Contact</p></nav>
      <p>Readable article paragraph here.</p>
      <pre><code>const x = 1;</code></pre>
      <p class="notranslate">Do not translate this bit.</p>
    `);
    const found = extractTranslatableParagraphs(
      document.body,
      EMPTY_RESOLVED_SITE_RULE,
    );
    expect(found.map((p) => p.text)).toEqual(['Readable article paragraph here.']);
  });

  it('skips text already in the target language', () => {
    mount(`
      <p>This is an English paragraph about design.</p>
      <p>这是一段已经翻译好的中文说明文字。</p>
    `);
    const found = extractTranslatableParagraphs(
      document.body,
      EMPTY_RESOLVED_SITE_RULE,
      { minCharacters: 2, targetLang: 'zh-CN' },
    );
    expect(found.map((p) => p.text)).toEqual([
      'This is an English paragraph about design.',
    ]);
  });

  it('honours include / exclude / forceInline selectors', () => {
    mount(`
      <aside class="skip"><p>Sidebar widget text goes here.</p></aside>
      <main>
        <p>Main article paragraph to translate.</p>
        <span class="need-inline">Inline label text</span>
      </main>
    `);
    const found = extractTranslatableParagraphs(document.body, {
      ...EMPTY_RESOLVED_SITE_RULE,
      includeSelector: 'main',
      excludeSelector: '.skip',
      forceInlineSelector: '.need-inline',
    });
    expect(found.map((p) => p.text).sort()).toEqual([
      'Inline label text',
      'Main article paragraph to translate.',
    ]);
    const inline = found.find((p) => p.text === 'Inline label text');
    expect(inline?.inline).toBe(true);
  });

  it('falls back to leaf divs on non-semantic pages', () => {
    mount(`
      <main>
        <div>Alpha paragraph written as a bare div.</div>
        <div>Beta paragraph written as a bare div.</div>
      </main>
    `);
    const found = extractTranslatableParagraphs(
      document.body,
      EMPTY_RESOLVED_SITE_RULE,
    );
    expect(found.map((p) => p.text)).toEqual([
      'Alpha paragraph written as a bare div.',
      'Beta paragraph written as a bare div.',
    ]);
  });

  it('can extract from a subtree root used by mutation handling', () => {
    mount(`<div id="root"></div>`);
    const p = document.createElement('p');
    p.textContent = 'Dynamically inserted paragraph content.';
    document.getElementById('root')!.appendChild(p);
    const found = extractTranslatableParagraphs(p, EMPTY_RESOLVED_SITE_RULE);
    expect(found).toHaveLength(1);
    expect(found[0].element).toBe(p);
  });

  it('skips list items that are only nested-list wrappers', () => {
    mount(`
      <ul>
        <li>
          <ul>
            <li>Nested leaf item text here.</li>
          </ul>
        </li>
        <li>Top level leaf item text.</li>
      </ul>
    `);
    const found = extractTranslatableParagraphs(
      document.body,
      EMPTY_RESOLVED_SITE_RULE,
    );
    expect(found.map((p) => p.text).sort()).toEqual([
      'Nested leaf item text here.',
      'Top level leaf item text.',
    ]);
  });
});

describe('isOwnTranslationNode', () => {
  it('recognises injected translation chrome', () => {
    mount(`
      <p>
        <span class="ueh-original-wrap">Hello</span>
        <span class="ueh-translated-block" data-ueh-translated="true">你好</span>
      </p>
    `);
    const trans = document.querySelector('.ueh-translated-block')!;
    const wrap = document.querySelector('.ueh-original-wrap')!;
    expect(isOwnTranslationNode(trans)).toBe(true);
    expect(isOwnTranslationNode(wrap)).toBe(true);
    expect(isOwnTranslationNode(document.querySelector('p')!)).toBe(false);
  });
});
