import { marked } from 'marked';

const SAFE_MD_ELEMENTS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
  'span',
] as const;

const SAFE_ELEMENT_SET = new Set<string>(SAFE_MD_ELEMENTS);
const DROP_WITH_CONTENT_SET = new Set<string>([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'noscript',
  'template',
  'textarea',
  'form',
  'input',
  'button',
  'select',
]);

function isSafeHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw, 'https://example.invalid');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function cloneSafeNodes(sourceParent: Node, targetDoc: Document): Node[] {
  const out: Node[] = [];
  for (const child of Array.from(sourceParent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.push(targetDoc.createTextNode(child.textContent ?? ''));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const srcEl = child as Element;
    const tag = srcEl.tagName.toLowerCase();

    if (DROP_WITH_CONTENT_SET.has(tag)) {
      continue;
    }

    if (!SAFE_ELEMENT_SET.has(tag)) {
      // Disallowed element: match native Sanitizer behavior by dropping it
      continue;
    }

    const cleanEl = targetDoc.createElement(tag);

    const cls = srcEl.getAttribute('class');
    if (cls && /^[a-zA-Z0-9_\-\s]+$/.test(cls)) {
      cleanEl.setAttribute('class', cls);
    }

    if (tag === 'a') {
      const href = srcEl.getAttribute('href')?.trim() ?? '';
      if (href && isSafeHttpUrl(href) && !/^\s*javascript:/i.test(href)) {
        cleanEl.setAttribute('href', href);
        cleanEl.setAttribute('target', '_blank');
        cleanEl.setAttribute('rel', 'noopener noreferrer');
      }
    }

    const children = cloneSafeNodes(srcEl, targetDoc);
    for (const c of children) {
      cleanEl.appendChild(c);
    }
    out.push(cleanEl);
  }
  return out;
}

/**
 * Safely parse Markdown and render sanitized DOM nodes into `el` without
 * exposing XSS vectors or raw `innerHTML` sinks on Trusted-Types pages.
 *
 * Uses the native Sanitizer API (`Element.prototype.setHTML`) when available,
 * and falls back to inert `DOMParser` + allowlisted DOM node construction.
 */
export function renderSafeMarkdownToElement(
  el: Element,
  markdown: string,
): void {
  const doc = el.ownerDocument ?? document;
  if (!markdown || !markdown.trim()) {
    el.replaceChildren();
    return;
  }

  let rawHtml = '';
  try {
    rawHtml = marked.parse(markdown, { breaks: true, gfm: true }) as string;
  } catch {
    el.textContent = markdown;
    return;
  }

  if ('setHTML' in Element.prototype && typeof (el as unknown as { setHTML?: unknown }).setHTML === 'function') {
    try {
      (
        el as unknown as {
          setHTML: (
            html: string,
            opts?: {
              sanitizer?: {
                elements?: readonly string[];
                attributes?: readonly string[];
              };
            },
          ) => void;
        }
      ).setHTML(rawHtml, {
        sanitizer: {
          elements: SAFE_MD_ELEMENTS,
          attributes: ['class', 'href'],
        },
      });
      // Harden any surviving anchor tags with rel="noopener noreferrer"
      el.querySelectorAll('a').forEach((a) => {
        const href = a.getAttribute('href') ?? '';
        if (!href || !isSafeHttpUrl(href)) {
          a.removeAttribute('href');
        } else {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
        }
      });
      return;
    } catch {
      // Fall through to DOMParser sanitizer if browser Sanitizer config differs
    }
  }

  try {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(rawHtml, 'text/html');
    const safeNodes = cloneSafeNodes(parsed.body, doc);
    el.replaceChildren(...safeNodes);
  } catch {
    el.textContent = markdown;
  }
}
