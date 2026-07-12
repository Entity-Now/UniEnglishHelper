import { CLIP_CHUNK_BYTES } from '../../shared/constants';
import { getClipBlob, getClipMeta } from '../../db';
import type {
  ClipPortClientMessage,
  ClipPortServerMessage,
} from '../../shared/messages/ports';

export async function handleClipPort(
  port: chrome.runtime.Port,
  msg: ClipPortClientMessage,
): Promise<void> {
  const { requestId, clipId } = msg;
  try {
    const clip = await getClipBlob(clipId);
    if (!clip?.blob) {
      port.postMessage({
        type: 'clips.blobError',
        requestId,
        clipId,
        code: 'DB_ERROR',
        message: 'Clip not found',
      } satisfies ClipPortServerMessage);
      return;
    }

    const buffer = await clip.blob.arrayBuffer();
    const total = Math.max(1, Math.ceil(buffer.byteLength / CLIP_CHUNK_BYTES));
    for (let index = 0; index < total; index++) {
      const start = index * CLIP_CHUNK_BYTES;
      const end = Math.min(buffer.byteLength, start + CLIP_CHUNK_BYTES);
      const bytes = buffer.slice(start, end);
      port.postMessage({
        type: 'clips.blobChunk',
        requestId,
        clipId,
        index,
        total,
        bytes,
      } satisfies ClipPortServerMessage);
    }
    port.postMessage({
      type: 'clips.blobEnd',
      requestId,
      clipId,
      mimeType: clip.mimeType,
      byteLength: buffer.byteLength,
    } satisfies ClipPortServerMessage);
  } catch (err) {
    port.postMessage({
      type: 'clips.blobError',
      requestId,
      clipId,
      code: 'DB_ERROR',
      message: err instanceof Error ? err.message : String(err),
    } satisfies ClipPortServerMessage);
  }
}

export { getClipMeta };
