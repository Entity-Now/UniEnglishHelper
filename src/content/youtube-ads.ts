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

const STRICT_SKIP_SELECTORS = [
  '.ytp-skip-ad-button',
  '.ytp-ad-skip-button-modern',
  '.ytp-ad-skip-button',
  'button.ytp-ad-skip-button-modern',
  '.ytp-ad-skip-button-container button',
  '.ytp-ad-skip-button-slot button',
  'button.ytp-skip-ad-button',
  '.ytp-ad-skip-button-container',
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

/**
 * Checks if an element is strictly a Skip button and NOT an advertiser CTA link
 * like "Learn More", "Visit Advertiser", "Shop Now", etc.
 */
function isStrictSkipButton(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  // Guard against advertiser links / CTAs
  if (el.tagName.toLowerCase() === 'a') return false;
  if (el.getAttribute('href') || el.getAttribute('target') === '_blank') return false;
  if (
    el.closest(
      'a, [href], .ytp-ad-action-interstitial-slot, .ytp-ad-visit-advertiser-button, .ytp-ad-button-icon, ytd-ad-slot-renderer',
    )
  ) {
    return false;
  }

  const text = (el.textContent || '').trim().toLowerCase();
  // Exclude CTA texts
  if (
    text.includes('visit') ||
    text.includes('learn') ||
    text.includes('shop') ||
    text.includes('详情') ||
    text.includes('访问') ||
    text.includes('安装') ||
    text.includes('下载') ||
    text.includes('install') ||
    text.includes('download')
  ) {
    return false;
  }

  // Must match skip selectors OR contain explicit skip keywords
  if (el.matches(STRICT_SKIP_SELECTORS) || el.closest(STRICT_SKIP_SELECTORS)) {
    return isAdElementPresent(el);
  }

  if (
    text.includes('skip') ||
    text.includes('跳过') ||
    text.includes('略過') ||
    text.includes('スキップ') ||
    text.includes('passer') ||
    text.includes('überspringen')
  ) {
    return isAdElementPresent(el);
  }

  return false;
}

function findStrictSkipButton(): HTMLElement | null {
  const nodes = document.querySelectorAll(STRICT_SKIP_SELECTORS);
  for (const node of nodes) {
    if (isStrictSkipButton(node)) {
      return node;
    }
  }

  // Text fallback for buttons only
  const candidates = document.querySelectorAll(
    '.ytp-ad-skip-button-text, .ytp-ad-module button, #movie_player button',
  );
  for (const el of candidates) {
    if (isStrictSkipButton(el)) return el as HTMLElement;
    const parentBtn = el.closest('button');
    if (parentBtn && isStrictSkipButton(parentBtn)) return parentBtn;
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

  const skip = findStrictSkipButton();
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
    canSkip: true, // Always allow user to trigger fast-forward skip
  };
}

/**
 * Safely skip YouTube ads by fast-forwarding the ad video stream and clicking
 * the native skip button without ever triggering advertiser landing pages.
 */
export function trySkipYoutubeAd(): boolean {
  let skipped = false;

  // 1. Fast-forward the ad video stream directly — 100% safe, instantaneous, never redirects to advertiser
  if (isYoutubeAdPlaying()) {
    try {
      const video =
        (document.querySelector('#movie_player video') as HTMLVideoElement | null) ||
        (document.querySelector('video.html5-main-video') as HTMLVideoElement | null) ||
        (document.querySelector('video') as HTMLVideoElement | null);
      if (video) {
        video.muted = true;
        if (Number.isFinite(video.duration) && video.duration > 0) {
          video.currentTime = video.duration - 0.05;
        } else {
          video.currentTime = 99999;
        }
        video.playbackRate = 16;
        skipped = true;
      }
    } catch {}
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

  // 3. If a strict, verified skip button exists, click it safely
  const skip = findStrictSkipButton();
  if (skip) {
    try {
      skip.click();
      skipped = true;
    } catch (err) {
      console.warn('[UEH] skip click error', err);
    }
  }

  return skipped;
}
