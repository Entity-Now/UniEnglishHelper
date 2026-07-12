/** Explicit learning status (independent of SRS stage). */
export type LearningStatus = 'new' | 'learning' | 'learned';

export interface WordRecord {
  id?: number;
  wordKey: string;
  /** Word / phrase / short sentence surface form */
  surface: string;
  /** Definition in target language (not a blob of meta notes) */
  translation?: string;
  phonetic?: string;
  /** Original sentence (subtitle line) */
  context: string;
  /** Translation of the original sentence */
  contextTranslation?: string;
  /** Full structured AI explanation (optional markdown) */
  explanation?: string;
  explainEngine?: 'llm' | 'free_mt' | 'manual' | 'none';
  explainProvider?: string;
  /** word = vocabulary; sentence = starred subtitle line */
  kind?: 'word' | 'sentence';
  sourceUrl?: string;
  sourceTitle?: string;
  cueStartMs?: number;
  cueEndMs?: number;
  audioClipId?: number;
  tags?: string[];
  /** new | learning | learned — used for highlight + popup filters */
  learningStatus: LearningStatus;
  reviewStage: number;
  nextReviewAt: number;
  ease?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AudioClipRecord {
  id?: number;
  blob: Blob;
  mimeType: 'audio/wav' | 'audio/webm' | 'audio/mpeg';
  durationMs: number;
  sampleRate?: number;
  sourceUrl?: string;
  startMs?: number;
  endMs?: number;
  epoch?: number;
  createdAt: number;
}

export interface TranslationCacheRecord {
  id?: number;
  key: string;
  src: string;
  dst: string;
  engine: string;
  text: string;
  createdAt: number;
}

export interface TtsCacheRecord {
  id?: number;
  key: string;
  blob: Blob;
  mimeType: string;
  voice: string;
  createdAt: number;
}

export interface SkillRecord {
  id: string;
  name: string;
  systemPrompt: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ReviewLogRecord {
  id?: number;
  wordId: number;
  result: string;
  stageBefore: number;
  stageAfter: number;
  createdAt: number;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}
