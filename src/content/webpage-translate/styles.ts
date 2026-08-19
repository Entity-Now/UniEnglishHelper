/**
 * In-page translation styles.
 *
 * Goal: the translated line should read as a second line of the same
 * paragraph / heading — same font, weight, alignment, and color family —
 * not as a widget, caption, or overlay.
 */

export const WEBPAGE_TRANSLATION_INJECTED_CSS = `
/* Original children stay in the host's layout (no extra box). */
.ueh-original-wrap {
  display: contents !important;
}

/* Hide original only after the translation is ready, so the page swaps in place. */
body[data-ueh-view-mode="translation_only"] .ueh-has-translation > .ueh-original-wrap {
  display: none !important;
}

/* Hide translation when user asks for original. */
body[data-ueh-view-mode="original"] .ueh-translated-block,
body[data-ueh-view-mode="original"] .ueh-translated-inline {
  display: none !important;
}

.ueh-translated-block {
  display: block !important;
  margin: 0.18em 0 0 !important;
  padding: 0 !important;
  border: none !important;
  border-radius: 0 !important;
  background: none !important;
  box-shadow: none !important;
  outline: none !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
  font-family: inherit !important;
  font-size: var(--ueh-trans-font-size, 0.94em) !important;
  font-weight: inherit !important;
  font-style: inherit !important;
  font-stretch: inherit !important;
  font-variant: inherit !important;
  letter-spacing: inherit !important;
  word-spacing: inherit !important;
  line-height: inherit !important;
  text-align: inherit !important;
  text-transform: inherit !important;
  text-indent: 0 !important;
  white-space: inherit !important;
  color: var(--ueh-trans-color, color-mix(in srgb, currentColor 68%, transparent)) !important;
  opacity: 1 !important;
  -webkit-text-fill-color: currentColor !important;
  word-break: break-word !important;
  overflow-wrap: anywhere !important;
  user-select: text !important;
  pointer-events: auto !important;
  animation: ueh-trans-in 0.2s ease-out !important;
}

.ueh-translated-inline {
  display: inline !important;
  margin: 0 0 0 0.4em !important;
  padding: 0 !important;
  border: none !important;
  background: none !important;
  font: inherit !important;
  letter-spacing: inherit !important;
  color: var(--ueh-trans-color, color-mix(in srgb, currentColor 68%, transparent)) !important;
  -webkit-text-fill-color: currentColor !important;
  opacity: 1 !important;
  user-select: text !important;
  animation: ueh-trans-in 0.2s ease-out !important;
}

/* Translation-only: occupy the original's full type scale so the page looks native. */
body[data-ueh-view-mode="translation_only"] .ueh-translated-block,
body[data-ueh-view-mode="translation_only"] .ueh-translated-inline {
  margin-top: 0 !important;
  margin-left: 0 !important;
  font-size: 1em !important;
  color: inherit !important;
  -webkit-text-fill-color: currentColor !important;
  animation: none !important;
}

/* Quiet skeleton — a faint line in the host's type scale, no "翻译中" chrome. */
.ueh-translated-block.ueh-loading,
.ueh-translated-inline.ueh-loading {
  display: block !important;
  height: 0.72em !important;
  width: var(--ueh-skel-width, 42ch) !important;
  max-width: 72% !important;
  min-width: 8ch !important;
  margin-top: 0.35em !important;
  margin-bottom: 0.05em !important;
  padding: 0 !important;
  border: none !important;
  border-radius: 2px !important;
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  pointer-events: none !important;
  user-select: none !important;
  overflow: hidden !important;
  background: color-mix(in srgb, currentColor 9%, transparent) !important;
  background-image: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in srgb, currentColor 16%, transparent) 50%,
    transparent 100%
  ) !important;
  background-size: 140% 100% !important;
  background-repeat: no-repeat !important;
  animation: ueh-skel-sweep 1.15s ease-in-out infinite !important;
}

.ueh-translated-inline.ueh-loading {
  display: inline-block !important;
  vertical-align: middle !important;
  width: var(--ueh-skel-width, 10ch) !important;
  max-width: 40% !important;
  margin: 0 0 0 0.4em !important;
  height: 0.85em !important;
}

body[data-ueh-view-mode="translation_only"] .ueh-translated-block.ueh-loading,
body[data-ueh-view-mode="translation_only"] .ueh-translated-inline.ueh-loading {
  margin-top: 0.2em !important;
}

@keyframes ueh-trans-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes ueh-skel-sweep {
  0% { background-position: 100% 0; }
  100% { background-position: -40% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .ueh-translated-block,
  .ueh-translated-inline,
  .ueh-translated-block.ueh-loading,
  .ueh-translated-inline.ueh-loading {
    animation: none !important;
  }
}
`;

export const FLOATING_BUTTON_CSS = `
:host {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2147483640;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  user-select: none;
  direction: ltr;
  color-scheme: light dark;
  opacity: 1;
  transition: opacity 0.2s ease, transform 0.2s ease;
}

:host(.ueh-fab-hidden) {
  opacity: 0;
  pointer-events: none;
  transform: translateY(8px);
}

.fab-container {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.fab-pill {
  display: flex;
  align-items: center;
  gap: 0;
  min-width: 40px;
  min-height: 40px;
  padding: 0 10px;
  background: color-mix(in srgb, Canvas 82%, CanvasText 18%);
  color: CanvasText;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
  box-shadow: 0 4px 18px color-mix(in srgb, CanvasText 16%, transparent);
  backdrop-filter: blur(14px) saturate(1.2);
  cursor: pointer;
  transition: background 0.18s ease, box-shadow 0.18s ease, padding 0.18s ease, gap 0.18s ease;
  font-size: 12px;
  font-weight: 550;
  letter-spacing: 0.01em;
}

.fab-pill:hover,
.fab-pill:focus-visible {
  background: color-mix(in srgb, Canvas 70%, CanvasText 30%);
  box-shadow: 0 6px 22px color-mix(in srgb, CanvasText 22%, transparent);
}

.fab-pill.active {
  background: color-mix(in srgb, Canvas 75%, #2563eb 25%);
  border-color: color-mix(in srgb, #2563eb 45%, transparent);
}

.fab-label {
  max-width: 0;
  overflow: hidden;
  opacity: 0;
  white-space: nowrap;
  transition: max-width 0.18s ease, opacity 0.16s ease, margin 0.18s ease;
}

.fab-pill:hover .fab-label,
.fab-pill:focus-visible .fab-label,
.fab-pill.expanded .fab-label {
  max-width: 180px;
  opacity: 0.92;
  margin-left: 8px;
}

.fab-icon {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.fab-icon svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.fab-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid color-mix(in srgb, currentColor 25%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: fab-spin 0.75s linear infinite;
}

@keyframes fab-spin {
  to { transform: rotate(360deg); }
}

.fab-menu {
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, Canvas 88%, CanvasText 12%);
  color: CanvasText;
  border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
  border-radius: 12px;
  padding: 4px;
  box-shadow: 0 10px 32px color-mix(in srgb, CanvasText 22%, transparent);
  backdrop-filter: blur(16px) saturate(1.2);
  min-width: 148px;
  animation: fab-fade-in 0.14s ease-out;
}

@keyframes fab-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.fab-menu-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  border: none;
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  transition: background 0.14s ease;
}

.fab-menu-btn:hover,
.fab-menu-btn:focus-visible {
  background: color-mix(in srgb, CanvasText 8%, transparent);
}

.fab-menu-btn.active {
  background: color-mix(in srgb, #2563eb 22%, transparent);
  font-weight: 600;
}

.fab-menu-divider {
  height: 1px;
  background: color-mix(in srgb, CanvasText 10%, transparent);
  margin: 4px 6px;
}

@media (prefers-reduced-motion: reduce) {
  .fab-pill, .fab-label, .fab-menu, .fab-spinner, :host {
    transition: none !important;
    animation: none !important;
  }
}
`;
