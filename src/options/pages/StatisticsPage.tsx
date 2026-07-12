import React, { useEffect, useMemo, useState } from 'react';
import { sendRuntime } from '../../shared/messaging/client';
import { EXT_VERSION } from '../../shared/version';
import type { WordRecord } from '../../db/schema';

interface Stats {
  words: number;
  due: number;
  clips: number;
  clipsBytes: number;
  translations: number;
  tts: number;
  skills: number;
  reviewLogs: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Last 14 days review activity (from review_logs via word list + local estimate). */
function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function StatisticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [words, setWords] = useState<WordRecord[]>([]);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const res = await sendRuntime<Stats>('stats.dashboard', {}, 'options');
    if (res.ok) setStats(res.data);
    const w = await sendRuntime<WordRecord[]>(
      'word.list',
      { limit: 500 },
      'options',
    );
    if (w.ok) setWords(w.data);
  };

  useEffect(() => {
    void load();
  }, []);

  const stageBuckets = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0, 0, 0];
    for (const w of words) {
      const s = Math.min(6, Math.max(0, w.reviewStage));
      buckets[s] += 1;
    }
    return buckets;
  }, [words]);

  const addedLast14 = useMemo(() => {
    const days: { key: string; count: number }[] = [];
    const map = new Map<string, number>();
    const now = Date.now();
    for (let i = 13; i >= 0; i--) {
      const t = now - i * 24 * 60 * 60_000;
      const k = dayKey(t);
      map.set(k, 0);
      days.push({ key: k, count: 0 });
    }
    for (const w of words) {
      const k = dayKey(w.createdAt);
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + 1);
    }
    return days.map((d) => ({ ...d, count: map.get(d.key) ?? 0 }));
  }, [words]);

  const maxBar = Math.max(1, ...addedLast14.map((d) => d.count));
  const maxStage = Math.max(1, ...stageBuckets);

  const clear = async (scopes: Array<'translation' | 'tts' | 'clips'>) => {
    const res = await sendRuntime('cache.clear', { scopes }, 'options');
    if (res.ok) {
      setMsg(`已清理: ${JSON.stringify(res.data)}`);
      await load();
    } else setMsg(res.error.message);
  };

  const exportDiag = async () => {
    const res = await sendRuntime<Record<string, unknown>>(
      'diag.export',
      {},
      'options',
    );
    if (!res.ok) {
      setMsg(res.error.message);
      return;
    }
    const blob = new Blob([JSON.stringify(res.data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ueh-diag-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg('诊断信息已导出');
  };

  if (!stats) return <div className="card">加载统计…</div>;

  return (
    <div>
      <h1 className="page-title">统计</h1>
      <p className="page-desc">
        学习数据、复习阶段分布与缓存占用（对应 read-frog Statistics）。
      </p>

      <div className="card">
        <h2>学习概览 · v{EXT_VERSION}</h2>
        <div className="row">
          <Stat label="生词" value={String(stats.words)} />
          <Stat label="待复习" value={String(stats.due)} />
          <Stat label="原声片段" value={String(stats.clips)} />
          <Stat label="音频占用" value={formatBytes(stats.clipsBytes)} />
          <Stat label="翻译缓存" value={String(stats.translations)} />
          <Stat label="TTS 缓存" value={String(stats.tts)} />
          <Stat label="Skills" value={String(stats.skills)} />
          <Stat label="复习记录" value={String(stats.reviewLogs)} />
        </div>
      </div>

      <div className="card">
        <h2>近 14 天新增生词</h2>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 4,
            height: 120,
            paddingTop: 8,
          }}
        >
          {addedLast14.map((d) => (
            <div
              key={d.key}
              title={`${d.key}: ${d.count}`}
              style={{
                flex: 1,
                background: 'oklch(76% 0.12 82)',
                borderRadius: '4px 4px 0 0',
                height: `${Math.max(4, (d.count / maxBar) * 100)}%`,
                opacity: d.count === 0 ? 0.25 : 1,
              }}
            />
          ))}
        </div>
        <div
          className="muted"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            marginTop: 6,
          }}
        >
          <span>{addedLast14[0]?.key.slice(5)}</span>
          <span>{addedLast14[addedLast14.length - 1]?.key.slice(5)}</span>
        </div>
      </div>

      <div className="card">
        <h2>复习阶段分布</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {stageBuckets.map((count, stage) => (
            <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="muted" style={{ width: 56, fontSize: 12 }}>
                Stage {stage}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 10,
                  background: '#21262d',
                  borderRadius: 999,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${(count / maxStage) * 100}%`,
                    height: '100%',
                    background: 'oklch(70% 0.1 82)',
                    borderRadius: 999,
                  }}
                />
              </div>
              <span style={{ width: 32, textAlign: 'right', fontSize: 13 }}>
                {count}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>维护</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="primary"
            onClick={() => clear(['translation'])}
          >
            清理翻译缓存
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => clear(['tts'])}
          >
            清理 TTS 缓存
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => clear(['clips'])}
          >
            清理音频片段
          </button>
          <button type="button" className="primary" onClick={exportDiag}>
            导出诊断
          </button>
          <button type="button" className="primary" onClick={load}>
            刷新
          </button>
        </div>
        {msg && (
          <p className="muted" style={{ marginTop: 12 }}>
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div
      style={{
        background: '#0d1117',
        borderRadius: 8,
        padding: 12,
        border: '1px solid #30363d',
        minWidth: 100,
      }}
    >
      <div className="muted">{props.label}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{props.value}</div>
    </div>
  );
}
