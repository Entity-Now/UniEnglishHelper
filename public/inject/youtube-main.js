/**
 * MAIN-world YouTube player interceptor (adapted from read-frog inject-player-api).
 * Loaded as an external file (not inline) so extension CSP allows it.
 *
 * Message protocol (page origin):
 *   request:  { type: 'UEH_GET_PLAYER_DATA', requestId, expectedVideoId }
 *   response: { type: 'UEH_PLAYER_DATA', requestId, success, data?, error? }
 *   request:  { type: 'UEH_ENSURE_SUBTITLES', requestId }
 *   response: { type: 'UEH_ENSURE_SUBTITLES_DONE', requestId }
 *   request:  { type: 'UEH_WAIT_TIMEDTEXT', requestId, videoId }
 *   response: { type: 'UEH_TIMEDTEXT_READY', requestId, url }
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

  var timedtextCache = new Map();
  var timedtextWaiters = new Map();

  function cacheTimedtextUrl(url) {
    try {
      if (!url || url.indexOf("api/timedtext") === -1) return;
      var u = new URL(url);
      var videoId = u.searchParams.get("v");
      var pot = u.searchParams.get("pot");
      if (!videoId || !pot) return;
      timedtextCache.set(videoId, url);
      var waiters = timedtextWaiters.get(videoId);
      if (waiters) {
        waiters.forEach(function (fn) {
          fn(url);
        });
        timedtextWaiters.delete(videoId);
      }
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
      this.addEventListener("load", function () {
        cacheTimedtextUrl(this.responseURL || this.__ueh_url);
      });
      return origSend.apply(this, arguments);
    };
  } catch (e) {}

  function findPlayer() {
    var shorts = document.querySelector(
      "#reel-overlay-container .html5-video-player",
    );
    if (shorts) return shorts;
    return (
      document.querySelector(
        ".html5-video-player.playing-mode, .html5-video-player.paused-mode",
      ) || document.querySelector(".html5-video-player")
    );
  }

  function normalizeTracks(tracks) {
    return (tracks || []).map(function (t) {
      var baseUrl = t.baseUrl || "";
      if (baseUrl && baseUrl.indexOf("://") === -1) {
        baseUrl = location.origin + baseUrl;
      }
      return {
        baseUrl: baseUrl,
        languageCode: t.languageCode || "",
        kind: t.kind,
        vssId: t.vssId || "",
        name: t.name,
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
      (selected && (selected.vssId || selected.vss_id)) ||
      null;
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

      if (!videoId || (expectedVideoId && videoId !== expectedVideoId)) {
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

      return {
        type: RES,
        requestId: requestId,
        success: true,
        data: {
          videoId: videoId,
          captionTracks: captionTracks,
          audioCaptionTracks: audioTracks,
          device: device,
          cver: cver,
          playerState: playerState,
          selectedTrackLanguageCode: selected.languageCode,
          selectedTrackVssId: selected.vssId,
          cachedTimedtextUrl: timedtextCache.get(videoId) || null,
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
    var button = document.querySelector(".ytp-subtitles-button");
    if (!button) return;
    if (button.getAttribute("aria-pressed") === "true") return;
    var player = findPlayer();
    if (player && player.toggleSubtitles) {
      player.toggleSubtitles();
    } else if (button.click) {
      button.click();
    }
  }

  function waitTimedtext(videoId, timeoutMs) {
    var cached = timedtextCache.get(videoId);
    if (cached) return Promise.resolve(cached);
    return new Promise(function (resolve) {
      var list = timedtextWaiters.get(videoId) || [];
      list.push(resolve);
      timedtextWaiters.set(videoId, list);
      setTimeout(function () {
        var cur = timedtextWaiters.get(videoId);
        if (!cur) return resolve(timedtextCache.get(videoId) || null);
        var idx = cur.indexOf(resolve);
        if (idx !== -1) cur.splice(idx, 1);
        resolve(timedtextCache.get(videoId) || null);
      }, timeoutMs || 5000);
    });
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== window.location.origin) return;
    var data = event.data;
    if (!data || !data.type) return;

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
      waitTimedtext(data.videoId, 5000).then(function (url) {
        window.postMessage(
          { type: WAIT_RES, requestId: data.requestId, url: url },
          window.location.origin,
        );
      });
    }
  });
})();
