/**
 * Detect YouTube ad playback and skip-button availability on the host page.
 * PiP mirrors the main video, so ad UI lives on the tab player chrome.
 */

export type YoutubeAdPhase = 'none' | 'ad' | 'ad_skippable';

export interface YoutubeAdStatus {
  phase: YoutubeAdPhase;
  /** Human label for PiP banner */
  label: string;
  /** True when a clickable skip control exists on the page */
  canSkip: boolean;
}

const SKIP_SELECTORS = [
  '.ytp-ad-skip-button',
  '.ytp-ad-skip-button-modern',
  '.ytp-skip-ad-button',
  'button.ytp-ad-skip-button-modern',
  '.ytp-ad-skip-button-container button',
  '.ytp-ad-skip-button-container',
  'button.ytp-skip-ad-button',
  '.ytp-ad-overlay-close-button',
].join(', ');

const AD_PLAYER_SELECTORS = [
  '.html5-video-player.ad-showing',
  '.html5-video-player.ad-interrupting',
  'ytd-player .ad-showing',
  '#movie_player.ad-showing',
  '#movie_player.ad-interrupting',
].join(', ');

const AD_OVERLAY_SELECTORS = [
  '.video-ads.ytp-ad-module',
  '.ytp-ad-player-overlay',
  '.ytp-ad-player-overlay-layout',
  '.ytp-ad-image-overlay',
  'div.ytp-ad-module',
].join(', ');

function isVisible(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findSkipButton(): HTMLElement | null {
  const nodes = document.querySelectorAll(SKIP_SELECTORS);
  for (const node of nodes) {
    if (isVisible(node)) return node as HTMLElement;
  }
  // Text fallback (localized skip labels)
  const candidates = document.querySelectorAll(
    'button, .ytp-ad-skip-button-text, .ytp-ad-text',
  );
  for (const el of candidates) {
    const text = (el.textContent || '').trim().toLowerCase();
    if (
      !text ||
      !(
        text.includes('skip') ||
        text.includes('跳过') ||
        text.includes('略過') ||
        text.includes('スキップ')
      )
    ) {
      continue;
    }
    const btn =
      el.closest('button') ||
      (el instanceof HTMLElement && el.getAttribute('role') === 'button'
        ? el
        : null) ||
      (el instanceof HTMLElement ? el : null);
    if (btn && isVisible(btn)) return btn;
  }
  return null;
}

export function detectYoutubeAdStatus(): YoutubeAdStatus {
  if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(location.hostname)) {
    return { phase: 'none', label: '', canSkip: false };
  }

  const playerAd = document.querySelector(AD_PLAYER_SELECTORS);
  const overlay = document.querySelector(AD_OVERLAY_SELECTORS);
  const hasAdChrome =
    !!playerAd ||
    (overlay ? isVisible(overlay) : false) ||
    !!document.querySelector('.ytp-ad-text, .ytp-ad-preview-container');

  if (!hasAdChrome) {
    return { phase: 'none', label: '', canSkip: false };
  }

  const skip = findSkipButton();
  if (skip) {
    return {
      phase: 'ad_skippable',
      label: '广告可跳过',
      canSkip: true,
    };
  }

  return {
    phase: 'ad',
    label: '广告播放中',
    canSkip: false,
  };
}

/** Click YouTube's native skip control if present. */
export function trySkipYoutubeAd(): boolean {
  const skip = findSkipButton();
  if (!skip) return false;
  try {
    skip.click();
    // Some UIs need a nested click
    const nested = skip.querySelector('button');
    if (nested && nested !== skip) nested.click();
    return true;
  } catch {
    return false;
  }
}
