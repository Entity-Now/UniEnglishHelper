/** Compact icon action buttons with tooltip (title + aria-label). */

export const UI_ICON_SVG = {
  add: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><line x1="12" x2="12" y1="11" y2="17"/><line x1="9" x2="15" y1="14" y2="14"/>',
  tts: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  explain:
    '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="M8 11h8"/><path d="M8 7h6"/>',
  learned:
    '<path d="M20 6 9 17l-5-5"/>',
  study:
    '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5v13"/><path d="M12 5a3 3 0 0 0 0 6"/>',
  dictionary:
    '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
  jump:
    '<polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none"/><line x1="19" x2="19" y1="5" y2="19"/>',
  star:
    '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor" stroke="none"/>',
  /** AI / skill sparkles */
  skill:
    '<path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="m5.6 5.6 2.1 2.1"/><path d="m16.3 16.3 2.1 2.1"/><path d="m5.6 18.4 2.1-2.1"/><path d="m16.3 7.7 2.1-2.1"/><circle cx="12" cy="12" r="3"/>',
} as const;

export type UiIconName = keyof typeof UI_ICON_SVG;

export function iconActionButton(
  icon: UiIconName,
  label: string,
  extraClass = '',
  attrs: Record<string, string> = {},
): string {
  const extra = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
  return `<button type="button" class="ueh-ibtn ${extraClass}"${extra} title="${label}" aria-label="${label}">
    <svg viewBox="0 0 24 24" aria-hidden="true">${UI_ICON_SVG[icon]}</svg>
  </button>`;
}

export const ICON_BTN_CSS = `
  .ueh-ibtn {
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 8px;
    background: rgba(255,255,255,.1);
    color: #fff;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    flex: 0 0 auto;
  }
  .ueh-ibtn:hover { background: rgba(255,255,255,.18); filter: brightness(1.05); }
  .ueh-ibtn.primary {
    background: oklch(76% 0.12 82);
    color: #1a1a1a;
  }
  .ueh-ibtn.star {
    background: color-mix(in srgb, oklch(76% 0.12 82) 85%, transparent);
    color: #1a1a1a;
  }
  .ueh-ibtn svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ueh-ibtn svg [fill="currentColor"] { fill: currentColor; stroke: none; }
  .ueh-ibtn-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
`;

/** Open extension options page with hash route (content / PiP safe). */
export async function openOptionsRoute(
  route: 'study' | 'dictionary' | 'general' = 'general',
): Promise<void> {
  const { sendRuntime } = await import('../shared/messaging/client');
  await sendRuntime('ui.openOptions', { route }, 'content');
}