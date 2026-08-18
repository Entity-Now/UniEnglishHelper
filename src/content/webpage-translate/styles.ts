/**
 * Styles for in-page translated text and the floating translation button.
 */

export const WEBPAGE_TRANSLATION_INJECTED_CSS = `
/* Webpage translated text styling - clean, non-disruptive & inherited from host */
.ueh-translated-block {
  display: block !important;
  margin-top: 0.25em !important;
  margin-bottom: 0.25em !important;
  padding: 0 !important;
  color: var(--ueh-trans-color, inherit) !important;
  background: transparent !important;
  border: none !important;
  border-radius: 0 !important;
  font-family: inherit !important;
  font-size: var(--ueh-trans-font-size, 0.88em) !important;
  font-weight: normal !important;
  font-style: normal !important;
  line-height: inherit !important;
  text-align: inherit !important;
  letter-spacing: normal !important;
  opacity: var(--ueh-trans-opacity, 0.78) !important;
  user-select: text !important;
  word-break: break-word !important;
  box-sizing: border-box !important;
  transition: opacity 0.2s ease, transform 0.2s ease !important;
}

.ueh-translated-inline {
  display: inline-block !important;
  margin-left: 0.35em !important;
  color: var(--ueh-trans-color, inherit) !important;
  background: transparent !important;
  font-family: inherit !important;
  font-size: var(--ueh-trans-font-size, 0.88em) !important;
  font-weight: normal !important;
  font-style: normal !important;
  text-align: inherit !important;
  opacity: var(--ueh-trans-opacity, 0.78) !important;
}

/* Loading Animation - High visibility, theme-adaptive & responsive */
.ueh-translated-block.ueh-loading {
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  margin-top: 0.25em !important;
  margin-bottom: 0.25em !important;
  padding: 2px 8px !important;
  border-radius: 4px !important;
  background: color-mix(in srgb, currentColor 7%, transparent) !important;
  border: 1px dashed color-mix(in srgb, currentColor 22%, transparent) !important;
  color: var(--ueh-trans-color, inherit) !important;
  opacity: 0.82 !important;
  pointer-events: none !important;
  font-size: var(--ueh-trans-font-size, 0.85em) !important;
  line-height: 1.4 !important;
  box-sizing: border-box !important;
  width: fit-content !important;
}

.ueh-loading-bar {
  display: inline-block !important;
  width: 24px !important;
  height: 5px !important;
  border-radius: 3px !important;
  background: color-mix(in srgb, currentColor 20%, transparent) !important;
  position: relative !important;
  overflow: hidden !important;
  vertical-align: middle !important;
}

.ueh-loading-bar::after {
  content: '' !important;
  position: absolute !important;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, currentColor 60%, transparent),
    transparent
  ) !important;
  animation: ueh-shimmer-sweep 1.2s infinite !important;
}

@keyframes ueh-shimmer-sweep {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

.ueh-loading-dots {
  display: inline-flex !important;
  align-items: center !important;
  gap: 3px !important;
}

.ueh-loading-dot {
  display: inline-block !important;
  width: 4px !important;
  height: 4px !important;
  border-radius: 50% !important;
  background-color: currentColor !important;
  animation: ueh-dot-bounce 1.2s infinite ease-in-out both !important;
}

.ueh-loading-dot:nth-child(1) {
  animation-delay: -0.32s !important;
}
.ueh-loading-dot:nth-child(2) {
  animation-delay: -0.16s !important;
}
.ueh-loading-dot:nth-child(3) {
  animation-delay: 0s !important;
}

@keyframes ueh-dot-bounce {
  0%,
  80%,
  100% {
    transform: scale(0.6);
    opacity: 0.3;
  }
  40% {
    transform: scale(1.15);
    opacity: 1;
  }
}

.ueh-loading-text {
  font-size: 0.88em !important;
  opacity: 0.8 !important;
  user-select: none !important;
}

/* Hide original text in translation-only mode */
.ueh-hide-original {
  display: none !important;
}

body[data-ueh-view-mode="translation_only"] .ueh-translated-block {
  font-size: inherit !important;
  color: inherit !important;
  opacity: 1 !important;
  margin-top: 0 !important;
}

/* Hide translated text when toggled to original view */
body[data-ueh-view-mode="original"] .ueh-translated-block,
body[data-ueh-view-mode="original"] .ueh-translated-inline {
  display: none !important;
}
`;

export const FLOATING_BUTTON_CSS = `
:host {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 2147483640;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  user-select: none;
  direction: ltr;
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
  gap: 6px;
  background: #1e293b;
  color: #f8fafc;
  padding: 7px 12px;
  border-radius: 24px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.24), 0 1px 4px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.12);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  font-size: 13px;
  font-weight: 500;
}

.fab-pill:hover {
  background: #334155;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.32);
  transform: translateY(-1px);
}

.fab-pill.active {
  background: #2563eb;
  border-color: #3b82f6;
}

.fab-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fab-icon svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.fab-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: fab-spin 0.8s linear infinite;
}

@keyframes fab-spin {
  to {
    transform: rotate(360deg);
  }
}

.fab-menu {
  display: flex;
  flex-direction: column;
  background: #0f172a;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  padding: 6px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.38);
  min-width: 150px;
  animation: fab-fade-in 0.15s ease-out;
}

@keyframes fab-fade-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.fab-menu-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  background: transparent;
  color: #e2e8f0;
  border: none;
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  transition: background 0.15s ease;
}

.fab-menu-btn:hover {
  background: #1e293b;
  color: #ffffff;
}

.fab-menu-btn.active {
  background: #2563eb;
  color: #ffffff;
  font-weight: 600;
}

.fab-menu-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 4px 2px;
}
`;
