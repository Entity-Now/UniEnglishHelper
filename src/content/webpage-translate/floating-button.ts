/**
 * Floating action widget for in-page translation.
 */

import type { AppConfig } from '../../shared/domain/types';
import type {
  StatusListener,
  TranslationProgress,
  TranslationStatus,
  ViewMode,
  WebpageTranslateController,
} from './controller';
import { FLOATING_BUTTON_CSS } from './styles';

const HOST_ID = 'ueh-web-translate-host';

const TRANSLATE_ICON_SVG = `
<svg viewBox="0 0 24 24">
  <path d="m5 8 6 6"/>
  <path d="m4 14 6-6 2-3"/>
  <path d="M2 5h12"/>
  <path d="M7 2h1"/>
  <path d="m22 22-5-10-5 10"/>
  <path d="M14 18h6"/>
</svg>
`;

export class WebpageTranslateFloatingButton {
  private controller: WebpageTranslateController;
  private config: AppConfig;
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private unsubscribe: (() => void) | null = null;
  private menuOpen = false;
  private status: TranslationStatus = 'idle';
  private progress: TranslationProgress = { total: 0, completed: 0, failed: 0 };
  private viewMode: ViewMode = 'bilingual';

  constructor(
    controller: WebpageTranslateController,
    config: AppConfig,
  ) {
    this.controller = controller;
    this.config = config;
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    if (this.config.webPageTranslate?.showFloatingButton === false) {
      this.hide();
    } else if (!this.host) {
      this.mount();
    }
  }

  mount(): void {
    if (this.host) return;
    if (this.config.webPageTranslate?.showFloatingButton === false) return;

    this.host = document.createElement('div');
    this.host.id = HOST_ID;
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = FLOATING_BUTTON_CSS;
    this.shadow.appendChild(styleEl);

    const container = document.createElement('div');
    container.className = 'fab-container';
    this.shadow.appendChild(container);

    document.documentElement.appendChild(this.host);

    const statusObj = this.controller.getStatus();
    this.status = statusObj.status;
    this.progress = statusObj.progress;
    this.viewMode = statusObj.viewMode;

    this.unsubscribe = this.controller.onStatusChange(
      (status, progress, viewMode) => {
        this.status = status;
        this.progress = progress;
        this.viewMode = viewMode;
        this.render();
      },
    );

    this.render();
  }

  private render(): void {
    if (!this.shadow) return;
    const container = this.shadow.querySelector('.fab-container');
    if (!container) return;

    container.innerHTML = '';

    if (this.menuOpen) {
      const menu = document.createElement('div');
      menu.className = 'fab-menu';

      const isTranslated = this.status === 'translated' || this.status === 'translating';

      if (!isTranslated) {
        const btnTranslate = document.createElement('button');
        btnTranslate.className = 'fab-menu-btn active';
        btnTranslate.textContent = '🌐 翻译本页';
        btnTranslate.onclick = () => {
          this.menuOpen = false;
          void this.controller.translate();
        };
        menu.appendChild(btnTranslate);
      } else {
        const btnBilingual = document.createElement('button');
        btnBilingual.className = `fab-menu-btn ${this.viewMode === 'bilingual' ? 'active' : ''}`;
        btnBilingual.textContent = '📖 双语对照';
        btnBilingual.onclick = () => {
          this.menuOpen = false;
          this.controller.setViewMode('bilingual');
        };
        menu.appendChild(btnBilingual);

        const btnTransOnly = document.createElement('button');
        btnTransOnly.className = `fab-menu-btn ${this.viewMode === 'translation_only' ? 'active' : ''}`;
        btnTransOnly.textContent = '📝 仅显示译文';
        btnTransOnly.onclick = () => {
          this.menuOpen = false;
          this.controller.setViewMode('translation_only');
        };
        menu.appendChild(btnTransOnly);

        const btnOriginal = document.createElement('button');
        btnOriginal.className = `fab-menu-btn ${this.viewMode === 'original' ? 'active' : ''}`;
        btnOriginal.textContent = '🔄 恢复原文';
        btnOriginal.onclick = () => {
          this.menuOpen = false;
          this.controller.restore();
        };
        menu.appendChild(btnOriginal);

        const divider = document.createElement('div');
        divider.className = 'fab-menu-divider';
        menu.appendChild(divider);

        const btnRetranslate = document.createElement('button');
        btnRetranslate.className = 'fab-menu-btn';
        btnRetranslate.textContent = '⚡ 重新翻译';
        btnRetranslate.onclick = () => {
          this.menuOpen = false;
          this.controller.restore();
          void this.controller.translate({ force: true });
        };
        menu.appendChild(btnRetranslate);
      }

      container.appendChild(menu);
    }

    const pill = document.createElement('div');
    pill.className = `fab-pill ${this.status === 'translated' ? 'active' : ''}`;

    let labelText = '翻译网页';
    if (this.status === 'translating') {
      labelText = `翻译中 ${this.progress.completed}/${this.progress.total || '…'}`;
    } else if (this.status === 'translated') {
      labelText = this.viewMode === 'bilingual' ? '双语对照' : this.viewMode === 'translation_only' ? '仅译文' : '已还原';
    }

    pill.innerHTML = `
      <div class="fab-icon">
        ${this.status === 'translating' ? '<div class="fab-spinner"></div>' : TRANSLATE_ICON_SVG}
      </div>
      <span>${labelText}</span>
    `;

    pill.onclick = (e) => {
      e.stopPropagation();
      if (this.status === 'idle' || this.status === 'restored') {
        void this.controller.translate();
      } else {
        this.menuOpen = !this.menuOpen;
        this.render();
      }
    };

    container.appendChild(pill);
  }

  hide(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.host) {
      this.host.remove();
      this.host = null;
      this.shadow = null;
    }
  }

  destroy(): void {
    this.hide();
  }
}
