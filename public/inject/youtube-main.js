/**
 * MAIN-world YouTube player interceptor (adapted from read-frog inject-player-api).
 * Loaded as an external file (not inline) so extension CSP allows it.
 *
 * Message protocol (page origin):
 *   request:  { type: 'UEH_GET_PLAYER_DATA', requestId, expectedVideoId }
 *   response: { type: 'UEH_PLAYER_DATA', requestId, success, data?, error? }
 *   request:  { type: 'UEH_ENSURE_SUBTITLES', requestId }
 *   response: { type: 'UEH_ENSURE_SUBTITLES_DONE', requestId }
 *   request:  { type: 'UEH_WAIT_TIMEDTEXT', requestId, videoId, timeoutMs? }
 *   response: { type: 'UEH_TIMEDTEXT_READY', requestId, url }
 *   request:  { type: 'UEH_FETCH_CAPTION', requestId, url }
 *   response: { type: 'UEH_FETCH_CAPTION_DONE', requestId, ok, text?, error? }
 */
(function () {
  if (window.__UEH_YT_MAIN_INJECTED__) return;
  window.__UEH_YT_MAIN_INJECTED__ = true;

  var REQ = "UEH_GET_PLAYER_DATA";
  var RES = "UEH_PLAYER_DATA";
  var ENSURE_REQ = "UEH_ENSURE_SUBTITLES";
  var ENSURE_RES = "UEH_ENSURE_SUBTITLES_DONE";
  var WAIT_REQ = "UEH_WAIT_TIMEDTEXT";
  var WAIT_RES = "UEH_TIMEDTEXT_READY";
  var FETCH_REQ = "UEH_FETCH_CAPTION";
  var FETCH_RES = "UEH_FETCH_CAPTION_DONE";

  var timedtextCache = new Map();
  var timedtextWaiters = new Map();

  function isTimedtextUrl(url) {
    if (!url) return false;
    var s = String(url);
    return (
      s.indexOf("api/timedtext") !== -1 ||
      s.indexOf("/timedtext") !== -1 ||
      (s.indexOf("youtube.com") !== -1 && s.indexOf("timedtext") !== -1)
    );
  }

  function cacheTimedtextUrl(url) {
    try {
      if (!isTimedtextUrl(url)) return;
      var u = new URL(url, location.href);
      var videoId =
        u.searchParams.get("v") ||
        u.searchParams.get("video_id") ||
        null;
      // Some URLs only have pot without v — still keep as last good URL
      var pot = u.searchParams.get("pot");
      if (videoId) {
        timedtextCache.set(videoId, u.toString());
        var waiters = timedtextWaiters.get(videoId);
        if (waiters) {
          waiters.forEach(function (fn) {
            fn(u.toString());
          });
          timedtextWaiters.delete(videoId);
        }
      }
      if (pot) {
        timedtextCache.set("__last_with_pot__", u.toString());
      }
      timedtextCache.set("__last__", u.toString());
    } catch (e) {}
  }

  // Observe timedtext XHR for pot tokens (read-frog approach)
  try {
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__ueh_url = url ? String(url) : "";
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var self = this;
      this.addEventListener("load", function () {
        cacheTimedtextUrl(self.responseURL || self.__ueh_url);
      });
      return origSend.apply(this, arguments);
    };
  } catch (e) {}

  // Modern YouTube often uses fetch() for timedtext
  try {
    var origFetch = window.fetch;
    if (typeof origFetch === "function") {
      window.fetch = function (input, init) {
        var reqUrl = "";
        try {
          if (typeof input === "string") reqUrl = input;
          else if (input && input.url) reqUrl = String(input.url);
        } catch (e) {}
        return origFetch.apply(this, arguments).then(function (res) {
          try {
            cacheTimedtextUrl(res && res.url ? res.url : reqUrl);
          } catch (e2) {}
          return res;
        });
      };
    }
  } catch (e) {}

  function findPlayer() {
    var shorts = document.querySelector(
      "#reel-overlay-container .html5-video-player",
    );
    if (shorts) return shorts;
    return (
      document.querySelector(
        ".html5-video-player.playing-mode, .html5-video-player.paused-mode",
      ) ||
      document.querySelector(".html5-video-player") ||
      document.getElementById("movie_player")
    );
  }

  function normalizeTracks(tracks) {
    return (tracks || []).map(function (t) {
      var baseUrl = t.baseUrl || "";
      if (baseUrl && baseUrl.indexOf("://") === -1) {
        baseUrl = location.origin + baseUrl;
      }
      var name = "";
      try {
        if (t.name && typeof t.name === "object") {
          name = t.name.simpleText || t.name.runs && t.name.runs[0] && t.name.runs[0].text || "";
        } else {
          name = String(t.name || "");
        }
      } catch (e) {
        name = "";
      }
      return {
        baseUrl: baseUrl,
        languageCode: t.languageCode || "",
        kind: t.kind,
        vssId: t.vssId || "",
        name: name,
        trackName: t.trackName,
      };
    });
  }

  function parseAudioTracks(tracks) {
    return (tracks || []).flatMap(function (t) {
      try {
        return [
          {
            url: t.url,
            vssId: t.vssId,
            kind: t.kind,
            languageCode: new URL(t.url).searchParams.get("lang") || undefined,
          },
        ];
      } catch (e) {
        return [];
      }
    });
  }

  function getSelectedTrackSnapshot(player, captionTracks) {
    var selected = null;
    try {
      selected = player.getOption && player.getOption("captions", "track");
    } catch (e) {}
    var languageCode = (selected && selected.languageCode) || null;
    var vssId =
      (selected && (selected.vssId || selected.vss_id)) || null;
    if (!vssId && selected && selected.baseUrl) {
      try {
        var u = new URL(selected.baseUrl, location.origin);
        vssId = u.searchParams.get("vssId") || u.searchParams.get("vss_id");
      } catch (e) {}
    }
    if (!vssId && languageCode) {
      var match = captionTracks.find(function (t) {
        return t.languageCode === languageCode;
      });
      if (match) vssId = match.vssId;
    }
    return { languageCode: languageCode, vssId: vssId };
  }

  function getPlayerData(requestId, expectedVideoId) {
    try {
      var player = findPlayer();
      if (!player) {
        return {
          type: RES,
          requestId: requestId,
          success: false,
          error: "PLAYER_NOT_FOUND",
        };
      }
      var playerResponse =
        (player.getPlayerResponse && player.getPlayerResponse()) || null;
      if (!playerResponse && window.ytInitialPlayerResponse) {
        playerResponse = window.ytInitialPlayerResponse;
      }
      // ytplayer config fallback
      if (!playerResponse && window.ytplayer && window.ytplayer.config) {
        try {
          var raw =
            window.ytplayer.config.args &&
            window.ytplayer.config.args.player_response;
          if (raw) {
            playerResponse = typeof raw === "string" ? JSON.parse(raw) : raw;
          }
        } catch (e) {}
      }

      var videoId =
        (playerResponse &&
          playerResponse.videoDetails &&
          playerResponse.videoDetails.videoId) ||
        null;
      var tracks =
        (playerResponse &&
          playerResponse.captions &&
          playerResponse.captions.playerCaptionsTracklistRenderer &&
          playerResponse.captions.playerCaptionsTracklistRenderer
            .captionTracks) ||
        [];
      var captionTracks = normalizeTracks(tracks);
      var selected = getSelectedTrackSnapshot(player, captionTracks);

      // Soft mismatch: still return data if we have tracks (SPA race)
      if (
        expectedVideoId &&
        videoId &&
        videoId !== expectedVideoId &&
        !captionTracks.length
      ) {
        return {
          type: RES,
          requestId: requestId,
          success: false,
          error: "VIDEO_ID_MISMATCH",
        };
      }

      var device = null;
      try {
        device =
          (window.ytcfg && window.ytcfg.get && window.ytcfg.get("DEVICE")) ||
          null;
      } catch (e) {}

      var cver = null;
      try {
        cver =
          (player.getWebPlayerContextConfig &&
            player.getWebPlayerContextConfig()
              .innertubeContextClientVersion) ||
          null;
      } catch (e) {}

      var playerState = -1;
      try {
        playerState =
          (player.getPlayerState && player.getPlayerState()) || -1;
      } catch (e) {}

      var audioTracks = [];
      try {
        var at = player.getAudioTrack && player.getAudioTrack();
        audioTracks = parseAudioTracks(at && at.captionTracks);
      } catch (e) {}

      var cached =
        (videoId && timedtextCache.get(videoId)) ||
        timedtextCache.get("__last_with_pot__") ||
        timedtextCache.get("__last__") ||
        null;

      return {
        type: RES,
        requestId: requestId,
        success: true,
        data: {
          videoId: videoId || expectedVideoId || "",
          captionTracks: captionTracks,
          audioCaptionTracks: audioTracks,
          device: device,
          cver: cver,
          playerState: playerState,
          selectedTrackLanguageCode: selected.languageCode,
          selectedTrackVssId: selected.vssId,
          cachedTimedtextUrl: cached,
        },
      };
    } catch (e) {
      return {
        type: RES,
        requestId: requestId,
        success: false,
        error: String(e && e.message ? e.message : e),
      };
    }
  }

  function ensureSubtitlesEnabled() {
    try {
      var player = findPlayer();
      // Prefer API so YT loads timedtext with pot
      if (player && player.loadModule) {
        try {
          player.loadModule("captions");
        } catch (e) {}
      }
      if (player && player.setOption) {
        try {
          // turn captions on if off
          var track = player.getOption && player.getOption("captions", "track");
          if (!track || !track.languageCode) {
            var list =
              (player.getOption && player.getOption("captions", "tracklist")) ||
              [];
            if (list && list.length) {
              // Prefer English ASR/human, else first
              var pick =
                list.find(function (t) {
                  return (
                    t.languageCode &&
                    String(t.languageCode).toLowerCase().indexOf("en") === 0
                  );
                }) || list[0];
              player.setOption("captions", "track", pick);
            }
          }
        } catch (e2) {}
      }
      var button = document.querySelector(".ytp-subtitles-button");
      if (button && button.getAttribute("aria-pressed") !== "true") {
        if (player && player.toggleSubtitles) {
          player.toggleSubtitles();
        } else if (button.click) {
          button.click();
        }
      }
    } catch (e) {}
  }

  function waitTimedtext(videoId, timeoutMs) {
    var cached =
      (videoId && timedtextCache.get(videoId)) ||
      timedtextCache.get("__last_with_pot__") ||
      null;
    if (cached) return Promise.resolve(cached);
    return new Promise(function (resolve) {
      if (videoId) {
        var list = timedtextWaiters.get(videoId) || [];
        list.push(resolve);
        timedtextWaiters.set(videoId, list);
      }
      setTimeout(function () {
        if (videoId) {
          var cur = timedtextWaiters.get(videoId);
          if (cur) {
            var idx = cur.indexOf(resolve);
            if (idx !== -1) cur.splice(idx, 1);
          }
        }
        resolve(
          (videoId && timedtextCache.get(videoId)) ||
            timedtextCache.get("__last_with_pot__") ||
            timedtextCache.get("__last__") ||
            null,
        );
      }, timeoutMs || 6000);
    });
  }

  function fetchCaptionInPage(url) {
    return fetch(url, {
      credentials: "include",
      cache: "no-store",
      mode: "cors",
      headers: { Accept: "*/*" },
    }).then(function (res) {
      if (!res.ok) {
        throw new Error("HTTP " + res.status);
      }
      return res.text();
    });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    var data = event.data;
    if (!data || !data.type || !data.requestId) return;
    // Only handle our UEH_* protocol
    if (String(data.type).indexOf("UEH_") !== 0) return;

    if (data.type === REQ) {
      var resp = getPlayerData(data.requestId, data.expectedVideoId);
      window.postMessage(resp, window.location.origin);
    }

    if (data.type === ENSURE_REQ) {
      ensureSubtitlesEnabled();
      window.postMessage(
        { type: ENSURE_RES, requestId: data.requestId },
        window.location.origin,
      );
    }

    if (data.type === WAIT_REQ) {
      waitTimedtext(data.videoId, data.timeoutMs || 6000).then(function (url) {
        window.postMessage(
          { type: WAIT_RES, requestId: data.requestId, url: url },
          window.location.origin,
        );
      });
    }

    if (data.type === FETCH_REQ) {
      var fetchUrl = data.url;
      if (!fetchUrl) {
        window.postMessage(
          {
            type: FETCH_RES,
            requestId: data.requestId,
            ok: false,
            error: "Missing url",
          },
          window.location.origin,
        );
        return;
      }
      fetchCaptionInPage(fetchUrl)
        .then(function (text) {
          window.postMessage(
            {
              type: FETCH_RES,
              requestId: data.requestId,
              ok: true,
              text: text,
            },
            window.location.origin,
          );
        })
        .catch(function (err) {
          window.postMessage(
            {
              type: FETCH_RES,
              requestId: data.requestId,
              ok: false,
              error: String(err && err.message ? err.message : err),
            },
            window.location.origin,
          );
        });
    }
  });
})();
