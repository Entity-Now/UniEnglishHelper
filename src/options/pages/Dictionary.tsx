import React, { useMemo, useState } from 'react';
import type { LearningStatus, WordRecord } from '../../db/schema';
import type { ReviewResult } from '../../shared/domain/types';
import { PORT_CLIP } from '../../shared/constants';
import { concatArrayBuffers } from '../../utils/audio';
import type { ClipPortServerMessage } from '../../shared/messages/ports';
import { sendRuntime } from '../../shared/messaging/client';

type FilterMode = 'all' | 'due' | 'new' | 'learning' | 'mature' | 'learned';

export function DictionaryPage(props: {
  words: WordRecord[];
  loading?: boolean;
  syncedAt?: number | null;
  onRefresh: () => Promise<void>;
  onReview: (id: number, result: ReviewResult) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [sort, setSort] = useState<'newest' | 'due' | 'alpha'>('newest');
  const [selected, setSelected] = useState<WordRecord | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const now = Date.now();

  const stats = useMemo(() => {
    const due = props.words.filter((w) => w.nextReviewAt <= now).length;
    const learning = props.words.filter(
      (w) => w.reviewStage > 0 && w.reviewStage < 4,
    ).length;
    const mature = props.words.filter((w) => w.reviewStage >= 4).length;
    const fresh = props.words.filter((w) => w.reviewStage === 0).length;
    return {
      total: props.words.length,
      due,
      learning,
      mature,
      fresh,
    };
  }, [props.words, now]);

  const filtered = useMemo(() => {
    let list = props.words.slice();
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter(
        (w) =>
          w.surface.toLowerCase().includes(needle) ||
          w.context.toLowerCase().includes(needle) ||
          (w.translation?.toLowerCase().includes(needle) ?? false) ||
          (w.tags ?? []).some((t) => t.toLowerCase().includes(needle)),
      );
    }
    switch (filter) {
      case 'due':
        list = list.filter((w) => w.nextReviewAt <= now);
        break;
      case 'new':
        list = list.filter((w) => (w.learningStatus ?? 'new') === 'new');
        break;
      case 'learning':
        list = list.filter(
          (w) => (w.learningStatus ?? 'new') === 'learning',
        );
        break;
      case 'learned':
      case 'mature':
        list = list.filter(
          (w) =>
            (w.learningStatus ?? 'new') === 'learned' || w.reviewStage >= 4,
        );
        break;
      default:
        break;
    }
    switch (sort) {
      case 'due':
        list.sort((a, b) => a.nextReviewAt - b.nextReviewAt);
        break;
      case 'alpha':
        list.sort((a, b) =>
          a.surface.localeCompare(b.surface, undefined, {
            sensitivity: 'base',
          }),
        );
        break;
      case 'newest':
      default:
        list.sort((a, b) => b.createdAt - a.createdAt);
        break;
    }
    return list;
  }, [props.words, q, filter, sort, now]);

  const playClip = async (clipId: number) => {
    const blob = await fetchClip(clipId);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  };

  const exportJson = () => {
    const payload = props.words.map((w) => ({
      surface: w.surface,
      translation: w.translation,
      context: w.context,
      contextTranslation: w.contextTranslation,
      sourceUrl: w.sourceUrl,
      sourceTitle: w.sourceTitle,
      tags: w.tags,
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
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await props.onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const syncedLabel = props.syncedAt
    ? `已同步 ${new Date(props.syncedAt).toLocaleTimeString()}`
    : '尚未同步';

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 4,
        }}
      >
        <div>
          <h1 className="page-title" style={{ marginBottom: 6 }}>
            生词本
          </h1>
          <p className="page-desc" style={{ marginBottom: 0 }}>
            从画中画 / 划词工具栏添加；支持筛选、导出与简易间隔复习。添加后会自动同步。
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <button
            type="button"
            className="ghost"
            disabled={refreshing || props.loading}
            onClick={() => void handleRefresh()}
          >
            {refreshing || props.loading ? '同步中…' : '↻ 同步生词'}
          </button>
          <span className="muted" style={{ fontSize: 11 }}>
            {syncedLabel} · {stats.total} 条
          </span>
        </div>
      </div>

      <div className="card">
        <h2>概览</h2>
        <div className="row">
          <MiniStat label="全部" value={stats.total} />
          <MiniStat label="待复习" value={stats.due} accent />
          <MiniStat label="新词" value={stats.fresh} />
          <MiniStat label="学习中" value={stats.learning} />
          <MiniStat label="已巩固" value={stats.mature} />
        </div>
      </div>

      <div className="card">
        <h2>词条</h2>
        <div className="row" style={{ marginBottom: 12, alignItems: 'end' }}>
          <div style={{ flex: 2 }}>
            <label>搜索</label>
            <input
              placeholder="单词 / 上下文 / 释义 / 标签…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div>
            <label>筛选</label>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterMode)}
            >
              <option value="all">全部</option>
              <option value="due">待复习</option>
              <option value="new">新词</option>
              <option value="learning">学习中</option>
              <option value="learned">已掌握</option>
              <option value="mature">SRS 已巩固</option>
            </select>
          </div>
          <div>
            <label>排序</label>
            <select
              value={sort}
              onChange={(e) =>
                setSort(e.target.value as 'newest' | 'due' | 'alpha')
              }
            >
              <option value="newest">最新添加</option>
              <option value="due">复习时间</option>
              <option value="alpha">字母序</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="primary"
            disabled={refreshing || props.loading}
            onClick={() => void handleRefresh()}
          >
            {refreshing || props.loading ? '同步中…' : '刷新'}
          </button>
          <button type="button" className="primary" onClick={exportJson}>
            导出 JSON
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            显示 {filtered.length} / {props.words.length}
          </span>
        </div>

        {props.words.length === 0 && (
          <p className="muted" style={{ marginBottom: 12 }}>
            暂无生词。在视频页添加后会自动出现；也可点「同步生词」。
          </p>
        )}

        {filtered.map((w) => {
          const due = w.nextReviewAt <= now;
          return (
            <div
              className="word-item"
              key={w.id}
              style={{
                borderColor: due ? 'oklch(76% 0.12 82 / 0.5)' : undefined,
                cursor: 'pointer',
              }}
              onClick={() => setSelected(w)}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <strong style={{ fontSize: 17 }}>{w.surface}</strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  {due ? '● 待复习' : `stage ${w.reviewStage}`}
                </span>
              </div>
              {w.kind === 'sentence' && (
                <span
                  className="muted"
                  style={{
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 999,
                    background: 'rgba(91,159,255,.2)',
                    marginLeft: 8,
                  }}
                >
                  句子
                </span>
              )}
              {w.translation && (
                <div style={{ marginTop: 4 }}>
                  <strong>释义</strong> {w.translation.slice(0, 160)}
                </div>
              )}
              {w.context && (
                <div className="muted" style={{ marginTop: 4 }}>
                  原文：{w.context}
                </div>
              )}
              {w.contextTranslation && (
                <div className="muted" style={{ marginTop: 2 }}>
                  译文：{w.contextTranslation}
                </div>
              )}
              {w.explainEngine && (
                <div className="muted" style={{ marginTop: 2, fontSize: 11 }}>
                  来源：{w.explainEngine}
                  {w.explainProvider ? ` / ${w.explainProvider}` : ''}
                </div>
              )}
              {(w.tags?.length ?? 0) > 0 && (
                <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {w.tags!.map((t) => (
                    <span
                      key={t}
                      style={{
                        fontSize: 11,
                        padding: '2px 6px',
                        borderRadius: 999,
                        background: 'rgba(255,255,255,.06)',
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                next {new Date(w.nextReviewAt).toLocaleString()}
                {w.sourceTitle ? ` · ${w.sourceTitle}` : ''}
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  marginTop: 8,
                  flexWrap: 'wrap',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {(
                  [
                    ['new', '新词'],
                    ['learning', '学习中'],
                    ['learned', '已掌握'],
                  ] as const
                ).map(([st, label]) => (
                  <button
                    key={st}
                    type="button"
                    className="primary"
                    disabled={(w.learningStatus ?? 'new') === st}
                    onClick={async () => {
                      if (w.id == null) return;
                      await sendRuntime(
                        'word.setStatus',
                        { id: w.id, learningStatus: st as LearningStatus },
                        'options',
                      );
                      await props.onRefresh();
                    }}
                  >
                    {label}
                  </button>
                ))}
                {(['again', 'hard', 'good', 'easy'] as ReviewResult[]).map(
                  (r) => (
                    <button
                      key={r}
                      type="button"
                      className="primary"
                      onClick={() => w.id != null && props.onReview(w.id, r)}
                    >
                      {r}
                    </button>
                  ),
                )}
                {w.audioClipId != null && (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void playClip(w.audioClipId!)}
                  >
                    播放原声
                  </button>
                )}
                <button
                  type="button"
                  className="primary"
                  onClick={() => w.id != null && props.onDelete(w.id)}
                >
                  删除
                </button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="muted">暂无词条。在画中画字幕中点单词添加。</p>
        )}
      </div>

      {selected && (
        <div className="card">
          <h2>详情 · {selected.surface}</h2>
          {selected.phonetic && <p className="muted">{selected.phonetic}</p>}
          {selected.translation && (
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit',
                fontSize: 13,
                lineHeight: 1.5,
                margin: '8px 0',
              }}
            >
              {selected.translation}
            </pre>
          )}
          <p>
            <strong>上下文</strong>
            <br />
            {selected.context}
          </p>
          {selected.contextTranslation && (
            <p className="muted">{selected.contextTranslation}</p>
          )}
          {selected.sourceUrl && (
            <p className="muted">
              <a href={selected.sourceUrl} target="_blank" rel="noreferrer">
                {selected.sourceTitle || selected.sourceUrl}
              </a>
            </p>
          )}
          <button
            type="button"
            className="primary"
            onClick={() => setSelected(null)}
          >
            关闭详情
          </button>
        </div>
      )}
    </div>
  );
}

function MiniStat(props: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        background: props.accent ? 'oklch(30% 0.04 82)' : '#0d1117',
        borderRadius: 8,
        padding: 12,
        border: '1px solid #30363d',
        minWidth: 88,
      }}
    >
      <div className="muted">{props.label}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{props.value}</div>
    </div>
  );
}

function fetchClip(clipId: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: PORT_CLIP });
    const requestId = crypto.randomUUID();
    const chunks: ArrayBuffer[] = [];
    port.onMessage.addListener((msg: ClipPortServerMessage) => {
      if (msg.requestId !== requestId) return;
      if (msg.type === 'clips.blobChunk') chunks[msg.index] = msg.bytes;
      if (msg.type === 'clips.blobEnd') {
        resolve(
          new Blob([concatArrayBuffers(chunks.filter(Boolean))], {
            type: msg.mimeType,
          }),
        );
        port.disconnect();
      }
      if (msg.type === 'clips.blobError') {
        reject(new Error(msg.message));
        port.disconnect();
      }
    });
    port.postMessage({ type: 'clips.getBlob', requestId, clipId });
  });
}
