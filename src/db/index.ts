import Dexie, { type Table } from 'dexie';
import type {
  AudioClipRecord,
  MetaRecord,
  ReviewLogRecord,
  SkillRecord,
  TranslationCacheRecord,
  TtsCacheRecord,
  WordRecord,
} from './schema';
import type { ReviewResult, WordCreate, WordQuery } from '../shared/domain/types';
import { WORDS_REVISION_KEY } from '../shared/constants';
import { normalizeWordKey } from '../utils/vocab-highlight';
import {
  classifyVideoVocab,
  type VideoVocabRecapResult,
} from '../utils/video-vocab-recap';

/** Notify options/popup UIs that the words table changed. */
async function bumpWordsRevision(): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
        [WORDS_REVISION_KEY]: Date.now(),
      });
    }
  } catch {
    // Non-extension context (tests) — ignore
  }
}

export class UehDatabase extends Dexie {
  words!: Table<WordRecord, number>;
  audio_clips!: Table<AudioClipRecord, number>;
  translation_cache!: Table<TranslationCacheRecord, number>;
  tts_cache!: Table<TtsCacheRecord, number>;
  skills!: Table<SkillRecord, string>;
  review_logs!: Table<ReviewLogRecord, number>;
  meta!: Table<MetaRecord, string>;

  constructor() {
    super('UniEnglishHelper');
    this.version(1).stores({
      words: '++id, wordKey, nextReviewAt, createdAt, reviewStage',
      audio_clips: '++id, createdAt',
      translation_cache: '++id, key, createdAt',
      tts_cache: '++id, key, createdAt',
      skills: 'id, updatedAt',
      review_logs: '++id, wordId, createdAt',
      meta: 'key',
    });
    this.version(2)
      .stores({
        words:
          '++id, wordKey, nextReviewAt, createdAt, reviewStage, learningStatus',
        audio_clips: '++id, createdAt',
        translation_cache: '++id, key, createdAt',
        tts_cache: '++id, key, createdAt',
        skills: 'id, updatedAt',
        review_logs: '++id, wordId, createdAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('words')
          .toCollection()
          .modify((w: Record<string, unknown>) => {
            if (!w.learningStatus) {
              const stage = Number(w.reviewStage ?? 0);
              w.learningStatus =
                stage >= 4 ? 'learned' : stage > 0 ? 'learning' : 'new';
            }
          });
      });
    this.version(3)
      .stores({
        words:
          '++id, wordKey, nextReviewAt, createdAt, reviewStage, learningStatus, kind',
        audio_clips: '++id, createdAt',
        translation_cache: '++id, key, createdAt',
        tts_cache: '++id, key, createdAt',
        skills: 'id, updatedAt',
        review_logs: '++id, wordId, createdAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('words')
          .toCollection()
          .modify((w: Record<string, unknown>) => {
            if (!w.kind) w.kind = 'word';
            // Strip legacy free-MT meta footer from definition field if present
            if (typeof w.translation === 'string') {
              const t = w.translation as string;
              const cut = t.search(/\n\n_via free MT|\n\n（未配置 AI|via free MT/i);
              if (cut > 0) {
                w.translation = t.slice(0, cut).replace(/^\*\*[^*]+\*\*\s*/, '').trim();
              }
            }
          });
      });
  }
}

export const db = new UehDatabase();

const STAGE_INTERVALS_MS = [
  0,
  10 * 60_000,
  60 * 60_000,
  24 * 60 * 60_000,
  3 * 24 * 60 * 60_000,
  7 * 24 * 60 * 60_000,
  30 * 24 * 60 * 60_000,
];

export async function addWord(input: WordCreate): Promise<WordRecord> {
  const now = Date.now();
  const wordKey = normalizeWordKey(input.surface);
  const existing = await db.words.where('wordKey').equals(wordKey).first();
  if (existing) {
    const updated: WordRecord = {
      ...existing,
      translation: input.translation ?? existing.translation,
      phonetic: input.phonetic ?? existing.phonetic,
      context: input.context || existing.context,
      contextTranslation:
        input.contextTranslation ?? existing.contextTranslation,
      explanation: input.explanation ?? existing.explanation,
      explainEngine: input.explainEngine ?? existing.explainEngine,
      explainProvider: input.explainProvider ?? existing.explainProvider,
      kind: input.kind ?? existing.kind ?? 'word',
      sourceUrl: input.sourceUrl ?? existing.sourceUrl,
      sourceTitle: input.sourceTitle ?? existing.sourceTitle,
      cueStartMs: input.cueStartMs ?? existing.cueStartMs,
      cueEndMs: input.cueEndMs ?? existing.cueEndMs,
      audioClipId: input.audioClipId ?? existing.audioClipId,
      tags: input.tags ?? existing.tags,
      learningStatus: existing.learningStatus ?? 'new',
      updatedAt: now,
    };
    await db.words.put(updated);
    await bumpWordsRevision();
    return updated;
  }
  const record: WordRecord = {
    wordKey,
    surface: input.surface.trim(),
    translation: input.translation,
    phonetic: input.phonetic,
    context: input.context,
    contextTranslation: input.contextTranslation,
    explanation: input.explanation,
    explainEngine: input.explainEngine,
    explainProvider: input.explainProvider,
    kind: input.kind ?? 'word',
    sourceUrl: input.sourceUrl,
    sourceTitle: input.sourceTitle,
    cueStartMs: input.cueStartMs,
    cueEndMs: input.cueEndMs,
    audioClipId: input.audioClipId,
    tags: input.tags,
    learningStatus: 'new',
    reviewStage: 0,
    nextReviewAt: now,
    ease: 2.5,
    createdAt: now,
    updatedAt: now,
  };
  const id = await db.words.add(record);
  await bumpWordsRevision();
  return { ...record, id };
}

export async function listWords(query: WordQuery = {}): Promise<WordRecord[]> {
  let coll = db.words.orderBy('createdAt').reverse();
  if (query.dueOnly) {
    const now = Date.now();
    coll = db.words.where('nextReviewAt').belowOrEqual(now);
  }
  let rows = await coll.toArray();
  if (query.q) {
    const q = query.q.toLowerCase();
    rows = rows.filter(
      (w) =>
        w.wordKey.includes(q) ||
        w.surface.toLowerCase().includes(q) ||
        (w.context?.toLowerCase().includes(q) ?? false) ||
        (w.translation?.toLowerCase().includes(q) ?? false),
    );
  }
  const offset = query.offset ?? 0;
  // limit <= 0 or omitted with all=true → return all rows
  // Default raised so options Study/Dictionary see the full book.
  const limit = query.limit;
  if (limit == null || limit <= 0) {
    return offset > 0 ? rows.slice(offset) : rows;
  }
  return rows.slice(offset, offset + limit);
}

export async function updateReview(
  id: number,
  result: ReviewResult,
): Promise<WordRecord> {
  const word = await db.words.get(id);
  if (!word) throw new Error('Word not found');
  const stageBefore = word.reviewStage;
  let stage = stageBefore;
  if (result === 'again') stage = 0;
  else if (result === 'hard') stage = Math.max(0, stage - 1);
  else if (result === 'good') stage = Math.min(STAGE_INTERVALS_MS.length - 1, stage + 1);
  else stage = Math.min(STAGE_INTERVALS_MS.length - 1, stage + 2);

  const now = Date.now();
  const updated: WordRecord = {
    ...word,
    reviewStage: stage,
    nextReviewAt: now + STAGE_INTERVALS_MS[stage],
    updatedAt: now,
  };
  await db.words.put(updated);
  await db.review_logs.add({
    wordId: id,
    result,
    stageBefore,
    stageAfter: stage,
    createdAt: now,
  });
  await bumpWordsRevision();
  return updated;
}

export async function deleteWord(id: number): Promise<void> {
  await db.words.delete(id);
  await bumpWordsRevision();
}

export async function setLearningStatus(
  id: number,
  learningStatus: import('./schema').LearningStatus,
): Promise<WordRecord> {
  const word = await db.words.get(id);
  if (!word) throw new Error('Word not found');
  const updated: WordRecord = {
    ...word,
    learningStatus,
    updatedAt: Date.now(),
  };
  await db.words.put(updated);
  await bumpWordsRevision();
  return updated;
}

/** Words added in this video vs revisiting from other videos in subtitle corpus. */
export async function getVideoVocabRecap(
  videoKey: string,
  cueWordKeys: string[],
): Promise<VideoVocabRecapResult> {
  const rows = await db.words.toArray();
  return classifyVideoVocab(rows, videoKey, cueWordKeys);
}

/** Lightweight map for subtitle highlight (wordKey → status). */
export async function getHighlightMap(): Promise<
  Record<string, import('./schema').LearningStatus>
> {
  const rows = await db.words.toArray();
  const map: Record<string, import('./schema').LearningStatus> = {};
  for (const w of rows) {
    const status = w.learningStatus ?? 'new';
    const key = normalizeWordKey(w.surface) || normalizeWordKey(w.wordKey);
    if (key) map[key] = status;
  }
  return map;
}

export async function addAudioClip(
  partial: Omit<AudioClipRecord, 'id' | 'createdAt'> & { createdAt?: number },
): Promise<number> {
  return db.audio_clips.add({
    ...partial,
    createdAt: partial.createdAt ?? Date.now(),
  });
}

export async function getClipMeta(clipId: number) {
  const clip = await db.audio_clips.get(clipId);
  if (!clip) return null;
  return {
    id: clip.id!,
    mimeType: clip.mimeType,
    durationMs: clip.durationMs,
    sampleRate: clip.sampleRate,
    sourceUrl: clip.sourceUrl,
    startMs: clip.startMs,
    endMs: clip.endMs,
    epoch: clip.epoch,
    createdAt: clip.createdAt,
    byteLength: clip.blob.size,
  };
}

export async function getClipBlob(clipId: number): Promise<AudioClipRecord | undefined> {
  return db.audio_clips.get(clipId);
}

export async function getTranslationCache(key: string) {
  return db.translation_cache.where('key').equals(key).first();
}

export async function putTranslationCache(
  key: string,
  src: string,
  dst: string,
  engine: string,
  text: string,
) {
  await db.translation_cache.put({
    key,
    src,
    dst,
    engine,
    text,
    createdAt: Date.now(),
  });
}

export async function listSkills(): Promise<SkillRecord[]> {
  return db.skills.orderBy('updatedAt').reverse().toArray();
}

export async function saveSkill(
  input: {
    id?: string;
    name: string;
    systemPrompt: string;
    enabled?: boolean;
  },
): Promise<SkillRecord> {
  const now = Date.now();
  const id = input.id ?? crypto.randomUUID();
  const existing = await db.skills.get(id);
  const record: SkillRecord = {
    id,
    name: input.name,
    systemPrompt: input.systemPrompt,
    enabled: input.enabled ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.skills.put(record);
  return record;
}

export async function deleteSkill(id: string): Promise<void> {
  await db.skills.delete(id);
}

/**
 * Ensure built-in Skills exist (install / skill.list).
 *
 * User edits are sacred:
 * - Only insert when the stable builtin id is missing.
 * - Never overwrite name / systemPrompt / enabled of an existing skill.
 * - Legacy same-name skills are migrated to the stable id while keeping the
 *   user's prompt text.
 */
export async function ensureDefaultSkills(): Promise<void> {
  const { BUILTIN_SKILLS, isBuiltinSkillId } = await import(
    '../utils/constants/skills'
  );

  const existing = await db.skills.toArray();
  const byId = new Map(existing.map((s) => [s.id, s]));

  for (const def of BUILTIN_SKILLS) {
    if (byId.has(def.id)) {
      // Already present — keep whatever the user has customized.
      continue;
    }

    const nameOwner = existing.find((s) => s.name === def.name);
    if (nameOwner && !isBuiltinSkillId(nameOwner.id)) {
      // Migrate legacy random-id record → stable id, preserve user content
      await db.skills.delete(nameOwner.id);
      await saveSkill({
        id: def.id,
        name: nameOwner.name,
        systemPrompt: nameOwner.systemPrompt,
        enabled: nameOwner.enabled,
      });
      continue;
    }

    await saveSkill({
      id: def.id,
      name: def.name,
      systemPrompt: def.systemPrompt,
      enabled: def.enabled,
    });
  }
}

/** Restore a built-in skill's name + prompt to factory defaults (user-initiated). */
export async function resetBuiltinSkill(
  id: string,
): Promise<import('./schema').SkillRecord | null> {
  const { BUILTIN_SKILLS, isBuiltinSkillId } = await import(
    '../utils/constants/skills'
  );
  if (!isBuiltinSkillId(id)) return null;
  const def = BUILTIN_SKILLS.find((s) => s.id === id);
  if (!def) return null;
  return saveSkill({
    id: def.id,
    name: def.name,
    systemPrompt: def.systemPrompt,
    enabled: true,
  });
}

export async function clearCaches(scopes: Array<'translation' | 'tts' | 'clips'>) {
  const stats: Record<string, number> = {};
  if (scopes.includes('translation')) {
    stats.translation = await db.translation_cache.count();
    await db.translation_cache.clear();
  }
  if (scopes.includes('tts')) {
    stats.tts = await db.tts_cache.count();
    await db.tts_cache.clear();
  }
  if (scopes.includes('clips')) {
    stats.clips = await db.audio_clips.count();
    await db.audio_clips.clear();
  }
  return stats;
}

export async function getDashboardStats() {
  const now = Date.now();
  const [words, due, clips, translations, tts, skills, reviewLogs] =
    await Promise.all([
      db.words.count(),
      db.words.where('nextReviewAt').belowOrEqual(now).count(),
      db.audio_clips.count(),
      db.translation_cache.count(),
      db.tts_cache.count(),
      db.skills.count(),
      db.review_logs.count(),
    ]);

  let clipsBytes = 0;
  const clipRows = await db.audio_clips.toArray();
  for (const c of clipRows) {
    clipsBytes += c.blob?.size ?? 0;
  }

  return {
    words,
    due,
    clips,
    clipsBytes,
    translations,
    tts,
    skills,
    reviewLogs,
  };
}

/** Soft LRU for translation cache */
export async function trimTranslationCache(max = 500): Promise<number> {
  const count = await db.translation_cache.count();
  if (count <= max) return 0;
  const old = await db.translation_cache
    .orderBy('createdAt')
    .limit(count - max)
    .toArray();
  await db.translation_cache.bulkDelete(old.map((r) => r.id!).filter(Boolean));
  return old.length;
}
