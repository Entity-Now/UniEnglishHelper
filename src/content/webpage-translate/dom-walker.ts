/**
 * DOM walker for webpage translation.
 * Prefers cheap tag/selector checks over getComputedStyle / innerText so
 * large articles don't lock the main thread before the first batch goes out.
 */

import type { ResolvedSiteRule } from '../../utils/site-rules/resolve';

export interface TranslatableParagraph {
  id: string;
  element: HTMLElement;
  text: string;
  inline: boolean;
}

export interface ExtractOptions {
  minCharacters?: number;
  targetLang?: string;
}

const IGNORED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'OPTION',
  'BUTTON',
  'SVG',
  'CANVAS',
  'AUDIO',
  'VIDEO',
  'IFRAME',
  'PRE',
  'CODE',
  'KBD',
  'SAMP',
  'VAR',
  'MATH',
]);

const BLOCK_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'BLOCKQUOTE',
  'FIGCAPTION',
  'DD',
  'DT',
  'TD',
  'TH',
  'SUMMARY',
  'CAPTION',
  'LEGEND',
  'LABEL',
]);

const BLOCK_SELECTOR = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'blockquote',
  'figcaption',
  'dd',
  'dt',
  'td',
  'th',
  'summary',
  'caption',
].join(',');

const SKIP_CLOSEST =
  'nav, [role="navigation"], [role="menu"], [role="menubar"], [role="tablist"], [role="combobox"]';

const HIDDEN_CLOSEST = '[hidden], [aria-hidden="true"]';

let paragraphCounter = 0;

function isExtensionHost(el: HTMLElement): boolean {
  return Boolean(
    el.id?.startsWith('ueh-') ||
      el.closest?.('#ueh-web-translate-host, [data-ueh-translated]'),
  );
}

function isExplicitlySkipped(el: HTMLElement): boolean {
  return (
    el.classList?.contains('notranslate') ||
    el.getAttribute('translate') === 'no' ||
    el.getAttribute('contenteditable') === 'true' ||
    el.hasAttribute('data-ueh-translated') ||
    el.hasAttribute('data-ueh-trans-id') ||
    el.classList?.contains('ueh-translated-block') ||
    el.classList?.contains('ueh-translated-inline') ||
    el.classList?.contains('ueh-original-wrap') ||
    el.classList?.contains('ueh-has-translation')
  );
}

/**
 * True when `text` is already predominantly written in `targetLang`.
 * Used to skip CJK (etc.) hosts when the user is translating into that language.
 */
export function looksLikeTargetLanguage(text: string, targetLang: string): boolean {
  const lang = targetLang.toLowerCase();
  const compact = text.replace(/\s+/g, '');
  if (compact.length < 6) return false;

  const ratio = (re: RegExp): number => {
    const m = compact.match(re);
    return (m ? m.length : 0) / compact.length;
  };

  if (
    lang.startsWith('zh') ||
    lang.startsWith('yue') ||
    lang === 'cht' ||
    lang === 'chs'
  ) {
    return ratio(/[\u4e00-\u9fff]/g) >= 0.32;
  }
  if (lang.startsWith('ja')) {
    return ratio(/[\u3040-\u30ff\u4e00-\u9fff]/g) >= 0.32;
  }
  if (lang.startsWith('ko')) {
    return ratio(/[\uac00-\ud7af]/g) >= 0.32;
  }
  if (
    lang.startsWith('ar') ||
    lang.startsWith('he') ||
    lang.startsWith('fa') ||
    lang.startsWith('ur')
  ) {
    return ratio(/[\u0600-\u06ff\u0590-\u05ff]/g) >= 0.32;
  }
  if (lang.startsWith('en') || lang.startsWith('fr') || lang.startsWith('de') || lang.startsWith('es')) {
    return ratio(/[A-Za-z]/g) >= 0.62 && ratio(/[\u4e00-\u9fff]/g) < 0.08;
  }
  return false;
}

function readableText(el: HTMLElement): string {
  const raw = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return raw;
}

function isLeafDiv(el: HTMLElement): boolean {
  if (el.tagName !== 'DIV') return false;
  for (const child of el.children) {
    const tag = child.tagName;
    if (
      BLOCK_TAGS.has(tag) ||
      tag === 'DIV' ||
      tag === 'UL' ||
      tag === 'OL' ||
      tag === 'DL' ||
      tag === 'TABLE' ||
      tag === 'SECTION' ||
      tag === 'ARTICLE' ||
      tag === 'NAV' ||
      tag === 'HEADER' ||
      tag === 'FOOTER' ||
      tag === 'PRE' ||
      tag === 'FIGURE'
    ) {
      return false;
    }
  }
  return true;
}

function acceptElement(
  el: HTMLElement,
  siteRule: ResolvedSiteRule,
): boolean {
  if (!el.tagName || IGNORED_TAGS.has(el.tagName)) return false;
  if (isExtensionHost(el) || isExplicitlySkipped(el)) return false;
  if (el.closest(SKIP_CLOSEST) || el.closest(HIDDEN_CLOSEST)) return false;
  if (siteRule.excludeSelector) {
    try {
      if (el.matches(siteRule.excludeSelector) || el.closest(siteRule.excludeSelector)) {
        return false;
      }
    } catch {
      // Invalid selector already filtered at resolve time; ignore.
    }
  }
  return true;
}

function collectCandidates(
  root: HTMLElement,
  siteRule: ResolvedSiteRule,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  const push = (el: HTMLElement) => {
    if (seen.has(el)) return;
    seen.add(el);
    out.push(el);
  };

  const scopes: HTMLElement[] = [];
  if (siteRule.includeSelector) {
    try {
      if (root.matches(siteRule.includeSelector)) scopes.push(root);
      root.querySelectorAll(siteRule.includeSelector).forEach((n) => {
        if (n instanceof HTMLElement) scopes.push(n);
      });
    } catch {
      scopes.push(root);
    }
  }
  if (scopes.length === 0) scopes.push(root);

  const extraBlock = siteRule.forceBlockSelector;
  const extraInline = siteRule.forceInlineSelector;
  const query = extraBlock ? `${BLOCK_SELECTOR},${extraBlock}` : BLOCK_SELECTOR;

  for (const scope of scopes) {
    try {
      if (acceptElement(scope, siteRule)) push(scope);
      scope.querySelectorAll(query).forEach((n) => {
        if (n instanceof HTMLElement) push(n);
      });
      if (extraInline) {
        scope.querySelectorAll(extraInline).forEach((n) => {
          if (n instanceof HTMLElement) push(n);
        });
      }
    } catch {
      // malformed extra selector
    }
  }

  // Semantic-tag sparse pages (div soup): pick leaf divs inside main/article.
  if (out.length < 4) {
    const article =
      (root.matches?.('article, main, [role="main"]') ? root : null) ??
      (root.querySelector('article, main, [role="main"]') as HTMLElement | null) ??
      root;
    article.querySelectorAll('div').forEach((n) => {
      if (n instanceof HTMLElement && isLeafDiv(n)) push(n);
    });
  }

  return out;
}

export function extractTranslatableParagraphs(
  root: HTMLElement | Document = document.body,
  siteRule: ResolvedSiteRule,
  minCharactersOrOptions: number | ExtractOptions = 2,
): TranslatableParagraph[] {
  const options: ExtractOptions =
    typeof minCharactersOrOptions === 'number'
      ? { minCharacters: minCharactersOrOptions }
      : minCharactersOrOptions ?? {};

  const list: TranslatableParagraph[] = [];
  if (!root || !('querySelectorAll' in root)) return list;

  const host = (root as Document).body ?? (root as HTMLElement);
  if (!host) return list;

  const minChars = options.minCharacters ?? siteRule.minCharacters ?? 2;
  const minWords = siteRule.minWords ?? 0;
  const targetLang = options.targetLang;

  const candidates = collectCandidates(host, siteRule);

  for (const el of candidates) {
    if (!acceptElement(el, siteRule)) continue;
    if (el.querySelector('.ueh-translated-block, .ueh-translated-inline, .ueh-original-wrap')) {
      continue;
    }

    const forcedInline = Boolean(
      siteRule.forceInlineSelector && el.matches(siteRule.forceInlineSelector),
    );
    const forcedBlock = Boolean(
      siteRule.forceBlockSelector && el.matches(siteRule.forceBlockSelector),
    );
    const isBlock = forcedBlock || BLOCK_TAGS.has(el.tagName) || isLeafDiv(el);

    if (!forcedInline && !isBlock) continue;

    // Prefer leaf blocks: skip containers that wrap other paragraphs/headings/items.
    if (
      !forcedInline &&
      !forcedBlock &&
      el.querySelector('p, h1, h2, h3, h4, h5, h6, li, blockquote')
    ) {
      continue;
    }
    if (el.tagName === 'LI' && el.querySelector('ul, ol')) continue;

    const rawText = readableText(el);
    if (!rawText || rawText.length < minChars) continue;

    if (minWords > 0) {
      const wordsCount = rawText.split(/\s+/).filter(Boolean).length;
      if (wordsCount < minWords) continue;
    }

    if (targetLang && looksLikeTargetLanguage(rawText, targetLang)) continue;

    const id = `ueh-p-${++paragraphCounter}`;
    list.push({
      id,
      element: el,
      text: rawText,
      inline: forcedInline && !forcedBlock,
    });
  }

  return list;
}

export function isOwnTranslationNode(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.id === 'ueh-web-translate-host' ||
    el.id === 'ueh-webpage-translate-style' ||
    el.hasAttribute('data-ueh-translated') ||
    el.classList.contains('ueh-translated-block') ||
    el.classList.contains('ueh-translated-inline') ||
    el.classList.contains('ueh-original-wrap') ||
    Boolean(
      el.closest(
        '#ueh-web-translate-host, [data-ueh-translated], .ueh-original-wrap, .ueh-translated-block, .ueh-translated-inline',
      ),
    )
  );
}
