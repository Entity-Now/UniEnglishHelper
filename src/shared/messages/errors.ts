export type ErrorCode =
  | 'UNKNOWN'
  | 'INVALID_MESSAGE'
  | 'UNAUTHORIZED_SENDER'
  | 'UNSUPPORTED_TYPE'
  | 'NOT_INVOKED'
  | 'STREAM_ID_EXPIRED'
  | 'CAPTURE_ACTIVE'
  | 'NO_AUDIO_TRACK'
  | 'AUDIO_CONTEXT_SUSPENDED'
  | 'TAB_MISMATCH'
  | 'OFFSCREEN_FAILED'
  | 'CLIP_NOT_IN_RING'
  | 'CLIP_RATE_UNSUPPORTED'
  | 'CLIP_TOO_LONG'
  | 'CLIP_EPOCH_MISMATCH'
  | 'PIP_UNSUPPORTED'
  | 'PIP_OPEN_FAILED'
  | 'VIDEO_NOT_FOUND'
  | 'MOVE_FAILED'
  | 'BRIDGE_AUTH_FAILED'
  | 'TRANSLATE_FAILED'
  | 'TTS_FAILED'
  | 'AI_FAILED'
  | 'AI_ABORTED'
  | 'RATE_LIMITED'
  | 'CONFIG_INVALID'
  | 'DB_ERROR'
  | 'PAYLOAD_TOO_LARGE'
  | 'HOST_NOT_GRANTED';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export function toErrorPayload(err: unknown): {
  code: ErrorCode;
  message: string;
  details?: unknown;
} {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof Error) {
    return { code: 'UNKNOWN', message: err.message };
  }
  return { code: 'UNKNOWN', message: String(err) };
}
