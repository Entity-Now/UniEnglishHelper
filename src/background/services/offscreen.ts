import { OFFSCREEN_URL } from '../../shared/constants';
import {
  createEnvelope,
  fail,
  type Result,
} from '../../shared/messages';
import { AppError } from '../../shared/messages/errors';

let creating: Promise<void> | null = null;

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts?.({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });
  if (contexts) return contexts.length > 0;
  // fallback older
  return false;
}

export async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  if (creating) {
    await creating;
    return;
  }
  creating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: [
        chrome.offscreen.Reason.USER_MEDIA,
        chrome.offscreen.Reason.AUDIO_PLAYBACK,
      ],
      justification:
        'Capture tab audio with loopback, PCM ring buffer, and clip export for language learning.',
    })
    .catch(async (err) => {
      // already exists race
      if (String(err).includes('Only a single offscreen')) return;
      throw err;
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

export async function sendToOffscreen<T = unknown>(
  type: string,
  payload: unknown,
): Promise<Result<T>> {
  await ensureOffscreen();
  const envelope = createEnvelope({
    channel: 'offscreen',
    type,
    source: 'background',
    payload,
  });
  try {
    const res = (await chrome.runtime.sendMessage(envelope)) as Result<T>;
    if (res && typeof res === 'object' && 'ok' in res) return res;
    return fail('OFFSCREEN_FAILED', 'Invalid offscreen response');
  } catch (err) {
    return fail(
      'OFFSCREEN_FAILED',
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function requireOffscreenOk<T>(
  type: string,
  payload: unknown,
): Promise<T> {
  const res = await sendToOffscreen<T>(type, payload);
  if (!res.ok) {
    throw new AppError(res.error.code, res.error.message, res.error.details);
  }
  return res.data;
}
