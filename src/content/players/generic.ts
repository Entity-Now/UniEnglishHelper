import type { SubtitleCue } from '../../shared/domain/types';
import { parseSubtitleFile } from '../../utils/subtitles/parser';
import { BasePlayerAdapter, type GetCuesOptions } from './base';
import { isLanguageMatching } from './youtube';

export class GenericHtml5Adapter extends BasePlayerAdapter {
  readonly id = 'generic';
  readonly supportsMove = true;
  private preferredLang: string;

  constructor(options?: { preferredLang?: string }) {
    super();
    this.preferredLang = options?.preferredLang || 'en';
  }

  setPreferredLang(lang: string): void {
    this.preferredLang = lang?.trim() || 'en';
  }

  findVideo(): HTMLVideoElement | null {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;
    // Prefer largest visible video
    return videos.sort(
      (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
    )[0];
  }

  async getCues(options?: GetCuesOptions): Promise<SubtitleCue[]> {
    const video = this.findVideo();
    if (!video) return [];
    const preferredLang = options?.preferredLang || this.preferredLang || 'en';

    // 1) <track> elements (sort preferred language first)
    const tracks = Array.from(video.querySelectorAll('track'));
    tracks.sort((a, b) => {
      const aMatch = isLanguageMatching(a.srclang, preferredLang) ? 1 : 0;
      const bMatch = isLanguageMatching(b.srclang, preferredLang) ? 1 : 0;
      return bMatch - aMatch;
    });

    for (const track of tracks) {
      const src = track.src;
      if (!src) continue;
      try {
        const res = await fetch(src);
        if (!res.ok) continue;
        const text = await res.text();
        const cues = parseSubtitleFile(text, src);
        if (cues.length) return cues;
      } catch {
        // CORS may block
      }
    }

    // 2) textTracks already loaded (sort preferred language first)
    if (video.textTracks?.length) {
      const textTracks = Array.from(video.textTracks);
      textTracks.sort((a, b) => {
        const aMatch = isLanguageMatching(a.language, preferredLang) ? 1 : 0;
        const bMatch = isLanguageMatching(b.language, preferredLang) ? 1 : 0;
        return bMatch - aMatch;
      });

      for (let i = 0; i < textTracks.length; i++) {
        const tt = textTracks[i];
        const cues: SubtitleCue[] = [];
        const list = tt.cues;
        if (!list) continue;
        for (let j = 0; j < list.length; j++) {
          const c = list[j] as VTTCue;
          cues.push({
            id: `tt-${i}-${j}`,
            startMs: Math.round(c.startTime * 1000),
            endMs: Math.round(c.endTime * 1000),
            text: c.text,
          });
        }
        if (cues.length) return cues;
      }
    }

    // 3) data attribute / global for fixture
    const fromDataset = document.querySelector<HTMLElement>('[data-ueh-subtitles]');
    if (fromDataset?.dataset.uehSubtitles) {
      return parseSubtitleFile(fromDataset.dataset.uehSubtitles);
    }

    const inline = document.getElementById('ueh-subtitles');
    if (inline?.textContent) {
      return parseSubtitleFile(inline.textContent);
    }

    return [];
  }
}
