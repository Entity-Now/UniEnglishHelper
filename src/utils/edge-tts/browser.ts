import { EDGE_TTS_HTTP_ENABLED } from "./constants"
import { EdgeTTSError } from "./errors"

interface ChromeLike {
  offscreen?: {
    createDocument?: unknown
  }
}

function hasChromeOffscreenApi(): boolean {
  const chromeApi = (globalThis as { chrome?: ChromeLike }).chrome
  return typeof chromeApi?.offscreen?.createDocument === "function"
}

export function isEdgeTTSBrowserSupported(): boolean {
  // Chromium extension contexts (SW / offscreen / pages)
  if (typeof chrome !== "undefined" && chrome.runtime?.id) return true
  if (hasChromeOffscreenApi()) return true
  // Dev / unit tests in Chromium-like environments
  if (typeof WebSocket !== "undefined") return true
  return false
}

export function assertEdgeTTSAvailable(): void {
  if (!EDGE_TTS_HTTP_ENABLED) {
    throw new EdgeTTSError("FEATURE_DISABLED", "Edge TTS HTTP route is disabled by feature flag")
  }

  if (!isEdgeTTSBrowserSupported()) {
    throw new EdgeTTSError(
      "UNSUPPORTED_BROWSER",
      "Edge TTS is not supported in this environment",
    )
  }
}
