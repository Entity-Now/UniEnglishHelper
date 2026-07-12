/**
 * Permission helpers.
 *
 * chrome.permissions.request() requires a user gesture (Popup / Options /
 * Onboarding button). Never call request() from the service worker after an
 * async message hop.
 */

import { PERMISSIONS_BOOTSTRAP_KEY } from './constants';

/** All host patterns the extension needs for full functionality. */
export const ALL_HOST_ORIGINS: string[] = [
  'http://*/*',
  'https://*/*',
  // Free MT
  'https://translate.googleapis.com/*',
  'https://translate.google.com/*',
  'https://edge.microsoft.com/*',
  'https://api-edge.cognitive.microsofttranslator.com/*',
  'https://api.cognitive.microsofttranslator.com/*',
  'https://api.mymemory.translated.net/*',
  // Edge TTS
  'https://speech.platform.bing.com/*',
];

/** Manifest permissions that are required at install (not host). */
export const REQUIRED_API_PERMISSIONS = [
  'storage',
  'unlimitedStorage',
  'activeTab',
  'tabs',
  'scripting',
  'offscreen',
  'tabCapture',
] as const;

export interface PermissionStatus {
  /** True when broad all-sites host access is available */
  allSites: boolean;
  freeMt: boolean;
  edgeTts: boolean;
  /** Every pattern in ALL_HOST_ORIGINS is granted (or covered by broad grant) */
  complete: boolean;
  missingOrigins: string[];
  bootstrapDone: boolean;
}

export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('devtools://') ||
    url.startsWith('chrome-search://') ||
    url.startsWith('https://chrome.google.com/webstore') ||
    url.startsWith('https://chromewebstore.google.com')
  );
}

export function originPatternFromUrl(url: string): string {
  const origin = new URL(url).origin;
  return `${origin}/*`;
}

/** Check only — never prompts. Safe from SW. */
export async function hasOriginPermission(url: string): Promise<boolean> {
  const origins = [originPatternFromUrl(url)];
  // Broad grant also covers a specific origin
  const broad = await chrome.permissions.contains({
    origins: ['http://*/*', 'https://*/*'],
  });
  if (broad) return true;
  return chrome.permissions.contains({ origins });
}

/**
 * Request host access for a single page. Prefer requestAllPermissions on first run.
 */
export async function requestOriginPermission(url: string): Promise<boolean> {
  const broad = await chrome.permissions.contains({
    origins: ['http://*/*', 'https://*/*'],
  });
  if (broad) return true;
  const origins = [originPatternFromUrl(url)];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

export async function getPermissionStatus(): Promise<PermissionStatus> {
  const missingOrigins: string[] = [];
  for (const origin of ALL_HOST_ORIGINS) {
    const ok = await chrome.permissions.contains({ origins: [origin] });
    if (!ok) {
      // If broad * already covers this host, treat as granted
      const isHttp =
        origin.startsWith('http://') || origin.startsWith('https://');
      if (isHttp && origin.includes('://*/')) {
        missingOrigins.push(origin);
      } else if (isHttp) {
        const scheme = origin.startsWith('https') ? 'https://*/*' : 'http://*/*';
        const broad = await chrome.permissions.contains({ origins: [scheme] });
        if (!broad) missingOrigins.push(origin);
      } else {
        missingOrigins.push(origin);
      }
    }
  }

  // Re-evaluate: broad https://*/* covers all https specific hosts
  const allSites = await chrome.permissions.contains({
    origins: ['http://*/*', 'https://*/*'],
  });

  const freeMtOrigins = [
    'https://translate.googleapis.com/*',
    'https://edge.microsoft.com/*',
    'https://api-edge.cognitive.microsofttranslator.com/*',
    'https://api.mymemory.translated.net/*',
  ];
  let freeMt = allSites;
  if (!freeMt) {
    freeMt = true;
    for (const o of freeMtOrigins) {
      if (!(await chrome.permissions.contains({ origins: [o] }))) {
        freeMt = false;
        break;
      }
    }
  }

  const edgeTts =
    allSites ||
    (await chrome.permissions.contains({
      origins: ['https://speech.platform.bing.com/*'],
    }));

  // complete if allSites (covers everything) OR no missing
  const complete = allSites || missingOrigins.length === 0;

  const stored = await chrome.storage.local.get(PERMISSIONS_BOOTSTRAP_KEY);
  const bootstrapDone = Boolean(stored[PERMISSIONS_BOOTSTRAP_KEY]);

  return {
    allSites,
    freeMt,
    edgeTts,
    complete,
    missingOrigins: complete ? [] : missingOrigins,
    bootstrapDone,
  };
}

export async function setBootstrapDone(done = true): Promise<void> {
  await chrome.storage.local.set({ [PERMISSIONS_BOOTSTRAP_KEY]: done });
}

/**
 * Request every host origin the extension needs.
 * MUST be called from a user gesture (button click).
 */
export async function requestAllPermissions(): Promise<PermissionStatus> {
  // Prefer one broad request first (best UX, covers MT/TTS/video sites)
  const broadOk = await chrome.permissions.request({
    origins: ['http://*/*', 'https://*/*'],
  });

  if (!broadOk) {
    // User denied all-sites — try requesting remaining specific origins
    const status = await getPermissionStatus();
    if (status.missingOrigins.length > 0) {
      await chrome.permissions.request({
        origins: status.missingOrigins,
      });
    }
  }

  // Also request the explicit list (no-ops if already granted via broad)
  try {
    await chrome.permissions.request({ origins: ALL_HOST_ORIGINS });
  } catch {
    // ignore — some patterns may be invalid duplicates
  }

  const finalStatus = await getPermissionStatus();
  if (finalStatus.complete || finalStatus.allSites) {
    await setBootstrapDone(true);
  }
  return getPermissionStatus();
}

/**
 * tabCapture.getMediaStreamId must run in the extension page that received
 * the user gesture (popup).
 */
export function getTabCaptureStreamId(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          reject(
            new Error(
              chrome.runtime.lastError?.message ??
                'Failed to get media stream id',
            ),
          );
          return;
        }
        resolve(streamId);
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export function getOnboardingUrl(): string {
  return chrome.runtime.getURL('src/onboarding/index.html');
}
