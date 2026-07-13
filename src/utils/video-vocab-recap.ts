import type { SubtitleCue } from '../shared/domain/types';
import type { WordRecord } from '../db/schema';
import { isClickableWord, segmentWords } from './segmenter';
import { normalizeWordKey } from './vocab-highlight';

export interface VideoVocabRecapStats {
  addedHereCount: number;
  revisitingCount: number;
  dueCount: number;
}

export interface VideoVocabRecapResult {
  addedHere: WordRecord[];
  revisiting: WordRecord[];
  stats: VideoVocabRecapStats;
}

/** Extract YouTube video id from a watch/shorts/embed URL. */
export function extractVideoIdFromUrl(href: string): string | null {
  try {
    const u = new URL(href);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.split('/').filter(Boolean)[0] ?? null;
    }
    const v = u.searchParams.get('v');
    if (v) return v;
    const shorts = u.pathname.match(/\/shorts\/([^/?]+)/);
    if (shorts) return shorts[1]!;
    const embed = u.pathname.match(/\/embed\/([^/?]+)/);
    if (embed) return embed[1]!;
    const live = u.pathname.match(/\/live\/([^/?]+)/);
    if (live) return live[1]!;
  } catch {
    // ignore
  }
  return null;
}

/** Stable key for grouping words by video source. */
export function normalizeVideoKey(href: string): string {
  const ytId = extractVideoIdFromUrl(href);
  if (ytId) return `yt:${ytId}`;
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`.toLowerCase();
  } catch {
    return href.toLowerCase();
  }
}

/** All normalized word keys appearing in subtitle cues. */
export function buildCueWordKeys(cues: SubtitleCue[]): string[] {
  const keys = new Set<string>();
  for (const cue of cues) {
    for (const seg of segmentWords(cue.text)) {
      if (!isClickableWord(seg)) continue;
      const key = normalizeWordKey(seg.text);
      if (key) keys.add(key);
    }
  }
  return [...keys];
}

/** First cue in the list where the word surface appears. */
export function findFirstCueForWord(
  cues: SubtitleCue[],
  surface: string,
): SubtitleCue | null {
  const target = normalizeWordKey(surface);
  if (!target) return null;
  for (const cue of cues) {
    for (const seg of segmentWords(cue.text)) {
      if (!isClickableWord(seg)) continue;
      if (normalizeWordKey(seg.text) === target) return cue;
    }
  }
  return null;
}

const STATUS_ORDER = { new: 0, learning: 1, learned: 2 } as const;

/** Classify vocabulary for the current video subtitle corpus. */
export function classifyVideoVocab(
  words: WordRecord[],
  videoKey: string,
  cueWordKeys: string[],
  now = Date.now(),
): VideoVocabRecapResult {
  const cueSet = new Set(cueWordKeys);
  const vocab = words.filter((w) => w.kind !== 'sentence');

  const addedHere: WordRecord[] = [];
  const addedKeys = new Set<string>();

  for (const w of vocab) {
    const srcKey = w.sourceUrl ? normalizeVideoKey(w.sourceUrl) : '';
    if (srcKey !== videoKey) continue;
    addedHere.push(w);
    const key = normalizeWordKey(w.surface);
    if (key) addedKeys.add(key);
  }
  addedHere.sort((a, b) => b.createdAt - a.createdAt);

  const revisiting: WordRecord[] = [];
  let dueCount = 0;

  for (const w of vocab) {
    const key = normalizeWordKey(w.surface);
    if (!key || !cueSet.has(key) || addedKeys.has(key)) continue;
    const srcKey = w.sourceUrl ? normalizeVideoKey(w.sourceUrl) : '';
    if (srcKey === videoKey) continue;
    revisiting.push(w);
    if (w.nextReviewAt <= now) dueCount++;
  }

  revisiting.sort((a, b) => {
    const aDue = a.nextReviewAt <= now ? 0 : 1;
    const bDue = b.nextReviewAt <= now ? 0 : 1;
    if (aDue !== bDue) return aDue - bDue;
    const sa = STATUS_ORDER[a.learningStatus ?? 'new'];
    const sb = STATUS_ORDER[b.learningStatus ?? 'new'];
    if (sa !== sb) return sa - sb;
    return a.nextReviewAt - b.nextReviewAt;
  });

  return {
    addedHere,
    revisiting,
    stats: {
      addedHereCount: addedHere.length,
      revisitingCount: revisiting.length,
      dueCount,
    },
  };
}

export function formatRecapBadge(stats: VideoVocabRecapStats): string {
  const { addedHereCount, revisitingCount } = stats;
  if (addedHereCount === 0 && revisitingCount === 0) return '';
  if (addedHereCount === 0) return String(revisitingCount);
  if (revisitingCount === 0) return String(addedHereCount);
  return `${addedHereCount}·${revisitingCount}`;
}