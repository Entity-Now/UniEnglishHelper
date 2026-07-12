import {
  createEnvelope,
  fail,
  isEnvelope,
  type Envelope,
  type MessageSource,
  type Result,
} from '../messages';
import { toErrorPayload } from '../messages/errors';

export async function sendRuntime<T = unknown>(
  type: string,
  payload: unknown,
  source: MessageSource,
): Promise<Result<T>> {
  const envelope = createEnvelope({
    channel: 'runtime',
    type,
    source,
    payload,
  });

  try {
    const response = (await chrome.runtime.sendMessage(envelope)) as Result<T>;
    if (response && typeof response === 'object' && 'ok' in response) {
      return response;
    }
    return fail('UNKNOWN', 'Empty or invalid response from background');
  } catch (err) {
    const e = toErrorPayload(err);
    return fail(e.code, e.message, e.details);
  }
}

export function assertOk<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.data;
}

export function parseIncoming(message: unknown): Envelope | null {
  return isEnvelope(message) ? message : null;
}
