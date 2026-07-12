import type { SubtitleCue } from '../../shared/domain/types';

function parseTimestamp(ts: string): number {
  // 00:00:01.000 or 00:00:01,000 or 00:01.000
  const normalized = ts.trim().replace(',', '.');
  const parts = normalized.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return Math.round((h * 3600 + m * 60 + s) * 1000);
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return Math.round((m * 60 + s) * 1000);
  }
  return Math.round(parts[0] * 1000);
}

export function parseVtt(content: string): SubtitleCue[] {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  const cues: SubtitleCue[] = [];
  let i = 0;
  let cueIndex = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line.startsWith('WEBVTT') || line.startsWith('NOTE')) {
      i += 1;
      continue;
    }
    // optional cue id
    let idLine = line;
    let timeLine = line;
    if (!line.includes('-->')) {
      i += 1;
      if (i >= lines.length) break;
      timeLine = lines[i].trim();
      idLine = line;
    }
    const match = timeLine.match(
      /([\d:.,]+)\s*-->\s*([\d:.,]+)/,
    );
    if (!match) {
      i += 1;
      continue;
    }
    const startMs = parseTimestamp(match[1]);
    const endMs = parseTimestamp(match[2]);
    i += 1;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i]);
      i += 1;
    }
    const text = textLines.join('\n').replace(/<[^>]+>/g, '').trim();
    if (text) {
      cues.push({
        id: idLine.includes('-->') ? `cue-${cueIndex}` : idLine || `cue-${cueIndex}`,
        startMs,
        endMs,
        text,
      });
      cueIndex += 1;
    }
    i += 1;
  }
  return cues;
}

export function parseSrt(content: string): SubtitleCue[] {
  // SRT timestamps use comma; reuse VTT parser after light normalize
  const asVtt =
    'WEBVTT\n\n' +
    content
      .replace(/^\uFEFF/, '')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return parseVtt(asVtt);
}

export function parseSubtitleFile(content: string, filename?: string): SubtitleCue[] {
  if (filename?.endsWith('.srt') || content.includes('-->') && /^\d+\s*$/m.test(content)) {
    if (filename?.endsWith('.srt') || /,\d{3}\s*-->/.test(content)) {
      return parseSrt(content);
    }
  }
  return parseVtt(content);
}

export function findActiveCue(
  cues: SubtitleCue[],
  mediaTimeMs: number,
): SubtitleCue | null {
  // linear for small lists; binary for large
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid];
    if (mediaTimeMs < c.startMs) hi = mid - 1;
    else if (mediaTimeMs >= c.endMs) lo = mid + 1;
    else return c;
  }
  return null;
}
