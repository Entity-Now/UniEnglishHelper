/**
 * Edge TTS module (ported from read-frog server/edge-tts).
 * HTTP + signed endpoint path with circuit breaker, chunking, voices.
 */

export {
  synthesizeEdgeTTS,
  listEdgeTTSVoices,
  getEdgeTTSHealthStatus,
} from './api';
export * from './chunk';
export * from './signature';
export * from './ssml';
export * from './token';
export * from './types';
export {
  filterEdgeTTSVoicesByLocale,
  clearEdgeTTSVoicesCache,
} from './voices';
export * from './browser';
export * from './circuit-breaker';
export * from './errors';
export * from './constants';
export {
  synthesizeEdgeTTSChunkWithRetry,
  combineEdgeTTSAudioChunks,
} from './synthesize';
