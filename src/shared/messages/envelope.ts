import type { ErrorCode } from './errors';

export type MessageSource =
  | 'content'
  | 'background'
  | 'offscreen'
  | 'pip'
  | 'popup'
  | 'options';

export type MessageChannel = 'runtime' | 'offscreen' | 'bridge' | 'stream';

export interface Envelope<T extends string = string, P = unknown> {
  v: 1;
  channel: MessageChannel;
  type: T;
  requestId: string;
  source: MessageSource;
  payload: P;
}

export type Result<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: ErrorCode; message: string; details?: unknown };
    };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail<T = never>(
  code: ErrorCode,
  message: string,
  details?: unknown,
): Result<T> {
  return { ok: false, error: { code, message, details } };
}

export function createEnvelope<T extends string, P>(
  partial: Omit<Envelope<T, P>, 'v' | 'requestId'> & { requestId?: string },
): Envelope<T, P> {
  return {
    v: 1,
    requestId: partial.requestId ?? crypto.randomUUID(),
    channel: partial.channel,
    type: partial.type,
    source: partial.source,
    payload: partial.payload,
  };
}

export function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Envelope;
  return (
    v.v === 1 &&
    typeof v.type === 'string' &&
    typeof v.requestId === 'string' &&
    typeof v.channel === 'string' &&
    typeof v.source === 'string'
  );
}
