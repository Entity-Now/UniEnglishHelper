import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { AppConfig, ReviewResult } from '../../shared/domain/types';
import type { WordRecord, SkillRecord } from '../../db/schema';
import { sendRuntime } from '../../shared/messaging/client';
import { marked } from 'marked';
import {
  BUILTIN_SKILL_IDS,
  DEFAULT_STUDY_SKILL_PROMPT,
  SKILL_STUDY_REVIEW_PROMPT,
} from '../../utils/constants/skills';

export { DEFAULT_STUDY_SKILL_PROMPT, SKILL_STUDY_REVIEW_PROMPT };

interface StudyPageProps {
  config: AppConfig;
  words: WordRecord[];
  loading?: boolean;
  syncedAt?: number | null;
  onRefresh: (opts?: { silent?: boolean; toast?: boolean }) => Promise<void>;
}

function formatSyncedAt(ts: number | null | undefined): string {
  if (!ts) return '尚未同步';
  return `已同步 ${new Date(ts).toLocaleTimeString()}`;
}

function toDateInputValue(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDayMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 0, 0, 0, 0).getTime();
}

function endOfDayMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 23, 59, 59, 999).getTime();
}

type TimeFilter =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'all'
  | 'custom';

type ListSort = 'newest' | 'oldest' | 'alpha' | 'due';

type StatusFilter = 'all' | 'new' | 'learning' | 'learned' | 'due';

function statusLabel(w: WordRecord): string {
  if (w.nextReviewAt <= Date.now()) return '待复习';
  const s = w.learningStatus ?? 'new';
  if (s === 'learned' || w.reviewStage >= 4) return '已掌握';
  if (s === 'learning' || w.reviewStage > 0) return '学习中';
  return '新词';
}

function statusColor(label: string): string {
  if (label === '待复习') return '#f59e0b';
  if (label === '已掌握') return '#10b981';
  if (label === '学习中') return '#3b82f6';
  return 'var(--rf-muted-foreground)';
}

export function StudyPage({
  config,
  words,
  loading,
  syncedAt,
  onRefresh,
}: StudyPageProps) {
  const [filter, setFilter] = useState<TimeFilter>('all');
  const [customFrom, setCustomFrom] = useState(() =>
    toDateInputValue(Date.now() - 7 * 24 * 3600 * 1000),
  );
  const [customTo, setCustomTo] = useState(() => toDateInputValue(Date.now()));
  const [listQuery, setListQuery] = useState('');
  const [listSort, setListSort] = useState<ListSort>('newest');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [manualSelect, setManualSelect] = useState(true);
  const [selectedWordIds, setSelectedWordIds] = useState<
    Record<number, boolean>
  >({});
  const [isStudying, setIsStudying] = useState(false);
  /** Snapshot for active session (keeps AI explanations stable). */
  const [sessionWords, setSessionWords] = useState<WordRecord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const abortRef = useRef(false);
  const selectionInitialized = useRef(false);

  const providerId = config.ai.providerId;
  const apiKey = config.ai.apiKeys[providerId];
  const isAiConfigured = !!apiKey;

  useEffect(() => {
    void sendRuntime<SkillRecord[]>('skill.list', {}, 'options').then((res) => {
      if (res.ok) setSkills(res.data);
    });
  }, []);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh({ toast: true });
    } finally {
      setRefreshing(false);
    }
  };

  const now = Date.now();
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const startOfYesterday = startOfToday - 24 * 3600 * 1000;

  const countForPreset = useCallback(
    (val: TimeFilter) => {
      return words.filter((w) => {
        if (w.kind === 'sentence') return false;
        const ct = w.createdAt;
        if (val === 'today') return ct >= startOfToday;
        if (val === 'yesterday')
          return ct >= startOfYesterday && ct < startOfToday;
        if (val === 'week') return now - ct <= 7 * 24 * 3600 * 1000;
        if (val === 'month') return now - ct <= 30 * 24 * 3600 * 1000;
        if (val === 'custom') {
          const from = startOfDayMs(customFrom);
          const to = endOfDayMs(customTo);
          return ct >= from && ct <= to;
        }
        return true;
      }).length;
    },
    [words, startOfToday, startOfYesterday, now, customFrom, customTo],
  );

  const filteredWords = useMemo(() => {
    let list = words.filter((w) => {
      if (w.kind === 'sentence') return false;
      const ct = w.createdAt;
      switch (filter) {
        case 'today':
          return ct >= startOfToday;
        case 'yesterday':
          return ct >= startOfYesterday && ct < startOfToday;
        case 'week':
          return now - ct <= 7 * 24 * 3600 * 1000;
        case 'month':
          return now - ct <= 30 * 24 * 3600 * 1000;
        case 'custom': {
          const from = startOfDayMs(customFrom);
          const to = endOfDayMs(customTo);
          if (from > to) return false;
          return ct >= from && ct <= to;
        }
        case 'all':
        default:
          return true;
      }
    });

    if (statusFilter !== 'all') {
      const t = Date.now();
      list = list.filter((w) => {
        if (statusFilter === 'due') return w.nextReviewAt <= t;
        if (statusFilter === 'new')
          return (w.learningStatus ?? 'new') === 'new' && w.reviewStage === 0;
        if (statusFilter === 'learning')
          return (
            (w.learningStatus ?? 'new') === 'learning' ||
            (w.reviewStage > 0 && w.reviewStage < 4)
          );
        if (statusFilter === 'learned')
          return (
            (w.learningStatus ?? 'new') === 'learned' || w.reviewStage >= 4
          );
        return true;
      });
    }

    if (listQuery.trim()) {
      const q = listQuery.trim().toLowerCase();
      list = list.filter(
        (w) =>
          w.surface.toLowerCase().includes(q) ||
          (w.translation?.toLowerCase().includes(q) ?? false) ||
          (w.context?.toLowerCase().includes(q) ?? false),
      );
    }

    list = list.slice();
    switch (listSort) {
      case 'oldest':
        list.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case 'alpha':
        list.sort((a, b) =>
          a.surface.localeCompare(b.surface, undefined, {
            sensitivity: 'base',
          }),
        );
        break;
      case 'due':
        list.sort((a, b) => a.nextReviewAt - b.nextReviewAt);
        break;
      case 'newest':
      default:
        list.sort((a, b) => b.createdAt - a.createdAt);
        break;
    }

    return list;
  }, [
    words,
    filter,
    customFrom,
    customTo,
    startOfToday,
    startOfYesterday,
    now,
    statusFilter,
    listQuery,
    listSort,
  ]);

  // Sync selection map: new words default selected; keep user unchecks
  useEffect(() => {
    setSelectedWordIds((prev) => {
      const next: Record<number, boolean> = {};
      for (const w of filteredWords) {
        if (w.id == null) continue;
        if (!selectionInitialized.current) {
          next[w.id] = true;
        } else {
          next[w.id] = prev[w.id] !== undefined ? prev[w.id]! : true;
        }
      }
      selectionInitialized.current = true;
      return next;
    });
  }, [filteredWords]);

  const studyList = useMemo(() => {
    if (manualSelect) {
      return filteredWords.filter((w) => w.id != null && selectedWordIds[w.id]);
    }
    return filteredWords;
  }, [filteredWords, manualSelect, selectedWordIds]);

  /** During study/analysis UI, use session snapshot when available. */
  const activeList = isStudying || isAnalyzing ? sessionWords : studyList;

  const selectedCount = studyList.length;
  const allSelected =
    filteredWords.length > 0 &&
    filteredWords.every((w) => w.id != null && selectedWordIds[w.id]);

  const selectAll = () => {
    const map: Record<number, boolean> = {};
    filteredWords.forEach((w) => {
      if (w.id != null) map[w.id] = true;
    });
    setSelectedWordIds(map);
  };

  const selectNone = () => {
    const map: Record<number, boolean> = {};
    filteredWords.forEach((w) => {
      if (w.id != null) map[w.id] = false;
    });
    setSelectedWordIds(map);
  };

  const invertSelection = () => {
    setSelectedWordIds((prev) => {
      const next: Record<number, boolean> = {};
      filteredWords.forEach((w) => {
        if (w.id != null) next[w.id] = !prev[w.id];
      });
      return next;
    });
  };

  const resolveStudySkill = async (): Promise<SkillRecord | null> => {
    let current = skills;
    if (current.length === 0) {
      const res = await sendRuntime<SkillRecord[]>('skill.list', {}, 'options');
      if (res.ok) {
        current = res.data;
        setSkills(res.data);
      }
    }
    let studySkill =
      current.find((s) => s.id === BUILTIN_SKILL_IDS.studyReview) ??
      current.find((s) => s.name === 'AI 单词深度复习');

    if (!studySkill) {
      const saveRes = await sendRuntime<SkillRecord>(
        'skill.save',
        {
          id: BUILTIN_SKILL_IDS.studyReview,
          name: 'AI 单词深度复习',
          systemPrompt: SKILL_STUDY_REVIEW_PROMPT,
          enabled: true,
        },
        'options',
      );
      if (saveRes.ok) {
        studySkill = saveRes.data;
        const listRes = await sendRuntime<SkillRecord[]>(
          'skill.list',
          {},
          'options',
        );
        if (listRes.ok) setSkills(listRes.data);
      }
    }
    return studySkill ?? null;
  };

  const handleStart = async () => {
    if (studyList.length === 0) return;

    abortRef.current = false;
    // Deep-enough snapshot for this session
    const queue = studyList.map((w) => ({ ...w }));
    setSessionWords(queue);
    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisError(null);

    const studySkill = await resolveStudySkill();
    if (!studySkill) {
      setAnalysisError('无法加载「AI 单词深度复习」指令，请到「自定义 AI 指令」检查。');
      setIsAnalyzing(false);
      setSessionWords([]);
      return;
    }

    for (let i = 0; i < queue.length; i++) {
      if (abortRef.current) {
        setIsAnalyzing(false);
        setSessionWords([]);
        return;
      }

      const word = queue[i]!;
      if (word.explanation) {
        setAnalysisProgress(i + 1);
        continue;
      }

      try {
        const res = await sendRuntime<{ text: string }>(
          'skill.run',
          {
            skillId: studySkill.id,
            text: word.surface,
            context: word.context || '',
          },
          'options',
        );

        if (abortRef.current) return;
        if (!res.ok) throw new Error(res.error.message);

        const updated = await sendRuntime<WordRecord>(
          'word.add',
          {
            surface: word.surface,
            explanation: res.data.text,
            explainEngine: 'llm',
            explainProvider: providerId,
            context: word.context,
            translation: word.translation,
          },
          'options',
        );

        if (abortRef.current) return;

        word.explanation = updated.ok
          ? updated.data.explanation ?? res.data.text
          : res.data.text;
        // Push explanation into session state for UI
        setSessionWords((prev) =>
          prev.map((w, idx) =>
            idx === i ? { ...w, explanation: word.explanation } : w,
          ),
        );

        setAnalysisProgress(i + 1);
      } catch (e) {
        if (!abortRef.current) {
          const errMsg = e instanceof Error ? e.message : String(e);
          setAnalysisError(`处理单词 "${word.surface}" 失败: ${errMsg}`);
          setIsAnalyzing(false);
        }
        return;
      }
    }

    if (abortRef.current) return;

    setSessionWords(queue.map((w) => ({ ...w })));
    setIsAnalyzing(false);
    setIsStudying(true);
    setCurrentIndex(0);
  };

  const handleStop = () => {
    setIsStudying(false);
    setIsAnalyzing(false);
    setSessionWords([]);
    abortRef.current = true;
    void onRefresh({ silent: true });
  };

  const handleSpeak = (text: string) => {
    void (async () => {
      const chunksRes = await sendRuntime<{
        chunks: Array<{ audioBase64: string; contentType: string }>;
      }>('tts.synthChunks', { text }, 'options');
      if (chunksRes.ok && chunksRes.data.chunks?.length) {
        const { playTtsAudioChunks, stopTtsPlayback } = await import(
          '../../utils/tts-playback/play-chunks'
        );
        stopTtsPlayback();
        await playTtsAudioChunks(chunksRes.data.chunks);
        return;
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        window.speechSynthesis.speak(u);
      }
    })();
  };

  const handleReview = async (result: ReviewResult) => {
    if (activeWord?.id == null) return;
    await sendRuntime(
      'word.updateReview',
      { id: activeWord.id, result },
      'options',
    );
    setCurrentIndex((prev) => prev + 1);
  };

  const activeWord = activeList[currentIndex];
  const sessionLen = activeList.length;

  if (isAnalyzing) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🤖</div>
        <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#fff' }}>
          AI 助教正在为您分析单词...
        </h2>
        <p className="muted" style={{ margin: '8px 0 24px 0', fontSize: '13px' }}>
          正在生成词根词缀、近反义词与场景例句，请稍候。
        </p>
        <div
          style={{
            width: '320px',
            height: '8px',
            background: 'var(--rf-border)',
            borderRadius: '4px',
            margin: '0 auto 16px auto',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${sessionLen ? (analysisProgress / sessionLen) * 100 : 0}%`,
              height: '100%',
              background: 'var(--rf-brand)',
              transition: 'width .3s ease',
            }}
          />
        </div>
        <div
          className="status"
          style={{
            display: 'inline-block',
            padding: '8px 16px',
            background: 'rgba(255,255,255,.05)',
            borderRadius: '4px',
            fontSize: '12px',
          }}
        >
          正在处理: 第 {Math.min(analysisProgress + 1, sessionLen)} 个，共{' '}
          {sessionLen} 个单词...
        </div>
        <div style={{ marginTop: '24px' }}>
          <button type="button" className="ghost" onClick={handleStop}>
            取消复习
          </button>
        </div>
      </div>
    );
  }

  if (!isStudying) {
    const totalWords = words.filter((w) => w.kind !== 'sentence').length;
    const customInvalid =
      filter === 'custom' && startOfDayMs(customFrom) > endOfDayMs(customTo);

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
              背单词 / AI 复习
            </h1>
            <p className="page-desc" style={{ marginBottom: 0 }}>
              按时间与状态筛选生词，勾选后由 AI 生成深度解析并进入间隔复习。
            </p>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 6,
            }}
          >
            <button
              type="button"
              className="ghost"
              disabled={refreshing || loading}
              onClick={() => void handleManualRefresh()}
            >
              {refreshing || loading ? '同步中…' : '↻ 同步生词'}
            </button>
            <span className="muted" style={{ fontSize: 11 }}>
              {formatSyncedAt(syncedAt)} · 词库 {totalWords} 词
            </span>
          </div>
        </div>

        {!isAiConfigured && (
          <div
            className="card"
            style={{
              borderColor: '#f87171',
              background: 'rgba(239, 68, 68, 0.08)',
              color: '#f87171',
            }}
          >
            <h3 style={{ margin: '0 0 6px' }}>⚠️ 尚未配置 AI 功能</h3>
            <p style={{ margin: '0 0 12px', fontSize: 13, opacity: 0.9 }}>
              此功能需要 API Key。请先前往翻译设置配置。
            </p>
            <button
              type="button"
              className="primary"
              style={{ background: '#ef4444', border: 'none' }}
              onClick={() => {
                window.location.hash = '#/translation';
              }}
            >
              去配置 AI Key
            </button>
          </div>
        )}

        {analysisError && (
          <div
            className="card"
            style={{
              borderColor: '#ef4444',
              background: 'rgba(239,68,68,.08)',
              color: '#ff8888',
              marginBottom: '16px',
            }}
          >
            <h3 style={{ margin: '0 0 6px' }}>⚠️ 复习准备失败</h3>
            <p style={{ margin: '0 0 12px', fontSize: '13px' }}>
              {analysisError}
            </p>
            <button type="button" className="primary" onClick={handleStart}>
              重新尝试
            </button>
          </div>
        )}

        {totalWords === 0 && (
          <div
            className="card"
            style={{ borderColor: 'oklch(76% 0.12 82 / 0.45)' }}
          >
            <h3 style={{ margin: '0 0 6px' }}>生词本还是空的</h3>
            <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
              在视频划词 / 画中画添加生词后会自动同步。
            </p>
            <button
              type="button"
              className="primary"
              disabled={refreshing || loading}
              onClick={() => void handleManualRefresh()}
            >
              立即同步
            </button>
          </div>
        )}

        <div className="card">
          <h2>1. 时间范围</h2>
          <p className="hint">按添加日期筛选；可自定义起止日期。</p>
          <div
            style={{
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
              margin: '14px 0',
            }}
          >
            {(
              [
                ['today', '今天'],
                ['yesterday', '昨天'],
                ['week', '近 7 天'],
                ['month', '近 30 天'],
                ['all', '全部'],
                ['custom', '自定义'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={filter === val ? 'primary' : 'ghost'}
                onClick={() => setFilter(val)}
              >
                {label} ({countForPreset(val)})
              </button>
            ))}
          </div>

          {filter === 'custom' && (
            <div
              className="row"
              style={{
                marginTop: 8,
                marginBottom: 8,
                alignItems: 'end',
                gap: 12,
              }}
            >
              <div className="field">
                <label>开始日期</label>
                <input
                  type="date"
                  value={customFrom}
                  max={customTo}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </div>
              <div className="field">
                <label>结束日期</label>
                <input
                  type="date"
                  value={customTo}
                  min={customFrom}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </div>
              <div className="muted" style={{ fontSize: 12, paddingBottom: 12 }}>
                含首尾整天 · {countForPreset('custom')} 词
              </div>
            </div>
          )}
          {customInvalid && (
            <p style={{ color: '#f87171', fontSize: 12, margin: '0 0 8px' }}>
              开始日期不能晚于结束日期
            </p>
          )}
        </div>

        <div className="card">
          <h2>2. 单词列表</h2>
          <p className="hint">
            支持搜索、状态筛选与排序；勾选要复习的词。已有 AI 解析的词会跳过预分析。
          </p>

          <div
            className="row"
            style={{ marginBottom: 10, alignItems: 'end', gap: 10 }}
          >
            <div style={{ flex: 2, minWidth: 160 }}>
              <label>搜索</label>
              <input
                placeholder="单词 / 释义 / 上下文…"
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
              />
            </div>
            <div>
              <label>状态</label>
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as StatusFilter)
                }
              >
                <option value="all">全部状态</option>
                <option value="due">待复习</option>
                <option value="new">新词</option>
                <option value="learning">学习中</option>
                <option value="learned">已掌握</option>
              </select>
            </div>
            <div>
              <label>排序</label>
              <select
                value={listSort}
                onChange={(e) => setListSort(e.target.value as ListSort)}
              >
                <option value="newest">最新添加</option>
                <option value="oldest">最早添加</option>
                <option value="alpha">字母序</option>
                <option value="due">复习时间</option>
              </select>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <label className="checkbox" style={{ marginBottom: 0 }}>
              <input
                type="checkbox"
                checked={manualSelect}
                onChange={(e) => setManualSelect(e.target.checked)}
              />
              手动勾选学习
            </label>
            {manualSelect && (
              <>
                <button type="button" className="ghost" onClick={selectAll}>
                  全选
                </button>
                <button type="button" className="ghost" onClick={selectNone}>
                  全不选
                </button>
                <button type="button" className="ghost" onClick={invertSelection}>
                  反选
                </button>
              </>
            )}
            <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
              列表 {filteredWords.length} · 将复习 {selectedCount}
              {allSelected && filteredWords.length > 0 ? '（已全选）' : ''}
            </span>
          </div>

          {filteredWords.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              当前筛选下没有单词。试试「全部」时间范围，或点同步生词。
            </p>
          ) : (
            <div
              className="study-word-list"
              style={{
                maxHeight: 360,
                overflowY: 'auto',
                border: '1px solid var(--rf-border)',
                borderRadius: 'var(--rf-radius)',
                background: 'rgba(0,0,0,.12)',
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13,
                }}
              >
                <thead
                  style={{
                    position: 'sticky',
                    top: 0,
                    background: 'var(--rf-card)',
                    zIndex: 1,
                  }}
                >
                  <tr className="muted" style={{ textAlign: 'left' }}>
                    {manualSelect && (
                      <th style={{ padding: '8px 10px', width: 36 }} />
                    )}
                    <th style={{ padding: '8px 10px' }}>单词</th>
                    <th style={{ padding: '8px 10px' }}>释义</th>
                    <th style={{ padding: '8px 10px', width: 88 }}>状态</th>
                    <th style={{ padding: '8px 10px', width: 100 }}>添加日</th>
                    <th style={{ padding: '8px 10px', width: 56 }}>AI</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWords.map((w) => {
                    const st = statusLabel(w);
                    const checked =
                      w.id != null && selectedWordIds[w.id] !== false;
                    return (
                      <tr
                        key={w.id}
                        style={{
                          borderTop: '1px solid var(--rf-border)',
                          opacity: manualSelect && !checked ? 0.55 : 1,
                        }}
                      >
                        {manualSelect && (
                          <td style={{ padding: '8px 10px' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (w.id == null) return;
                                setSelectedWordIds({
                                  ...selectedWordIds,
                                  [w.id]: e.target.checked,
                                });
                              }}
                              aria-label={`选择 ${w.surface}`}
                            />
                          </td>
                        )}
                        <td style={{ padding: '8px 10px' }}>
                          <strong>{w.surface}</strong>
                          {w.phonetic && (
                            <div className="muted" style={{ fontSize: 11 }}>
                              {w.phonetic}
                            </div>
                          )}
                        </td>
                        <td
                          className="muted"
                          style={{
                            padding: '8px 10px',
                            maxWidth: 220,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={w.translation || w.context}
                        >
                          {w.translation ||
                            (w.context ? `…${w.context.slice(0, 40)}` : '—')}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: statusColor(st),
                            }}
                          >
                            {st}
                          </span>
                        </td>
                        <td className="muted" style={{ padding: '8px 10px', fontSize: 11 }}>
                          {new Date(w.createdAt).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 12 }}>
                          {w.explanation ? (
                            <span title="已有 AI 解析">✓</span>
                          ) : (
                            <span className="muted" title="开始复习时将生成">
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div
            style={{
              marginTop: 20,
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <button
              type="button"
              className="primary"
              disabled={
                !isAiConfigured ||
                selectedCount === 0 ||
                customInvalid ||
                refreshing
              }
              onClick={() => void handleStart()}
              style={{ padding: '10px 24px', fontSize: 14 }}
            >
              开始复习 ({selectedCount} 个单词)
            </button>
            <button
              type="button"
              className="ghost"
              disabled={refreshing || loading}
              onClick={() => void handleManualRefresh()}
            >
              {refreshing || loading ? '同步中…' : '刷新列表'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (currentIndex >= sessionLen || !activeWord) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎉</div>
        <h2 style={{ fontSize: '20px', fontWeight: 'bold' }}>复习完成！</h2>
        <p className="muted" style={{ margin: '8px 0 24px 0' }}>
          太棒了！您已学完本组选定的所有单词。
        </p>
        <button type="button" className="primary" onClick={handleStop}>
          返回列表
        </button>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <button type="button" className="ghost" onClick={handleStop}>
          ← 退出复习
        </button>
        <span className="muted" style={{ fontSize: '13px' }}>
          进度: {currentIndex + 1} / {sessionLen}
        </span>
      </div>

      <div
        style={{
          width: '100%',
          height: '6px',
          background: 'var(--rf-border)',
          borderRadius: '3px',
          overflow: 'hidden',
          marginBottom: '24px',
        }}
      >
        <div
          style={{
            width: `${sessionLen ? ((currentIndex + 1) / sessionLen) * 100 : 0}%`,
            height: '100%',
            background: 'var(--rf-brand)',
            transition: 'width .2s ease',
          }}
        />
      </div>

      <div
        className="card"
        style={{
          padding: '24px',
          textAlign: 'center',
          minHeight: '320px',
          position: 'relative',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '8px',
          }}
        >
          <h1 style={{ fontSize: '28px', margin: 0, fontWeight: 800 }}>
            {activeWord.surface}
          </h1>
          <button
            type="button"
            className="ghost"
            title="朗读单词"
            onClick={() => handleSpeak(activeWord.surface)}
            style={{
              padding: '4px 8px',
              fontSize: '16px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
            }}
          >
            🔊
          </button>
        </div>

        {activeWord.phonetic && (
          <div className="muted" style={{ fontSize: '14px', marginBottom: '16px' }}>
            [{activeWord.phonetic}]
          </div>
        )}

        {activeWord.translation && (
          <div
            style={{
              background: 'rgba(255,255,255,.03)',
              border: '1px solid var(--rf-border)',
              padding: '8px 12px',
              borderRadius: 'var(--rf-radius)',
              display: 'inline-block',
              fontSize: '13px',
              margin: '0 auto 20px auto',
              maxWidth: '90%',
            }}
          >
            <strong>释义快照:</strong> {activeWord.translation}
          </div>
        )}

        {activeWord.context && (
          <div
            style={{
              textAlign: 'left',
              marginTop: '16px',
              padding: '12px',
              borderLeft: '3px solid var(--rf-brand)',
              background: 'rgba(255,255,255, .02)',
              fontSize: '13px',
              borderRadius: '0 4px 4px 0',
              marginBottom: '20px',
            }}
          >
            <div style={{ opacity: 0.8, fontWeight: 600, marginBottom: '4px' }}>
              保存时的上下文：
            </div>
            <div style={{ fontStyle: 'italic', lineHeight: 1.4 }}>
              &quot;{activeWord.context}&quot;
            </div>
            {activeWord.contextTranslation && (
              <div className="muted" style={{ marginTop: '4px', fontSize: '12px' }}>
                (翻译: {activeWord.contextTranslation})
              </div>
            )}
          </div>
        )}

        <div
          style={{
            marginTop: '20px',
            borderTop: '1px solid var(--rf-border)',
            paddingTop: '20px',
            textAlign: 'left',
          }}
        >
          <div
            className="study-explanation-container"
            dangerouslySetInnerHTML={{
              __html: marked.parse(activeWord.explanation || '_暂无解析_') as string,
            }}
          />
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '12px',
          marginTop: '24px',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={() => void handleReview('again')}
          style={{
            flex: 1,
            padding: '12px',
            background: '#ef4444',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--rf-radius)',
            fontWeight: 'bold',
            cursor: 'pointer',
            minWidth: '100px',
          }}
        >
          Again (忘光了)
        </button>
        <button
          type="button"
          onClick={() => void handleReview('hard')}
          style={{
            flex: 1,
            padding: '12px',
            background: '#f59e0b',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--rf-radius)',
            fontWeight: 'bold',
            cursor: 'pointer',
            minWidth: '100px',
          }}
        >
          Hard (模糊)
        </button>
        <button
          type="button"
          onClick={() => void handleReview('good')}
          style={{
            flex: 1,
            padding: '12px',
            background: 'oklch(76.034% 0.12361 82.191)',
            color: '#1a1a1a',
            border: 'none',
            borderRadius: 'var(--rf-radius)',
            fontWeight: 'bold',
            cursor: 'pointer',
            minWidth: '100px',
          }}
        >
          Good (记得)
        </button>
        <button
          type="button"
          onClick={() => void handleReview('easy')}
          style={{
            flex: 1,
            padding: '12px',
            background: '#10b981',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--rf-radius)',
            fontWeight: 'bold',
            cursor: 'pointer',
            minWidth: '100px',
          }}
        >
          Easy (秒杀)
        </button>
      </div>
    </div>
  );
}
