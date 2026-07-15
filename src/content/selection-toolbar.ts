/**
 * Floating selection toolbar (translate / TTS / dictionary / add word / AI Skills).
 * Compact icon bar anchored under the selection start.
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
import { ClipPlayer } from './clip-player';
import {
  playTtsAudioChunks,
  stopTtsPlayback,
} from '../utils/tts-playback/play-chunks';
import { ICON_BTN_CSS, UI_ICON_SVG } from './ui-icons';

const HOST_ID = 'ueh-selection-host';

/** Built-ins that rarely make sense on free-text selection */
const DEFAULT_EXCLUDED_SKILL_IDS = new Set<string>([
  BUILTIN_SKILL_IDS.studyReview,
]);

/** Max skill chips on the bar before folding into 「更多」 */
const MAX_SKILL_CHIPS = 4;

const EXTRA_SVG = {
  translate:
    '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  close:
    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  more: '<circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/>',
} as const;

export class SelectionToolbar {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private config: AppConfig;
  private selectedText = '';
  private hideTimer = 0;
  private skills: SkillRecord[] = [];
  private skillsLoadedAt = 0;
  private skillMenuOpen = false;
  private boundMouseUp: (e: MouseEvent) => void;
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundScroll: () => void;

  constructor(config: AppConfig) {
    this.config = config;
    this.boundMouseUp = (e) => this.onMouseUp(e);
    this.boundKeyDown = (e) => this.onKeyDown(e);
    this.boundScroll = () => this.hide();
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    if (!this.isToolbarAllowed()) this.hide();
    this.applyOpacity();
    // Config change may mean skills pinned list changed — refresh soon
    this.skillsLoadedAt = 0;
  }

  start(): void {
    document.addEventListener('mouseup', this.boundMouseUp, true);
    document.addEventListener('keydown', this.boundKeyDown, true);
    window.addEventListener('scroll', this.boundScroll, true);
    void this.refreshSkills();
  }

  stop(): void {
    document.removeEventListener('mouseup', this.boundMouseUp, true);
    document.removeEventListener('keydown', this.boundKeyDown, true);
    window.removeEventListener('scroll', this.boundScroll, true);
    this.host?.remove();
    this.host = null;
    this.shadow = null;
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
      document.documentElement.appendChild(host);
    }
    this.host = host;
    this.shadow = host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap {
          position: fixed;
          pointer-events: none;
          display: none;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
          max-width: min(340px, 94vw);
          opacity: var(--ueh-sel-opacity, 1);
        }
        .bar {
          pointer-events: auto;
          display: inline-flex;
          gap: 2px;
          align-items: center;
          padding: 2px;
          border-radius: 8px;
          background: rgba(16,17,22,.96);
          border: 1px solid rgba(255,255,255,.12);
          box-shadow: 0 8px 24px rgba(0,0,0,.38);
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
          color: #f5f5f5;
          max-width: min(340px, 94vw);
          overflow-x: auto;
          scrollbar-width: none;
        }
        .bar::-webkit-scrollbar { display: none; }
        ${ICON_BTN_CSS}
        .bar .ueh-ibtn {
          width: 22px;
          height: 22px;
          border-radius: 6px;
          background: rgba(255,255,255,.08);
        }
        .bar .ueh-ibtn:hover { background: rgba(255,255,255,.16); }
        .bar .ueh-ibtn svg {
          width: 11px;
          height: 11px;
          stroke-width: 2.25;
        }
        .bar .ueh-ibtn.primary {
          background: oklch(76% 0.12 82);
          color: #1a1a1a;
        }
        .bar .ueh-ibtn.skill {
          background: color-mix(in srgb, oklch(76% 0.12 82) 28%, rgba(255,255,255,.06));
          color: oklch(90% 0.06 82);
        }
        .bar .ueh-ibtn.skill:hover {
          background: color-mix(in srgb, oklch(76% 0.12 82) 45%, transparent);
        }
        .bar .ueh-ibtn.close {
          background: transparent;
          opacity: .7;
        }
        .bar .ueh-ibtn.close:hover {
          opacity: 1;
          background: rgba(255,255,255,.12);
        }
        .bar .ueh-ibtn.chip {
          width: auto;
          min-width: 22px;
          height: 22px;
          padding: 0 5px;
          font-size: 10px;
          font-weight: 700;
          gap: 3px;
        }
        .bar .ueh-ibtn.chip span {
          max-width: 64px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .skill-menu {
          pointer-events: auto;
          display: none;
          flex-direction: column;
          gap: 2px;
          min-width: 148px;
          max-width: min(260px, 90vw);
          max-height: 220px;
          overflow: auto;
          padding: 3px;
          border-radius: 8px;
          background: rgba(16,17,22,.98);
          border: 1px solid rgba(255,255,255,.12);
          box-shadow: 0 8px 24px rgba(0,0,0,.4);
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
          font-size: 11px;
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
          width: max-content;
          max-width: min(340px, 94vw);
          max-height: min(280px, 48vh);
          overflow: auto;
          padding: 8px 10px;
          border-radius: 10px;
          background: rgba(16,17,22,.97);
          border: 1px solid rgba(255,255,255,.12);
          box-shadow: 0 8px 24px rgba(0,0,0,.38);
          font-size: 12px;
          line-height: 1.45;
          color: #f0f0f0;
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
          overscroll-behavior: contain;
        }
        .panel.open { display: block; }
        .panel .label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .02em;
          opacity: .5;
          margin-bottom: 2px;
        }
        .panel .orig {
          white-space: pre-wrap;
          word-break: break-word;
          color: rgba(255,255,255,.88);
          margin-bottom: 6px;
        }
        .panel .tr, .panel .result {
          white-space: pre-wrap;
          word-break: break-word;
          color: oklch(88% 0.08 82);
          font-weight: 500;
        }
        .panel .body {
          white-space: pre-wrap;
          word-break: break-word;
        }
        .panel .muted { opacity: .55; font-size: 11px; }
        .panel .divider {
          height: 1px;
          background: rgba(255,255,255,.08);
          margin: 6px 0;
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

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.skillMenuOpen) {
        this.closeSkillMenu();
        return;
      }
      this.hide();
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
    if ((e.target as Element)?.closest?.(`#${HOST_ID}`)) return;
    if (this.host?.contains(e.target as Node)) return;

    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (!text || text.length > 2000) {
        this.hide();
        return;
      }
      if (!/\S/.test(text)) {
        this.hide();
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
        this.hide();
        return;
      }
      this.selectedText = text;
      const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
      if (!range) {
        this.hide();
        return;
      }
      const startRect = getSelectionStartRect(range);
      if (!startRect) {
        this.hide();
        return;
      }
      void this.showAtAsync(startRect.left, startRect.bottom);
    }, 10);
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

    if (tb.showTranslate) {
      bar.appendChild(
        this.mkIconBtn(
          EXTRA_SVG.translate,
          '翻译',
          'primary',
          () => void this.runTranslate(panel),
        ),
      );
    }
    if (tb.showDictionary) {
      bar.appendChild(
        this.mkIconBtn(
          UI_ICON_SVG.explain,
          '词典',
          '',
          () => void this.runExplain(panel),
        ),
      );
    }
    if (tb.showTts) {
      bar.appendChild(
        this.mkIconBtn(UI_ICON_SVG.tts, '朗读', '', () => void this.runTts()),
      );
    }
    if (tb.showAddWord) {
      bar.appendChild(
        this.mkIconBtn(
          UI_ICON_SVG.add,
          '生词',
          '',
          () => void this.runAddWord(panel),
        ),
      );
    }

    // AI Skills (inherit Skill 体系)
    const toolbarSkills = this.resolveToolbarSkills();
    if (tb.showSkills && toolbarSkills.length) {
      const head = toolbarSkills.slice(0, MAX_SKILL_CHIPS);
      const rest = toolbarSkills.slice(MAX_SKILL_CHIPS);

      for (const skill of head) {
        bar.appendChild(
          this.mkSkillChip(skill, () => {
            this.closeSkillMenu();
            void this.runSkill(panel, skill);
          }),
        );
      }

      if (rest.length > 0) {
        bar.appendChild(
          this.mkIconBtn(EXTRA_SVG.more, `更多 AI 指令 (${rest.length})`, '', () => {
            this.toggleSkillMenu(skillMenu, rest, panel);
          }),
        );
        // Prebuild overflow items when opened
      } else if (toolbarSkills.length > 1) {
        // Optional overflow still useful for long names — skip if all shown
      }
    } else if (tb.showSkills) {
      // No skills loaded yet — entry to open menu with empty state
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

    bar.appendChild(
      this.mkIconBtn(EXTRA_SVG.close, '关闭', 'close', () => this.hide()),
    );

    panel.classList.remove('open');
    panel.innerHTML = '';

    const gap = 4;
    wrap.style.display = 'flex';
    wrap.style.left = '0px';
    wrap.style.top = '0px';
    const barW = Math.max(bar.offsetWidth || 120, 120);
    const left = Math.max(8, Math.min(window.innerWidth - barW - 8, x));
    let top = y + gap;
    const approxH = 36;
    if (top + approxH > window.innerHeight - 8) {
      top = Math.max(8, y - approxH - gap);
    }
    wrap.style.left = `${left}px`;
    wrap.style.top = `${top}px`;
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

  private hide(): void {
    if (!this.shadow) return;
    this.skillMenuOpen = false;
    const wrap = this.shadow.getElementById('wrap');
    if (wrap) wrap.style.display = 'none';
  }

  private async runSkill(
    panel: HTMLElement,
    skill: SkillRecord,
  ): Promise<void> {
    const orig = this.selectedText;
    const context = [
      document.title ? `页面：${document.title}` : '',
      `URL：${location.href}`,
    ]
      .filter(Boolean)
      .join('\n');

    panel.classList.add('open');
    panel.innerHTML = `
      <div class="label">原文</div>
      <div class="orig"></div>
      <div class="divider"></div>
      <div class="label"></div>
      <div class="result muted">运行中…</div>
    `;
    const origEl = panel.querySelector('.orig') as HTMLElement;
    const labelEl = panel.querySelectorAll('.label')[1] as HTMLElement;
    const resultEl = panel.querySelector('.result') as HTMLElement;
    if (origEl) origEl.textContent = orig;
    if (labelEl) labelEl.textContent = skill.name;

    const res = await sendRuntime<{ text: string }>(
      'skill.run',
      {
        skillId: skill.id,
        text: orig,
        context,
      },
      'content',
    );

    if (!resultEl) return;
    resultEl.classList.remove('muted');
    if (res.ok) {
      resultEl.textContent = res.data.text?.trim() || '（空结果）';
    } else {
      resultEl.textContent = res.error.message;
    }
  }

  private async runTranslate(panel: HTMLElement): Promise<void> {
    const orig = this.selectedText;
    panel.classList.add('open');
    panel.innerHTML = `
      <div class="label">原文</div>
      <div class="orig"></div>
      <div class="divider"></div>
      <div class="label">译文</div>
      <div class="tr muted">翻译中…</div>
    `;
    const origEl = panel.querySelector('.orig') as HTMLElement;
    const trEl = panel.querySelector('.tr') as HTMLElement;
    if (origEl) origEl.textContent = orig;

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
    if (!trEl) return;
    trEl.classList.remove('muted');
    if (res.ok) {
      trEl.textContent = res.data.items[0]?.text || '（空结果）';
    } else {
      trEl.textContent = res.error.message;
    }
  }

  private async runExplain(panel: HTMLElement): Promise<void> {
    const orig = this.selectedText;
    panel.classList.add('open');
    panel.innerHTML = `
      <div class="label">原文</div>
      <div class="orig"></div>
      <div class="divider"></div>
      <div class="body muted">查询中…</div>
    `;
    const origEl = panel.querySelector('.orig') as HTMLElement;
    const body = panel.querySelector('.body') as HTMLElement;
    if (origEl) origEl.textContent = orig;

    const res = await sendRuntime<{
      text?: string;
      definition?: string;
      contextTranslation?: string;
      note?: string;
      explanation?: string;
      engine?: string;
    }>(
      'word.explain',
      {
        word: orig,
        surface: orig,
        context: orig,
      },
      'content',
    );
    if (!body) return;
    body.classList.remove('muted');
    if (!res.ok) {
      body.textContent = res.error.message;
      return;
    }
    const d = res.data;
    const lines = [
      d.definition,
      d.contextTranslation ? `句子译文：${d.contextTranslation}` : '',
      d.engine === 'llm' && d.explanation ? d.explanation : '',
      d.note ? `（${d.note}）` : '',
    ].filter(Boolean);
    body.textContent = lines.join('\n\n') || d.text || orig;
  }

  private async runTts(): Promise<void> {
    if (
      this.config.tts?.engine === 'edge' &&
      this.config.features.enableEdgeTts
    ) {
      const chunksRes = await sendRuntime<{
        mode: string;
        voice: string;
        chunks: Array<{ audioBase64: string; contentType: string }>;
      }>('tts.synthChunks', { text: this.selectedText }, 'content');

      if (chunksRes.ok && chunksRes.data.chunks?.length) {
        stopTtsPlayback();
        await playTtsAudioChunks(chunksRes.data.chunks);
        return;
      }
    }

    const res = await sendRuntime<{
      mode: string;
      text?: string;
      voice?: string;
      clipId?: number;
      clipIds?: number[];
    }>('tts.synth', { text: this.selectedText }, 'content');

    if (!res.ok) return;

    if (res.data.mode === 'web-speech' && res.data.text) {
      if (typeof speechSynthesis !== 'undefined') {
        const u = new SpeechSynthesisUtterance(res.data.text);
        u.lang = res.data.voice || 'en-US';
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      }
      return;
    }

    const ids = res.data.clipIds?.length
      ? res.data.clipIds
      : res.data.clipId != null
        ? [res.data.clipId]
        : [];
    if (!ids.length) return;

    const player = new ClipPlayer();
    await player.playSequence(ids, () => undefined);
  }

  private async runAddWord(panel: HTMLElement): Promise<void> {
    const surface = this.selectedText.split(/\s+/).slice(0, 6).join(' ');
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
    panel.classList.add('open');
    panel.innerHTML = `
      <div class="label">原文</div>
      <div class="orig"></div>
      <div class="divider"></div>
      <div class="body"></div>
    `;
    const origEl = panel.querySelector('.orig') as HTMLElement;
    const body = panel.querySelector('.body') as HTMLElement;
    if (origEl) origEl.textContent = surface;
    if (body) {
      body.textContent = res.ok ? '已加入生词本' : res.error.message;
      if (res.ok) body.style.color = 'oklch(80% 0.1 145)';
    }
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
