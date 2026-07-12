import type { AppConfig } from '../../shared/domain/types';
import type { PlayerAdapter } from './base';
import { GenericHtml5Adapter } from './generic';
import { isYoutubeHost, YoutubeAdapter } from './youtube';

export function createPlayerAdapter(_config: AppConfig): PlayerAdapter {
  // Always use YouTube adapter on YT (mirror + MAIN-world caption intercept).
  if (isYoutubeHost()) {
    return new YoutubeAdapter();
  }
  return new GenericHtml5Adapter();
}

export type { PlayerAdapter };
