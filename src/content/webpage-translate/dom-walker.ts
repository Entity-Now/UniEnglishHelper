/**
 * DOM Tree Walker for Webpage Translation.
 * Extracts translatable text blocks and paragraphs while respecting Site Rules.
 */

import type { ResolvedSiteRule } from '../../utils/site-rules/resolve';

export interface TranslatableParagraph {
  id: string;
  element: HTMLElement;
  text: string;
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
  'ARTICLE',
  'SECTION',
  'ASIDE',
  'HEADER',
  'FOOTER',
  'FIGCAPTION',
  'DD',
  'DT',
  'TD',
  'TH',
]);

let paragraphCounter = 0;

export function extractTranslatableParagraphs(
  root: HTMLElement | Document = document.body,
  siteRule: ResolvedSiteRule,
  minCharacters = 2,
): TranslatableParagraph[] {
  const list: TranslatableParagraph[] = [];
  if (!root || !('querySelectorAll' in root)) return list;

  const minChars = siteRule.minCharacters ?? minCharacters;
  const minWords = siteRule.minWords ?? 0;

  const walker = document.createTreeWalker(
    root === document ? document.body : (root as HTMLElement),
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node: Node): number {
        const el = node as HTMLElement;
        if (!el || !el.tagName) return NodeFilter.FILTER_REJECT;

        // Skip ignored tags
        if (IGNORED_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;

        // Skip extension hosts and components
        if (
          el.id?.startsWith('ueh-') ||
          el.classList?.contains('notranslate') ||
          el.getAttribute('translate') === 'no' ||
          el.getAttribute('contenteditable') === 'true' ||
          el.hasAttribute('data-ueh-translated')
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        // Apply site rule exclude selector
        if (siteRule.excludeSelector && el.matches(siteRule.excludeSelector)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  const candidateElements: HTMLElement[] = [];
  let current = walker.nextNode() as HTMLElement | null;
  while (current) {
    candidateElements.push(current);
    current = walker.nextNode() as HTMLElement | null;
  }

  for (const el of candidateElements) {
    if (el.hasAttribute('data-ueh-trans-id')) continue;
    if (el.querySelector('.ueh-translated-block, .ueh-translated-inline')) continue;

    // If include selector is active, enforce it
    if (siteRule.includeSelector && !el.matches(siteRule.includeSelector) && !el.closest(siteRule.includeSelector)) {
      continue;
    }

    const isBlock =
      BLOCK_TAGS.has(el.tagName) ||
      (siteRule.forceBlockSelector && el.matches(siteRule.forceBlockSelector)) ||
      window.getComputedStyle(el).display === 'block';

    if (!isBlock) continue;

    // Ensure we don't select a parent block if its children are blocks with translatable content
    const hasBlockChildren = Array.from(el.children).some(
      (child) =>
        BLOCK_TAGS.has(child.tagName) ||
        (child instanceof HTMLElement &&
          window.getComputedStyle(child).display === 'block'),
    );

    if (hasBlockChildren) continue;

    const rawText = el.innerText?.trim() ?? '';
    if (!rawText || rawText.length < minChars) continue;

    if (minWords > 0) {
      const wordsCount = rawText.split(/\s+/).filter(Boolean).length;
      if (wordsCount < minWords) continue;
    }

    const id = `ueh-p-${Date.now()}-${++paragraphCounter}`;
    list.push({ id, element: el, text: rawText });
  }

  return list;
}
