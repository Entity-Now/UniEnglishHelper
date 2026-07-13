/**
 * YouTube subtitles — MAIN-world bridge (read-frog style).
 *
 * Critical: timedtext requires page cookies + often a `pot` token captured from
 * the player's own network calls. Service-worker fetch alone is unreliable.
 */
import type { SubtitleCue } from '../../shared/domain/types';
import { sendRuntime } from '../../shared/messaging/client';
import { BasePlayerAdapter } from './base';

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  vssId: string;
  name?: string;
}

interface PlayerData {
  videoId: string;
  captionTracks: CaptionTrack[];
  audioCaptionTracks: Array<{
    url: string;
    vssId: string;
    kind?: string;
    languageCode?: string;
  }>;
  device: string | null;
  cver: string | null;
  playerState: number;
  selectedTrackLanguageCode: string | null;
  selectedTrackVssId: string | null;
  cachedTimedtextUrl: string | null;
}

interface TimedEvent {
  tStartMs: number;
  dDurationMs?: number;
  aAppend?: number;
  segs?: Array<{ utf8: string; tOffsetMs?: number }>;
  wWinId?: number;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function newRequestId(): string {
  return `ueh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * postMessage bridge to public/inject/youtube-main.js (MAIN world).
 */
function mainWorldRequest<T extends Record<string, unknown>>(
  requestType: string,
  responseType: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 8000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = newRequestId();
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMsg);
      reject(new Error(`MAIN bridge timeout: ${requestType}`));
    }, timeoutMs);

    function onMsg(event: MessageEvent) {
      if (event.source !== window) return;
      if (event.origin !== window.location.origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.requestId !== requestId) return;
      if (data.type !== responseType) return;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      resolve(data as T);
    }

    window.addEventListener('message', onMsg);
    window.postMessage(
      { type: requestType, requestId, ...payload },
      window.location.origin,
    );
  });
}

async function ensureMainInjected(): Promise<void> {
  // Background injects via chrome.scripting (CSP-safe). Best-effort.
  await sendRuntime('youtube.injectMain', {}, 'content').catch(() => undefined);
  // Give the IIFE a tick to install listeners
  await sleep(30);
}

export class YoutubeAdapter extends BasePlayerAdapter {
  readonly id = 'youtube';
  readonly supportsMove = false;
  private cachedCues: SubtitleCue[] | null = null;
  private cacheKey: string | null = null;
  /** When true, next getCues ignores in-memory cache (e.g. after ad ends). */
  private forceRefresh = false;

  findVideo(): HTMLVideoElement | null {
    return document.querySelector(
      'video.html5-main-video, ytd-player video, #movie_player video, video',
    );
  }

  /** Drop cache when SPA navigates to another video or ad ends. */
  clearCache(): void {
    this.cachedCues = null;
    this.cacheKey = null;
    this.forceRefresh = true;
  }

  async getCues(): Promise<SubtitleCue[]> {
    const videoId = extractYoutubeVideoId();
    if (!videoId) return this.readTextTracks();

    // Invalidate if video changed
    if (this.cacheKey && !this.cacheKey.startsWith(`${videoId}:`)) {
      this.clearCache();
    }

    try {
      await ensureMainInjected();

      // 1) Turn captions on so YT issues timedtext (with pot)
      await mainWorldRequest(
        'UEH_ENSURE_SUBTITLES',
        'UEH_ENSURE_SUBTITLES_DONE',
        {},
        3000,
      ).catch(() => undefined);

      // 2) Player data + tracks (retry for SPA)
      let playerData = await this.fetchPlayerData(videoId);
      if (!playerData?.captionTracks?.length) {
        for (let i = 0; i < 12; i++) {
          await sleep(400);
          // Re-ensure captions periodically
          if (i === 3 || i === 7) {
            await mainWorldRequest(
              'UEH_ENSURE_SUBTITLES',
              'UEH_ENSURE_SUBTITLES_DONE',
              {},
              2000,
            ).catch(() => undefined);
          }
          playerData = await this.fetchPlayerData(videoId);
          if (playerData?.captionTracks?.length) break;
        }
      }

      // 3) BG one-shot MAIN extract fallback
      if (!playerData?.captionTracks?.length) {
        const tr = await sendRuntime<{ tracks: CaptionTrack[] }>(
          'youtube.captionTracks',
          {},
          'content',
        );
        if (tr.ok && tr.data.tracks?.length) {
          playerData = {
            videoId,
            captionTracks: tr.data.tracks,
            audioCaptionTracks: [],
            device: null,
            cver: null,
            playerState: -1,
            selectedTrackLanguageCode: null,
            selectedTrackVssId: null,
            cachedTimedtextUrl: null,
          };
        }
      }

      if (!playerData?.captionTracks?.length) {
        console.warn('[UEH] No caption tracks on player response');
        return this.readTextTracks();
      }

      const track = selectTrack(playerData);
      if (!track?.baseUrl) {
        console.warn('[UEH] No usable caption track baseUrl');
        return this.readTextTracks();
      }

      const key = `${videoId}:${track.languageCode}:${track.kind ?? ''}:${track.vssId}`;
      if (
        !this.forceRefresh &&
        this.cacheKey === key &&
        this.cachedCues?.length
      ) {
        return this.cachedCues;
      }

      // 4) Wait for pot-bearing timedtext URL from YT network (must match main video)
      let liveTimedtext = filterTimedtextForVideo(
        playerData.cachedTimedtextUrl,
        videoId,
      );
      if (!liveTimedtext || !liveTimedtext.includes('pot=')) {
        const waited = await mainWorldRequest<{ url?: string | null }>(
          'UEH_WAIT_TIMEDTEXT',
          'UEH_TIMEDTEXT_READY',
          { videoId, timeoutMs: 6500 },
          7000,
        ).catch(() => null);
        const waitedUrl = filterTimedtextForVideo(waited?.url ?? null, videoId);
        if (waitedUrl) liveTimedtext = waitedUrl;
      }

      const urls = buildFetchUrls(track, playerData, liveTimedtext);
      let events: TimedEvent[] | null = null;
      let lastErr = '';

      for (const url of urls) {
        try {
          const text = await fetchCaptionMulti(url);
          events = parseCaptionPayload(text);
          if (events?.length) break;
          if (text?.trim()) {
            lastErr = `parsed 0 events (${text.slice(0, 40)}…)`;
          }
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
        }
      }

      if (!events?.length) {
        console.warn('[UEH] caption fetch empty', lastErr, {
          tracks: playerData.captionTracks.length,
          track: track.languageCode,
          hasPotUrl: Boolean(liveTimedtext?.includes('pot=')),
        });
        return this.readTextTracks();
      }

      const cues = eventsToCues(events, videoId);
      if (cues.length) {
        this.cachedCues = cues;
        this.cacheKey = key;
        this.forceRefresh = false;
        console.info('[UEH] YouTube cues loaded', cues.length, track.languageCode);
      }
      return cues.length ? cues : this.readTextTracks();
    } catch (err) {
      console.warn('[UEH] YouTube getCues failed', err);
      return this.readTextTracks();
    }
  }

  private async fetchPlayerData(videoId: string): Promise<PlayerData | null> {
    // Prefer page postMessage bridge (has timedtext cache)
    try {
      const resp = await mainWorldRequest<{
        success?: boolean;
        data?: PlayerData;
        error?: string;
      }>('UEH_GET_PLAYER_DATA', 'UEH_PLAYER_DATA', { expectedVideoId: videoId }, 5000);
      if (resp.success && resp.data) return resp.data;
    } catch {
      // fall through
    }

    // Background executeScript fallback
    const res = await sendRuntime<{ data: PlayerData | null }>(
      'youtube.playerData',
      { videoId },
      'content',
    );
    if (!res.ok) return null;
    return res.data.data;
  }

  private readTextTracks(): SubtitleCue[] {
    const video = this.findVideo();
    if (!video?.textTracks) return [];
    const cues: SubtitleCue[] = [];
    for (let i = 0; i < video.textTracks.length; i++) {
      const tt = video.textTracks[i];
      try {
        tt.mode = 'hidden';
      } catch {
        // ignore
      }
      const list = tt.cues;
      if (!list?.length) continue;
      for (let j = 0; j < list.length; j++) {
        const c = list[j] as VTTCue;
        cues.push({
          id: `yt-tt-${i}-${j}`,
          startMs: Math.round(c.startTime * 1000),
          endMs: Math.round(c.endTime * 1000),
          text: cleanText(c.text),
        });
      }
      if (cues.length) break;
    }
    return cues;
  }
}

/**
 * Fetch caption body: MAIN page context → content page fetch → SW.
 */
async function fetchCaptionMulti(url: string): Promise<string> {
  // 1) MAIN world (best cookies)
  try {
    const r = await mainWorldRequest<{
      ok?: boolean;
      text?: string;
      error?: string;
    }>('UEH_FETCH_CAPTION', 'UEH_FETCH_CAPTION_DONE', { url }, 12000);
    if (r.ok && r.text?.trim()) return r.text;
  } catch {
    // continue
  }

  // 2) Content script (youtube.com origin)
  try {
    const r = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      mode: 'cors',
    });
    if (r.ok) {
      const text = await r.text();
      if (text?.trim()) return text;
    }
  } catch {
    // continue
  }

  // 3) Service worker
  const res = await sendRuntime<{ text: string }>(
    'youtube.fetchCaption',
    { url },
    'content',
  );
  if (res.ok && res.data.text?.trim()) return res.data.text;
  throw new Error(
    res.ok ? 'Empty caption body' : res.error?.message || 'fetch failed',
  );
}

function selectTrack(playerData: PlayerData): CaptionTrack | null {
  const tracks = playerData.captionTracks.filter((t) => t.baseUrl);
  if (!tracks.length) return null;

  if (playerData.selectedTrackVssId) {
    const t = tracks.find((x) => x.vssId === playerData.selectedTrackVssId);
    if (t) return t;
  }
  if (playerData.selectedTrackLanguageCode) {
    const t = tracks.find(
      (x) => x.languageCode === playerData.selectedTrackLanguageCode,
    );
    if (t) return t;
  }

  // Prefer human English, then any human, then English ASR, then any ASR
  const isAsr = (t: CaptionTrack) =>
    t.kind === 'asr' || (t.vssId || '').includes('.asr') || (t.vssId || '').startsWith('a.');

  const humanEn = tracks.find(
    (t) =>
      !isAsr(t) &&
      (t.languageCode || '').toLowerCase().startsWith('en'),
  );
  if (humanEn) return humanEn;

  const human = tracks.find((t) => !isAsr(t));
  if (human) return human;

  const asrEn = tracks.find(
    (t) =>
      isAsr(t) && (t.languageCode || '').toLowerCase().startsWith('en'),
  );
  if (asrEn) return asrEn;

  return tracks[0] ?? null;
}

function extractPot(
  track: CaptionTrack,
  playerData: PlayerData,
  liveTimedtext: string | null,
): { pot: string | null; potc: string | null } {
  const tryUrl = (raw: string | null | undefined) => {
    if (!raw) return null;
    try {
      const u = new URL(raw);
      const pot = u.searchParams.get('pot');
      if (!pot) return null;
      return { pot, potc: u.searchParams.get('potc') };
    } catch {
      return null;
    }
  };

  // Prefer live network URL with pot
  const fromLive = tryUrl(liveTimedtext);
  if (fromLive) return fromLive;

  // Matching audio caption track
  for (const t of playerData.audioCaptionTracks) {
    if (
      t.vssId === track.vssId ||
      (t.languageCode && t.languageCode === track.languageCode)
    ) {
      const hit = tryUrl(t.url);
      if (hit) return hit;
    }
  }
  // Any audio caption pot
  for (const t of playerData.audioCaptionTracks) {
    const hit = tryUrl(t.url);
    if (hit) return hit;
  }

  const fromCache = tryUrl(playerData.cachedTimedtextUrl);
  if (fromCache) return fromCache;

  return { pot: null, potc: null };
}

/**
 * Accept a network timedtext URL only if it belongs to the main video.
 * Rejects ad timedtext (different `v` / `video_id`) so we never cache ad cues
 * under the main video's track key.
 *
 * - Matching v=videoId → accept
 * - Explicit other video id → reject (ads)
 * - No video id (pot-only) → accept as pot carrier (baseUrl still from main track)
 */
export function filterTimedtextForVideo(
  url: string | null | undefined,
  videoId: string,
): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, typeof location !== 'undefined' ? location.href : 'https://www.youtube.com');
    const v =
      u.searchParams.get('v') || u.searchParams.get('video_id') || null;
    if (v && v !== videoId) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Build candidate URLs: live timedtext first, then pot variants, then plain. */
function buildFetchUrls(
  track: CaptionTrack,
  playerData: PlayerData,
  liveTimedtext: string | null,
): string[] {
  const pot = extractPot(track, playerData, liveTimedtext);
  const urls: string[] = [];

  if (liveTimedtext) {
    urls.push(liveTimedtext);
    // Also force json3 on the live URL
    try {
      const u = new URL(liveTimedtext);
      u.searchParams.set('fmt', 'json3');
      urls.push(u.toString());
    } catch {
      // ignore
    }
  }

  const withParams = (fmt: string, usePot: boolean) => {
    try {
      const url = new URL(track.baseUrl);
      url.searchParams.set('fmt', fmt);
      url.searchParams.set('xorb', '2');
      url.searchParams.set('xobt', '3');
      url.searchParams.set('xovt', '3');
      if (!url.searchParams.get('c')) url.searchParams.set('c', 'WEB');
      if (playerData.cver) url.searchParams.set('cver', playerData.cver);
      if (playerData.device) {
        const dp = new URLSearchParams(playerData.device);
        for (const k of [
          'cbrand',
          'cbr',
          'cbrver',
          'cos',
          'cosver',
          'cplatform',
        ]) {
          const v = dp.get(k);
          if (v) url.searchParams.set(k, v);
        }
      }
      if (usePot && pot.pot) {
        url.searchParams.set('pot', pot.pot);
        if (pot.potc) url.searchParams.set('potc', pot.potc);
      }
      return url.toString();
    } catch {
      return track.baseUrl;
    }
  };

  for (const fmt of ['json3', 'srv3', 'vtt']) {
    if (pot.pot) urls.push(withParams(fmt, true));
    urls.push(withParams(fmt, false));
  }
  urls.push(track.baseUrl);
  return [...new Set(urls)];
}

function parseCaptionPayload(text: string): TimedEvent[] {
  const t = text.trim();
  if (!t) return [];

  if (t.startsWith('{')) {
    try {
      const data = JSON.parse(t) as { events?: TimedEvent[] };
      return Array.isArray(data.events) ? data.events : [];
    } catch {
      return [];
    }
  }

  // srv3 / xml
  if (t.includes('<text') || t.includes('<p ')) {
    const events: TimedEvent[] = [];
    // classic srv3
    const re =
      /<text\b[^>]*\bstart="([^"]+)"[^>]*\b(?:dur|d)="([^"]+)"[^>]*>([\s\S]*?)<\/text>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const start = Math.round(parseFloat(m[1]) * 1000);
      const dur = Math.round(parseFloat(m[2]) * 1000);
      const utf8 = cleanText(
        m[3]
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/<br\s*\/?>/gi, ' '),
      );
      if (!utf8) continue;
      events.push({
        tStartMs: start,
        dDurationMs: Number.isFinite(dur) ? dur : 2000,
        segs: [{ utf8 }],
      });
    }
    if (events.length) return events;

    // srv3 p-tags (t= ms)
    const pre =
      /<p\b[^>]*\bt="(\d+)"[^>]*(?:\bd="(\d+)")?[^>]*>([\s\S]*?)<\/p>/gi;
    while ((m = pre.exec(t))) {
      const start = parseInt(m[1], 10);
      const dur = m[2] ? parseInt(m[2], 10) : 2000;
      const utf8 = cleanText(
        m[3]
          .replace(/<[^>]+>/g, ' ')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&'),
      );
      if (!utf8) continue;
      events.push({
        tStartMs: start,
        dDurationMs: dur,
        segs: [{ utf8 }],
      });
    }
    return events;
  }

  // vtt
  if (t.includes('-->')) {
    const events: TimedEvent[] = [];
    const blocks = t.replace(/^WEBVTT[^\n]*\n/, '').split(/\n\n+/);
    for (const block of blocks) {
      const lines = block.trim().split(/\n/);
      const timeLine = lines.find((l) => l.includes('-->'));
      if (!timeLine) continue;
      const m = timeLine.match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
      if (!m) continue;
      const startMs = vttTime(m[1]);
      const endMs = vttTime(m[2]);
      const utf8 = cleanText(
        lines.filter((l) => l !== timeLine && !/^\d+$/.test(l)).join(' '),
      );
      if (!utf8) continue;
      events.push({
        tStartMs: startMs,
        dDurationMs: Math.max(400, endMs - startMs),
        segs: [{ utf8 }],
      });
    }
    return events;
  }

  return [];
}

function vttTime(ts: string): number {
  const p = ts.trim().replace(',', '.').split(':').map(Number);
  if (p.length === 3)
    return Math.round((p[0]! * 3600 + p[1]! * 60 + p[2]!) * 1000);
  if (p.length === 2) return Math.round((p[0]! * 60 + p[1]!) * 1000);
  return 0;
}

function eventsToCues(events: TimedEvent[], prefix: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let idx = 0;
  for (const ev of events) {
    if (ev.tStartMs == null) continue;
    // json3 window markers without segs — skip
    if (!ev.segs?.length && !ev.dDurationMs) continue;

    const text = cleanText((ev.segs ?? []).map((s) => s.utf8 || '').join(''));
    if (!text) continue;
    if (ev.aAppend === 1 && text.length < 2) continue;

    // Keep light cleanup; do NOT strip all parentheses (kills valid lyrics/ASR)
    const cleaned = text
      .replace(/\[(?:Music|Applause|Laughter|Silence)\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) continue;

    const startMs = ev.tStartMs;
    const endMs = startMs + (ev.dDurationMs ?? 2000);
    const prev = cues[cues.length - 1];
    if (
      prev &&
      startMs - prev.endMs < 50 &&
      prev.text.length + cleaned.length < 100 &&
      !/[.!?。？！]$/.test(prev.text)
    ) {
      prev.text = `${prev.text} ${cleaned}`.trim();
      prev.endMs = Math.max(prev.endMs, endMs);
      continue;
    }
    cues.push({
      id: `${prefix}-${idx++}`,
      startMs,
      endMs: Math.max(endMs, startMs + 500),
      text: cleaned,
    });
  }
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    if (next && cues[i]!.endMs > next.startMs) cues[i]!.endMs = next.startMs;
    if (cues[i]!.endMs <= cues[i]!.startMs) {
      cues[i]!.endMs = cues[i]!.startMs + 800;
    }
  }
  return cues;
}

function cleanText(text: string): string {
  return text
    .replace(/\u200B/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractYoutubeVideoId(href = location.href): string | null {
  try {
    const u = new URL(href);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.split('/').filter(Boolean)[0] ?? null;
    }
    const v = u.searchParams.get('v');
    if (v) return v;
    const shorts = u.pathname.match(/\/shorts\/([^/?]+)/);
    if (shorts) return shorts[1]!;
    const embed = u.pathname.match(/\/embed\/([^/?]+)/);
    if (embed) return embed[1]!;
    const live = u.pathname.match(/\/live\/([^/?]+)/);
    if (live) return live[1]!;
  } catch {
    // ignore
  }
  return null;
}

export function isYoutubeHost(hostname = location.hostname): boolean {
  return (
    hostname === 'www.youtube.com' ||
    hostname === 'youtube.com' ||
    hostname === 'm.youtube.com' ||
    hostname === 'youtu.be' ||
    hostname.endsWith('.youtube.com')
  );
}

export function isYoutubeWatchLikePath(pathname = location.pathname): boolean {
  return (
    pathname === '/watch' ||
    pathname.startsWith('/watch') ||
    pathname.startsWith('/shorts/') ||
    pathname.startsWith('/embed/') ||
    pathname.startsWith('/live/')
  );
}
