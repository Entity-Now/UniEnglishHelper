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
  '.ytp-ad-skip-button-slot button',
  '.ytp-ad-skip-button-container',
  'button.ytp-skip-ad-button',
  '.ytp-ad-overlay-close-button',
  'button[id^="skip-button"]',
  'button[class*="skip-button"]',
  '[class*="ytp-ad-skip-button"]',
  '.ytp-ad-text[id^="skip-button"]',
  '.ytp-ad-action-interstitial-slot button',
  'ytd-ad-slot-renderer button',
  '.video-ads button',
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

function isAdElementPresent(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none') return false;
  return true;
}

function findSkipButton(): HTMLElement | null {
  const nodes = document.querySelectorAll(SKIP_SELECTORS);
  for (const node of nodes) {
    if (node instanceof HTMLElement && isAdElementPresent(node)) {
      return node;
    }
  }
  // Text fallback (localized skip labels)
  const candidates = document.querySelectorAll(
    'button, .ytp-ad-skip-button-text, .ytp-ad-text, [role="button"]',
  );
  for (const el of candidates) {
    const text = (el.textContent || '').trim().toLowerCase();
    if (
      !text ||
      !(
        text.includes('skip') ||
        text.includes('跳过') ||
        text.includes('略過') ||
        text.includes('スキップ') ||
        text.includes('passer') ||
        text.includes('überspringen')
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
    if (btn && isAdElementPresent(btn)) return btn;
  }
  return null;
}

export function isYoutubeAdPlaying(): boolean {
  if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(location.hostname)) {
    return false;
  }
  const playerAd = document.querySelector(AD_PLAYER_SELECTORS);
  const overlay = document.querySelector(AD_OVERLAY_SELECTORS);
  const textAd = document.querySelector('.ytp-ad-text, .ytp-ad-preview-container');
  return !!playerAd || (overlay ? isAdElementPresent(overlay) : false) || !!textAd;
}

export function detectYoutubeAdStatus(): YoutubeAdStatus {
  if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(location.hostname)) {
    return { phase: 'none', label: '', canSkip: false };
  }

  const isAd = isYoutubeAdPlaying();
  if (!isAd) {
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
    canSkip: true, // Always allow clicking skip in PiP to trigger fast-forward / API skip
  };
}

/**
 * Click YouTube's native skip control if present, and fast-forward ad video if stuck.
 */
export function trySkipYoutubeAd(): boolean {
  let skipped = false;

  // 1. Try finding and clicking native skip button
  const skip = findSkipButton();
  if (skip) {
    try {
      skip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      skip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      skip.click();
      skip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      skip.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      const nested = skip.querySelector('button');
      if (nested && nested !== skip) nested.click();
      skipped = true;
    } catch (err) {
      console.warn('[UEH] skip click error', err);
    }
  }

  // 2. Try YouTube movie_player internal skip API
  try {
    const moviePlayer = document.getElementById('movie_player') as any;
    if (moviePlayer) {
      if (typeof moviePlayer.skipAd === 'function') {
        moviePlayer.skipAd();
        skipped = true;
      }
      if (typeof moviePlayer.cancelPlayback === 'function' && isYoutubeAdPlaying()) {
        moviePlayer.cancelPlayback();
        skipped = true;
      }
    }
  } catch {}

  // 3. If ad is actively playing on HTML5 video, fast-forward the ad stream to instantly finish it
  if (isYoutubeAdPlaying()) {
    try {
      const video =
        (document.querySelector('#movie_player video') as HTMLVideoElement | null) ||
        (document.querySelector('video.html5-main-video') as HTMLVideoElement | null);
      if (video && Number.isFinite(video.duration) && video.duration > 0) {
        video.muted = true;
        video.currentTime = video.duration || 99999;
        skipped = true;
      }
    } catch {}
  }

  return skipped;
}
