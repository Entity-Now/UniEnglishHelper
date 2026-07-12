import type { SubtitleCue } from '../../shared/domain/types';

export interface PlayerAdapter {
  readonly id: string;
  readonly supportsMove: boolean;
  findVideo(): HTMLVideoElement | null;
  getCues(): Promise<SubtitleCue[]>;
  onCuesChanged?(cb: (cues: SubtitleCue[]) => void): () => void;
}

export abstract class BasePlayerAdapter implements PlayerAdapter {
  abstract readonly id: string;
  abstract readonly supportsMove: boolean;
  abstract findVideo(): HTMLVideoElement | null;
  abstract getCues(): Promise<SubtitleCue[]>;
}
