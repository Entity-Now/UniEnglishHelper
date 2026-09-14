import { PORT_STREAM } from '../shared/constants';
import type {
  StreamPortClientMessage,
  StreamPortServerMessage,
} from '../shared/messages/ports';
import { sendRuntime } from '../shared/messaging/client';
import type { WordExplainResult } from '../shared/domain/types';

export interface StreamExplainOptions {
  word: string;
  surface?: string;
  context?: string;
  forceLlm?: boolean;
  timeoutMs?: number;
  id?: number;
}

export type StreamChunkCallback = (chunk: string, accumulated: string) => void;

export interface StreamExplainSession {
  promise: Promise<WordExplainResult & { text?: string }>;
  abort: () => void;
}

/**
 * Connect to the background PORT_STREAM port to stream word explanations in real-time.
 * If the port encounters any disconnection or error, it gracefully falls back to sendRuntime.
 */
export function streamWordExplain(
  options: StreamExplainOptions,
  onChunk: StreamChunkCallback,
): StreamExplainSession {
  let finished = false;
  let aborted = false;
  let port: chrome.runtime.Port | null = null;

  const abort = () => {
    if (finished || aborted) return;
    aborted = true;
    try {
      port?.disconnect();
    } catch {
      // ignore
    }
  };

  const promise = new Promise<WordExplainResult & { text?: string }>(
    // eslint-disable-next-line no-async-promise-executor
    async (resolve, reject) => {
      const surface = options.surface ?? options.word;
      const context = options.context ?? '';
      const forceLlm = Boolean(options.forceLlm);

      const runPort = (): Promise<WordExplainResult & { text?: string }> => {
        return new Promise((resPort, rejPort) => {
          try {
            port = chrome.runtime.connect({ name: PORT_STREAM });
          } catch (e) {
            rejPort(e);
            return;
          }

          const requestId = 'req_' + Math.random().toString(36).slice(2);

          port.onDisconnect.addListener(() => {
            if (!finished && !aborted) {
              const err = chrome.runtime.lastError;
              rejPort(new Error(err?.message || 'Port disconnected'));
            }
          });

          port.onMessage.addListener((msg: StreamPortServerMessage) => {
            if (aborted || msg.requestId !== requestId) return;
            if (msg.type === 'chunk') {
              onChunk(msg.chunk, msg.accumulated);
            } else if (msg.type === 'done') {
              finished = true;
              try {
                port?.disconnect();
              } catch {
                // ignore
              }
              resPort(msg.result);
            } else if (msg.type === 'error') {
              finished = true;
              try {
                port?.disconnect();
              } catch {
                // ignore
              }
              rejPort(new Error(msg.message || msg.code));
            }
          });

          port.postMessage({
            type: 'word.explain',
            requestId,
            word: surface,
            surface,
            context,
            forceLlm,
            timeoutMs: options.timeoutMs,
            id: options.id,
          } satisfies StreamPortClientMessage);
        });
      };

      try {
        const result = await runPort();
        if (aborted) return;
        finished = true;
        resolve(result);
      } catch (streamErr) {
        if (aborted) return;
        console.warn(
          '[UEH] streamWordExplain port error, falling back to sendRuntime:',
          streamErr,
        );
        try {
          const res = await sendRuntime<WordExplainResult & { text?: string }>(
            forceLlm ? 'word.retranslate' : 'word.explain',
            { word: surface, surface, context, forceLlm },
            'content',
          );
          if (aborted) return;
          finished = true;
          if (res.ok) {
            const rawText =
              res.data.explanation ||
              res.data.definition ||
              res.data.text ||
              surface;
            onChunk(rawText, rawText);
            resolve(res.data);
          } else {
            reject(new Error(res.error.message));
          }
        } catch (e: any) {
          if (aborted) return;
          finished = true;
          reject(e);
        }
      }
    },
  );

  return { promise, abort };
}
