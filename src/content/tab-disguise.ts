/**
 * Disguises the opener video tab's title and favicon as a neutral technical
 * documentation page while PiP loafing mode is active, and cleanly restores
 * the original title and icons when disabled or when PiP closes.
 */

const DOC_FAVICON_DATA_URI =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<rect x="4" y="2" width="24" height="28" rx="4" fill="#3178c6"/>' +
      '<path d="M10 11h12M10 16h12M10 21h8" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/>' +
      '</svg>',
  );

export class TabDisguiseController {
  private active = false;
  private targetTitle = 'TypeScript: Documentation - Everyday Types';
  private realTitle = '';
  private savedIcons: Array<{ el: HTMLLinkElement; href: string }> = [];
  private injectedIcon: HTMLLinkElement | null = null;
  private titleObserver: MutationObserver | null = null;
  private applyingTitle = false;

  enable(customTitle?: string): void {
    const nextTitle =
      customTitle?.trim() || 'TypeScript: Documentation - Everyday Types';
    this.targetTitle = nextTitle;

    if (!this.active) {
      this.active = true;
      this.realTitle = document.title;
      this.applyFaviconDisguise();
      this.observeTitle();
    }
    this.applyTitleDisguise();
  }

  disable(): void {
    if (!this.active) return;
    this.active = false;
    this.titleObserver?.disconnect();
    this.titleObserver = null;

    if (this.realTitle) {
      document.title = this.realTitle;
    }
    this.restoreFavicons();
  }

  isActive(): boolean {
    return this.active;
  }

  private applyTitleDisguise(): void {
    if (!this.active || document.title === this.targetTitle) return;
    this.applyingTitle = true;
    try {
      document.title = this.targetTitle;
    } finally {
      this.applyingTitle = false;
    }
  }

  private observeTitle(): void {
    this.titleObserver?.disconnect();
    const head = document.head || document.documentElement;
    if (!head || typeof MutationObserver === 'undefined') return;

    this.titleObserver = new MutationObserver(() => {
      if (!this.active || this.applyingTitle) return;
      if (document.title && document.title !== this.targetTitle) {
        this.realTitle = document.title;
        this.applyTitleDisguise();
      }
    });
    this.titleObserver.observe(head, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }

  private applyFaviconDisguise(): void {
    this.savedIcons = [];
    const existing = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]'),
    );
    if (existing.length > 0) {
      for (const link of existing) {
        this.savedIcons.push({ el: link, href: link.href });
        link.href = DOC_FAVICON_DATA_URI;
      }
    } else if (document.head) {
      const link = document.createElement('link');
      link.rel = 'icon';
      link.href = DOC_FAVICON_DATA_URI;
      document.head.appendChild(link);
      this.injectedIcon = link;
    }
  }

  private restoreFavicons(): void {
    for (const item of this.savedIcons) {
      if (item.el.isConnected) {
        item.el.href = item.href;
      }
    }
    this.savedIcons = [];
    this.injectedIcon?.remove();
    this.injectedIcon = null;
  }
}
