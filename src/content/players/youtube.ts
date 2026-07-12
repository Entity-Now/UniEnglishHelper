/**
 * YouTube subtitles — read-frog style, without page <script> injection
 * (Trusted Types / CSP block that). MAIN world via background scripting.
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
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class YoutubeAdapter extends BasePlayerAdapter {
  readonly id = 'youtube';
  readonly supportsMove = false;
  private cachedCues: SubtitleCue[] | null = null;
  private cacheKey: string | null = null;

  findVideo(): HTMLVideoElement | null {
    return document.querySelector(
      'video.html5-main-video, ytd-player video, #movie_player video, video',
    );
  }

  async getCues(): Promise<SubtitleCue[]> {
    const videoId = extractYoutubeVideoId();
    if (!videoId) return this.readTextTracks();

    try {
      // Ask background to inject MAIN + return player data / tracks
      let playerData = await this.fetchPlayerData(videoId);
      if (!playerData?.captionTracks?.length) {
        for (let i = 0; i < 10; i++) {
          await sleep(350);
          playerData = await this.fetchPlayerData(videoId);
          if (playerData?.captionTracks?.length) break;
        }
      }

      // Fallback: tracks-only API
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
        return this.readTextTracks();
      }

      const track = selectTrack(playerData);
      if (!track?.baseUrl) return this.readTextTracks();

      const key = `${videoId}:${track.languageCode}:${track.kind ?? ''}:${track.vssId}`;
      if (this.cacheKey === key && this.cachedCues?.length) {
        return this.cachedCues;
      }

      const urls = buildFetchUrls(track, playerData);
      let events: TimedEvent[] | null = null;
      let lastErr = '';
      for (const url of urls) {
        try {
          const text = await fetchCaptionViaBg(url);
          events = parseCaptionPayload(text);
          if (events?.length) break;
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
        }
      }

      if (!events?.length) {
        console.warn('[UEH] caption fetch empty', lastErr);
        return this.readTextTracks();
      }

      const cues = eventsToCues(events, videoId);
      if (cues.length) {
        this.cachedCues = cues;
        this.cacheKey = key;
      }
      return cues.length ? cues : this.readTextTracks();
    } catch (err) {
      console.warn('[UEH] YouTube getCues failed', err);
      return this.readTextTracks();
    }
  }

  private async fetchPlayerData(videoId: string): Promise<PlayerData | null> {
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

async function fetchCaptionViaBg(url: string): Promise<string> {
  // Prefer SW fetch (extension origin often works better with YT)
  const res = await sendRuntime<{ text: string }>(
    'youtube.fetchCaption',
    { url },
    'content',
  );
  if (res.ok && res.data.text?.trim()) return res.data.text;

  // Page-context fallback
  const r = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  if (!text?.trim()) throw new Error('Empty body');
  return text;
}

function selectTrack(playerData: PlayerData): CaptionTrack | null {
  const tracks = playerData.captionTracks;
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
  const humanExact = tracks.find((t) => t.kind !== 'asr' && !t.name);
  if (humanExact) return humanExact;
  const human = tracks.find((t) => t.kind !== 'asr');
  if (human) return human;
  const asrEn = tracks.find(
    (t) => t.kind === 'asr' && t.languageCode.toLowerCase().startsWith('en'),
  );
  if (asrEn) return asrEn;
  return tracks.find((t) => t.kind === 'asr') || tracks[0];
}

function extractPot(
  track: CaptionTrack,
  playerData: PlayerData,
): { pot: string | null; potc: string | null } {
  for (const t of playerData.audioCaptionTracks) {
    if (
      t.vssId === track.vssId ||
      t.languageCode === track.languageCode ||
      true
    ) {
      try {
        const u = new URL(t.url);
        const pot = u.searchParams.get('pot');
        const potc = u.searchParams.get('potc');
        if (pot) return { pot, potc };
      } catch {
        // continue
      }
    }
  }
  if (playerData.cachedTimedtextUrl) {
    try {
      const u = new URL(playerData.cachedTimedtextUrl);
      return {
        pot: u.searchParams.get('pot'),
        potc: u.searchParams.get('potc'),
      };
    } catch {
      // ignore
    }
  }
  return { pot: null, potc: null };
}

/** Build candidate URLs like read-frog (with pot) + plain baseUrl variants. */
function buildFetchUrls(track: CaptionTrack, playerData: PlayerData): string[] {
  const pot = extractPot(track, playerData);
  const urls: string[] = [];

  const withParams = (fmt: string, usePot: boolean) => {
    try {
      const url = new URL(track.baseUrl);
      url.searchParams.set('fmt', fmt);
      url.searchParams.set('xorb', '2');
      url.searchParams.set('xobt', '3');
      url.searchParams.set('xovt', '3');
      url.searchParams.set('c', 'WEB');
      url.searchParams.set('cplayer', 'UNIPLAYER');
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

  // Prefer pot+json3, then without pot, then other fmts, then raw baseUrl
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

  // srv3 xml
  if (t.includes('<text')) {
    const events: TimedEvent[] = [];
    const re =
      /<text\b[^>]*\bstart="([^"]+)"[^>]*\bdur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/gi;
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
    return events;
  }

  // vtt → pseudo events
  if (t.includes('-->')) {
    const events: TimedEvent[] = [];
    const blocks = t.replace(/^WEBVTT[^\n]*\n/, '').split(/\n\n+/);
    for (const block of blocks) {
      const lines = block.trim().split(/\n/);
      const timeLine = lines.find((l) => l.includes('-->'));
      if (!timeLine) continue;
      const m = timeLine.match(
        /([\d:.]+)\s*-->\s*([\d:.]+)/,
      );
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
  if (p.length === 3) return Math.round((p[0] * 3600 + p[1] * 60 + p[2]) * 1000);
  if (p.length === 2) return Math.round((p[0] * 60 + p[1]) * 1000);
  return 0;
}

function eventsToCues(events: TimedEvent[], prefix: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let idx = 0;
  for (const ev of events) {
    if (ev.tStartMs == null) continue;
    const text = cleanText((ev.segs ?? []).map((s) => s.utf8 || '').join(''));
    if (!text) continue;
    if (ev.aAppend === 1 && text.length < 2) continue;
    // strip noise brackets
    const cleaned = text
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) continue;

    const startMs = ev.tStartMs;
    const endMs = startMs + (ev.dDurationMs ?? 2000);
    const prev = cues[cues.length - 1];
    if (
      prev &&
      startMs - prev.endMs < 50 &&
      prev.text.length + cleaned.length < 90 &&
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
    if (next && cues[i].endMs > next.startMs) cues[i].endMs = next.startMs;
    if (cues[i].endMs <= cues[i].startMs) {
      cues[i].endMs = cues[i].startMs + 800;
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
    if (shorts) return shorts[1];
    const embed = u.pathname.match(/\/embed\/([^/?]+)/);
    if (embed) return embed[1];
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
