import type { CaptureState, MediaTimelineSample } from '../../shared/domain/types';
import { CAPTURE_SESSION_KEY } from '../../shared/constants';
import { AppError } from '../../shared/messages/errors';
import { createEnvelope } from '../../shared/messages';
import { getConfig } from './config';
import { ensureOffscreen, requireOffscreenOk, sendToOffscreen } from './offscreen';

export interface CaptureSession {
  sessionId: string;
  tabId: number;
  state: CaptureState;
  startedAt: number;
  errorMessage?: string;
  loopbackOk?: boolean;
}

async function saveSession(session: CaptureSession | null) {
  if (!session) {
    await chrome.storage.session.remove(CAPTURE_SESSION_KEY);
    return;
  }
  await chrome.storage.session.set({ [CAPTURE_SESSION_KEY]: session });
}

export async function getSession(): Promise<CaptureSession | null> {
  const data = await chrome.storage.session.get(CAPTURE_SESSION_KEY);
  return (data[CAPTURE_SESSION_KEY] as CaptureSession | undefined) ?? null;
}

export async function getCaptureStatus(tabId?: number) {
  const session = await getSession();
  if (!session) {
    return { state: 'CaptureIdle' as CaptureState, sessionId: undefined, loopbackOk: undefined };
  }
  if (tabId !== undefined && session.tabId !== tabId) {
    return {
      state: session.state,
      sessionId: session.sessionId,
      loopbackOk: session.loopbackOk,
      tabId: session.tabId,
    };
  }
  return {
    state: session.state,
    sessionId: session.sessionId,
    loopbackOk: session.loopbackOk,
    tabId: session.tabId,
  };
}

/**
 * @param streamId Prefer streamId obtained in Popup during user gesture.
 *                 SW-side getMediaStreamId often fails with "user gesture" errors.
 */
export async function armCapture(
  tabId: number,
  streamIdFromPopup?: string,
): Promise<{ sessionId: string }> {
  const config = await getConfig();
  if (!config.features.enableTabCapture) {
    throw new AppError('CONFIG_INVALID', 'Tab capture is disabled in settings');
  }

  const existing = await getSession();
  if (existing && existing.state === 'CaptureLive') {
    if (existing.tabId === tabId) {
      return { sessionId: existing.sessionId };
    }
    throw new AppError('CAPTURE_ACTIVE', 'Another tab capture session is active');
  }

  const sessionId = crypto.randomUUID();
  const arming: CaptureSession = {
    sessionId,
    tabId,
    state: 'CaptureArming',
    startedAt: Date.now(),
  };
  await saveSession(arming);

  try {
    await ensureOffscreen();

    // Avoid concurrent captures
    const captured = await new Promise<chrome.tabCapture.CaptureInfo[]>(
      (resolve) => {
        chrome.tabCapture.getCapturedTabs((tabs) => resolve(tabs ?? []));
      },
    );
    if (captured.some((t) => t.tabId === tabId && t.status === 'active')) {
      throw new AppError('CAPTURE_ACTIVE', 'Tab is already being captured');
    }

    let streamId = streamIdFromPopup?.trim() || '';
    if (!streamId) {
      // Fallback — often fails outside user gesture; prefer Popup-provided id
      streamId = await new Promise<string>((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
          if (chrome.runtime.lastError || !id) {
            reject(
              new AppError(
                'NOT_INVOKED',
                chrome.runtime.lastError?.message ??
                  'Failed to get media stream id. Use Start capture from the popup.',
              ),
            );
            return;
          }
          resolve(id);
        });
      });
    }

    const init = await requireOffscreenOk<{ loopbackOk: boolean; suspended?: boolean }>(
      'offscreen.capture.initStream',
      { streamId, sessionId, tabId },
    );

    const live: CaptureSession = {
      sessionId,
      tabId,
      state: 'CaptureLive',
      startedAt: Date.now(),
      loopbackOk: init.loopbackOk,
    };
    await saveSession(live);

    // Notify content to start anchors
    try {
      await chrome.tabs.sendMessage(
        tabId,
        createEnvelope({
          channel: 'runtime',
          type: 'content.captureLive',
          source: 'background',
          payload: { sessionId },
        }),
      );
    } catch {
      // content may not be ready; user can still open PiP later
    }

    return { sessionId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await saveSession({
      sessionId,
      tabId,
      state: 'CaptureError',
      startedAt: Date.now(),
      errorMessage: message,
    });
    throw err;
  }
}

export async function stopCapture(sessionId: string): Promise<void> {
  const session = await getSession();
  const tabId = session?.tabId;
  if (!session || session.sessionId !== sessionId) {
    await sendToOffscreen('offscreen.capture.stop', { sessionId });
    await saveSession(null);
    return;
  }
  await sendToOffscreen('offscreen.capture.stop', { sessionId });
  await saveSession(null);

  if (tabId != null) {
    try {
      await chrome.tabs.sendMessage(
        tabId,
        createEnvelope({
          channel: 'runtime',
          type: 'content.captureStop',
          source: 'background',
          payload: { sessionId },
        }),
      );
    } catch {
      // tab may be closed
    }
  }
}

export async function forwardAnchors(
  sessionId: string,
  samples: MediaTimelineSample[],
): Promise<{ accepted: number }> {
  const session = await getSession();
  if (!session || session.sessionId !== sessionId || session.state !== 'CaptureLive') {
    return { accepted: 0 };
  }
  const res = await sendToOffscreen<{ accepted: number }>(
    'offscreen.timeline.anchors',
    { sessionId, samples },
  );
  if (!res.ok) return { accepted: 0 };
  return res.data;
}

export async function exportClip(input: {
  sessionId: string;
  startMs: number;
  endMs: number;
  epoch: number;
}): Promise<{ clipId: number; durationMs: number; mimeType: string }> {
  return requireOffscreenOk('offscreen.clips.export', input);
}
