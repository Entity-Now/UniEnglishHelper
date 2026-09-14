import type {
  StreamPortClientMessage,
  StreamPortServerMessage,
} from '../../shared/messages/ports';
import { explainWord, formatWordExplainForDisplay } from '../../api/ai-provider';
import { getConfig } from './config';
import { updateWordTranslation, updateWordTranslationBySurface } from '../../db';

export function handleWordStreamPort(port: chrome.runtime.Port): void {
  port.onMessage.addListener(async (msg: StreamPortClientMessage) => {
    if (!msg || msg.type !== 'word.explain') return;
    const { requestId, word, surface, context, forceLlm, timeoutMs, id } = msg;
    const wordSurface = String(surface ?? word ?? '');
    const wordContext = String(context ?? '');

    try {
      port.postMessage({
        type: 'chunk',
        requestId,
        chunk: '',
        accumulated: '',
      } satisfies StreamPortServerMessage);
    } catch {
      return;
    }

    try {
      const config = await getConfig();
      const result = await explainWord(
        config,
        wordSurface,
        wordContext,
        {
          forceLlm: Boolean(forceLlm),
          resetCircuit: Boolean(forceLlm),
          timeoutMs,
          onChunk: (chunk, accumulated) => {
            try {
              port.postMessage({
                type: 'chunk',
                requestId,
                chunk,
                accumulated,
              } satisfies StreamPortServerMessage);
            } catch {
              // Port disconnected
            }
          },
        },
      );

      let updatedWord = null;
      if (id != null) {
        updatedWord = await updateWordTranslation(Number(id), {
          translation: result.definition || undefined,
          contextTranslation: result.contextTranslation,
          explanation: result.explanation,
          explainEngine: result.engine,
          explainProvider: result.provider,
        });
      } else if (wordSurface && forceLlm) {
        updatedWord = await updateWordTranslationBySurface(wordSurface, {
          translation: result.definition || undefined,
          contextTranslation: result.contextTranslation,
          explanation: result.explanation,
          explainEngine: result.engine,
          explainProvider: result.provider,
        });
      }

      const formatted = {
        ...result,
        text: formatWordExplainForDisplay(result),
        word: updatedWord,
      };

      port.postMessage({
        type: 'done',
        requestId,
        result: formatted,
      } satisfies StreamPortServerMessage);
    } catch (err: any) {
      try {
        port.postMessage({
          type: 'error',
          requestId,
          code: 'EXPLAIN_FAILED',
          message: err?.message || String(err),
        } satisfies StreamPortServerMessage);
      } catch {
        // Port disconnected
      }
    }
  });
}
