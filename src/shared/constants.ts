export const EXT_NAME = 'UniEnglishHelper';
export const CONFIG_STORAGE_KEY = 'ueh.appConfig';
export const CAPTURE_SESSION_KEY = 'ueh.captureSession';
/** Set after first-run permission bootstrap succeeds */
export const PERMISSIONS_BOOTSTRAP_KEY = 'ueh.permissionsBootstrapDone';
/**
 * Bumped whenever the words table changes (add/update/delete/review).
 * Options/popup pages listen via chrome.storage.onChanged to auto-refresh.
 */
export const WORDS_REVISION_KEY = 'ueh.wordsRevision';

export const PORT_STREAM = 'ueh-stream';
export const PORT_ANCHORS = 'ueh-anchors';
export const PORT_CLIP = 'ueh-clip';
export const PORT_OFFSCREEN = 'ueh-offscreen';

export const CLIP_CHUNK_BYTES = 256 * 1024;
export const BRIDGE_INIT_TYPE = 'ueh.bridge.init';

export const SUPPORTED_PLAYBACK_RATES = [0.75, 1, 1.25] as const;

export const OFFSCREEN_URL = 'src/offscreen/index.html';
export const PIP_BUNDLE_HTML = 'src/pip/index.html';
