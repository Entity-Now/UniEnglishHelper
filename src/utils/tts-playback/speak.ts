import { sendRuntime } from '../../shared/messaging/client';
import {
  isTtsPlaying,
  playTtsAudioChunks,
  stopTtsPlayback,
} from './play-chunks';

export { isTtsPlaying, stopTtsPlayback };

/**
 * Stop all active TTS playback (both DOM Audio chunks and Web Speech API).
 */
export function stopAllSpeech(hostWin: Window = window): void {
  stopTtsPlayback();
  try {
    hostWin.speechSynthesis?.cancel();
  } catch {
    // ignore
  }
  try {
    if (hostWin !== window) window.speechSynthesis?.cancel();
  } catch {
    // ignore
  }
}

/**
 * Unified TTS helper for content scripts, PiP windows, popups, and options pages.
 * Uses Edge TTS `tts.synthChunks` (backed by `tts_cache` without polluting
 * `audio_clips`) when Edge TTS is active, and gracefully falls back to
 * Web Speech API (`speechSynthesis`) when Web Speech is selected or Edge TTS
 * fails/is blocked.
 */
export async function speakTextSmart(
  text: string,
  source: 'content' | 'options' | 'popup' = 'content',
  hostWin: Window = window,
): Promise<boolean> {
  const clean = text.trim();
  if (!clean) return false;

  try {
    const chunksRes = await sendRuntime<{
      mode: string;
      voice: string;
      chunks: Array<{ audioBase64: string; contentType: string }>;
    }>('tts.synthChunks', { text: clean }, source);

    if (chunksRes.ok && chunksRes.data.chunks?.length) {
      stopAllSpeech(hostWin);
      try {
        return await playTtsAudioChunks(chunksRes.data.chunks, hostWin);
      } catch {
        // If DOM Audio playback failed in PiP, try opener window before Web Speech fallback
        if (hostWin !== window) {
          try {
            return await playTtsAudioChunks(chunksRes.data.chunks, window);
          } catch {
            // fall through to Web Speech fallback
          }
        }
      }
    }

    // Query tts.synth when Web Speech is the configured engine (to get its BCP-47 voice tag)
    let webSpeechLang = '';
    if (!chunksRes.ok && chunksRes.error.message.includes('only for Edge TTS')) {
      const res = await sendRuntime<{
        mode: string;
        text?: string;
        voice?: string;
      }>('tts.synth', { text: clean }, source);
      if (res.ok && res.data.mode === 'web-speech' && res.data.voice) {
        webSpeechLang = res.data.voice;
      }
    }

    const synth = hostWin.speechSynthesis ?? globalThis.speechSynthesis;
    if (typeof synth !== 'undefined') {
      const lang =
        webSpeechLang || (/[\u4e00-\u9fff]/.test(clean) ? 'zh-CN' : 'en-US');
      const UtterCtor =
        (hostWin as unknown as typeof globalThis).SpeechSynthesisUtterance ??
        SpeechSynthesisUtterance;
      const u = new UtterCtor(clean);
      u.lang = lang;
      stopAllSpeech(hostWin);
      return await new Promise<boolean>((resolve) => {
        let settled = false;
        const done = (ok: boolean) => {
          if (settled) return;
          settled = true;
          resolve(ok);
        };
        u.onend = () => done(true);
        u.onerror = () => done(false);
        synth.speak(u);
        // Safety guard in case onend never fires on some OS voices
        globalThis.setTimeout(() => done(true), Math.max(4000, clean.length * 140));
      });
    }
  } catch {
    // ignore
  }

  return false;
}
