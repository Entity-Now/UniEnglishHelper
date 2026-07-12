/**
 * Player chrome controls:
 *  - 「字幕」panel: page overlay options (size, display mode, auto-translate…)
 *  - 「PiP」: open Document Picture-in-Picture
 * Settings are persisted via config.set and applied live.
 */

import type { AppConfig } from '../shared/domain/types';
import type { SubtitlesDisplayMode } from '../types/config/subtitles';
import { sendRuntime } from '../shared/messaging/client';

export type PipHandler = () => void;
export type CueListHandler = () => void;

export type LiveConfigApply = (config: AppConfig) => void | Promise<void>;

const GROUP_ID = 'ueh-chrome-group';
const PANEL_ID = 'ueh-page-settings-panel';
const STYLE_ID = 'ueh-chrome-controls-style';

export class PlayerChromeButton {
  private group: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private timer: number | null = null;
  private config: AppConfig;
  private onPip: PipHandler;
  private onLiveApply: LiveConfigApply;
  private onCueList: CueListHandler | null;
  private onSubtitlesClick: (() => void) | null = null;
  private panelOpen = false;
  private boundDocClick: ((e: MouseEvent) => void) | null = null;

  constructor(
    config: AppConfig,
    onPip: PipHandler,
    onLiveApply: LiveConfigApply,
    onCueList?: CueListHandler,
    onSubtitlesClick?: () => void,
  ) {
    this.config = config;
    this.onPip = onPip;
    this.onLiveApply = onLiveApply;
    this.onCueList = onCueList ?? null;
    this.onSubtitlesClick = onSubtitlesClick ?? null;
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    this.syncPanelFields();
  }

  start(): void {
    this.ensureStyles();
    this.mount();
    this.observer = new MutationObserver(() => {
      if (!document.getElementById(GROUP_ID)) this.mount();
    });
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    this.timer = window.setInterval(() => {
      if (!document.getElementById(GROUP_ID)) this.mount();
    }, 2000);

    this.boundDocClick = (e) => {
      if (!this.panelOpen) return;
      const t = e.target as Node;
      if (this.panel?.contains(t) || this.group?.contains(t)) return;
      this.closePanel();
    };
    document.addEventListener('click', this.boundDocClick, true);
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.timer != null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.boundDocClick) {
      document.removeEventListener('click', this.boundDocClick, true);
      this.boundDocClick = null;
    }
    this.panel?.remove();
    this.panel = null;
    this.group?.remove();
    this.group = null;
    this.panelOpen = false;
  }

  private ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${GROUP_ID} {
        display: inline-flex !important;
        align-items: center !important;
        gap: 4px !important;
        margin: 0 4px !important;
        vertical-align: middle !important;
        flex-shrink: 0 !important;
      }
      #${GROUP_ID} .ueh-chrome-btn {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        height: 36px !important;
        min-width: 40px !important;
        padding: 0 10px !important;
        border: none !important;
        border-radius: 4px !important;
        font-size: 12px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        line-height: 1 !important;
        font-family: system-ui, -apple-system, sans-serif !important;
      }
      #${GROUP_ID} .ueh-chrome-btn.ueh-pip {
        background: oklch(76.034% 0.12361 82.191) !important;
        color: #1a1a1a !important;
      }
      #${GROUP_ID} .ueh-chrome-btn.ueh-settings,
      #${GROUP_ID} .ueh-chrome-btn.ueh-cues {
        background: rgba(255,255,255,.14) !important;
        color: #fff !important;
        border: 1px solid rgba(255,255,255,.2) !important;
      }
      #${GROUP_ID} .ueh-chrome-btn.ueh-settings.ueh-active {
        background: oklch(76.034% 0.12361 82.191) !important;
        color: #1a1a1a !important;
        border-color: transparent !important;
      }
      #${GROUP_ID} .ueh-chrome-btn:hover {
        filter: brightness(1.1);
      }
      #${PANEL_ID} {
        position: fixed !important;
        z-index: 2147483645 !important;
        width: min(320px, calc(100vw - 24px)) !important;
        max-height: min(70vh, 480px) !important;
        overflow: auto !important;
        padding: 12px 14px 14px !important;
        border-radius: 12px !important;
        background: rgba(16, 17, 22, 0.97) !important;
        border: 1px solid rgba(255,255,255,.14) !important;
        box-shadow: 0 16px 48px rgba(0,0,0,.5) !important;
        color: #f5f5f5 !important;
        font: 12px/1.4 system-ui, -apple-system, sans-serif !important;
        display: none !important;
      }
      #${PANEL_ID}.ueh-open {
        display: block !important;
      }
      #${PANEL_ID} h3 {
        margin: 0 0 10px !important;
        font-size: 13px !important;
        font-weight: 700 !important;
        color: oklch(88% 0.08 82) !important;
      }
      #${PANEL_ID} .ueh-field {
        margin-bottom: 10px !important;
      }
      #${PANEL_ID} label.ueh-row {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        cursor: pointer !important;
        margin: 6px 0 !important;
        user-select: none !important;
      }
      #${PANEL_ID} label.ueh-block {
        display: block !important;
        margin-bottom: 4px !important;
        color: rgba(255,255,255,.7) !important;
        font-size: 11px !important;
      }
      #${PANEL_ID} select,
      #${PANEL_ID} input[type="range"] {
        width: 100% !important;
        box-sizing: border-box !important;
      }
      #${PANEL_ID} select {
        background: #0d1117 !important;
        color: #f5f5f5 !important;
        border: 1px solid #30363d !important;
        border-radius: 8px !important;
        padding: 6px 8px !important;
        font-size: 12px !important;
      }
      #${PANEL_ID} .ueh-actions {
        display: flex !important;
        gap: 8px !important;
        margin-top: 12px !important;
      }
      #${PANEL_ID} .ueh-actions button {
        flex: 1 !important;
        border: 0 !important;
        border-radius: 8px !important;
        padding: 8px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        font-size: 12px !important;
      }
      #${PANEL_ID} .ueh-save {
        background: oklch(76.034% 0.12361 82.191) !important;
        color: #1a1a1a !important;
      }
      #${PANEL_ID} .ueh-close {
        background: rgba(255,255,255,.1) !important;
        color: #fff !important;
      }
      #${PANEL_ID} .ueh-hint {
        font-size: 10px !important;
        color: rgba(255,255,255,.5) !important;
        margin-top: 8px !important;
      }
      #${PANEL_ID} .ueh-status {
        margin-top: 8px !important;
        font-size: 11px !important;
        color: oklch(80% 0.1 145) !important;
        min-height: 1.2em !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  private mount(): void {
    if (document.getElementById(GROUP_ID)) return;

    const host = this.findControlsHost();
    const group = this.createGroup();

    if (host) {
      const cc = this.findCcButton(host);
      if (cc?.parentElement) {
        cc.parentElement.insertBefore(group, cc);
      } else {
        host.appendChild(group);
      }
      this.group = group;
      return;
    }

    const video = this.findPrimaryVideo();
    if (!video) return;
    const wrap = video.parentElement ?? video;
    const style = getComputedStyle(wrap);
    if (style.position === 'static') {
      (wrap as HTMLElement).style.position = 'relative';
    }
    Object.assign(group.style, {
      position: 'absolute',
      right: '48px',
      bottom: '48px',
      zIndex: '30',
    } as CSSStyleDeclaration);
    wrap.appendChild(group);
    this.group = group;
  }

  private createGroup(): HTMLElement {
    const group = document.createElement('div');
    group.id = GROUP_ID;
    group.setAttribute('data-ueh-chrome', '1');

    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'ueh-chrome-btn ueh-settings';
    settingsBtn.id = 'ueh-chrome-settings-btn';
    settingsBtn.title = '页内字幕与翻译设置';
    settingsBtn.setAttribute('aria-label', 'Page subtitle settings');
    settingsBtn.textContent = '字幕';
    settingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onSubtitlesClick?.();
      this.togglePanel(settingsBtn);
    });

    const cuesBtn = document.createElement('button');
    cuesBtn.type = 'button';
    cuesBtn.className = 'ueh-chrome-btn ueh-cues';
    cuesBtn.id = 'ueh-chrome-cues-btn';
    cuesBtn.title = '字幕列表（Alt+Shift+L）';
    cuesBtn.setAttribute('aria-label', 'Subtitle list');
    cuesBtn.textContent = '列表';
    cuesBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.closePanel();
      this.onCueList?.();
    });

    const pipBtn = document.createElement('button');
    pipBtn.type = 'button';
    pipBtn.className = 'ueh-chrome-btn ueh-pip';
    pipBtn.id = 'ueh-chrome-pip-btn';
    pipBtn.title = '打开学习画中画 PiP';
    pipBtn.setAttribute('aria-label', 'Open learning Picture-in-Picture');
    pipBtn.textContent = 'PiP';
    pipBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.closePanel();
      this.onPip();
    });

    group.appendChild(settingsBtn);
    group.appendChild(cuesBtn);
    group.appendChild(pipBtn);
    return group;
  }

  private togglePanel(anchor: HTMLElement): void {
    if (this.panelOpen) {
      this.closePanel();
      return;
    }
    this.openPanel(anchor);
  }

  private openPanel(anchor: HTMLElement): void {
    if (!this.panel) {
      this.panel = this.createPanel();
      document.documentElement.appendChild(this.panel);
    }
    this.syncPanelFields();
    this.panel.classList.add('ueh-open');
    this.panelOpen = true;
    document
      .getElementById('ueh-chrome-settings-btn')
      ?.classList.add('ueh-active');

    const rect = anchor.getBoundingClientRect();
    const panelW = Math.min(320, window.innerWidth - 24);
    let left = rect.right - panelW;
    left = Math.max(12, Math.min(left, window.innerWidth - panelW - 12));
    let top = rect.top - 8;
    // Prefer above controls; if no room, place above with clamp
    this.panel.style.left = `${left}px`;
    this.panel.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    this.panel.style.top = 'auto';
    void top;
  }

  private closePanel(): void {
    this.panel?.classList.remove('ueh-open');
    this.panelOpen = false;
    document
      .getElementById('ueh-chrome-settings-btn')
      ?.classList.remove('ueh-active');
  }

  private createPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('data-ueh-overlay', 'page-settings');
    panel.innerHTML = `
      <h3>页内字幕 / 翻译（非 PiP）</h3>
      <div class="ueh-field">
        <label class="ueh-row"><input type="checkbox" id="ueh-ps-enabled" /> 显示页内字幕叠层</label>
        <label class="ueh-row"><input type="checkbox" id="ueh-ps-auto-yt" /> YouTube 默认自动启动</label>
        <label class="ueh-row"><input type="checkbox" id="ueh-ps-auto-tr" /> 新字幕句自动翻译</label>
      </div>
      <div class="ueh-field">
        <label class="ueh-block" for="ueh-ps-mode">显示模式</label>
        <select id="ueh-ps-mode">
          <option value="bilingual">双语（原文 + 译文）</option>
          <option value="originalOnly">仅原文</option>
          <option value="translationOnly">仅译文</option>
          <option value="off">关闭字幕</option>
        </select>
      </div>
      <div class="ueh-field">
        <label class="ueh-block" for="ueh-ps-pos">译文位置</label>
        <select id="ueh-ps-pos">
          <option value="below">原文下方</option>
          <option value="above">原文上方</option>
        </select>
      </div>
      <div class="ueh-field">
        <label class="ueh-block" for="ueh-ps-scale">字幕大小 <span id="ueh-ps-scale-val"></span></label>
        <input type="range" id="ueh-ps-scale" min="50" max="150" step="5" />
      </div>
      <div class="ueh-actions">
        <button type="button" class="ueh-save" id="ueh-ps-save">保存并应用</button>
        <button type="button" class="ueh-close" id="ueh-ps-close">关闭</button>
      </div>
      <div class="ueh-status" id="ueh-ps-status"></div>
      <p class="ueh-hint">设置会同步到扩展 Options，并立即作用于当前页面与 PiP。</p>
    `;

    // Live preview on change (apply immediately + debounce persist optional)
    const applyLiveFromPanel = () => {
      void this.applyFromPanel(false);
    };
    panel
      .querySelector('#ueh-ps-enabled')
      ?.addEventListener('change', applyLiveFromPanel);
    panel
      .querySelector('#ueh-ps-auto-tr')
      ?.addEventListener('change', applyLiveFromPanel);
    panel
      .querySelector('#ueh-ps-mode')
      ?.addEventListener('change', applyLiveFromPanel);
    panel
      .querySelector('#ueh-ps-pos')
      ?.addEventListener('change', applyLiveFromPanel);
    panel.querySelector('#ueh-ps-scale')?.addEventListener('input', () => {
      this.updateScaleLabel();
      void this.applyFromPanel(false);
    });
    panel.querySelector('#ueh-ps-auto-yt')?.addEventListener('change', () => {
      // autoStart only matters on next video; still persist
      void this.applyFromPanel(true);
    });

    panel.querySelector('#ueh-ps-save')?.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.applyFromPanel(true).then((ok) => {
        const st = panel.querySelector('#ueh-ps-status');
        if (st) st.textContent = ok ? '✓ 已保存并同步到设置' : '保存失败';
      });
    });
    panel.querySelector('#ueh-ps-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closePanel();
    });

    panel.addEventListener('click', (e) => e.stopPropagation());
    return panel;
  }

  private updateScaleLabel(): void {
    const scale = this.panel?.querySelector(
      '#ueh-ps-scale',
    ) as HTMLInputElement | null;
    const lab = this.panel?.querySelector('#ueh-ps-scale-val');
    if (scale && lab) lab.textContent = `${scale.value}%`;
  }

  private syncPanelFields(): void {
    if (!this.panel) return;
    const c = this.config;
    const en = this.panel.querySelector(
      '#ueh-ps-enabled',
    ) as HTMLInputElement | null;
    const autoYt = this.panel.querySelector(
      '#ueh-ps-auto-yt',
    ) as HTMLInputElement | null;
    const autoTr = this.panel.querySelector(
      '#ueh-ps-auto-tr',
    ) as HTMLInputElement | null;
    const mode = this.panel.querySelector(
      '#ueh-ps-mode',
    ) as HTMLSelectElement | null;
    const pos = this.panel.querySelector(
      '#ueh-ps-pos',
    ) as HTMLSelectElement | null;
    const scale = this.panel.querySelector(
      '#ueh-ps-scale',
    ) as HTMLInputElement | null;

    const ps = c.pageSubtitles;
    if (en) en.checked = ps?.enabled !== false;
    if (autoYt) autoYt.checked = ps?.autoStartOnYoutube !== false;
    if (autoTr)
      autoTr.checked =
        ps?.autoTranslate ?? c.features?.autoTranslate !== false;
    if (mode) mode.value = ps?.style?.displayMode ?? 'bilingual';
    if (pos) pos.value = ps?.style?.translationPosition ?? 'below';
    if (scale) {
      scale.value = String(ps?.style?.main?.fontScale ?? 110);
      this.updateScaleLabel();
    }
  }

  /** Read panel → merge pageSubtitles only → live apply → optionally persist. */
  private async applyFromPanel(persist: boolean): Promise<boolean> {
    if (!this.panel) return false;
    const en = this.panel.querySelector(
      '#ueh-ps-enabled',
    ) as HTMLInputElement;
    const autoYt = this.panel.querySelector(
      '#ueh-ps-auto-yt',
    ) as HTMLInputElement;
    const autoTr = this.panel.querySelector(
      '#ueh-ps-auto-tr',
    ) as HTMLInputElement;
    const mode = this.panel.querySelector('#ueh-ps-mode') as HTMLSelectElement;
    const pos = this.panel.querySelector('#ueh-ps-pos') as HTMLSelectElement;
    const scale = this.panel.querySelector(
      '#ueh-ps-scale',
    ) as HTMLInputElement;

    const fontScale = Number(scale.value) || 110;
    const displayMode = mode.value as SubtitlesDisplayMode;
    const prev = this.config.pageSubtitles;
    const nextPartial: Partial<AppConfig> = {
      pageSubtitles: {
        ...prev,
        enabled: en.checked,
        autoStartOnYoutube: autoYt.checked,
        autoTranslate: autoTr.checked,
        style: {
          ...prev.style,
          displayMode,
          translationPosition: pos.value as 'above' | 'below',
          main: {
            ...prev.style.main,
            fontScale,
          },
          translation: {
            ...prev.style.translation,
            fontScale: Math.round(fontScale * 0.88),
          },
        },
      },
    };

    this.config = {
      ...this.config,
      pageSubtitles: nextPartial.pageSubtitles!,
    };
    await this.onLiveApply(this.config);

    if (!persist) return true;

    const res = await sendRuntime<AppConfig>(
      'config.set',
      nextPartial,
      'content',
    );
    if (res.ok) {
      this.config = res.data;
      await this.onLiveApply(this.config);
      return true;
    }
    return false;
  }

  private findControlsHost(): HTMLElement | null {
    const selectors = [
      '.ytp-right-controls',
      '.ytp-chrome-controls .ytp-right-controls',
      '.bpx-player-control-bottom-right',
      '.bilibili-player-video-control-bottom-right',
      '.vjs-control-bar',
      '.plyr__controls',
      '.mejs__controls',
      '[data-uia="control-fullscreen"]',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el instanceof HTMLElement && el.offsetParent !== null) {
        if (sel.includes('data-uia')) return el.parentElement;
        return el;
      }
    }

    const cc = document.querySelector(
      [
        '.ytp-subtitles-button',
        'button[aria-label*="字幕" i]',
        'button[aria-label*="Caption" i]',
        'button[aria-label*="Subtitle" i]',
        'button[title*="字幕" i]',
        'button[title*="Caption" i]',
        'button[title*="Subtitle" i]',
        '.vjs-subs-caps-button',
        '.plyr__controls__item[data-plyr="captions"]',
      ].join(','),
    );
    if (cc?.parentElement instanceof HTMLElement) return cc.parentElement;
    return null;
  }

  private findCcButton(host: HTMLElement): HTMLElement | null {
    const sel = [
      '.ytp-subtitles-button',
      'button[aria-label*="字幕" i]',
      'button[aria-label*="Caption" i]',
      'button[aria-label*="Subtitle" i]',
      'button[title*="字幕" i]',
      'button[title*="Caption" i]',
      'button[title*="Subtitle" i]',
      '.vjs-subs-caps-button',
      '[data-plyr="captions"]',
    ].join(',');
    const inHost = host.querySelector(sel);
    return inHost instanceof HTMLElement ? inHost : null;
  }

  private findPrimaryVideo(): HTMLVideoElement | null {
    const videos = Array.from(document.querySelectorAll('video'));
    if (!videos.length) return null;
    return videos.sort(
      (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
    )[0];
  }
}
