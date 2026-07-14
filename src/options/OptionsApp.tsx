import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sendRuntime } from '../shared/messaging/client';
import type { AppConfig } from '../shared/domain/types';
import type { WordRecord, SkillRecord } from '../db/schema';
import { WORDS_REVISION_KEY } from '../shared/constants';
import { NAV_ITEMS, type OptionsRoute } from './nav';
import { GeneralPage } from './pages/GeneralPage';
import { TranslationPage } from './pages/TranslationPage';
import { VideoSubtitlesPage } from './pages/VideoSubtitlesPage';
import { SelectionToolbarPage } from './pages/SelectionToolbarPage';
import { CustomActionsPage } from './pages/CustomActionsPage';
import { TtsPage } from './pages/TtsPage';
import { DictionaryPage } from './pages/Dictionary';
import { StatisticsPage } from './pages/StatisticsPage';
import { ConfigPage } from './pages/ConfigPage';
import { StudyPage } from './pages/Study';

function routeFromHash(): OptionsRoute {
  const h = location.hash.replace(/^#\/?/, '') || 'general';
  const ok = NAV_ITEMS.some((n) => n.id === h);
  return (ok ? h : 'general') as OptionsRoute;
}

type ToastKind = 'success' | 'error' | 'info';

/** Poll interval while on study/dictionary so newly saved words appear without leaving the page. */
const WORDS_POLL_MS = 8_000;

export function OptionsApp() {
  const [route, setRoute] = useState<OptionsRoute>(routeFromHash);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [words, setWords] = useState<WordRecord[]>([]);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [wordsLoading, setWordsLoading] = useState(false);
  const [wordsSyncedAt, setWordsSyncedAt] = useState<number | null>(null);
  const [toast, setToast] = useState<{ text: string; kind: ToastKind } | null>(
    null,
  );
  const toastTimer = useRef<number>(0);
  const lastWordsRev = useRef<number>(0);
  const loadWordsInFlight = useRef(false);

  const loadConfigAndSkills = useCallback(async () => {
    const c = await sendRuntime<AppConfig>('config.get', {}, 'options');
    if (c.ok) setConfig(c.data);
    const s = await sendRuntime<SkillRecord[]>('skill.list', {}, 'options');
    if (s.ok) setSkills(s.data);
  }, []);

  const loadWords = useCallback(async (opts?: { silent?: boolean }) => {
    if (loadWordsInFlight.current) return;
    loadWordsInFlight.current = true;
    if (!opts?.silent) setWordsLoading(true);
    try {
      // No limit → full dictionary (was capped at 200, hiding older/newer ranges)
      const w = await sendRuntime<WordRecord[]>(
        'word.list',
        { limit: 0 },
        'options',
      );
      if (w.ok) {
        setWords(w.data);
        setWordsSyncedAt(Date.now());
      }
    } finally {
      loadWordsInFlight.current = false;
      if (!opts?.silent) setWordsLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    await Promise.all([loadConfigAndSkills(), loadWords()]);
  }, [loadConfigAndSkills, loadWords]);

  const flash = useCallback((msg: string, kind: ToastKind = 'success') => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ text: msg, kind });
    toastTimer.current = window.setTimeout(
      () => setToast(null),
      kind === 'error' ? 4200 : 2800,
    );
  }, []);

  const refreshWords = useCallback(
    async (opts?: { silent?: boolean; toast?: boolean }) => {
      await loadWords({ silent: opts?.silent });
      if (opts?.toast) {
        flash('生词本已同步', 'info');
      }
    },
    [loadWords, flash],
  );

  // Initial + on route change
  useEffect(() => {
    void load();
  }, [route, load]);

  // Auto-sync when words change elsewhere (PiP / toolbar / other options tab)
  useEffect(() => {
    const onStorage = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      const rev = changes[WORDS_REVISION_KEY];
      if (!rev) return;
      const next = Number(rev.newValue ?? 0);
      if (!next || next === lastWordsRev.current) return;
      lastWordsRev.current = next;
      void loadWords({ silent: true });
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, [loadWords]);

  // Refresh when tab becomes visible / focused again
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadWords({ silent: true });
      }
    };
    const onFocus = () => {
      void loadWords({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadWords]);

  // Light polling on study / dictionary so new words appear without user action
  useEffect(() => {
    if (route !== 'study' && route !== 'dictionary') return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadWords({ silent: true });
    }, WORDS_POLL_MS);
    return () => window.clearInterval(id);
  }, [route, loadWords]);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (id: OptionsRoute) => {
    location.hash = `#/${id}`;
    setRoute(id);
  };

  const saveConfig = async (partial: Partial<AppConfig>) => {
    const res = await sendRuntime<AppConfig>('config.set', partial, 'options');
    if (res.ok) {
      setConfig(res.data);
      flash('✓ 设置已保存', 'success');
    } else {
      flash(`保存失败：${res.error.message}`, 'error');
    }
  };

  const settingsItems = useMemo(
    () => NAV_ITEMS.filter((n) => n.group === 'settings'),
    [],
  );
  const toolItems = useMemo(
    () => NAV_ITEMS.filter((n) => n.group === 'tools'),
    [],
  );

  const wordCount = words.filter((w) => w.kind !== 'sentence').length;

  if (!config) {
    return <div className="main">加载设置…</div>;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={chrome.runtime.getURL('public/icons/icon48.png')} alt="logo" />
          UniEnglishHelper
        </div>
        <div className="nav-group-label">Settings</div>
        {settingsItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${route === item.id ? 'active' : ''}`}
            onClick={() => navigate(item.id)}
          >
            <span className="ico">{item.icon}</span>
            {item.label}
          </button>
        ))}
        <div className="nav-group-label">Tools</div>
        {toolItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${route === item.id ? 'active' : ''}`}
            onClick={() => navigate(item.id)}
          >
            <span className="ico">{item.icon}</span>
            {item.id === 'dictionary'
              ? `${item.label} (${wordCount})`
              : item.id === 'study'
                ? `${item.label}${wordCount ? ` (${wordCount})` : ''}`
                : item.label}
          </button>
        ))}
      </aside>

      <main className="main">
        {route === 'general' && (
          <GeneralPage config={config} onSave={saveConfig} />
        )}
        {route === 'translation' && (
          <TranslationPage config={config} onSave={saveConfig} />
        )}
        {route === 'video-subtitles' && (
          <VideoSubtitlesPage config={config} onSave={saveConfig} />
        )}
        {route === 'selection-toolbar' && (
          <SelectionToolbarPage
            config={config}
            skills={skills}
            onSave={saveConfig}
          />
        )}
        {route === 'custom-actions' && (
          <CustomActionsPage
            skills={skills}
            onChanged={async () => {
              await load();
              flash('✓ 自定义指令已更新', 'success');
            }}
          />
        )}
        {route === 'tts' && <TtsPage config={config} onSave={saveConfig} />}
        {route === 'dictionary' && (
          <DictionaryPage
            words={words}
            loading={wordsLoading}
            syncedAt={wordsSyncedAt}
            onRefresh={async () => {
              await refreshWords({ toast: true });
            }}
            onReview={async (id, result) => {
              await sendRuntime('word.updateReview', { id, result }, 'options');
              await loadWords({ silent: true });
              flash(`复习已记录：${result}`, 'success');
            }}
            onDelete={async (id) => {
              await sendRuntime('word.delete', { id }, 'options');
              await loadWords({ silent: true });
              flash('词条已删除', 'success');
            }}
          />
        )}
        {route === 'statistics' && <StatisticsPage />}
        {route === 'study' && (
          <StudyPage
            config={config}
            words={words}
            loading={wordsLoading}
            syncedAt={wordsSyncedAt}
            onRefresh={async (opts) => {
              await refreshWords({
                silent: opts?.silent,
                toast: opts?.toast ?? true,
              });
            }}
          />
        )}
        {route === 'config' && (
          <ConfigPage
            config={config}
            onSave={saveConfig}
            onToast={(msg) => flash(msg, 'success')}
          />
        )}
      </main>

      {toast && (
        <div
          className={`toast toast-${toast.kind === 'error' ? 'error' : 'success'}`}
          role="status"
          aria-live="polite"
        >
          <span className="toast-icon">
            {toast.kind === 'error' ? '!' : '✓'}
          </span>
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
