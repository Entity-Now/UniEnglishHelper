/**
 * Page-mode side panels: reserve horizontal space so left vocab / right cue
 * lists do not cover the video. PiP mode handles this via #ueh-video-slot.
 */

const STYLE_ID = 'ueh-page-side-layout-style';

const LEFT_W = 'min(280px, 28vw)';
const RIGHT_W = 'min(360px, 32vw)';

/**
 * Ensure the shared layout stylesheet is present (idempotent).
 * Classes on <html>:
 * - ueh-recap-open → reserve left gutter
 * - ueh-cue-list-open.ueh-cue-list-overlay → reserve right gutter
 *   (only when cue list is a fixed overlay, not docked into #secondary)
 */
export function ensurePageSideLayoutStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    html.ueh-recap-open,
    html.ueh-cue-list-open.ueh-cue-list-overlay {
      --ueh-left-gutter: 0px;
      --ueh-right-gutter: 0px;
    }
    html.ueh-recap-open {
      --ueh-left-gutter: ${LEFT_W};
    }
    html.ueh-cue-list-open.ueh-cue-list-overlay {
      --ueh-right-gutter: ${RIGHT_W};
    }

    /* YouTube watch: shift primary+secondary so gutters stay free */
    html.ueh-recap-open ytd-watch-flexy #columns,
    html.ueh-cue-list-open.ueh-cue-list-overlay ytd-watch-flexy #columns,
    html.ueh-recap-open #columns.ytd-watch-flexy,
    html.ueh-cue-list-open.ueh-cue-list-overlay #columns.ytd-watch-flexy {
      margin-left: var(--ueh-left-gutter) !important;
      margin-right: var(--ueh-right-gutter) !important;
      width: auto !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
      transition: margin-left .18s ease, margin-right .18s ease;
    }

    /* Theater / wide player container */
    html.ueh-recap-open ytd-watch-flexy[theater] #player-full-bleed-container,
    html.ueh-cue-list-open.ueh-cue-list-overlay ytd-watch-flexy[theater] #player-full-bleed-container,
    html.ueh-recap-open ytd-watch-flexy[fullscreen] #player-full-bleed-container,
    html.ueh-cue-list-open.ueh-cue-list-overlay ytd-watch-flexy[fullscreen] #player-full-bleed-container {
      margin-left: var(--ueh-left-gutter) !important;
      margin-right: var(--ueh-right-gutter) !important;
      width: auto !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
    }

    /* Generic HTML5 pages: pad the document so fixed panels sit in gutters */
    html.ueh-recap-open body:not(:has(ytd-app)),
    html.ueh-cue-list-open.ueh-cue-list-overlay body:not(:has(ytd-app)) {
      padding-left: var(--ueh-left-gutter) !important;
      padding-right: var(--ueh-right-gutter) !important;
      box-sizing: border-box !important;
      transition: padding-left .18s ease, padding-right .18s ease;
    }

    /* Fixed side panels fill the reserved gutters */
    #ueh-vocab-recap-root.ueh-page-dock {
      position: fixed !important;
      top: 56px !important;
      left: 0 !important;
      bottom: 0 !important;
      width: ${LEFT_W} !important;
      max-height: none !important;
      z-index: 2147483638 !important;
      box-sizing: border-box !important;
    }
    #ueh-cue-list-root.ueh-page-dock-overlay {
      position: fixed !important;
      top: 56px !important;
      right: 0 !important;
      bottom: 0 !important;
      width: ${RIGHT_W} !important;
      max-height: none !important;
      z-index: 2147483640 !important;
      box-sizing: border-box !important;
    }
  `;
  (doc.head || doc.documentElement).appendChild(style);
}

export function setCueListOverlayMode(
  on: boolean,
  doc: Document = document,
): void {
  ensurePageSideLayoutStyles(doc);
  doc.documentElement.classList.toggle('ueh-cue-list-overlay', on);
}

export function pageLeftPanelWidthCss(): string {
  return LEFT_W;
}

export function pageRightPanelWidthCss(): string {
  return RIGHT_W;
}
