/**
 * Floating selection toolbar (translate / TTS / dictionary / add word / AI Skills).
 * Compact icon bar anchored under the selection start, with Doubao-inspired UX:
 * - Pin / unpin window (stays open across outside clicks & scrolls; updates in-place on new selections)
 * - Drag-to-move handle + viewport-safe clamping
 * - Result panel with quick Copy, Retry, TTS, collapsible long source text, and Markdown rendering
 * Skills reuse the shared Skill 体系 (skill.list / skill.run).
 */

import type { AppConfig } from '../shared/domain/types';
import {
  DEFAULT_SELECTION_TOOLBAR,
  MAX_SELECTION_OVERLAY_OPACITY,
  MIN_SELECTION_OVERLAY_OPACITY,
} from '../shared/domain/types';
import type { SkillRecord } from '../db/schema';
import { BUILTIN_SKILL_IDS } from '../utils/constants/skills';
import { matchDomainPattern } from '../utils/site-control';
import { sendRuntime } from '../shared/messaging/client';
import { speakTextSmart } from '../utils/tts-playback/speak';
import { ICON_BTN_CSS, UI_ICON_SVG } from './ui-icons';
import { renderSafeMarkdownToElement } from '../utils/dom/safe-markdown';
import { mountFullscreenAwareHost } from '../utils/dom/fullscreen-host';
import {
  streamWordExplain,
  type StreamExplainSession,
} from './stream-client';

const HOST_ID = 'ueh-selection-host';

/** Built-ins that rarely make sense on free-text selection */
const DEFAULT_EXCLUDED_SKILL_IDS = new Set<string>([
  BUILTIN_SKILL_IDS.studyReview,
]);

/** Max skill chips on the bar before folding into 「更多」 */
const MAX_SKILL_CHIPS = 4;

/** Collapse source text preview when longer than this many characters */
const LONG_ORIG_THRESHOLD = 120;

const EXTRA_SVG = {
  translate:
    '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  close:
    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  more: '<circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  grip: '<circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  retry: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
} as const;

type ActivePanelMode =
  | { type: 'translate' }
  | { type: 'explain' }
  | { type: 'addWord' }
  | { type: 'skill'; skill: SkillRecord }
  | null;

export class SelectionToolbar {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private config: AppConfig;
  private selectedText = '';
  private hideTimer = 0;
  private skills: SkillRecord[] = [];
  private skillsLoadedAt = 0;
  private skillMenuOpen = false;
  private isPinned = false;
  private userPositioned = false;
  private activeMode: ActivePanelMode = null;
  private lastResultText = '';
  private boundMouseDown: (e: MouseEvent) => void;
  private boundMouseUp: (e: MouseEvent) => void;
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundScroll: (e: Event) => void;
  private boundResize: () => void;
  private unbindFullscreen: (() => void) | null = null;
  private activeExplainSession: StreamExplainSession | null = null;
  private dragCleanup: (() => void) | null = null;

  constructor(config: AppConfig) {
    this.config = config;
    this.boundMouseDown = (e) => this.onMouseDown(e);
    this.boundMouseUp = (e) => this.onMouseUp(e);
    this.boundKeyDown = (e) => this.onKeyDown(e);
    this.boundScroll = (e) => this.onScroll(e);
    this.boundResize = () => this.clampWrapInViewport();
  }

  private isVisible(): boolean {
    const wrap = this.shadow?.getElementById('wrap') as HTMLElement | null;
    return Boolean(wrap && wrap.style.display !== 'none' && wrap.style.display !== '');
  }

  private isEventInsideHost(e: Event): boolean {
    if (!this.host) return false;
    const path = e.composedPath?.() ?? [];
    if (path.includes(this.host)) return true;
    const target = e.target as Node | null;
    if (target && this.host.contains(target)) return true;
    if ((target as Element | null)?.closest?.(`#${HOST_ID}`)) return true;
    return false;
  }

  private onMouseDown(e: MouseEvent): void {
    if (!this.isVisible()) return;
    if (this.isEventInsideHost(e)) return;
    if (this.skillMenuOpen) {
      this.closeSkillMenu();
    }
    // Unpinned window auto-dismisses immediately when clicking anywhere outside
    if (!this.isPinned) {
      this.hide();
    }
  }

  private onScroll(e: Event): void {
    if (!this.shadow || !this.isVisible()) return;
    if (this.isPinned) return;
    // Never dismiss when scrolling inside the toolbar's own panel / skill menu
    if (this.isEventInsideHost(e)) return;
    // Keep open while user is actively reading an open result panel or skill menu
    const panel = this.shadow.getElementById('panel');
    if (panel?.classList.contains('open') || this.skillMenuOpen) return;
    this.hide();
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    if (!this.isToolbarAllowed()) this.hide();
    this.applyOpacity();
    // Config change may mean skills pinned list changed — refresh soon
    this.skillsLoadedAt = 0;
  }

  start(): void {
    document.addEventListener('mousedown', this.boundMouseDown, true);
    document.addEventListener('mouseup', this.boundMouseUp, true);
    document.addEventListener('keydown', this.boundKeyDown, true);
    window.addEventListener('scroll', this.boundScroll, true);
    window.addEventListener('resize', this.boundResize);
    void this.refreshSkills();
  }

  stop(): void {
    document.removeEventListener('mousedown', this.boundMouseDown, true);
    document.removeEventListener('mouseup', this.boundMouseUp, true);
    document.removeEventListener('keydown', this.boundKeyDown, true);
    window.removeEventListener('scroll', this.boundScroll, true);
    window.removeEventListener('resize', this.boundResize);
    this.dragCleanup?.();
    this.dragCleanup = null;
    this.activeExplainSession?.abort();
    this.activeExplainSession = null;
    this.unbindFullscreen?.();
    this.unbindFullscreen = null;
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.isPinned = false;
    this.userPositioned = false;
    this.activeMode = null;
    this.lastResultText = '';
  }

  triggerTranslateForSelection(text?: string): void {
    const sel = (text || window.getSelection()?.toString() || '').trim();
    if (!sel) return;
    this.selectedText = sel;
    const range = window.getSelection()?.rangeCount
      ? window.getSelection()?.getRangeAt(0)
      : null;
    const rect = range ? getSelectionStartRect(range) : null;
    const x = rect?.left ?? window.innerWidth / 2 - 100;
    const y = rect?.bottom ?? window.innerHeight / 2;
    void this.showAtAsync(x, y).then(() => {
      const panel = this.shadow?.getElementById('panel');
      if (panel) void this.runTranslate(panel);
    });
  }

  triggerExplainForSelection(text?: string): void {
    const sel = (text || window.getSelection()?.toString() || '').trim();
    if (!sel) return;
    this.selectedText = sel;
    const range = window.getSelection()?.rangeCount
      ? window.getSelection()?.getRangeAt(0)
      : null;
    const rect = range ? getSelectionStartRect(range) : null;
    const x = rect?.left ?? window.innerWidth / 2 - 100;
    const y = rect?.bottom ?? window.innerHeight / 2;
    void this.showAtAsync(x, y).then(() => {
      const panel = this.shadow?.getElementById('panel');
      if (panel) void this.runExplain(panel);
    });
  }

  triggerTtsForSelection(text?: string): void {
    const sel = (text || window.getSelection()?.toString() || '').trim();
    if (!sel) return;
    this.selectedText = sel;
    void this.runTts();
  }

  private tb() {
    return {
      ...DEFAULT_SELECTION_TOOLBAR,
      ...this.config.selectionToolbar,
    };
  }

  private isToolbarAllowed(): boolean {
    const tb = this.tb();
    if (!tb.enabled) return false;
    const patterns = tb.disabledSelectionToolbarPatterns ?? [];
    if (patterns.some((p) => matchDomainPattern(location.href, p))) {
      return false;
    }
    return true;
  }

  private async refreshSkills(): Promise<void> {
    const res = await sendRuntime<SkillRecord[]>(
      'skill.list',
      {},
      'content',
    );
    if (res.ok) {
      this.skills = res.data.filter((s) => s.enabled);
      this.skillsLoadedAt = Date.now();
    }
  }

  private async ensureSkillsFresh(): Promise<void> {
    if (Date.now() - this.skillsLoadedAt > 30_000 || !this.skills.length) {
      await this.refreshSkills();
    }
  }

  /** Skills visible on the toolbar (enabled + pin filter). */
  private resolveToolbarSkills(): SkillRecord[] {
    const tb = this.tb();
    if (!tb.showSkills) return [];
    const enabled = this.skills.filter((s) => s.enabled);
    const pins = tb.pinnedSkillIds ?? [];
    if (pins.length > 0) {
      const byId = new Map(enabled.map((s) => [s.id, s]));
      return pins
        .map((id) => byId.get(id))
        .filter((s): s is SkillRecord => Boolean(s));
    }
    // Auto: all enabled except study-only built-ins
    return enabled.filter((s) => !DEFAULT_EXCLUDED_SKILL_IDS.has(s.id));
  }

  private applyOpacity(): void {
    if (!this.shadow) return;
    const wrap = this.shadow.getElementById('wrap') as HTMLElement | null;
    if (!wrap) return;
    const raw = this.tb().opacity ?? 100;
    const pct = Math.max(
      MIN_SELECTION_OVERLAY_OPACITY,
      Math.min(MAX_SELECTION_OVERLAY_OPACITY, raw),
    );
    wrap.style.setProperty('--ueh-sel-opacity', String(pct / 100));
  }

  private ensureUi(): ShadowRoot {
    if (this.shadow) return this.shadow;
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      host.setAttribute('data-ueh-overlay', 'selection');
      host.style.cssText =
        'all:initial;position:fixed;z-index:2147483646;pointer-events:none;';
      this.unbindFullscreen = mountFullscreenAwareHost(host, document);
    }
    this.host = host;
    this.shadow = host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `
      <style>
        :host { all: initial; }
        @keyframes ueh-pop-in {
          from {
            opacity: 0;
            transform: translateY(-3px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .wrap {
          position: fixed;
          pointer-events: none;
          display: none;
          flex-direction: column;
          align-items: flex-start;
          gap: 5px;
          max-width: min(380px, 94vw);
          opacity: var(--ueh-sel-opacity, 1);
          animation: ueh-pop-in 0.14s ease-out;
        }
        @media (prefers-reduced-motion: reduce) {
          .wrap { animation: none; }
        }
        .wrap.dragging {
          user-select: none;
          cursor: grabbing;
        }
        .wrap.pinned .bar,
        .wrap.pinned .panel {
          border-color: color-mix(in srgb, oklch(76% 0.12 82) 48%, rgba(255,255,255,.16));
          box-shadow: 0 10px 28px rgba(0,0,0,.46), 0 0 0 1px color-mix(in srgb, oklch(76% 0.12 82) 18%, transparent);
        }
        .bar {
          pointer-events: auto;
          display: inline-flex;
          gap: 2px;
          align-items: center;
          padding: 3px 4px;
          border-radius: 10px;
          background: rgba(16,17,22,.94);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255,255,255,.13);
          box-shadow: 0 8px 24px rgba(0,0,0,.4);
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
          color: #f5f5f5;
          max-width: min(380px, 94vw);
          overflow-x: auto;
          scrollbar-width: none;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .bar::-webkit-scrollbar { display: none; }
        .drag-handle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 14px;
          height: 22px;
          cursor: grab;
          color: rgba(255,255,255,.35);
          flex-shrink: 0;
          border-radius: 4px;
          transition: color 0.12s ease, background 0.12s ease;
        }
        .drag-handle:hover {
          color: rgba(255,255,255,.75);
          background: rgba(255,255,255,.08);
        }
        .drag-handle:active { cursor: grabbing; }
        .drag-handle svg {
          width: 12px;
          height: 12px;
        }
        .bar-sep {
          width: 1px;
          height: 14px;
          background: rgba(255,255,255,.12);
          margin: 0 2px;
          flex-shrink: 0;
        }
        ${ICON_BTN_CSS}
        .bar .ueh-ibtn {
          width: 24px;
          height: 24px;
          border-radius: 6px;
          background: rgba(255,255,255,.07);
          transition: background 0.12s ease, color 0.12s ease, transform 0.1s ease;
        }
        .bar .ueh-ibtn:hover { background: rgba(255,255,255,.16); }
        .bar .ueh-ibtn:active { transform: scale(0.94); }
        .bar .ueh-ibtn svg {
          width: 12px;
          height: 12px;
          stroke-width: 2.2;
        }
        .bar .ueh-ibtn.primary {
          background: oklch(76% 0.12 82);
          color: #1a1a1a;
        }
        .bar .ueh-ibtn.primary:hover {
          background: oklch(81% 0.13 82);
        }
        .bar .ueh-ibtn.active:not(.primary):not(.pin) {
          background: color-mix(in srgb, oklch(76% 0.12 82) 32%, rgba(255,255,255,.12));
          color: oklch(92% 0.08 82);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, oklch(76% 0.12 82) 55%, transparent);
        }
        .bar .ueh-ibtn.skill {
          background: color-mix(in srgb, oklch(76% 0.12 82) 22%, rgba(255,255,255,.06));
          color: oklch(90% 0.06 82);
        }
        .bar .ueh-ibtn.skill:hover {
          background: color-mix(in srgb, oklch(76% 0.12 82) 40%, transparent);
        }
        .bar .ueh-ibtn.pin {
          background: transparent;
          color: rgba(255,255,255,.65);
        }
        .bar .ueh-ibtn.pin:hover {
          color: #fff;
          background: rgba(255,255,255,.12);
        }
        .bar .ueh-ibtn.pin.pinned {
          background: color-mix(in srgb, oklch(76% 0.12 82) 28%, transparent);
          color: oklch(84% 0.13 82);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, oklch(76% 0.12 82) 55%, transparent);
        }
        .bar .ueh-ibtn.pin.pinned svg {
          fill: color-mix(in srgb, oklch(84% 0.13 82) 35%, transparent);
          transform: rotate(-28deg);
        }
        .bar .ueh-ibtn.close {
          background: transparent;
          opacity: .7;
        }
        .bar .ueh-ibtn.close:hover {
          opacity: 1;
          background: rgba(255,90,90,.2);
          color: #ff9b9b;
        }
        .bar .ueh-ibtn.chip {
          width: auto;
          min-width: 24px;
          height: 24px;
          padding: 0 6px;
          font-size: 10.5px;
          font-weight: 700;
          gap: 3px;
        }
        .bar .ueh-ibtn.chip span {
          max-width: 68px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .skill-menu {
          pointer-events: auto;
          display: none;
          flex-direction: column;
          gap: 2px;
          min-width: 152px;
          max-width: min(260px, 90vw);
          max-height: 220px;
          overflow: auto;
          padding: 4px;
          border-radius: 10px;
          background: rgba(16,17,22,.96);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255,255,255,.13);
          box-shadow: 0 10px 26px rgba(0,0,0,.44);
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        }
        .skill-menu.open { display: flex; }
        .skill-menu button {
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: #f0f0f0;
          text-align: left;
          padding: 5px 8px;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .skill-menu button:hover {
          background: rgba(255,255,255,.1);
        }
        .skill-menu button svg {
          width: 12px; height: 12px; flex-shrink: 0;
          fill: none; stroke: currentColor; stroke-width: 2.25;
          stroke-linecap: round; stroke-linejoin: round;
        }
        .skill-menu .empty {
          padding: 10px;
          font-size: 11px;
          opacity: .55;
          color: #fff;
        }
        .panel {
          pointer-events: auto;
          display: none;
          width: min(360px, 92vw);
          max-width: min(380px, 94vw);
          max-height: min(320px, 52vh);
          overflow: hidden;
          flex-direction: column;
          border-radius: 12px;
          background: rgba(16,17,22,.95);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1px solid rgba(255,255,255,.13);
          box-shadow: 0 12px 32px rgba(0,0,0,.44);
          font-size: 12.5px;
          line-height: 1.5;
          color: #f0f0f0;
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
          overscroll-behavior: contain;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .panel.open { display: flex; }
        .panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 6px 10px;
          border-bottom: 1px solid rgba(255,255,255,.08);
          background: rgba(255,255,255,.03);
          cursor: grab;
          flex-shrink: 0;
        }
        .panel-head:active { cursor: grabbing; }
        .panel-title-wrap {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }
        .panel-title {
          font-size: 11.5px;
          font-weight: 700;
          color: rgba(255,255,255,.88);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .panel-pin-tag {
          display: none;
          font-size: 10px;
          font-weight: 600;
          padding: 1px 5px;
          border-radius: 999px;
          background: color-mix(in srgb, oklch(76% 0.12 82) 22%, transparent);
          color: oklch(86% 0.11 82);
          white-space: nowrap;
        }
        .wrap.pinned .panel-pin-tag { display: inline-block; }
        .panel-actions {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          flex-shrink: 0;
        }
        .panel-act-btn {
          border: 0;
          background: rgba(255,255,255,.06);
          color: rgba(255,255,255,.76);
          border-radius: 6px;
          height: 22px;
          padding: 0 6px;
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-size: 10.5px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: background 0.12s ease, color 0.12s ease;
        }
        .panel-act-btn:hover {
          background: rgba(255,255,255,.15);
          color: #fff;
        }
        .panel-act-btn.copied {
          background: rgba(61, 220, 151, 0.2);
          color: #5ee6ad;
        }
        .panel-act-btn svg {
          width: 11px;
          height: 11px;
          fill: none;
          stroke: currentColor;
          stroke-width: 2.2;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .panel-scroll {
          padding: 9px 11px 11px;
          overflow: auto;
          overscroll-behavior: contain;
        }
        .panel .label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .02em;
          opacity: .5;
          margin-bottom: 2px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .panel .orig-wrap {
          margin-bottom: 6px;
        }
        .panel .orig {
          white-space: pre-wrap;
          word-break: break-word;
          color: rgba(255,255,255,.82);
          font-size: 12px;
        }
        .panel .orig.clamped {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .panel .orig-toggle {
          border: 0;
          background: transparent;
          color: oklch(82% 0.1 82);
          font-size: 10.5px;
          padding: 2px 0 0;
          cursor: pointer;
          font-family: inherit;
        }
        .panel .orig-toggle:hover { text-decoration: underline; }
        .panel .tr, .panel .result {
          white-space: pre-wrap;
          word-break: break-word;
          color: oklch(89% 0.08 82);
          font-weight: 500;
        }
        .panel .body {
          word-break: break-word;
        }
        .panel .md-body {
          font: 12.5px/1.55 system-ui, -apple-system, sans-serif;
          color: #e6e6e6;
          word-break: break-word;
        }
        .panel .md-body h1,
        .panel .md-body h2,
        .panel .md-body h3,
        .panel .md-body h4 {
          margin: 6px 0 3px;
          font-size: 13px;
          font-weight: 700;
          color: oklch(88% 0.08 82);
          line-height: 1.35;
        }
        .panel .md-body p { margin: 3px 0; }
        .panel .md-body strong { color: #fff; font-weight: 600; }
        .panel .md-body em { color: oklch(88% 0.08 82); }
        .panel .md-body ul, .panel .md-body ol { margin: 3px 0; padding-left: 16px; }
        .panel .md-body li { margin: 2px 0; }
        .panel .md-body code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 11px;
          padding: 1px 4px;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.12);
          color: oklch(90% 0.08 82);
        }
        .panel .loading-hint {
          color: #aaa;
          font-size: 11.5px;
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .panel .muted { opacity: .55; font-size: 11.5px; }
        .panel .divider {
          height: 1px;
          background: rgba(255,255,255,.08);
          margin: 7px 0;
        }
      </style>
      <div class="wrap" id="wrap">
        <div class="bar" id="bar"></div>
        <div class="skill-menu" id="skill-menu"></div>
        <div class="panel" id="panel"></div>
      </div>
    `;
    this.applyOpacity();
    return this.shadow;
  }

  private setPinned(next: boolean): void {
    this.isPinned = next;
    const wrap = this.shadow?.getElementById('wrap');
    wrap?.classList.toggle('pinned', next);
    const pinBtn = this.shadow?.querySelector('.ueh-ibtn.pin') as HTMLButtonElement | null;
    if (pinBtn) {
      pinBtn.classList.toggle('pinned', next);
      pinBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
      pinBtn.title = next
        ? '取消固定（点击其他区域自动关闭）'
        : '固定窗口（点击其他区域不消失）';
      pinBtn.setAttribute('aria-label', pinBtn.title);
    }
  }

  private togglePin(): void {
    this.setPinned(!this.isPinned);
  }

  private startDrag(e: MouseEvent): void {
    if (e.button !== 0) return;
    const target = e.target as Element | null;
    if (target?.closest?.('button')) return;
    const wrap = this.shadow?.getElementById('wrap') as HTMLElement | null;
    if (!wrap) return;

    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const rect = wrap.getBoundingClientRect();
    const origLeft = rect.left;
    const origTop = rect.top;

    wrap.classList.add('dragging');
    this.userPositioned = true;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const w = wrap.offsetWidth || rect.width;
      const h = wrap.offsetHeight || rect.height;
      const nextLeft = Math.max(8, Math.min(window.innerWidth - w - 8, origLeft + dx));
      const nextTop = Math.max(8, Math.min(window.innerHeight - h - 8, origTop + dy));
      wrap.style.left = `${nextLeft}px`;
      wrap.style.top = `${nextTop}px`;
    };

    const cleanup = () => {
      wrap.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', cleanup, true);
      this.dragCleanup = null;
    };

    this.dragCleanup?.();
    this.dragCleanup = cleanup;
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', cleanup, true);
  }

  private updateActiveButtonHighlight(): void {
    const bar = this.shadow?.getElementById('bar');
    if (!bar) return;
    const btns = bar.querySelectorAll<HTMLButtonElement>('[data-mode]');
    for (const btn of btns) {
      const mode = btn.getAttribute('data-mode');
      let isActive = false;
      if (this.activeMode?.type === 'translate' && mode === 'translate') isActive = true;
      else if (this.activeMode?.type === 'explain' && mode === 'explain') isActive = true;
      else if (this.activeMode?.type === 'addWord' && mode === 'addWord') isActive = true;
      else if (
        this.activeMode?.type === 'skill' &&
        mode === `skill:${this.activeMode.skill.id}`
      ) {
        isActive = true;
      }
      btn.classList.toggle('active', isActive);
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.skillMenuOpen) {
        this.closeSkillMenu();
        return;
      }
      // Pinned window ignores Escape so it stays anchored until unpinned or explicitly closed
      if (!this.isPinned) {
        this.hide();
      }
      return;
    }
    if (!this.isToolbarAllowed()) return;
    const tb = this.tb();
    if (!tb.showTranslate) return;
    const shortcut = (tb.translateShortcut || '').trim();
    if (!shortcut) return;
    if (!matchesShortcut(e, shortcut)) return;

    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (!text || text.length > 2000) return;

    e.preventDefault();
    e.stopPropagation();
    this.selectedText = text;
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    const startRect = range ? getSelectionStartRect(range) : null;
    void this.showAtAsync(
      startRect?.left ?? 24,
      startRect?.bottom ?? 72,
    ).then(() => {
      const panel = this.shadow?.getElementById('panel');
      if (panel) void this.runTranslate(panel);
    });
  }

  private onMouseUp(e: MouseEvent): void {
    if (!this.isToolbarAllowed()) return;
    if (this.isEventInsideHost(e)) return;

    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (!text || text.length > 2000 || !/\S/.test(text)) {
        // When pinned, clicking elsewhere with empty selection keeps the window open
        if (!this.isPinned) {
          this.hide();
        }
        return;
      }
      const tb = this.tb();
      const hasCore =
        tb.showTranslate ||
        tb.showDictionary ||
        tb.showTts ||
        tb.showAddWord ||
        tb.showSkills;
      if (!hasCore) {
        if (!this.isPinned) this.hide();
        return;
      }

      const textChanged = text !== this.selectedText;
      this.selectedText = text;

      // Doubao-style pinned workflow: keep window anchored in place and auto-refresh active panel
      if (this.isPinned && this.isVisible()) {
        if (textChanged) {
          const panel = this.shadow?.getElementById('panel');
          if (panel?.classList.contains('open') && this.activeMode) {
            this.rerunActiveMode(panel);
          }
        }
        return;
      }

      const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
      if (!range) {
        if (!this.isPinned) this.hide();
        return;
      }
      const startRect = getSelectionStartRect(range);
      if (!startRect) {
        if (!this.isPinned) this.hide();
        return;
      }
      void this.showAtAsync(startRect.left, startRect.bottom);
    }, 10);
  }

  private rerunActiveMode(panel: HTMLElement): void {
    if (!this.activeMode) return;
    if (this.activeMode.type === 'translate') {
      void this.runTranslate(panel);
    } else if (this.activeMode.type === 'explain') {
      void this.runExplain(panel);
    } else if (this.activeMode.type === 'skill') {
      void this.runSkill(panel, this.activeMode.skill);
    } else if (this.activeMode.type === 'addWord') {
      void this.runAddWord(panel);
    }
  }

  private async showAtAsync(x: number, y: number): Promise<void> {
    if (this.tb().showSkills) {
      await this.ensureSkillsFresh();
    }
    this.showAt(x, y);
  }

  private showAt(x: number, y: number): void {
    const shadow = this.ensureUi();
    this.applyOpacity();
    this.skillMenuOpen = false;
    const wrap = shadow.getElementById('wrap') as HTMLElement;
    const bar = shadow.getElementById('bar') as HTMLElement;
    const panel = shadow.getElementById('panel') as HTMLElement;
    const skillMenu = shadow.getElementById('skill-menu') as HTMLElement;
    const tb = this.tb();

    bar.innerHTML = '';
    skillMenu.classList.remove('open');
    skillMenu.innerHTML = '';

    // Drag handle for effortless repositioning (especially when pinned)
    const grip = document.createElement('span');
    grip.className = 'drag-handle';
    grip.title = '拖动移动窗口';
    grip.setAttribute('aria-label', '拖动移动窗口');
    grip.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${EXTRA_SVG.grip}</svg>`;
    grip.addEventListener('mousedown', (e) => this.startDrag(e));
    bar.appendChild(grip);

    if (tb.showTranslate) {
      const btn = this.mkIconBtn(
        EXTRA_SVG.translate,
        '翻译',
        'primary',
        () => void this.runTranslate(panel),
      );
      btn.setAttribute('data-mode', 'translate');
      bar.appendChild(btn);
    }
    if (tb.showDictionary) {
      const btn = this.mkIconBtn(
        UI_ICON_SVG.explain,
        '词典 / 释义',
        '',
        () => void this.runExplain(panel),
      );
      btn.setAttribute('data-mode', 'explain');
      bar.appendChild(btn);
    }
    if (tb.showTts) {
      bar.appendChild(
        this.mkIconBtn(UI_ICON_SVG.tts, '朗读', '', () => void this.runTts()),
      );
    }
    if (tb.showAddWord) {
      const btn = this.mkIconBtn(
        UI_ICON_SVG.add,
        '加入生词本',
        '',
        () => void this.runAddWord(panel),
      );
      btn.setAttribute('data-mode', 'addWord');
      bar.appendChild(btn);
    }

    // AI Skills (inherit Skill 体系)
    const toolbarSkills = this.resolveToolbarSkills();
    if (tb.showSkills && toolbarSkills.length) {
      const head = toolbarSkills.slice(0, MAX_SKILL_CHIPS);
      const rest = toolbarSkills.slice(MAX_SKILL_CHIPS);

      for (const skill of head) {
        const chip = this.mkSkillChip(skill, () => {
          this.closeSkillMenu();
          void this.runSkill(panel, skill);
        });
        chip.setAttribute('data-mode', `skill:${skill.id}`);
        bar.appendChild(chip);
      }

      if (rest.length > 0) {
        bar.appendChild(
          this.mkIconBtn(EXTRA_SVG.more, `更多 AI 指令 (${rest.length})`, '', () => {
            this.toggleSkillMenu(skillMenu, rest, panel);
          }),
        );
      }
    } else if (tb.showSkills) {
      bar.appendChild(
        this.mkIconBtn(
          UI_ICON_SVG.skill,
          'AI 指令',
          'skill',
          () => {
            void this.ensureSkillsFresh().then(() => {
              const list = this.resolveToolbarSkills();
              this.toggleSkillMenu(skillMenu, list, panel);
            });
          },
        ),
      );
    }

    // Visual divider before window controls (Pin + Close)
    const sep = document.createElement('span');
    sep.className = 'bar-sep';
    sep.setAttribute('aria-hidden', 'true');
    bar.appendChild(sep);

    const pinBtn = this.mkIconBtn(
      EXTRA_SVG.pin,
      this.isPinned
        ? '取消固定（点击其他区域自动关闭）'
        : '固定窗口（点击其他区域不消失）',
      `pin${this.isPinned ? ' pinned' : ''}`,
      () => this.togglePin(),
    );
    pinBtn.setAttribute('aria-pressed', this.isPinned ? 'true' : 'false');
    bar.appendChild(pinBtn);

    bar.appendChild(
      this.mkIconBtn(EXTRA_SVG.close, '关闭', 'close', () => this.hide()),
    );

    if (!this.isPinned) {
      panel.classList.remove('open');
      panel.innerHTML = '';
      this.activeMode = null;
      this.lastResultText = '';
    } else {
      this.updateActiveButtonHighlight();
    }

    wrap.classList.toggle('pinned', this.isPinned);
    wrap.style.display = 'flex';

    // Preserve user's dragged/pinned coordinates when already positioned
    if (!this.isPinned || !this.userPositioned) {
      const gap = 6;
      wrap.style.left = '0px';
      wrap.style.top = '0px';
      const barW = Math.max(bar.offsetWidth || 160, 160);
      const left = Math.max(8, Math.min(window.innerWidth - barW - 8, x));
      let top = y + gap;
      const approxH = 38;
      if (top + approxH > window.innerHeight - 8) {
        top = Math.max(8, y - approxH - gap);
      }
      wrap.style.left = `${left}px`;
      wrap.style.top = `${top}px`;
    } else {
      this.clampWrapInViewport();
    }
  }

  /** Keep #wrap inside the viewport when .panel or .skill-menu expands downward or window resizes. */
  private clampWrapInViewport(): void {
    const wrap = this.shadow?.getElementById('wrap') as HTMLElement | null;
    if (!wrap || wrap.style.display === 'none' || wrap.style.display === '') return;
    const rect = wrap.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw - 8) {
      const nextLeft = Math.max(8, vw - rect.width - 8);
      wrap.style.left = `${nextLeft}px`;
    }
    if (rect.bottom > vh - 8) {
      const nextTop = Math.max(8, vh - rect.height - 8);
      wrap.style.top = `${nextTop}px`;
    }
  }

  private closeSkillMenu(): void {
    this.skillMenuOpen = false;
    this.shadow
      ?.getElementById('skill-menu')
      ?.classList.remove('open');
  }

  private toggleSkillMenu(
    menu: HTMLElement,
    skills: SkillRecord[],
    panel: HTMLElement,
  ): void {
    if (this.skillMenuOpen) {
      this.closeSkillMenu();
      return;
    }
    menu.innerHTML = '';
    if (!skills.length) {
      menu.innerHTML =
        '<div class="empty">暂无可用指令。请在选项 → 自定义 AI 指令中启用 Skill。</div>';
    } else {
      for (const skill of skills) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${UI_ICON_SVG.skill}</svg><span></span>`;
        const span = btn.querySelector('span')!;
        span.textContent = skill.name;
        btn.title = skill.name;
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.closeSkillMenu();
          void this.runSkill(panel, skill);
        });
        menu.appendChild(btn);
      }
    }
    menu.classList.add('open');
    this.skillMenuOpen = true;
    this.clampWrapInViewport();
  }

  private mkSkillChip(
    skill: SkillRecord,
    onClick: () => void,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ueh-ibtn skill chip';
    b.title = skill.name;
    b.setAttribute('aria-label', skill.name);
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${UI_ICON_SVG.skill}</svg><span></span>`;
    const span = b.querySelector('span')!;
    // Short label: first 4 CJK or 6 latin chars
    const name = skill.name.trim();
    span.textContent =
      name.length > 5 ? `${[...name].slice(0, 4).join('')}…` : name;
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  private mkIconBtn(
    svgInner: string,
    label: string,
    extraClass: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ueh-ibtn${extraClass ? ` ${extraClass}` : ''}`;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${svgInner}</svg>`;
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  private mkPanelActionBtn(
    svgInner: string,
    text: string,
    title: string,
    onClick: (btn: HTMLButtonElement) => void,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'panel-act-btn';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${svgInner}</svg><span>${text}</span>`;
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(b);
    });
    return b;
  }

  private async copyText(text: string, btn: HTMLButtonElement): Promise<void> {
    const value = text.trim();
    if (!value) return;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch {
        ok = false;
      }
    }
    if (ok) {
      btn.classList.add('copied');
      const origHtml = btn.innerHTML;
      btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${EXTRA_SVG.check}</svg><span>已复制</span>`;
      window.setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = origHtml;
      }, 1400);
    }
  }

  /**
   * Build the standardized result panel chrome: draggable header with title + Copy/Retry/TTS actions,
   * collapsible original text preview, and body container.
   */
  private mountPanelShell(
    panel: HTMLElement,
    opts: {
      title: string;
      origText: string;
      showCopy?: boolean;
      showRetry?: boolean;
      onRetry?: () => void;
    },
  ): HTMLElement {
    panel.classList.add('open');
    panel.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'panel-head';
    head.addEventListener('mousedown', (e) => this.startDrag(e));

    const titleWrap = document.createElement('div');
    titleWrap.className = 'panel-title-wrap';
    const titleEl = document.createElement('span');
    titleEl.className = 'panel-title';
    titleEl.textContent = opts.title;
    const pinTag = document.createElement('span');
    pinTag.className = 'panel-pin-tag';
    pinTag.textContent = '已固定';
    titleWrap.append(titleEl, pinTag);

    const actions = document.createElement('div');
    actions.className = 'panel-actions';

    if (opts.showCopy !== false) {
      actions.appendChild(
        this.mkPanelActionBtn(EXTRA_SVG.copy, '复制', '复制结果', (btn) => {
          void this.copyText(this.lastResultText, btn);
        }),
      );
    }
    if (opts.showRetry && opts.onRetry) {
      actions.appendChild(
        this.mkPanelActionBtn(EXTRA_SVG.retry, '重试', '重新生成', () => {
          opts.onRetry?.();
        }),
      );
    }

    head.append(titleWrap, actions);

    const scroll = document.createElement('div');
    scroll.className = 'panel-scroll';

    const origLabel = document.createElement('div');
    origLabel.className = 'label';
    origLabel.textContent = '原文';

    const origWrap = document.createElement('div');
    origWrap.className = 'orig-wrap';
    const origEl = document.createElement('div');
    origEl.className = 'orig';
    origEl.textContent = opts.origText;
    origWrap.appendChild(origEl);

    if (opts.origText.length > LONG_ORIG_THRESHOLD) {
      origEl.classList.add('clamped');
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'orig-toggle';
      toggleBtn.textContent = '展开全文';
      toggleBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const clamped = origEl.classList.toggle('clamped');
        toggleBtn.textContent = clamped ? '展开全文' : '收起';
        this.clampWrapInViewport();
      });
      origWrap.appendChild(toggleBtn);
    }

    const divider = document.createElement('div');
    divider.className = 'divider';

    const body = document.createElement('div');
    body.className = 'body';

    scroll.append(origLabel, origWrap, divider, body);
    panel.append(head, scroll);
    this.clampWrapInViewport();
    return body;
  }

  private hide(): void {
    this.dragCleanup?.();
    this.dragCleanup = null;
    this.activeExplainSession?.abort();
    this.activeExplainSession = null;
    this.isPinned = false;
    this.userPositioned = false;
    this.activeMode = null;
    this.lastResultText = '';
    if (!this.shadow) return;
    this.skillMenuOpen = false;
    const wrap = this.shadow.getElementById('wrap');
    if (wrap) {
      wrap.classList.remove('pinned', 'dragging');
      wrap.style.display = 'none';
    }
  }

  private async runSkill(
    panel: HTMLElement,
    skill: SkillRecord,
  ): Promise<void> {
    this.activeExplainSession?.abort();
    this.activeExplainSession = null;
    this.activeMode = { type: 'skill', skill };
    this.lastResultText = '';
    this.updateActiveButtonHighlight();

    const orig = this.selectedText;
    const context = [
      document.title ? `页面：${document.title}` : '',
      `URL：${location.href}`,
    ]
      .filter(Boolean)
      .join('\n');

    const body = this.mountPanelShell(panel, {
      title: skill.name,
      origText: orig,
      showCopy: true,
      showRetry: true,
      onRetry: () => void this.runSkill(panel, skill),
    });
    body.innerHTML = '<div class="loading-hint"><span>⏳</span> AI 指令运行中…</div>';

    const res = await sendRuntime<{ text: string }>(
      'skill.run',
      {
        skillId: skill.id,
        text: orig,
        context,
      },
      'content',
    );

    if (!body.isConnected) return;
    if (res.ok) {
      const text = res.data.text?.trim() || '（空结果）';
      this.lastResultText = text;
      const md = document.createElement('div');
      md.className = 'md-body';
      renderSafeMarkdownToElement(md, text);
      body.replaceChildren(md);
    } else {
      body.textContent = res.error.message;
    }
    this.clampWrapInViewport();
  }

  private async runTranslate(panel: HTMLElement): Promise<void> {
    this.activeExplainSession?.abort();
    this.activeExplainSession = null;
    this.activeMode = { type: 'translate' };
    this.lastResultText = '';
    this.updateActiveButtonHighlight();

    const orig = this.selectedText;
    const body = this.mountPanelShell(panel, {
      title: '译文',
      origText: orig,
      showCopy: true,
      showRetry: true,
      onRetry: () => void this.runTranslate(panel),
    });
    body.innerHTML = '<div class="tr muted">翻译中…</div>';

    const res = await sendRuntime<{ items: { id: string; text: string }[] }>(
      'translate.cues',
      {
        cues: [{ id: 'sel', text: orig }],
        src: this.config.sourceLang,
        dst: this.config.targetLang,
        mode: 'mt',
      },
      'content',
    );
    if (!body.isConnected) return;
    const trEl = document.createElement('div');
    trEl.className = 'tr';
    if (res.ok) {
      const text = res.data.items[0]?.text || '（空结果）';
      this.lastResultText = text;
      trEl.textContent = text;
    } else {
      trEl.textContent = res.error.message;
    }
    body.replaceChildren(trEl);
    this.clampWrapInViewport();
  }

  private async runExplain(panel: HTMLElement): Promise<void> {
    this.activeExplainSession?.abort();
    this.activeMode = { type: 'explain' };
    this.lastResultText = '';
    this.updateActiveButtonHighlight();

    const orig = this.selectedText;
    const body = this.mountPanelShell(panel, {
      title: '词典 / 释义',
      origText: orig,
      showCopy: true,
      showRetry: true,
      onRetry: () => void this.runExplain(panel),
    });
    body.innerHTML = '<div class="loading-hint"><span>⏳</span> 正在连接 AI 生成释义…</div>';

    let mdContainer: HTMLElement | null = null;

    const session = streamWordExplain(
      {
        word: orig,
        surface: orig,
        context: orig,
      },
      (_chunk, accumulated) => {
        if (!body.isConnected) return;
        const clean = accumulated.trim();
        if (!clean) {
          body.innerHTML = '<div class="loading-hint"><span>🧠</span> AI 正在思考中…</div>';
          return;
        }
        this.lastResultText = clean;
        if (!mdContainer || !body.contains(mdContainer)) {
          body.replaceChildren();
          mdContainer = document.createElement('div');
          mdContainer.className = 'md-body';
          body.appendChild(mdContainer);
        }
        renderSafeMarkdownToElement(mdContainer, accumulated);
        this.clampWrapInViewport();
      },
    );
    this.activeExplainSession = session;

    try {
      const d = await session.promise;
      if (!body.isConnected) return;
      const rawMarkdown = d.explanation || (!d.definition ? d.text : '');
      if (rawMarkdown) {
        this.lastResultText = rawMarkdown;
        const md = document.createElement('div');
        md.className = 'md-body';
        renderSafeMarkdownToElement(md, rawMarkdown);
        body.replaceChildren(md);
      } else {
        const lines = [
          d.definition,
          d.contextTranslation ? `句子译文：${d.contextTranslation}` : '',
          d.note ? `（${d.note}）` : '',
        ].filter(Boolean);
        const text = lines.join('\n\n') || d.text || orig;
        this.lastResultText = text;
        body.textContent = text;
      }
      this.clampWrapInViewport();
    } catch (err: unknown) {
      if (!body.isConnected) return;
      body.textContent = `查询异常: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async runTts(): Promise<void> {
    await speakTextSmart(this.selectedText, 'content');
  }

  private async runAddWord(panel: HTMLElement): Promise<void> {
    this.activeExplainSession?.abort();
    this.activeExplainSession = null;
    this.activeMode = { type: 'addWord' };
    this.lastResultText = '';
    this.updateActiveButtonHighlight();

    const surface = this.selectedText.split(/\s+/).slice(0, 6).join(' ');
    const body = this.mountPanelShell(panel, {
      title: '生词本',
      origText: surface,
      showCopy: false,
      showRetry: false,
    });
    body.innerHTML = '<div class="loading-hint"><span>⏳</span> 正在加入生词本…</div>';

    const exp = await sendRuntime<{
      definition?: string;
      contextTranslation?: string;
      explanation?: string;
      engine?: 'llm' | 'free_mt' | 'none';
      provider?: string;
    }>(
      'word.explain',
      {
        word: surface,
        surface,
        context: this.selectedText.slice(0, 500),
      },
      'content',
    );
    const res = await sendRuntime(
      'word.add',
      {
        surface,
        context: this.selectedText.slice(0, 500),
        translation: exp.ok ? exp.data.definition : undefined,
        contextTranslation: exp.ok ? exp.data.contextTranslation : undefined,
        explanation: exp.ok ? exp.data.explanation : undefined,
        explainEngine: exp.ok ? exp.data.engine : 'none',
        explainProvider: exp.ok ? exp.data.provider : undefined,
        kind:
          surface.includes(' ') && surface.split(/\s+/).length > 3
            ? 'sentence'
            : 'word',
        sourceUrl: location.href,
        sourceTitle: document.title,
      },
      'content',
    );
    if (!body.isConnected) return;
    body.textContent = res.ok ? '✓ 已加入生词本' : res.error.message;
    if (res.ok) body.style.color = 'oklch(80% 0.1 145)';
    this.clampWrapInViewport();
  }
}

function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut
    .split('+')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) return false;

  const needCtrl = parts.includes('ctrl') || parts.includes('control');
  const needAlt = parts.includes('alt') || parts.includes('option');
  const needShift = parts.includes('shift');
  const needMeta =
    parts.includes('meta') ||
    parts.includes('cmd') ||
    parts.includes('command') ||
    parts.includes('win');

  if (e.ctrlKey !== needCtrl) return false;
  if (e.altKey !== needAlt) return false;
  if (e.shiftKey !== needShift) return false;
  if (e.metaKey !== needMeta) return false;

  const keyPart = parts.find(
    (p) =>
      ![
        'ctrl',
        'control',
        'alt',
        'option',
        'shift',
        'meta',
        'cmd',
        'command',
        'win',
      ].includes(p),
  );
  if (!keyPart) return false;

  const pressed = e.key.toLowerCase();
  if (pressed === keyPart) return true;
  if (e.code.toLowerCase() === `key${keyPart}`) return true;
  if (e.code.toLowerCase() === keyPart) return true;
  return false;
}

function getSelectionStartRect(range: Range): DOMRect | null {
  const rects = range.getClientRects();
  if (rects.length > 0) return rects[0]!;
  try {
    const caret = range.cloneRange();
    caret.collapse(true);
    const r = caret.getBoundingClientRect();
    if (r.width > 0 || r.height > 0 || r.top !== 0 || r.left !== 0) {
      return r;
    }
  } catch {
    // ignore
  }
  const fallback = range.getBoundingClientRect();
  if (fallback.width === 0 && fallback.height === 0) return null;
  return fallback;
}
