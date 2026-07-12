import type { CaptureState, PipSessionState, SubtitleCue } from '../domain/types';

export type BridgeMessage =
  | { type: 'bridge.hello'; payload: { role: 'content' | 'pip'; token: string } }
  | {
      type: 'pip.subtitleCue';
      payload: {
        cue: SubtitleCue | null;
        neighbors?: SubtitleCue[];
        translation?: string;
      };
    }
  | {
      type: 'pip.subtitleProgress';
      payload: { mediaTimeMs: number; cueId?: string };
    }
  | {
      type: 'pip.playbackState';
      payload: {
        mediaTimeMs: number;
        paused: boolean;
        rate: number;
        captureState: CaptureState;
        sessionId?: string;
        epoch: number;
      };
    }
  | { type: 'pip.command.playPause'; payload: Record<string, never> }
  | { type: 'pip.command.seek'; payload: { mediaTimeMs: number } }
  | { type: 'pip.command.setRate'; payload: { rate: number } }
  | { type: 'pip.ui.translateRequest'; payload: { cueId: string } }
  | {
      type: 'pip.ui.explainWord';
      payload: { surface: string; context: string };
    }
  | {
      type: 'pip.ui.addWord';
      payload: {
        surface: string;
        context: string;
        translation?: string;
        cueStartMs?: number;
        cueEndMs?: number;
      };
    }
  | { type: 'pip.ui.exportClip'; payload: Record<string, never> }
  | { type: 'pip.ui.playClip'; payload: { clipId: number } }
  | { type: 'pip.ui.stopClip'; payload: Record<string, never> }
  | {
      type: 'pip.clipPlayState';
      payload: {
        clipId: number;
        state: 'loading' | 'playing' | 'ended' | 'error';
        message?: string;
      };
    }
  | { type: 'pip.ui.tts'; payload: { text: string } }
  | {
      type: 'pip.ui.runSkill';
      payload: { skillId: string; text: string };
    }
  | {
      type: 'pip.toast';
      payload: { level: 'info' | 'warn' | 'error'; message: string };
    }
  | {
      type: 'pip.sessionState';
      payload: { state: PipSessionState; mode?: 'move' | 'mirror' };
    }
  | {
      type: 'pip.explainResult';
      payload: { surface: string; text: string };
    }
  | {
      type: 'pip.exportResult';
      payload: { clipId: number; durationMs: number };
    };
