import type { LearningStatus, WordRecord } from '../db/schema';
import type { ReviewResult, WordCreate, WordQuery } from '../shared/domain/types';
import { sendRuntime } from '../shared/messaging/client';

export interface ImportWordsResult {
  added: number;
  updated: number;
  total: number;
}

/**
 * Import a list of words into the dictionary database.
 */
export async function importWordsApi(
  words: WordCreate[],
  mode: 'merge' | 'overwrite' = 'merge',
): Promise<ImportWordsResult> {
  const res = await sendRuntime<ImportWordsResult>(
    'word.import',
    { words, mode },
    'options',
  );
  if (!res.ok) {
    throw new Error(res.error?.message || '导入生词失败');
  }
  return res.data;
}

/**
 * Fetch word list from dictionary.
 */
export async function listWordsApi(query: WordQuery = { limit: 0 }): Promise<WordRecord[]> {
  const res = await sendRuntime<WordRecord[]>('word.list', query, 'options');
  if (!res.ok) {
    throw new Error(res.error?.message || '获取生词列表失败');
  }
  return res.data;
}

/**
 * Update learning status of a word.
 */
export async function setWordStatusApi(
  id: number,
  learningStatus: LearningStatus,
): Promise<void> {
  const res = await sendRuntime(
    'word.setStatus',
    { id, learningStatus },
    'options',
  );
  if (!res.ok) {
    throw new Error(res.error?.message || '更新生词状态失败');
  }
}

/**
 * Update review status of a word.
 */
export async function updateWordReviewApi(
  id: number,
  result: ReviewResult,
): Promise<void> {
  const res = await sendRuntime('word.updateReview', { id, result }, 'options');
  if (!res.ok) {
    throw new Error(res.error?.message || '更新复习进度失败');
  }
}

/**
 * Delete a word record by ID.
 */
export async function deleteWordApi(id: number): Promise<void> {
  const res = await sendRuntime('word.delete', { id }, 'options');
  if (!res.ok) {
    throw new Error(res.error?.message || '删除生词失败');
  }
}

/**
 * Export word list as JSON file download.
 */
export function exportWordsJson(words: WordRecord[]): void {
  const payload = words.map((w) => ({
    surface: w.surface,
    translation: w.translation,
    phonetic: w.phonetic,
    context: w.context,
    contextTranslation: w.contextTranslation,
    explanation: w.explanation,
    explainEngine: w.explainEngine,
    explainProvider: w.explainProvider,
    kind: w.kind ?? 'word',
    sourceUrl: w.sourceUrl,
    sourceTitle: w.sourceTitle,
    tags: w.tags,
    learningStatus: w.learningStatus,
    reviewStage: w.reviewStage,
    nextReviewAt: w.nextReviewAt,
    createdAt: w.createdAt,
  }));
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ueh-dictionary-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
