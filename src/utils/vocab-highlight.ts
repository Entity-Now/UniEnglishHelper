import type { LearningStatus } from '../db/schema';
import type { VocabHighlightConfig } from '../shared/domain/types';
import { DEFAULT_VOCAB_HIGHLIGHT } from '../shared/domain/types';

export type HighlightMap = Record<string, LearningStatus>;

/** Canonical key for word lookup / storage (strip punctuation, lowercase). */
export function normalizeWordKey(surface: string): string {
  return surface.toLowerCase().trim().replace(/[^\p{L}\p{N}'-]/gu, '');
}

export function statusForSurface(
  map: HighlightMap,
  surface: string,
): LearningStatus | null {
  const key = normalizeWordKey(surface);
  if (!key) return null;
  return map[key] ?? null;
}

/** Apply vocab highlight classes + underline to a clickable word span. */
export function decorateWordSpan(
  span: HTMLElement,
  surface: string,
  map: HighlightMap,
  cfg: VocabHighlightConfig = DEFAULT_VOCAB_HIGHLIGHT,
): void {
  if (cfg.enabled === false) return;
  const st = statusForSurface(map, surface);
  const cls = highlightClass(st);
  if (!cls || !st) return;
  span.classList.add(cls);
  span.title = `生词 · ${st}`;
  span.style.boxShadow = `inset 0 -2px 0 ${colorForStatus(st, cfg)}`;
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

/** CSS snippet injected into PiP / page overlay. */
export function buildHighlightCss(cfg: VocabHighlightConfig): string {
  if (!cfg.enabled) return '';
  return `
    .ueh-word.ueh-hl-new {
      background: color-mix(in srgb, ${cfg.newColor} 42%, transparent);
      border-bottom-color: ${cfg.newColor} !important;
      border-radius: 3px;
    }
    .ueh-word.ueh-hl-learning {
      background: color-mix(in srgb, ${cfg.learningColor} 42%, transparent);
      border-bottom-color: ${cfg.learningColor} !important;
      border-radius: 3px;
    }
    .ueh-word.ueh-hl-learned {
      background: color-mix(in srgb, ${cfg.learnedColor} 38%, transparent);
      border-bottom-color: ${cfg.learnedColor} !important;
      border-radius: 3px;
    }
  `;
}

export function highlightClass(status: LearningStatus | null): string {
  if (!status) return '';
  return `ueh-hl-${status}`;
}
