import type { StateData, SubtitlesFragment } from './types';
import type { SubtitlesDisplayMode } from '@/types/config/subtitles';

export function hasRenderableSubtitleByMode(
  subtitle: SubtitlesFragment | null,
  displayMode: SubtitlesDisplayMode,
): boolean {
  if (!subtitle) return false;
  if (displayMode === 'off') return false;
  if (displayMode === 'translationOnly') return !!subtitle.translation;
  return true;
}

export function isAwaitingTranslation(
  subtitle: SubtitlesFragment | null,
  stateData: StateData | null,
): boolean {
  return subtitle ? !subtitle.translation : stateData?.state === 'loading';
}

/** Pick which lines to show given display mode. */
export function pickSubtitleLines(
  subtitle: SubtitlesFragment | null,
  displayMode: SubtitlesDisplayMode,
): { original?: string; translation?: string } {
  if (!subtitle) return {};
  switch (displayMode) {
    case 'off':
      return {};
    case 'originalOnly':
      return { original: subtitle.text };
    case 'translationOnly':
      return { translation: subtitle.translation };
    case 'bilingual':
    default:
      return {
        original: subtitle.text,
        translation: subtitle.translation,
      };
  }
}
