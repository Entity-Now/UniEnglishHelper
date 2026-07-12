import type { AppConfig } from '../../shared/domain/types';
import { AppError } from '../../shared/messages/errors';
import { synthesizeEdgeTts } from '../../api/edge-tts';
import {
  getEdgeTTSHealthStatus,
  synthesizeEdgeTTS,
} from '../../utils/edge-tts';
import { splitTextByUtf8Bytes } from '../../utils/edge-tts/chunk';
import { synthesizeEdgeTTSChunkWithRetry } from '../../utils/edge-tts/synthesize';
import { db } from '../../db';
import { simpleKey } from '../../utils/hash';
import { addAudioClip } from '../../db';
import {
  normalizeProsodyToSsml,
  selectTTSVoice,
  toSignedProsody,
  type TTSConfig,
} from '../../types/config/tts';
import type { EdgeTTSSynthesizeRequest } from '../../types/edge-tts';

export type TtsSynthResult =
  | {
      mode: 'web-speech';
      text: string;
      voice: string;
    }
  | {
      mode: 'edge' | 'azure';
      text: string;
      voice: string;
      /** Primary clip for short text / single-chunk audio */
      clipId: number;
      mimeType: string;
      /**
       * When text is split into multiple Edge chunks, each chunk is a separate
       * clip. Play them **sequentially** — do NOT binary-concat MP3 (causes
       * stutter / re-accent glitches at frame boundaries).
       */
      clipIds?: number[];
      contentType?: string;
    };

export interface TtsAudioChunk {
  audioBase64: string;
  contentType: string;
  text: string;
}

export interface TtsSynthesizeChunksResult {
  mode: 'edge';
  voice: string;
  rate: string;
  pitch: string;
  volume: string;
  chunks: TtsAudioChunk[];
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function resolveProsody(tts: AppConfig['tts'], overrides?: {
  rate?: string | number;
  pitch?: string | number;
  volume?: string | number;
}): { rate: string; pitch: string; volume: string } {
  const rate =
    overrides?.rate !== undefined
      ? normalizeProsodyToSsml(overrides.rate, '%', 0)
      : toSignedProsody(Number(tts.rate) || 0, '%');
  const pitch =
    overrides?.pitch !== undefined
      ? normalizeProsodyToSsml(overrides.pitch, 'Hz', 0)
      : toSignedProsody(Number(tts.pitch) || 0, 'Hz');
  const volume =
    overrides?.volume !== undefined
      ? normalizeProsodyToSsml(overrides.volume, '%', 0)
      : toSignedProsody(Number(tts.volume) || 0, '%');
  return { rate, pitch, volume };
}

function resolveVoice(
  tts: AppConfig['tts'],
  text: string,
  voiceOverride?: string,
): string {
  if (voiceOverride?.trim()) return voiceOverride.trim();
  // Lightweight locale hint from source language / text script
  let detected: string | null = null;
  if (/[\u4e00-\u9fff]/.test(text)) detected = 'zh-CN';
  else if (/[\u3040-\u30ff]/.test(text)) detected = 'ja';
  else if (/[\uac00-\ud7af]/.test(text)) detected = 'ko';
  else detected = 'en';

  return selectTTSVoice(
    {
      defaultVoice: tts.defaultVoice || tts.voice || 'en-US-AndrewMultilingualNeural',
      languageVoices: tts.languageVoices ?? {},
    },
    detected,
  );
}

/**
 * Synthesize TTS. Edge path returns clipId(s) for Port playback.
 * Multi-chunk text yields multiple clipIds — play sequentially.
 * Web Speech is played in the page/UI context.
 */
export async function synthTts(
  config: AppConfig,
  text: string,
  voiceOverride?: string,
  rateOverride?: string | number,
  pitchOverride?: string | number,
  volumeOverride?: string | number,
): Promise<TtsSynthResult> {
  if (!text.trim()) {
    throw new AppError('TTS_FAILED', 'Empty text');
  }

  const engine = config.tts.engine ?? 'edge';
  const voice = resolveVoice(config.tts, text, voiceOverride);
  const { rate, pitch, volume } = resolveProsody(config.tts, {
    rate: rateOverride,
    pitch: pitchOverride,
    volume: volumeOverride,
  });

  if (engine === 'edge') {
    if (!config.features.enableEdgeTts) {
      throw new AppError(
        'TTS_FAILED',
        'Edge TTS is disabled. Enable it in 朗读 / TTS settings (unofficial, optional).',
      );
    }
    return synthEdgeSequentialClips(text, voice, rate, pitch, volume);
  }

  if (engine === 'azure') {
    throw new AppError(
      'TTS_FAILED',
      'Azure TTS not configured — use Web Speech or Edge TTS.',
    );
  }

  // Web Speech: map neural voice names to a short BCP-47 lang tag
  const lang =
    voice.match(/^[a-z]{2}-[A-Z]{2}/)?.[0] ??
    (voice.length <= 10 ? voice : 'en-US');

  return {
    mode: 'web-speech',
    text,
    voice: lang,
  };
}

/**
 * Synthesize and return base64 audio chunks (read-frog wire format).
 * Prefer this for options preview / in-page sequential playback.
 */
export async function synthesizeTtsChunks(
  config: AppConfig,
  text: string,
  options?: {
    voice?: string;
    rate?: string | number;
    pitch?: string | number;
    volume?: string | number;
  },
): Promise<TtsSynthesizeChunksResult> {
  if (!text.trim()) {
    throw new AppError('TTS_FAILED', 'Empty text');
  }
  if ((config.tts.engine ?? 'edge') !== 'edge') {
    throw new AppError(
      'TTS_FAILED',
      'synthesizeTtsChunks is only for Edge TTS engine',
    );
  }
  if (!config.features.enableEdgeTts) {
    throw new AppError(
      'TTS_FAILED',
      'Edge TTS is disabled. Enable it in 朗读 / TTS settings.',
    );
  }

  const voice = resolveVoice(config.tts, text, options?.voice);
  const { rate, pitch, volume } = resolveProsody(config.tts, options);
  const textChunks = splitTextByUtf8Bytes(text.trim());
  const chunks: TtsAudioChunk[] = [];

  for (const chunk of textChunks) {
    const audio = await synthesizeOneChunk(chunk, voice, rate, pitch, volume);
    chunks.push({
      audioBase64: arrayBufferToBase64(audio.audio),
      contentType: audio.contentType || 'audio/mpeg',
      text: chunk,
    });
  }

  return { mode: 'edge', voice, rate, pitch, volume, chunks };
}

async function synthesizeOneChunk(
  text: string,
  voice: string,
  rate: string,
  pitch: string,
  volume: string,
): Promise<{ audio: ArrayBuffer; contentType: string }> {
  const key = simpleKey('edge-chunk', voice, rate, pitch, volume, text);
  const cached = await db.tts_cache.where('key').equals(key).first();
  if (cached?.blob) {
    return {
      audio: await cached.blob.arrayBuffer(),
      contentType: cached.mimeType || 'audio/mpeg',
    };
  }

  const request: EdgeTTSSynthesizeRequest = {
    text,
    voice,
    rate,
    pitch,
    volume,
  };

  let audio: ArrayBuffer;
  let contentType = 'audio/mpeg';

  try {
    // Prefer signed HTTP Edge TTS (read-frog path) for a single chunk.
    // Do NOT use multi-chunk combine here — that binary-concats MP3 and glitches.
    const http = await synthesizeEdgeTTSChunkWithRetry(request);
    audio = http.audio;
    contentType = http.contentType || 'audio/mpeg';
  } catch (httpErr) {
    try {
      // Fallback: whole-module synthesize (still one chunk of text)
      const whole = await synthesizeEdgeTTS(request);
      if (!whole.ok) throw new Error(whole.error.message);
      audio = whole.audio;
      contentType = whole.contentType || 'audio/mpeg';
    } catch {
      // Last resort: WebSocket Edge Read Aloud
      const blob = await synthesizeEdgeTts({
        text,
        voice,
        rate,
        pitch,
        volume,
      });
      audio = await blob.arrayBuffer();
      contentType = 'audio/mpeg';
      void httpErr;
    }
  }

  if (!audio || audio.byteLength === 0) {
    throw new AppError('TTS_FAILED', 'Edge TTS returned empty audio data');
  }

  await db.tts_cache.put({
    key,
    blob: new Blob([audio], { type: contentType }),
    mimeType: contentType,
    voice,
    createdAt: Date.now(),
  });
  await trimTtsCache();

  return { audio, contentType };
}

async function synthEdgeSequentialClips(
  text: string,
  voice: string,
  rate: string,
  pitch: string,
  volume: string,
): Promise<TtsSynthResult> {
  const textChunks = splitTextByUtf8Bytes(text.trim());
  const clipIds: number[] = [];
  let mimeType = 'audio/mpeg';

  for (const chunk of textChunks) {
    const { audio, contentType } = await synthesizeOneChunk(
      chunk,
      voice,
      rate,
      pitch,
      volume,
    );
    mimeType = contentType || mimeType;
    const clipId = await addAudioClip({
      blob: new Blob([audio], { type: mimeType }),
      mimeType: mimeType as 'audio/mpeg',
      durationMs: 0,
    });
    clipIds.push(clipId);
  }

  return {
    mode: 'edge',
    text,
    voice,
    clipId: clipIds[0]!,
    clipIds,
    mimeType,
    contentType: mimeType,
  };
}

async function trimTtsCache(): Promise<void> {
  const count = await db.tts_cache.count();
  if (count <= 200) return;
  const old = await db.tts_cache
    .orderBy('createdAt')
    .limit(count - 200)
    .toArray();
  await db.tts_cache.bulkDelete(old.map((r) => r.id!).filter(Boolean));
}

export async function edgeTtsHealth() {
  return getEdgeTTSHealthStatus();
}

export function speakInPage(text: string, lang = 'en-US', rate = 1): void {
  if (typeof speechSynthesis === 'undefined') return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/** Build SSML prosody snapshot from current config for UI display. */
export function ttsProsodyPreview(tts: TTSConfig): {
  rate: string;
  pitch: string;
  volume: string;
} {
  return {
    rate: toSignedProsody(Number(tts.rate) || 0, '%'),
    pitch: toSignedProsody(Number(tts.pitch) || 0, 'Hz'),
    volume: toSignedProsody(Number(tts.volume) || 0, '%'),
  };
}
