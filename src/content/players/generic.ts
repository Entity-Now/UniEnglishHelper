import type { SubtitleCue } from '../../shared/domain/types';
import { parseSubtitleFile } from '../../utils/subtitles/parser';
import { BasePlayerAdapter } from './base';

export class GenericHtml5Adapter extends BasePlayerAdapter {
  readonly id = 'generic';
  readonly supportsMove = true;

  findVideo(): HTMLVideoElement | null {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;
    // Prefer largest visible video
    return videos.sort(
      (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
    )[0];
  }

  async getCues(): Promise<SubtitleCue[]> {
    const video = this.findVideo();
    if (!video) return [];

    // 1) <track> elements
    const tracks = Array.from(video.querySelectorAll('track'));
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

    // 2) textTracks already loaded
    if (video.textTracks?.length) {
      for (let i = 0; i < video.textTracks.length; i++) {
        const tt = video.textTracks[i];
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
