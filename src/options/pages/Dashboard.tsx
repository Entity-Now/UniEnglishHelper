import React, { useEffect, useState } from 'react';
import { sendRuntime } from '../../shared/messaging/client';
import { EXT_VERSION } from '../../shared/version';

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

export function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const res = await sendRuntime<Stats>('stats.dashboard', {}, 'options');
    if (res.ok) setStats(res.data);
  };

  useEffect(() => {
    void load();
  }, []);

  const clear = async (scopes: Array<'translation' | 'tts' | 'clips'>) => {
    const res = await sendRuntime('cache.clear', { scopes }, 'options');
    if (res.ok) {
      setMsg(`Cleared: ${JSON.stringify(res.data)}`);
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
    setMsg('Diagnostic exported');
  };

  if (!stats) return <div className="card">Loading dashboard…</div>;

  return (
    <div>
      <div className="card">
        <h2>Learning overview · v{EXT_VERSION}</h2>
        <div className="row">
          <Stat label="Words" value={String(stats.words)} />
          <Stat label="Due for review" value={String(stats.due)} />
          <Stat label="Audio clips" value={String(stats.clips)} />
          <Stat label="Clip storage" value={formatBytes(stats.clipsBytes)} />
          <Stat label="Translation cache" value={String(stats.translations)} />
          <Stat label="TTS cache" value={String(stats.tts)} />
          <Stat label="Skills" value={String(stats.skills)} />
          <Stat label="Review logs" value={String(stats.reviewLogs)} />
        </div>
      </div>
      <div className="card">
        <h2>Maintenance</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="primary" onClick={() => clear(['translation'])}>
            Clear translation cache
          </button>
          <button type="button" className="primary" onClick={() => clear(['tts'])}>
            Clear TTS cache
          </button>
          <button type="button" className="primary" onClick={() => clear(['clips'])}>
            Clear audio clips
          </button>
          <button type="button" className="primary" onClick={exportDiag}>
            Export diagnostics
          </button>
          <button type="button" className="primary" onClick={load}>
            Refresh
          </button>
        </div>
        {msg && <p className="muted" style={{ marginTop: 12 }}>{msg}</p>}
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
      }}
    >
      <div className="muted">{props.label}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{props.value}</div>
    </div>
  );
}
