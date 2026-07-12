/**
 * Inject + query YouTube MAIN-world player (read-frog style).
 * Uses chrome.scripting.executeScript files/world — never content-script
 * <script> injection (blocked by Trusted Types / CSP on YouTube).
 */

export interface YtCaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  vssId: string;
  name?: string;
}

export interface YtPlayerData {
  videoId: string;
  captionTracks: YtCaptionTrack[];
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

/** Ensure MAIN interceptor is installed (idempotent). */
export async function injectYoutubeMain(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: ['inject/youtube-main.js'],
    });
  } catch (err) {
    console.warn('[UEH] inject youtube-main failed', err);
  }
}

/** One-shot track list extract (also used as fallback). */
function extractTracksOnce(): YtCaptionTrack[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    let pr: any = null;
    try {
      const p =
        document.getElementById('movie_player') ||
        document.querySelector('.html5-video-player');
      if (p && typeof (p as any).getPlayerResponse === 'function') {
        pr = (p as any).getPlayerResponse();
      }
    } catch {
      // ignore
    }
    if (!pr) pr = w.ytInitialPlayerResponse || null;
    if (!pr && w.ytplayer?.config?.args?.player_response) {
      try {
        const raw = w.ytplayer.config.args.player_response;
        pr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        // ignore
      }
    }
    const tracks =
      pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    return (tracks as any[]).map((t) => ({
      baseUrl: String(t.baseUrl || '').startsWith('http')
        ? String(t.baseUrl)
        : t.baseUrl
          ? `${location.origin}${t.baseUrl}`
          : '',
      languageCode: String(t.languageCode || ''),
      kind: t.kind ? String(t.kind) : undefined,
      vssId: String(t.vssId || ''),
      name: String(t.name?.simpleText || t.name || ''),
    }));
  } catch {
    return [];
  }
}

export async function extractYoutubeCaptionTracks(
  tabId: number,
): Promise<YtCaptionTrack[]> {
  await injectYoutubeMain(tabId);
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: extractTracksOnce,
    });
    const value = results?.[0]?.result;
    return Array.isArray(value) ? value : [];
  } catch (err) {
    console.warn('[UEH] MAIN track extract failed', err);
    return [];
  }
}

/**
 * Ask MAIN interceptor for full player data via injected postMessage bridge.
 * Falls back to one-shot extractTracksOnce if bridge not ready.
 */
export async function getYoutubePlayerData(
  tabId: number,
  expectedVideoId: string,
): Promise<YtPlayerData | null> {
  await injectYoutubeMain(tabId);

  // Run a MAIN-world function that uses the same API as the interceptor
  // (works even if postMessage bridge isn't used).
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (videoId: string) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const w = window as any;
          const player =
            document.querySelector(
              '#reel-overlay-container .html5-video-player',
            ) ||
            document.querySelector(
              '.html5-video-player.playing-mode, .html5-video-player.paused-mode',
            ) ||
            document.querySelector('.html5-video-player') ||
            document.getElementById('movie_player');

          let pr: any = null;
          try {
            if (player && typeof (player as any).getPlayerResponse === 'function') {
              pr = (player as any).getPlayerResponse();
            }
          } catch {
            // ignore
          }
          if (!pr) pr = w.ytInitialPlayerResponse || null;

          const vid = pr?.videoDetails?.videoId || videoId;
          const tracksRaw =
            pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
            [];
          const captionTracks = (tracksRaw as any[]).map((t) => ({
            baseUrl: String(t.baseUrl || '').includes('://')
              ? String(t.baseUrl)
              : t.baseUrl
                ? `${location.origin}${t.baseUrl}`
                : '',
            languageCode: String(t.languageCode || ''),
            kind: t.kind ? String(t.kind) : undefined,
            vssId: String(t.vssId || ''),
            name: String(t.name?.simpleText || t.name || ''),
          }));

          let selectedTrackLanguageCode: string | null = null;
          let selectedTrackVssId: string | null = null;
          try {
            const sel = (player as any)?.getOption?.('captions', 'track');
            selectedTrackLanguageCode = sel?.languageCode ?? null;
            selectedTrackVssId = sel?.vssId || sel?.vss_id || null;
          } catch {
            // ignore
          }

          let audioCaptionTracks: any[] = [];
          try {
            const at = (player as any)?.getAudioTrack?.();
            audioCaptionTracks = (at?.captionTracks || []).flatMap(
              (t: any) => {
                try {
                  return [
                    {
                      url: t.url,
                      vssId: t.vssId,
                      kind: t.kind,
                      languageCode:
                        new URL(t.url).searchParams.get('lang') || undefined,
                    },
                  ];
                } catch {
                  return [];
                }
              },
            );
          } catch {
            // ignore
          }

          let device: string | null = null;
          try {
            device = w.ytcfg?.get?.('DEVICE') ?? null;
          } catch {
            // ignore
          }

          let cver: string | null = null;
          try {
            cver =
              (player as any)?.getWebPlayerContextConfig?.()
                ?.innertubeContextClientVersion ?? null;
          } catch {
            // ignore
          }

          let playerState = -1;
          try {
            playerState = (player as any)?.getPlayerState?.() ?? -1;
          } catch {
            // ignore
          }

          return {
            videoId: vid,
            captionTracks,
            audioCaptionTracks,
            device,
            cver,
            playerState,
            selectedTrackLanguageCode,
            selectedTrackVssId,
            cachedTimedtextUrl: null,
          };
        } catch {
          return null;
        }
      },
      args: [expectedVideoId],
    });
    return (results?.[0]?.result as YtPlayerData | null) ?? null;
  } catch (err) {
    console.warn('[UEH] getYoutubePlayerData failed', err);
    return null;
  }
}

/** Fetch caption body from SW (avoids page CORS edge cases). */
export async function fetchCaptionText(url: string): Promise<string> {
  const res = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    headers: {
      Accept: '*/*',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const text = await res.text();
  if (!text?.trim()) {
    throw new Error('Empty body');
  }
  return text;
}
