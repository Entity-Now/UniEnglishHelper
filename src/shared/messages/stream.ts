import type { ErrorCode } from './errors';

export type StreamFrame =
  | { type: 'stream.start'; requestId: string; jobId: string }
  | { type: 'stream.chunk'; requestId: string; jobId: string; text: string }
  | { type: 'stream.end'; requestId: string; jobId: string }
  | {
      type: 'stream.error';
      requestId: string;
      jobId: string;
      code: ErrorCode;
      message: string;
    }
  | { type: 'stream.abort'; requestId: string; jobId: string };
