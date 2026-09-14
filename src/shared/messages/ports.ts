import {
  PORT_ANCHORS,
  PORT_CLIP,
  PORT_OFFSCREEN,
  PORT_STREAM,
} from '../constants';

export const PortNames = {
  stream: PORT_STREAM,
  anchors: PORT_ANCHORS,
  clip: PORT_CLIP,
  offscreen: PORT_OFFSCREEN,
} as const;

export type PortName = (typeof PortNames)[keyof typeof PortNames];

export type ClipPortClientMessage = {
  type: 'clips.getBlobChunks';
  requestId: string;
  clipId: number;
};

export type ClipPortServerMessage =
  | {
      type: 'clips.blobChunk';
      requestId: string;
      clipId: number;
      index: number;
      total: number;
      bytes: ArrayBuffer;
    }
  | {
      type: 'clips.blobEnd';
      requestId: string;
      clipId: number;
      mimeType: string;
      byteLength: number;
      sha256?: string;
    }
  | {
      type: 'clips.blobError';
      requestId: string;
      clipId: number;
      code: string;
      message: string;
    };

export type StreamPortClientMessage =
  | {
      type: 'word.explain';
      requestId: string;
      word: string;
      surface?: string;
      context?: string;
      forceLlm?: boolean;
      timeoutMs?: number;
      id?: number;
    };

export type StreamPortServerMessage =
  | {
      type: 'chunk';
      requestId: string;
      chunk: string;
      accumulated: string;
    }
  | {
      type: 'done';
      requestId: string;
      result: any;
    }
  | {
      type: 'error';
      requestId: string;
      code: string;
      message: string;
    };

