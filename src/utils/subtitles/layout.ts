/**
 * Resolve and apply bilingual subtitle placement:
 * - stacked: one block with translation above/below original
 * - split: original and translation on opposite vertical edges
 */

import type {
  SubtitlePosition,
  SubtitlesLayout,
  SubtitlesTranslationPosition,
} from '@/types/config/subtitles';
import {
  MAX_POSITION_PERCENT,
  MIN_POSITION_PERCENT,
} from '../constants/subtitles';

export type SubtitleEdge = 'top' | 'bottom';

export interface ResolvedSubtitlePlacement {
  layout: SubtitlesLayout;
  /** stacked only */
  flexDirection: 'column' | 'column-reverse';
  /** stacked block anchor */
  stackAnchor: SubtitleEdge;
  /** split only — where original sits */
  originalEdge: SubtitleEdge;
  /** split only — where translation sits */
  translationEdge: SubtitleEdge;
  /** clamped 0–45 */
  percent: number;
}

export function clampPositionPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 10;
  return Math.max(
    MIN_POSITION_PERCENT,
    Math.min(MAX_POSITION_PERCENT, percent),
  );
}

/**
 * Map style + position into concrete placement rules.
 *
 * Split + translationPosition:
 * - `above` → translation on top edge, original on bottom (中文上 / 英文下)
 * - `below` → original on top edge, translation on bottom (英文上 / 中文下)
 */
export function resolveSubtitlePlacement(opts: {
  layout?: SubtitlesLayout | null;
  translationPosition?: SubtitlesTranslationPosition | null;
  position?: Partial<SubtitlePosition> | null;
}): ResolvedSubtitlePlacement {
  const layout: SubtitlesLayout =
    opts.layout === 'split' ? 'split' : 'stacked';
  const translationPosition: SubtitlesTranslationPosition =
    opts.translationPosition === 'above' ? 'above' : 'below';
  const percent = clampPositionPercent(opts.position?.percent ?? 10);
  const stackAnchor: SubtitleEdge =
    opts.position?.anchor === 'top' ? 'top' : 'bottom';

  if (layout === 'split') {
    if (translationPosition === 'above') {
      return {
        layout: 'split',
        flexDirection: 'column',
        stackAnchor,
        originalEdge: 'bottom',
        translationEdge: 'top',
        percent,
      };
    }
    return {
      layout: 'split',
      flexDirection: 'column',
      stackAnchor,
      originalEdge: 'top',
      translationEdge: 'bottom',
      percent,
    };
  }

  return {
    layout: 'stacked',
    flexDirection:
      translationPosition === 'above' ? 'column-reverse' : 'column',
    stackAnchor,
    originalEdge: stackAnchor,
    translationEdge: stackAnchor,
    percent,
  };
}

export interface ApplySubtitleLayerLayoutOpts {
  placement: ResolvedSubtitlePlacement;
  /**
   * Extra px under bottom-anchored lines (PiP chrome clearance).
   * Applied only when the line/block sits on the bottom edge.
   */
  bottomExtraPx?: number;
  /**
   * Prefer % for page overlay; PiP may pass true to use px for stacked bottom.
   * When true and stacked+bottom: bottom = max(bottomExtraPx, bottomExtraPx - 8 + percent*1.2) style.
   * Keep simple: stacked bottom uses `bottom: max(bottomExtraPx, percent as soft)`.
   */
  stackedBottomPx?: number | null;
}

function clearEdge(el: HTMLElement): void {
  el.style.top = '';
  el.style.bottom = '';
  el.style.left = '';
  el.style.right = '';
  el.style.position = '';
  el.style.transform = '';
  el.style.margin = '';
}

function pinEdge(
  el: HTMLElement,
  edge: SubtitleEdge,
  percent: number,
  bottomExtraPx: number,
): void {
  el.style.position = 'absolute';
  el.style.left = '50%';
  el.style.right = 'auto';
  el.style.transform = 'translateX(-50%)';
  el.style.margin = '0';
  if (edge === 'top') {
    el.style.top = `${percent}%`;
    el.style.bottom = 'auto';
  } else {
    el.style.top = 'auto';
    // Keep clear of player chrome when bottomExtraPx is set
    if (bottomExtraPx > 0) {
      el.style.bottom = `max(${bottomExtraPx}px, ${percent}%)`;
    } else {
      el.style.bottom = `${percent}%`;
    }
  }
}

/**
 * Mutates layer / original / translation DOM styles for the active placement.
 * Safe to call on every config change and cue re-render.
 */
export function applySubtitleLayerLayout(
  layer: HTMLElement,
  originalEl: HTMLElement,
  translationEl: HTMLElement,
  opts: ApplySubtitleLayerLayoutOpts,
): void {
  const { placement } = opts;
  const bottomExtraPx = Math.max(0, opts.bottomExtraPx ?? 0);
  const stackedBottomPx =
    opts.stackedBottomPx != null && Number.isFinite(opts.stackedBottomPx)
      ? Math.max(0, opts.stackedBottomPx)
      : null;

  // Reset line-level positioning first (split → stacked transitions)
  clearEdge(originalEl);
  clearEdge(translationEl);

  if (placement.layout === 'split') {
    layer.style.position = 'absolute';
    layer.style.left = '0';
    layer.style.right = '0';
    layer.style.top = '0';
    layer.style.bottom = '0';
    layer.style.display = 'block';
    layer.style.flexDirection = '';
    layer.style.alignItems = '';
    layer.style.gap = '';
    layer.style.padding = '0';
    layer.style.pointerEvents = 'none';
    layer.style.transform = '';

    pinEdge(
      originalEl,
      placement.originalEdge,
      placement.percent,
      placement.originalEdge === 'bottom' ? bottomExtraPx : 0,
    );
    pinEdge(
      translationEl,
      placement.translationEdge,
      placement.percent,
      placement.translationEdge === 'bottom' ? bottomExtraPx : 0,
    );
    originalEl.style.pointerEvents = 'auto';
    translationEl.style.pointerEvents = 'auto';
    originalEl.style.maxWidth = 'min(920px, 94%)';
    translationEl.style.maxWidth = 'min(920px, 94%)';
    originalEl.style.width = 'max-content';
    translationEl.style.width = 'max-content';
    originalEl.style.boxSizing = 'border-box';
    translationEl.style.boxSizing = 'border-box';
    return;
  }

  // stacked
  layer.style.position = 'absolute';
  layer.style.left = '0';
  layer.style.right = '0';
  layer.style.display = 'flex';
  layer.style.flexDirection = placement.flexDirection;
  layer.style.alignItems = 'center';
  layer.style.gap = '4px';
  layer.style.padding = '0 12px';
  layer.style.pointerEvents = 'none';
  layer.style.transform = '';

  if (placement.stackAnchor === 'top') {
    layer.style.top = `${placement.percent}%`;
    layer.style.bottom = 'auto';
  } else if (stackedBottomPx != null) {
    layer.style.top = 'auto';
    layer.style.bottom = `${stackedBottomPx}px`;
  } else if (bottomExtraPx > 0) {
    layer.style.top = 'auto';
    layer.style.bottom = `max(${bottomExtraPx}px, ${placement.percent}%)`;
  } else {
    layer.style.top = 'auto';
    layer.style.bottom = `${Math.max(0, placement.percent)}%`;
  }

  originalEl.style.position = '';
  translationEl.style.position = '';
  originalEl.style.left = '';
  translationEl.style.left = '';
  originalEl.style.transform = '';
  translationEl.style.transform = '';
  originalEl.style.width = '';
  translationEl.style.width = '';
  originalEl.style.maxWidth = 'min(920px, 94%)';
  translationEl.style.maxWidth = 'min(920px, 94%)';
  originalEl.style.pointerEvents = 'auto';
  translationEl.style.pointerEvents = 'auto';
}

/** Human-readable label for options / settings chrome. */
export function describeSubtitlePlacement(
  placement: ResolvedSubtitlePlacement,
): string {
  if (placement.layout === 'split') {
    if (placement.translationEdge === 'top') {
      return '分离：译文顶 / 原文底';
    }
    return '分离：原文顶 / 译文底';
  }
  const order =
    placement.flexDirection === 'column-reverse' ? '译文在上' : '译文在下';
  const edge = placement.stackAnchor === 'top' ? '靠上' : '靠下';
  return `堆叠：${order} · ${edge} ${placement.percent}%`;
}
