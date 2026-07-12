import type {
  AppConfig,
  CaptureState,
  MediaTimelineSample,
  PipMode,
  ReviewResult,
  SkillRecordInput,
  SubtitleCue,
  WordCreate,
  WordQuery,
} from '../domain/types';
import type { Envelope } from './envelope';

export type RuntimeRequest =
  | Envelope<'sys.ping', Record<string, never>>
  | Envelope<'config.get', Record<string, never>>
  | Envelope<'config.set', Partial<AppConfig>>
  | Envelope<'pip.open', { tabId: number }>
  | Envelope<'pip.close', { tabId: number }>
  | Envelope<'capture.arm', { tabId: number; streamId?: string }>
  | Envelope<'capture.stop', { sessionId: string }>
  | Envelope<'capture.status', { tabId?: number }>
  | Envelope<
      'capture.anchors',
      { sessionId: string; samples: MediaTimelineSample[] }
    >
  | Envelope<
      'capture.live',
      { sessionId: string; tabId: number }
    >
  | Envelope<
      'translate.cues',
      {
        cues: Pick<SubtitleCue, 'id' | 'text'>[];
        src: string;
        dst: string;
        mode: 'mt' | 'llm';
      }
    >
  | Envelope<
      'word.explain',
      { word: string; surface: string; context: string; skillId?: string }
    >
  | Envelope<'word.add', WordCreate>
  | Envelope<'word.list', WordQuery>
  | Envelope<'word.updateReview', { id: number; result: ReviewResult }>
  | Envelope<
      'word.setStatus',
      { id: number; learningStatus: 'new' | 'learning' | 'learned' }
    >
  | Envelope<'word.highlightMap', Record<string, never>>
  | Envelope<'word.delete', { id: number }>
  | Envelope<'skill.list', Record<string, never>>
  | Envelope<'skill.save', SkillRecordInput>
  | Envelope<'skill.delete', { id: string }>
  | Envelope<'skill.resetBuiltin', { id: string }>
  | Envelope<
      'skill.run',
      { skillId: string; text: string; context?: string; stream?: boolean }
    >
  | Envelope<
      'tts.synth',
      {
        text: string;
        voice?: string;
        rate?: string | number;
        pitch?: string | number;
        volume?: string | number;
      }
    >
  | Envelope<
      'tts.synthChunks',
      {
        text: string;
        voice?: string;
        rate?: string | number;
        pitch?: string | number;
        volume?: string | number;
      }
    >
  | Envelope<'tts.health', Record<string, never>>
  | Envelope<'tts.voices', Record<string, never>>
  | Envelope<
      'clips.export',
      { sessionId: string; startMs: number; endMs: number; epoch: number }
    >
  | Envelope<
      'clips.exportResult',
      {
        requestId?: string;
        sessionId: string;
        startMs: number;
        endMs: number;
        epoch: number;
        clipId: number;
        durationMs: number;
        mimeType: string;
      }
    >
  | Envelope<'clips.getMeta', { clipId: number }>
  | Envelope<'cache.clear', { scopes: Array<'translation' | 'tts' | 'clips'> }>
  | Envelope<'diag.export', Record<string, never>>
  | Envelope<'host.ensure', { origin: string }>
  | Envelope<'content.openPip', Record<string, never>>
  | Envelope<'content.captureLive', { sessionId: string }>
  | Envelope<'content.captureStop', { sessionId: string }>
  | Envelope<'stats.dashboard', Record<string, never>>
  | Envelope<'translate.ensureFreeMt', { provider?: string }>
  | Envelope<'youtube.captionTracks', Record<string, never>>
  | Envelope<'youtube.playerData', { videoId: string }>
  | Envelope<'youtube.fetchCaption', { url: string }>
  | Envelope<'youtube.injectMain', Record<string, never>>;

export type RuntimeType = RuntimeRequest['type'];
