import type { LearningStatus } from '../db/schema';
import type { VocabHighlightConfig } from '../shared/domain/types';
import { DEFAULT_VOCAB_HIGHLIGHT } from '../shared/domain/types';
import {
  cleanLine,
  isExplicitDefinitionLine,
  isQueryEchoLine,
  isSentenceLine,
  ALL_PREFIX_PATTERN,
} from '../api/ai-provider';

/** Per-word entry for subtitle highlight + inline gloss. */
export interface HighlightEntry {
  status: LearningStatus;
  /** Saved definition (target language), if any. */
  translation?: string;
}

export type HighlightMap = Record<string, HighlightEntry>;

const HL_CLASSES = ['ueh-hl-new', 'ueh-hl-learning', 'ueh-hl-learned'] as const;

/** Canonical key for word lookup / storage (strip punctuation, lowercase). */
export function normalizeWordKey(surface: string): string {
  return surface.toLowerCase().trim().replace(/[^\p{L}\p{N}'-]/gu, '');
}

export function entryForSurface(
  map: HighlightMap,
  surface: string,
): HighlightEntry | null {
  const key = normalizeWordKey(surface);
  if (!key) return null;
  return map[key] ?? null;
}

export function statusForSurface(
  map: HighlightMap,
  surface: string,
): LearningStatus | null {
  return entryForSurface(map, surface)?.status ?? null;
}

export function translationForSurface(
  map: HighlightMap,
  surface: string,
): string | undefined {
  const t = entryForSurface(map, surface)?.translation?.trim();
  return t || undefined;
}

export const VOCAB_PREFIX_REGEX = ALL_PREFIX_PATTERN;

/**
 * Compact gloss under a highlighted word.
 * Takes the first sense and truncates for inline display.
 * Strips prefixes like "词：", "单词：", "上下文：", "查询：", "Query:", "释义：" and avoids echoing the surface word.
 * Keep short so absolute under-word labels stay unobtrusive.
 */
export function shortGloss(
  translation: string | undefined,
  maxLen = 6,
  surface?: string,
): string {
  if (!translation) return '';

  const rawLines = translation
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!rawLines.length) return '';

  const isSurface = (text: string) =>
    Boolean(surface && text.toLowerCase() === surface.toLowerCase().trim());

  let chosenLine = '';

  if (rawLines.length > 1) {
    // 1. Look for explicit definition line (e.g. "单词：法语", "【单词】法语", "释义：法语")
    const defLine = rawLines.find((l) => {
      if (!isExplicitDefinitionLine(l)) return false;
      if (isSentenceLine(l)) return false;
      const cleaned = cleanLine(l, surface);
      return cleaned && !isSurface(cleaned);
    });

    if (defLine) {
      chosenLine = defLine;
    } else {
      // 2. Find target language line that is not a header, context line, or example
      const zhCandidate = rawLines.find((l) => {
        if (/^#+/.test(l)) return false;
        if (isSentenceLine(l) || isQueryEchoLine(l)) return false;
        const cleaned = cleanLine(l, surface);
        if (!cleaned || /^(?:例句|e\.g\.)/i.test(cleaned) || isSurface(cleaned)) return false;
        if (/^(?:释义|Definition|词根|扩展|语法点|讲解|同义词|反义词|例句)$/i.test(cleaned)) return false;
        return /[\u4e00-\u9fa5]/.test(cleaned);
      });

      if (zhCandidate) {
        chosenLine = zhCandidate;
      } else {
        const nonSentence = rawLines.find((l) => {
          if (/^#+/.test(l)) return false;
          if (isSentenceLine(l) || isQueryEchoLine(l)) return false;
          const cleaned = cleanLine(l, surface);
          if (!cleaned || /^(?:例句|e\.g\.)/i.test(cleaned) || isSurface(cleaned)) return false;
          if (/^[\[/][^\]/]+[\]/]$/.test(cleaned)) return false;
          if (/^(?:释义|Definition|词根|扩展|语法点|讲解|同义词|反义词|例句)$/i.test(cleaned)) return false;
          return true;
        });
        chosenLine = nonSentence ?? '';
      }
    }
  } else {
    // Single line: if it's purely a sentence/context line, reject it so subtitle doesn't show context sentence
    if (isSentenceLine(rawLines[0]) && !isExplicitDefinitionLine(rawLines[0])) {
      return '';
    }
    chosenLine = rawLines[0];
  }

  if (!chosenLine) return '';

  let t = cleanLine(chosenLine, surface);

  // Drop leading POS tags like "n. " / "v. " / "adj. " / "[n.] " / "(n.) "
  t = t.replace(/^(?:\[?[a-z]{1,5}\]?\.\s+|\[[a-z]{1,5}\]\s*|\([a-z]{1,5}\)\s*)+/i, '').trim();

  // Re-clean in case prefix was after POS tag
  t = cleanLine(t, surface);

  // Take first sense before delimiter
  t = t.split(/[;；|/｜]/)[0]?.trim() ?? t;

  // Clean trailing punctuation
  t = t.replace(/[.,:;!?，。：；！？]+$/, '').trim();

  if (!t || isSurface(t) || isQueryEchoLine(t)) return '';

  if (t.length > maxLen) return `${t.slice(0, maxLen)}…`;
  return t;
}

/** Apply vocab highlight classes + optional under-word gloss. */
export function decorateWordSpan(
  span: HTMLElement,
  surface: string,
  map: HighlightMap,
  cfg: VocabHighlightConfig = DEFAULT_VOCAB_HIGHLIGHT,
): void {
  // Clear previous decoration so re-render / re-decorate is idempotent
  for (const c of HL_CLASSES) span.classList.remove(c);
  span.classList.remove('ueh-word-has-gloss');
  span.style.boxShadow = '';
  span.removeAttribute('title');
  span.removeAttribute('data-gloss');

  if (cfg.enabled === false) {
    span.textContent = surface;
    return;
  }

  const entry = entryForSurface(map, surface);
  if (!entry) {
    span.textContent = surface;
    return;
  }

  const st = entry.status;
  const cls = highlightClass(st);
  if (cls) span.classList.add(cls);

  const full = entry.translation?.trim() || '';
  const gloss = shortGloss(full, 6, surface);
  const tip = full
    ? `${surface} · ${full}`
    : `生词 · ${st}`;
  span.title = tip;
  if (full) span.setAttribute('data-gloss', full);

  span.style.boxShadow = `inset 0 -2px 0 ${colorForStatus(st, cfg)}`;

  if (gloss) {
    span.classList.add('ueh-word-has-gloss');
    const doc = span.ownerDocument;
    const surfaceEl = doc.createElement('span');
    surfaceEl.className = 'ueh-word-surface';
    surfaceEl.textContent = surface;
    const glossEl = doc.createElement('span');
    glossEl.className = 'ueh-word-gloss';
    glossEl.textContent = gloss;
    span.replaceChildren(surfaceEl, glossEl);
  } else {
    span.textContent = surface;
  }
}

export function colorForStatus(
  status: LearningStatus,
  cfg: VocabHighlightConfig = DEFAULT_VOCAB_HIGHLIGHT,
): string {
  switch (status) {
    case 'learning':
      return cfg.learningColor;
    case 'learned':
      return cfg.learnedColor;
    case 'new':
    default:
      return cfg.newColor;
  }
}

/**
 * Under-word gloss CSS.
 * Gloss is position:absolute so it does NOT expand per-word height /
 * scramble baseline alignment. Parent line uses a uniform line-height
 * bump via `.ueh-en-has-gloss` instead of uneven flex columns.
 *
 * Visual goals: clear air gap under the English word, readable pill,
 * and enough line padding so gloss never collides with the next line.
 */
export function buildWordGlossCss(): string {
  return `
    .ueh-word {
      position: relative;
    }
    /* English line: room for under-word gloss + gap from next line */
    .ueh-en-has-gloss {
      line-height: 2.05 !important;
      padding-top: 0.08em;
      padding-bottom: 0.55em;
    }
    .ueh-word.ueh-word-has-gloss {
      display: inline;
      position: relative;
      /* keep on the same baseline as non-vocab words */
      vertical-align: baseline;
      /* horizontal room so adjacent gloss pills don't merge */
      padding: 0 0.2em 0.05em;
      margin: 0 0.06em;
      border-radius: 4px;
    }
    .ueh-word-surface {
      display: inline;
      line-height: inherit;
    }
    /* Float under the word — out of document flow, with intentional gap */
    .ueh-word-gloss {
      position: absolute;
      left: 50%;
      top: calc(100% + 0.2em);
      transform: translateX(-50%);
      z-index: 2;
      display: block;
      box-sizing: border-box;
      font-size: 0.5em;
      font-weight: 600;
      line-height: 1.15;
      letter-spacing: 0.03em;
      opacity: 0.96;
      max-width: 6.5em;
      min-width: 1.2em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #fff;
      pointer-events: none;
      user-select: none;
      padding: 0.14em 0.4em;
      border-radius: 999px;
      background: rgba(8, 10, 16, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
      text-shadow: none;
      filter: none;
    }
    /* Instant hover tip (full gloss) — no click, no video pause */
    .ueh-word[data-gloss]:hover::after {
      content: attr(data-gloss);
      position: absolute;
      left: 50%;
      bottom: calc(100% + 8px);
      transform: translateX(-50%);
      z-index: 30;
      max-width: min(240px, 70vw);
      padding: 5px 8px;
      border-radius: 6px;
      background: rgba(12, 14, 20, 0.96);
      color: #fff;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.35;
      white-space: normal;
      text-align: center;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
      pointer-events: none;
      word-break: break-word;
    }
    .ueh-word[data-gloss]:hover::before {
      content: "";
      position: absolute;
      left: 50%;
      bottom: calc(100% + 3px);
      transform: translateX(-50%);
      z-index: 30;
      border: 5px solid transparent;
      border-top-color: rgba(12, 14, 20, 0.96);
      pointer-events: none;
    }
  `;
}

/** Mark the English cue container when any under-word gloss is present. */
export function syncEnGlossClass(en: HTMLElement | null): void {
  if (!en) return;
  en.classList.toggle(
    'ueh-en-has-gloss',
    !!en.querySelector('.ueh-word-has-gloss'),
  );
}

/** CSS snippet injected into PiP / page overlay. */
export function buildHighlightCss(cfg: VocabHighlightConfig): string {
  if (!cfg.enabled) return buildWordGlossCss();
  return `
    ${buildWordGlossCss()}
    .ueh-word.ueh-hl-new {
      background: color-mix(in srgb, ${cfg.newColor} 34%, transparent);
      border-bottom-color: ${cfg.newColor} !important;
      border-radius: 5px;
    }
    .ueh-word.ueh-hl-learning {
      background: color-mix(in srgb, ${cfg.learningColor} 34%, transparent);
      border-bottom-color: ${cfg.learningColor} !important;
      border-radius: 5px;
    }
    .ueh-word.ueh-hl-learned {
      background: color-mix(in srgb, ${cfg.learnedColor} 30%, transparent);
      border-bottom-color: ${cfg.learnedColor} !important;
      border-radius: 5px;
    }
  `;
}

export function highlightClass(status: LearningStatus | null): string {
  if (!status) return '';
  return `ueh-hl-${status}`;
}
