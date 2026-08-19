/**
 * Document PiP chrome: video fill + current-cue overlay + icon toolbar + seek bar.
 * Controls drive the *page* <video> (YouTube native chrome stays on the tab).
 */

import { ICON_BTN_CSS, iconActionButton } from './ui-icons';
import { SUBTITLE_FONT_FAMILIES } from '../utils/constants/subtitles';

/** Side-rail widths. Opening a panel grows the PiP window by this much. */
export const PIP_RECAP_PANEL_PX = 280;
export const PIP_CUELIST_PANEL_PX = 300;

export function pipSidePanelExtraPx(opts: {
  recapOpen?: boolean;
  cueListOpen?: boolean;
}): number {
  return (
    (opts.recapOpen ? PIP_RECAP_PANEL_PX : 0) +
    (opts.cueListOpen ? PIP_CUELIST_PANEL_PX : 0)
  );
}

export function clampPipOuterSize(opts: {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  minWidth?: number;
  minHeight?: number;
}): { width: number; height: number } {
  const minW = opts.minWidth ?? 480;
  const minH = opts.minHeight ?? 320;
  const availW = Math.max(minW, opts.availWidth || minW);
  const availH = Math.max(minH, opts.availHeight || minH);
  return {
    width: Math.max(minW, Math.min(availW, Math.round(opts.width))),
    height: Math.max(minH, Math.min(availH, Math.round(opts.height))),
  };
}

export function buildPipStyles(opts: {
  fontSize: number;
  bgOpacity: number;
  displayMode?: 'bilingual' | 'originalOnly' | 'translationOnly' | 'off';
  translationPosition?: 'above' | 'below';
  mainColor?: string;
  translationColor?: string;
  translationFontSize?: number;
  mainWeight?: number;
  translationWeight?: number;
  fontFamily?: string;
  underlineWords?: boolean;
  panelWidth?: number;
}): string {
  const {
    fontSize,
    bgOpacity,
    mainColor = '#fff',
    translationColor = 'oklch(90% 0.055 88)',
    translationFontSize,
    mainWeight = 600,
    translationWeight = 500,
    fontFamily = SUBTITLE_FONT_FAMILIES.system,
    underlineWords = true,
    panelWidth = 280,
  } = opts;
  const bg = Math.max(0, Math.min(1, bgOpacity));
  const trSize = translationFontSize ?? Math.round(fontSize * 0.86);
  const bare = bg < 0.04;
  const glassBg = bare
    ? 'transparent'
    : `linear-gradient(180deg, rgba(16,18,26,${(bg * 0.78).toFixed(3)}) 0%, rgba(0,0,0,${bg.toFixed(3)}) 100%)`;
  const glassBorder = bare ? 'none' : '1px solid rgba(255,255,255,0.13)';
  const glassShadow = bare
    ? 'none'
    : '0 10px 36px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.12)';
  const glassBlur = bare ? 'none' : 'blur(14px) saturate(1.25)';
  const wordBorder = underlineWords
    ? 'border-bottom: 1px solid color-mix(in srgb, currentColor 32%, transparent);'
    : 'border-bottom: none;';
  return `
    html, body {
      margin: 0 !important; padding: 0 !important;
      width: 100% !important; height: 100% !important;
      overflow: hidden !important;
      background: #0a0a0b;
      color: #f5f5f5;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      user-select: none;
    }
    body + body { display: none !important; }
    #ueh-pip-root {
      --ueh-pip-recap-w: ${PIP_RECAP_PANEL_PX}px;
      --ueh-pip-list-w: ${PIP_CUELIST_PANEL_PX}px;
      position: relative;
      width: 100%; height: 100%;
      display: flex; flex-direction: row;
      align-items: stretch;
      background: #000;
      overflow: hidden;
    }
    #ueh-pip-recap-slot,
    #ueh-pip-cuelist-slot {
      flex: 0 0 0;
      width: 0;
      min-width: 0;
      overflow: hidden;
      align-self: stretch;
      z-index: 12;
      background: #101116;
    }
    #ueh-pip-root.ueh-recap-open #ueh-pip-recap-slot {
      flex: 0 0 var(--ueh-pip-recap-w);
      width: var(--ueh-pip-recap-w);
      border-right: 1px solid rgba(255,255,255,.1);
    }
    #ueh-pip-root.ueh-cue-list-open #ueh-pip-cuelist-slot {
      flex: 0 0 var(--ueh-pip-list-w);
      width: var(--ueh-pip-list-w);
      border-left: 1px solid rgba(255,255,255,.1);
    }
    #ueh-pip-stage {
      position: relative;
      flex: 1 1 auto;
      min-width: 200px;
      min-height: 0;
      height: 100%;
      background: #000;
      contain: layout style;
    }
    #ueh-video-slot {
      position: absolute;
      inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: #000; overflow: hidden;
      contain: strict;
    }
    #ueh-video-slot video, #ueh-video-slot canvas {
      width: 100% !important; height: 100% !important;
      object-fit: contain; display: block; background: #000;
      /* Avoid layout thrash while the OS resizes the PiP window */
      pointer-events: none;
    }
    /* Current cue — stacked bilingual reads as one glass card */
    #ueh-sub-layer {
      position: absolute; left: 0; right: 0; bottom: 72px;
      z-index: 6; display: flex; flex-direction: column;
      align-items: center; gap: 0;
      padding: 0 16px; pointer-events: none;
      transition: padding-right .2s ease, padding-left .2s ease;
    }
    #ueh-pip-root.ueh-word-open #ueh-sub-layer {
      padding-right: min(300px, 42%);
      padding-left: 12px;
      z-index: 6;
    }
    #ueh-pip-root.ueh-word-open #ueh-chrome {
      z-index: 8;
    }
    #ueh-sub-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.28em;
      width: fit-content;
      max-width: min(920px, 94%);
      box-sizing: border-box;
      padding: 8px 18px 9px;
      border-radius: 16px;
      background: ${glassBg};
      border: ${glassBorder};
      box-shadow: ${glassShadow};
      backdrop-filter: ${glassBlur};
      -webkit-backdrop-filter: ${glassBlur};
      pointer-events: auto;
      cursor: pointer;
    }
    #ueh-sub-card:has(#ueh-sub-en:empty):has(#ueh-sub-tr:empty) {
      display: none !important;
      padding: 0;
      background: none;
      border: none;
      box-shadow: none;
    }
    #ueh-sub-layer.ueh-sub-split #ueh-sub-card {
      display: contents;
      padding: 0;
      background: none;
      border: none;
      box-shadow: none;
      backdrop-filter: none;
    }
    #ueh-sub-en, #ueh-sub-tr {
      max-width: 100%;
      text-align: center;
      font-family: ${fontFamily};
      font-optical-sizing: auto;
      text-wrap: pretty;
      word-break: break-word;
      overflow-wrap: anywhere;
      pointer-events: auto;
      cursor: pointer;
      text-shadow:
        0 1px 1px rgba(0,0,0,.55),
        0 0 14px rgba(0,0,0,.28);
    }
    #ueh-sub-layer.ueh-sub-stacked #ueh-sub-en,
    #ueh-sub-layer.ueh-sub-stacked #ueh-sub-tr {
      padding: 0;
      margin: 0;
      background: none;
      border: none;
      border-radius: 0;
      box-shadow: none;
    }
    #ueh-sub-layer.ueh-sub-split #ueh-sub-en,
    #ueh-sub-layer.ueh-sub-split #ueh-sub-tr {
      padding: 7px 16px;
      border-radius: 14px;
      background: ${glassBg};
      border: ${glassBorder};
      box-shadow: ${glassShadow};
      backdrop-filter: ${glassBlur};
      -webkit-backdrop-filter: ${glassBlur};
    }
    #ueh-sub-en {
      font-size: ${fontSize}px;
      font-weight: ${mainWeight};
      letter-spacing: 0.008em;
      line-height: 1.42;
      color: ${mainColor};
    }
    #ueh-sub-tr {
      font-size: ${trSize}px;
      font-weight: ${translationWeight};
      letter-spacing: 0.03em;
      line-height: 1.5;
      color: ${translationColor};
    }
    #ueh-sub-layer.ueh-sub-stacked #ueh-sub-tr:not(:empty) {
      padding-top: 0.06em;
      opacity: 0.96;
    }
    #ueh-sub-en:empty, #ueh-sub-tr:empty {
      display: none;
      padding: 0;
      background: transparent;
      border: none;
      box-shadow: none;
    }
    #ueh-sub-card.ueh-cue-in {
      animation: ueh-cue-in 0.22s ease-out;
    }
    @keyframes ueh-cue-in {
      from { opacity: 0; transform: translateY(7px) scale(0.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      #ueh-sub-card.ueh-cue-in { animation: none; }
    }
    .ueh-word {
      position: relative;
      cursor: pointer;
      ${wordBorder}
      padding: 0 0.12em 0.04em;
      margin: 0 0.02em;
      border-radius: 4px;
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    .ueh-word:hover {
      background: color-mix(in srgb, currentColor 18%, transparent);
      border-bottom-color: color-mix(in srgb, currentColor 55%, transparent);
    }
    /* Gloss layout injected via #ueh-hl-style (buildHighlightCss) */

    /* Bottom chrome */
    #ueh-chrome {
      position: absolute; left: 0; right: 0; bottom: 0; z-index: 8;
      padding: 8px 10px 10px;
      background: linear-gradient(180deg, transparent, rgba(0,0,0,.82) 40%);
      opacity: 0;
      transition: opacity .18s ease;
    }
    #ueh-pip-root:hover #ueh-chrome,
    #ueh-pip-root.ueh-show-chrome #ueh-chrome,
    #ueh-chrome:focus-within {
      opacity: 1;
    }
    #ueh-progress {
      -webkit-appearance: none; appearance: none;
      width: 100%; height: 4px; border-radius: 999px;
      background: rgba(255,255,255,.22); outline: none; cursor: pointer;
      margin: 0 0 8px;
    }
    #ueh-progress::-webkit-slider-thumb {
      -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%;
      background: oklch(76% 0.12 82); border: 0; cursor: pointer;
    }
    #ueh-bar {
      display: flex; align-items: center; gap: 4px;
    }
    #ueh-time {
      font-size: 11px; color: rgba(255,255,255,.8);
      font-variant-numeric: tabular-nums; min-width: 84px;
      margin-left: 4px;
    }
    .ueh-spacer { flex: 1; }
    .ueh-ico {
      width: 34px; height: 34px; border: 0; border-radius: 8px;
      background: transparent; color: #fff; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      padding: 0;
    }
    .ueh-ico:hover { background: rgba(255,255,255,.12); }
    .ueh-ico svg { width: 18px; height: 18px; fill: none; stroke: currentColor;
      stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .ueh-ico.brand { color: oklch(82% 0.12 82); }
    #ueh-status {
      font-size: 10px; color: rgba(255,255,255,.55); margin-left: 6px;
      max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    /* Side dictionary panel — above cue list / chrome so it is never obscured */
    #ueh-word-panel {
      position: absolute;
      top: 10px;
      right: 10px;
      bottom: 78px;
      width: min(${panelWidth}px, 46%);
      z-index: 30;
      display: flex;
      flex-direction: column;
      gap: 0;
      background: rgba(16, 17, 22, 0.96);
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 14px;
      box-shadow: -10px 0 32px rgba(0,0,0,.5);
      backdrop-filter: blur(12px);
      transform: translateX(calc(100% + 16px));
      opacity: 0;
      pointer-events: none;
      transition: transform .2s ease, opacity .2s ease, right .2s ease, width .2s ease;
      overflow: hidden;
      isolation: isolate;
    }
    #ueh-pip-root.ueh-word-open #ueh-word-panel {
      transform: translateX(0);
      opacity: 1;
      pointer-events: auto;
    }
    #ueh-pip-root.ueh-word-open.ueh-cue-list-open #ueh-word-panel {
      z-index: 32;
    }
    #ueh-word-panel-head {
      display: flex; align-items: flex-start; gap: 6px;
      padding: 8px 8px 6px 10px;
      border-bottom: 1px solid rgba(255,255,255,.08);
      flex: 0 0 auto;
    }
    #ueh-word-panel-title {
      flex: 1; min-width: 0;
      font-size: 14px; font-weight: 700; line-height: 1.3;
      color: oklch(88% 0.08 82);
      word-break: break-word;
    }
    #ueh-word-panel-head-actions {
      display: flex; align-items: center; gap: 3px; flex-shrink: 0;
    }
    #ueh-word-panel-head-actions .ueh-ibtn {
      width: 26px; height: 26px; border-radius: 7px;
    }
    #ueh-word-panel-head-actions .ueh-ibtn svg {
      width: 13px; height: 13px;
    }
    #ueh-word-panel-close {
      flex-shrink: 0; width: 26px; height: 26px; border: 0; border-radius: 7px;
      background: rgba(255,255,255,.08); color: #fff; cursor: pointer;
      font-size: 15px; line-height: 1;
      display: inline-flex; align-items: center; justify-content: center;
      padding: 0;
    }
    #ueh-word-panel-close:hover { background: rgba(255,255,255,.16); }
    #ueh-word-panel-ctx {
      flex: 0 0 auto;
      margin: 6px 10px 0;
      padding: 5px 7px;
      border-radius: 6px;
      background: rgba(255,255,255,.06);
      font-size: 11px; line-height: 1.4;
      color: rgba(255,255,255,.85);
      white-space: pre-wrap;
      word-break: break-word;
      overflow: visible;
    }
    #ueh-word-panel-ctx .tr-line {
      margin-top: 3px;
      color: oklch(88% 0.08 82);
    }
    #ueh-word-panel-main {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #ueh-word-panel-body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 6px 10px 10px;
      font-size: 12px; line-height: 1.45;
      color: rgba(255,255,255,.92);
      white-space: pre-wrap;
      word-break: break-word;
    }
    ${ICON_BTN_CSS}
    /* Small PiP window: word panel goes full-screen of the video stage */
    @media (max-height: 400px), (max-width: 420px) {
      #ueh-pip-root.ueh-word-open #ueh-word-panel {
        top: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        left: 0 !important;
        width: 100% !important;
        max-width: none !important;
        border-radius: 0;
        z-index: 50;
      }
    }

    /* YouTube ad banner */
    #ueh-ad-banner {
      position: absolute; left: 50%; top: 14px; z-index: 12;
      transform: translateX(-50%);
      display: none; align-items: center; gap: 10px;
      max-width: min(92%, 420px);
      padding: 10px 14px;
      border-radius: 12px;
      background: rgba(20, 12, 8, 0.92);
      border: 1px solid oklch(76% 0.12 82 / 0.55);
      box-shadow: 0 8px 28px rgba(0,0,0,.45);
      pointer-events: auto;
    }
    #ueh-ad-banner.ueh-ad-visible { display: flex; }
    #ueh-ad-banner.ueh-ad-skippable {
      border-color: oklch(72% 0.16 145 / 0.7);
      background: rgba(12, 28, 18, 0.94);
    }
    #ueh-ad-label {
      font-size: 13px; font-weight: 600; color: #fff;
      white-space: nowrap;
    }
    #ueh-ad-hint {
      font-size: 11px; color: rgba(255,255,255,.65);
    }
    #ueh-ad-skip {
      border: 0; border-radius: 8px;
      padding: 8px 14px; cursor: pointer;
      font-size: 13px; font-weight: 700;
      background: oklch(76% 0.12 82); color: #1a1a1a;
      white-space: nowrap;
    }
    #ueh-ad-skip:hover { filter: brightness(1.08); }
    #ueh-ad-skip:disabled {
      opacity: 0.45; cursor: not-allowed; filter: none;
    }
    #ueh-pip-root.ueh-ad-active #ueh-sub-layer { opacity: 0.15; }
    #ueh-pip-root.ueh-subs-off #ueh-sub-layer { display: none !important; }
    .ueh-ico.recap-wrap {
      position: relative;
    }
    .ueh-recap-badge {
      position: absolute;
      top: 2px; right: 2px;
      min-width: 14px; height: 14px;
      padding: 0 3px;
      border-radius: 999px;
      background: oklch(76% 0.12 82);
      color: #1a1a1a;
      font-size: 8px; font-weight: 800;
      line-height: 14px;
      text-align: center;
      pointer-events: none;
      display: none;
    }
    .ueh-recap-badge.on { display: block; }

    /* Subtitle visibility toggles in chrome */
    .ueh-chip {
      border: 1px solid rgba(255,255,255,.18);
      background: rgba(255,255,255,.08);
      color: rgba(255,255,255,.85);
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 11px; font-weight: 600;
      cursor: pointer;
      line-height: 1.2;
    }
    .ueh-chip:hover { background: rgba(255,255,255,.14); }
    .ueh-chip.off {
      opacity: 0.45;
      text-decoration: line-through;
    }

    /* PiP subtitle settings panel */
    #ueh-pip-settings {
      position: absolute;
      right: 10px;
      bottom: 78px;
      z-index: 14;
      width: min(280px, 88vw);
      max-height: min(70%, 360px);
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
      padding: 12px;
      border-radius: 12px;
      background: rgba(16,17,22,.96);
      border: 1px solid rgba(255,255,255,.14);
      box-shadow: 0 12px 36px rgba(0,0,0,.45);
      display: none;
      pointer-events: auto;
      font-size: 12px;
      color: #f5f5f5;
      scrollbar-width: thin;
      scrollbar-color: transparent transparent;
    }
    #ueh-pip-settings:hover {
      scrollbar-color: rgba(255,255,255,.28) transparent;
    }
    #ueh-pip-settings::-webkit-scrollbar { width: 5px; }
    #ueh-pip-settings::-webkit-scrollbar-track { background: transparent; }
    #ueh-pip-settings::-webkit-scrollbar-thumb {
      background: transparent; border-radius: 999px;
    }
    #ueh-pip-settings:hover::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,.22);
    }
    #ueh-pip-settings.ueh-open { display: block; }
    #ueh-pip-settings h3 {
      margin: 0 0 10px; font-size: 13px; font-weight: 700;
      color: oklch(88% 0.08 82);
    }
    #ueh-pip-settings label.ueh-row {
      display: flex; align-items: center; gap: 8px;
      margin: 6px 0; cursor: pointer; user-select: none;
    }
    #ueh-pip-settings label.ueh-block {
      display: block; margin: 8px 0 4px;
      color: rgba(255,255,255,.65); font-size: 11px;
    }
    #ueh-pip-settings select,
    #ueh-pip-settings input[type="range"] {
      width: 100%; box-sizing: border-box;
    }
    #ueh-pip-settings select {
      background: #0d1117; color: #f5f5f5;
      border: 1px solid #30363d; border-radius: 8px;
      padding: 6px 8px; font-size: 12px;
    }
    #ueh-pip-settings .ueh-actions {
      display: flex; gap: 8px; margin-top: 12px;
    }
    #ueh-pip-settings .ueh-actions button {
      flex: 1; border: 0; border-radius: 8px;
      padding: 8px; font-weight: 700; cursor: pointer; font-size: 12px;
    }
    #ueh-pip-settings .ueh-save {
      background: oklch(76% 0.12 82); color: #1a1a1a;
    }
    #ueh-pip-settings .ueh-close-btn {
      background: rgba(255,255,255,.1); color: #fff;
    }
    #ueh-pip-settings .ueh-status {
      margin-top: 8px; font-size: 11px; color: oklch(80% 0.1 145);
      min-height: 1.2em;
    }
    #ueh-pip-settings .ueh-hint {
      margin: 8px 0 0; font-size: 10px; color: rgba(255,255,255,.5);
    }
  `;
}

/** Icon paths (lucide-style strokes) */
export const ICONS = {
  play: '<polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none"/>',
  pause:
    '<rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none"/>',
  prev: '<polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/>',
  next: '<polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/>',
  translate:
    '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  subtitles:
    '<path d="M4 6h16v12H4z"/><path d="M8 12h8"/><path d="M8 15h5"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
  list:
    '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  book:
    '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="M8 11h8"/><path d="M8 7h6"/>',
  volume:
    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
} as const;

export function iconButton(
  act: string,
  svgInner: string,
  title: string,
  extraClass = '',
): string {
  return `<button type="button" class="ueh-ico ${extraClass}" data-act="${act}" title="${title}" aria-label="${title}">
    <svg viewBox="0 0 24 24" aria-hidden="true">${svgInner}</svg>
  </button>`;
}

export function buildPipMarkup(): string {
  return `
    <div id="ueh-pip-root">
      <aside id="ueh-pip-recap-slot" aria-label="生词回顾"></aside>
      <div id="ueh-pip-stage">
      <div id="ueh-video-slot">
        <div style="color:#8b949e;font-size:13px;padding:12px;">加载画面…</div>
      </div>
      <div id="ueh-ad-banner" role="status" aria-live="polite">
        <div>
          <div id="ueh-ad-label">广告播放中</div>
          <div id="ueh-ad-hint">请在原页面或点击跳过</div>
        </div>
        <button type="button" id="ueh-ad-skip" disabled>跳过广告</button>
      </div>
      <div id="ueh-sub-layer">
        <div id="ueh-sub-card">
          <div id="ueh-sub-en"></div>
          <div id="ueh-sub-tr"></div>
        </div>
      </div>
      <aside id="ueh-word-panel" aria-label="单词释义" aria-hidden="true">
        <div id="ueh-word-panel-head">
          <div id="ueh-word-panel-title"></div>
          <div id="ueh-word-panel-head-actions">
            ${iconActionButton('add', '加生词本', 'primary', { 'data-word-act': 'add' })}
            ${iconActionButton('tts', '朗读', '', { 'data-word-act': 'tts' })}
            <button type="button" id="ueh-word-panel-close" class="ueh-ibtn" title="关闭" aria-label="关闭">×</button>
          </div>
        </div>
        <div id="ueh-word-panel-main">
          <div id="ueh-word-panel-ctx"></div>
          <div id="ueh-word-panel-body"></div>
        </div>
      </aside>
      <div id="ueh-pip-settings" aria-label="PiP 字幕设置">
        <h3>PiP 字幕设置</h3>
        <label class="ueh-row"><input type="checkbox" id="ueh-pip-en" /> 显示字幕</label>
        <label class="ueh-row"><input type="checkbox" id="ueh-pip-auto-tr" /> 自动翻译新句</label>
        <label class="ueh-block" for="ueh-pip-mode">显示模式</label>
        <select id="ueh-pip-mode">
          <option value="bilingual">双语</option>
          <option value="originalOnly">仅原文</option>
          <option value="translationOnly">仅译文</option>
          <option value="off">关闭</option>
        </select>
        <label class="ueh-block" for="ueh-pip-layout">双语布局</label>
        <select id="ueh-pip-layout">
          <option value="stacked">堆叠（同一区域）</option>
          <option value="split">分离（上下两端）</option>
        </select>
        <label class="ueh-block" for="ueh-pip-pos">译文位置</label>
        <select id="ueh-pip-pos">
          <option value="below">堆叠：原文下 · 分离：原文顶/译文底</option>
          <option value="above">堆叠：原文上 · 分离：译文顶/原文底</option>
        </select>
        <label class="ueh-block" for="ueh-pip-anchor">垂直锚点（堆叠）</label>
        <select id="ueh-pip-anchor">
          <option value="bottom">靠下</option>
          <option value="top">靠上</option>
        </select>
        <label class="ueh-block" for="ueh-pip-offset">边距 <span id="ueh-pip-offset-val"></span></label>
        <input type="range" id="ueh-pip-offset" min="0" max="45" step="1" />
        <label class="ueh-block" for="ueh-pip-scale">字幕大小 <span id="ueh-pip-scale-val"></span></label>
        <input type="range" id="ueh-pip-scale" min="50" max="200" step="5" />
        <label class="ueh-block" for="ueh-pip-bg">背景不透明度 <span id="ueh-pip-bg-val"></span></label>
        <input type="range" id="ueh-pip-bg" min="0" max="100" step="5" />
        <div class="ueh-actions">
          <button type="button" class="ueh-save" id="ueh-pip-save">保存</button>
          <button type="button" class="ueh-close-btn" id="ueh-pip-settings-close">关闭</button>
        </div>
        <div class="ueh-status" id="ueh-pip-settings-status"></div>
        <p class="ueh-hint">仅影响 PiP，与页内全屏字幕配置独立。</p>
      </div>
      <div id="ueh-chrome">
        <input id="ueh-progress" type="range" min="0" max="1000" value="0" step="1" />
        <div id="ueh-bar">
          ${iconButton('play', ICONS.play, '播放/暂停')}
          <span id="ueh-time">0:00 / 0:00</span>
          <span class="ueh-spacer"></span>
          <button type="button" class="ueh-chip" data-act="toggle-en" title="显示/隐藏原文字幕">原文</button>
          <button type="button" class="ueh-chip" data-act="toggle-tr" title="显示/隐藏译文字幕">译文</button>
          ${iconButton('prev', ICONS.prev, '上一句')}
          ${iconButton('next', ICONS.next, '下一句')}
          ${iconButton('translate', ICONS.translate, '翻译当前句', 'brand')}
          ${iconButton('tts', ICONS.volume, '朗读')}
          <span class="ueh-ico recap-wrap">
            ${iconButton('recap', ICONS.book, '生词回顾')}
            <span class="ueh-recap-badge" id="ueh-recap-badge"></span>
          </span>
          ${iconButton('list', ICONS.list, '字幕列表')}
          ${iconButton('settings', ICONS.settings, 'PiP 字幕设置')}
          ${iconButton('export', ICONS.save, '保存原声')}
          <span id="ueh-status"></span>
        </div>
      </div>
      </div>
      <aside id="ueh-pip-cuelist-slot" aria-label="字幕列表"></aside>
    </div>
  `;
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}
