import type { AppConfig } from '../../shared/domain/types';
import type { PlayerAdapter } from './base';
import { GenericHtml5Adapter } from './generic';
import { isYoutubeHost, YoutubeAdapter } from './youtube';

export function createPlayerAdapter(config?: AppConfig): PlayerAdapter {
  const preferredLang = config?.sourceLang || 'en';
  // Always use YouTube adapter on YT (mirror + MAIN-world caption intercept).
  if (isYoutubeHost()) {
    return new YoutubeAdapter({ preferredLang });
  }
  return new GenericHtml5Adapter({ preferredLang });
}

export type { PlayerAdapter };
