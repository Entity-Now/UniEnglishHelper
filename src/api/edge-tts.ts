/**
 * Clean-room Edge Read Aloud TTS client.
 *
 * Protocol notes are derived from public browser network behavior and
 * Microsoft Edge Read Aloud endpoints (not from GPL source trees).
 * Feature is optional and off by default (ToS / stability risk).
 */

import { AppError } from '../shared/messages/errors';

/** Public client token used by Edge Read Aloud (not a user secret). */
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

const EDGE_TTS_WS =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

export interface EdgeTtsOptions {
  text: string;
  /** e.g. en-US-JennyNeural */
  voice?: string;
  /** SSML prosody rate, e.g. +0% / -10% */
  rate?: string;
  /** SSML prosody pitch, e.g. +0Hz / +5Hz / -2Hz */
  pitch?: string;
  /** SSML prosody volume, e.g. +0% / +20% / -10% */
  volume?: string;
  /** Output format chrome-compatible */
  outputFormat?: string;
  timeoutMs?: number;
}

function uuidNoDashes(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSsml(text: string, voice: string, rate: string, pitch: string, volume: string): string {
  const lang = voice.split('-').slice(0, 2).join('-') || 'en-US';
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
    `<voice name='${escapeXml(voice)}'>` +
    `<prosody pitch='${escapeXml(pitch)}' rate='${escapeXml(rate)}' volume='${escapeXml(volume)}'>` +
    `${escapeXml(text)}` +
    `</prosody></voice></speak>`
  );
}

/**
 * Synthesize speech via Edge Read Aloud WebSocket.
 * Returns MP3 audio as Blob.
 */
export async function synthesizeEdgeTts(opts: EdgeTtsOptions): Promise<Blob> {
  const text = opts.text.trim();
  if (!text) throw new AppError('TTS_FAILED', 'Empty text');
  if (text.length > 2000) {
    throw new AppError('TTS_FAILED', 'Text too long for Edge TTS (max 2000)');
  }

  const voice = opts.voice || 'en-US-JennyNeural';
  const rate = opts.rate || '+0%';
  const pitch = opts.pitch || '+0Hz';
  const volume = opts.volume || '+0%';
  const outputFormat =
    opts.outputFormat || 'audio-24khz-48kbitrate-mono-mp3';
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const requestId = uuidNoDashes();
  const connectionId = uuidNoDashes();

  const url =
    `${EDGE_TTS_WS}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&ConnectionId=${connectionId}`;

  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    const chunks: ArrayBuffer[] = [];
    let ws: WebSocket;

    const finishErr = (err: unknown) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        // ignore
      }
      reject(
        err instanceof AppError
          ? err
          : new AppError(
              'TTS_FAILED',
              err instanceof Error ? err.message : String(err),
            ),
      );
    };

    const finishOk = () => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        // ignore
      }
      if (chunks.length === 0) {
        reject(new AppError('TTS_FAILED', 'No audio received from Edge TTS'));
        return;
      }
      resolve(new Blob(chunks, { type: 'audio/mpeg' }));
    };

    const timer = setTimeout(() => {
      finishErr(new AppError('TTS_FAILED', 'Edge TTS timeout'));
    }, timeoutMs);

    try {
      ws = new WebSocket(url);
    } catch (err) {
      clearTimeout(timer);
      finishErr(err);
      return;
    }

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      const configMsg =
        `X-Timestamp:${new Date().toISOString()}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: {
                  sentenceBoundaryEnabled: 'false',
                  wordBoundaryEnabled: 'false',
                },
                outputFormat,
              },
            },
          },
        });

      const ssml = buildSsml(text, voice, rate, pitch, volume);
      const ssmlMsg =
        `X-RequestId:${requestId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${new Date().toISOString()}\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml;

      ws.send(configMsg);
      ws.send(ssmlMsg);
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        // Look for turn end
        if (
          ev.data.includes('Path:turn.end') ||
          ev.data.includes('Path:response')
        ) {
          // turn.end means complete
          if (ev.data.includes('Path:turn.end')) {
            clearTimeout(timer);
            finishOk();
          }
        }
        return;
      }

      // Binary: header + audio. Header is UTF-8 until 2x CRLF after a 2-byte length.
      const buf = ev.data as ArrayBuffer;
      const audio = extractAudioFromBinaryMessage(buf);
      if (audio && audio.byteLength > 0) {
        chunks.push(audio);
      }
    };

    ws.onerror = () => {
      clearTimeout(timer);
      finishErr(new AppError('TTS_FAILED', 'Edge TTS WebSocket error'));
    };

    ws.onclose = () => {
      clearTimeout(timer);
      if (!settled) {
        if (chunks.length > 0) finishOk();
        else finishErr(new AppError('TTS_FAILED', 'Edge TTS closed early'));
      }
    };
  });
}

/**
 * Edge binary frames: 2-byte big-endian header length + header text + audio bytes.
 * Fallback: if no header, treat whole buffer as audio.
 */
export function extractAudioFromBinaryMessage(buf: ArrayBuffer): ArrayBuffer | null {
  if (buf.byteLength < 2) return null;
  const view = new DataView(buf);
  const headerLen = view.getUint16(0, false);
  if (headerLen > 0 && headerLen + 2 < buf.byteLength) {
    const header = new TextDecoder().decode(buf.slice(2, 2 + headerLen));
    if (header.includes('Path:audio')) {
      return buf.slice(2 + headerLen);
    }
    // other binary path — ignore
    return null;
  }
  // Some servers omit length prefix for pure audio
  return buf;
}

/** Common voices for English learning. */
export const EDGE_TTS_VOICES = [
  { id: 'en-US-JennyNeural', label: 'en-US Jenny (F)' },
  { id: 'en-US-GuyNeural', label: 'en-US Guy (M)' },
  { id: 'en-GB-SoniaNeural', label: 'en-GB Sonia (F)' },
  { id: 'en-GB-RyanNeural', label: 'en-GB Ryan (M)' },
  { id: 'en-US-AriaNeural', label: 'en-US Aria (F)' },
] as const;
