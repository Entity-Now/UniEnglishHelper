/**
 * Quiet floating control for in-page translation.
 * Icon-first so it sits on the page instead of advertising itself as a widget.
 */

import type { AppConfig } from '../../shared/domain/types';
import type {
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
  private scrollHideTimer = 0;
  private onScroll: (() => void) | null = null;
  private onDocClick: ((e: Event) => void) | null = null;

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
    const pageScheme = getComputedStyle(document.documentElement).colorScheme;
    if (pageScheme) this.host.style.colorScheme = pageScheme;
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

    this.onScroll = () => {
      if (!this.host) return;
      this.host.classList.add('ueh-fab-hidden');
      window.clearTimeout(this.scrollHideTimer);
      this.scrollHideTimer = window.setTimeout(() => {
        this.host?.classList.remove('ueh-fab-hidden');
      }, 280);
    };
    window.addEventListener('scroll', this.onScroll, { passive: true, capture: true });

    this.onDocClick = (e: Event) => {
      if (!this.menuOpen) return;
      const path = e.composedPath();
      if (this.host && path.includes(this.host)) return;
      this.menuOpen = false;
      this.render();
    };
    document.addEventListener('click', this.onDocClick, true);

    this.render();
  }

  private render(): void {
    if (!this.shadow) return;
    const container = this.shadow.querySelector('.fab-container');
    if (!container) return;

    container.replaceChildren();

    const isTranslated = this.status === 'translated' || this.status === 'translating';

    if (this.menuOpen) {
      const menu = document.createElement('div');
      menu.className = 'fab-menu';
      menu.setAttribute('role', 'menu');

      if (!isTranslated) {
        menu.appendChild(
          this.menuButton('翻译本页', true, () => {
            this.menuOpen = false;
            void this.controller.translate();
          }),
        );
      } else {
        menu.appendChild(
          this.menuButton('双语对照', this.viewMode === 'bilingual', () => {
            this.menuOpen = false;
            this.controller.setViewMode('bilingual');
          }),
        );
        menu.appendChild(
          this.menuButton('仅显示译文', this.viewMode === 'translation_only', () => {
            this.menuOpen = false;
            this.controller.setViewMode('translation_only');
          }),
        );
        menu.appendChild(
          this.menuButton('只看原文', false, () => {
            this.menuOpen = false;
            this.controller.restore();
          }),
        );
        const divider = document.createElement('div');
        divider.className = 'fab-menu-divider';
        menu.appendChild(divider);
        menu.appendChild(
          this.menuButton('重新翻译', false, () => {
            this.menuOpen = false;
            this.controller.restore();
            void this.controller.translate({ force: true });
          }),
        );
      }

      container.appendChild(menu);
    }

    const pill = document.createElement('div');
    const expanded =
      this.menuOpen || this.status === 'translating' || this.status === 'error';
    pill.className = `fab-pill${this.status === 'translated' ? ' active' : ''}${expanded ? ' expanded' : ''}`;
    pill.setAttribute('role', 'button');
    pill.setAttribute('tabindex', '0');
    pill.setAttribute('aria-label', '网页翻译');

    let labelText = '翻译';
    if (this.status === 'translating') {
      const total = this.progress.total || 0;
      labelText = total
        ? `${this.progress.completed}/${total}`
        : '翻译中';
    } else if (this.status === 'translated') {
      labelText =
        this.viewMode === 'bilingual'
          ? '双语'
          : this.viewMode === 'translation_only'
            ? '译文'
            : '原文';
    } else if (this.status === 'error') {
      labelText = '重试';
    }

    const icon = document.createElement('div');
    icon.className = 'fab-icon';
    if (this.status === 'translating') {
      const spinner = document.createElement('div');
      spinner.className = 'fab-spinner';
      icon.appendChild(spinner);
    } else {
      icon.innerHTML = TRANSLATE_ICON_SVG;
    }

    const label = document.createElement('span');
    label.className = 'fab-label';
    label.textContent = labelText;

    pill.appendChild(icon);
    pill.appendChild(label);

    const activate = (e: Event) => {
      e.stopPropagation();
      if (this.status === 'idle' || this.status === 'restored' || this.status === 'error') {
        void this.controller.translate();
        return;
      }
      this.menuOpen = !this.menuOpen;
      this.render();
    };
    pill.addEventListener('click', activate);
    pill.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate(e);
      }
    });

    container.appendChild(pill);
  }

  private menuButton(
    text: string,
    active: boolean,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `fab-menu-btn${active ? ' active' : ''}`;
    btn.textContent = text;
    btn.setAttribute('role', 'menuitem');
    btn.onclick = onClick;
    return btn;
  }

  hide(): void {
    this.teardownListeners();
    if (this.host) {
      this.host.remove();
      this.host = null;
      this.shadow = null;
    }
  }

  private teardownListeners(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.onScroll) {
      window.removeEventListener('scroll', this.onScroll, true);
      this.onScroll = null;
    }
    if (this.onDocClick) {
      document.removeEventListener('click', this.onDocClick, true);
      this.onDocClick = null;
    }
    window.clearTimeout(this.scrollHideTimer);
  }

  destroy(): void {
    this.hide();
  }
}
