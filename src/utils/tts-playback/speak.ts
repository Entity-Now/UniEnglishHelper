import { sendRuntime } from '../../shared/messaging/client';
import { playTtsAudioChunks, stopTtsPlayback } from './play-chunks';

/**
 * Unified TTS helper for content scripts, popups, and options pages.
 * Uses Edge TTS `tts.synthChunks` (backed by `tts_cache` without polluting
 * `audio_clips`) when Edge TTS is active, and gracefully falls back to
 * Web Speech API (`speechSynthesis`) when Web Speech is selected or Edge TTS
 * is unavailable.
 */
export async function speakTextSmart(
  text: string,
  source: 'content' | 'options' | 'popup' = 'content',
  hostWin: Window = window,
): Promise<boolean> {
  const clean = text.trim();
  if (!clean) return false;

  const chunksRes = await sendRuntime<{
    mode: string;
    voice: string;
    chunks: Array<{ audioBase64: string; contentType: string }>;
  }>('tts.synthChunks', { text: clean }, source);

  if (chunksRes.ok && chunksRes.data.chunks?.length) {
    stopTtsPlayback();
    if (typeof hostWin.speechSynthesis !== 'undefined') {
      hostWin.speechSynthesis.cancel();
    }
    return playTtsAudioChunks(chunksRes.data.chunks);
  }

  // Only query tts.synth when Web Speech is the configured engine (to get its BCP-47 voice tag)
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
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = lang;
    stopTtsPlayback();
    synth.cancel();
    synth.speak(u);
    return true;
  }

  return false;
}
