import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sendRuntime } from '../shared/messaging/client';
import { createEnvelope } from '../shared/messages/envelope';
import type { AppConfig, CaptureState } from '../shared/domain/types';
import type { LearningStatus, WordRecord } from '../db/schema';
import { EXT_VERSION } from '../shared/version';
import {
  getOnboardingUrl,
  getPermissionStatus,
  getTabCaptureStreamId,
  isRestrictedUrl,
  requestAllPermissions,
  requestOriginPermission,
  type PermissionStatus,
} from '../shared/permissions';
import {
  isSiteEnabled,
  toggleHostnameInBlacklist,
} from '../utils/site-control';

type PopupView = 'home' | 'vocab';

const STATUS_LABEL: Record<LearningStatus, string> = {
  new: '新词',
  learning: '学习中',
  learned: '已掌握',
};

export function PopupApp() {
  const [view, setView] = useState<PopupView>('home');
  const [tabId, setTabId] = useState<number | null>(null);
  const [tabUrl, setTabUrl] = useState('');
  const [status, setStatus] = useState('准备就绪');
  const [capture, setCapture] = useState<{
    state: CaptureState;
    sessionId?: string;
  }>({ state: 'CaptureIdle' });
  const [busy, setBusy] = useState(false);
  const [perm, setPerm] = useState<PermissionStatus | null>(null);
  const [words, setWords] = useState<WordRecord[]>([]);
  const [vocabFilter, setVocabFilter] = useState<
    'all' | LearningStatus | 'due'
  >('all');
  const [vocabQ, setVocabQ] = useState('');
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [siteDisabled, setSiteDisabled] = useState(false);
  const [pageTrStatus, setPageTrStatus] = useState<{
    status: 'idle' | 'translating' | 'translated' | 'restored' | 'error';
    progress: { total: number; completed: number; failed: number };
    viewMode: 'bilingual' | 'translation_only' | 'original';
  } | null>(null);

  const refreshPerm = useCallback(async () => {
    const s = await getPermissionStatus();
    setPerm(s);
    return s;
  }, []);

  const refresh = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus('没有活动标签页');
      return;
    }
    setTabId(tab.id);
    setTabUrl(tab.url ?? '');
    const res = await sendRuntime<{
      state: CaptureState;
      sessionId?: string;
    }>('capture.status', { tabId: tab.id }, 'popup');
    if (res.ok) {
      setCapture({ state: res.data.state, sessionId: res.data.sessionId });
      setStatus(
        `标签 #${tab.id} · ${
          res.data.state === 'CaptureLive' ? '采集中' : res.data.state
        }`,
      );
    }

    try {
      const pStatus = await chrome.tabs.sendMessage(
        tab.id,
        createEnvelope({
          channel: 'runtime',
          type: 'page.getStatus',
          source: 'popup',
          payload: {},
        }),
      );
      if (pStatus?.ok) {
        setPageTrStatus(pStatus.data);
      }
    } catch {
      setPageTrStatus(null);
    }
  }, []);

  const translatePage = async () => {
    if (!tabId) return;
    setBusy(true);
    try {
      await chrome.tabs.sendMessage(
        tabId,
        createEnvelope({
          channel: 'runtime',
          type: 'page.translate',
          source: 'popup',
          payload: {},
        }),
      );
      setPageTrStatus({
        status: 'translating',
        progress: { total: 0, completed: 0, failed: 0 },
        viewMode: 'bilingual',
      });
      setStatus('正在启动网页翻译...');
    } catch (err) {
      setStatus('发送翻译指令失败');
    } finally {
      setBusy(false);
    }
  };

  const setPageMode = async (mode: 'bilingual' | 'translation_only') => {
    if (!tabId) return;
    await chrome.tabs.sendMessage(
      tabId,
      createEnvelope({
        channel: 'runtime',
        type: 'page.toggleMode',
        source: 'popup',
        payload: { mode },
      }),
    );
    setPageTrStatus((prev) => (prev ? { ...prev, viewMode: mode } : null));
  };

  const restorePage = async () => {
    if (!tabId) return;
    await chrome.tabs.sendMessage(
      tabId,
      createEnvelope({
        channel: 'runtime',
        type: 'page.restore',
        source: 'popup',
        payload: {},
      }),
    );
    setPageTrStatus((prev) =>
      prev ? { ...prev, status: 'restored', viewMode: 'original' } : null,
    );
    setStatus('已恢复网页原文');
  };

  const [showTranslateSettings, setShowTranslateSettings] = useState(false);

  const updateWebPageTranslateConfig = async (
    partial: Partial<AppConfig['webPageTranslate']>,
  ) => {
    if (!appConfig) return;
    const nextConfig = {
      ...appConfig.webPageTranslate,
      ...partial,
    };
    const res = await sendRuntime<AppConfig>(
      'config.set',
      { webPageTranslate: nextConfig },
      'popup',
    );
    if (res.ok) {
      setAppConfig(res.data);
    }
  };

  const loadWords = useCallback(async () => {
    const w = await sendRuntime<WordRecord[]>(
      'word.list',
      { limit: 0 },
      'popup',
    );
    if (w.ok) setWords(w.data);
  }, []);

  const loadConfig = useCallback(async () => {
    const c = await sendRuntime<AppConfig>('config.get', {}, 'popup');
    if (!c.ok) return;
    setAppConfig(c.data);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ?? '';
    if (url) {
      setSiteDisabled(!isSiteEnabled(url, c.data.siteControl));
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshPerm();
    void loadWords();
    void loadConfig();
  }, [refresh, refreshPerm, loadWords, loadConfig]);

  const toggleSiteDisable = async (disabled: boolean) => {
    if (!tabUrl || !appConfig) return;
    setBusy(true);
    try {
      const nextControl = toggleHostnameInBlacklist(
        appConfig.siteControl,
        tabUrl,
        disabled,
      );
      const res = await sendRuntime<AppConfig>(
        'config.set',
        { siteControl: nextControl },
        'popup',
      );
      if (res.ok) {
        setAppConfig(res.data);
        setSiteDisabled(disabled);
        setStatus(
          disabled
            ? '已在此网站禁用扩展（将刷新页面）'
            : '已在此网站启用扩展（将刷新页面）',
        );
        if (tabId != null) {
          void chrome.tabs.reload(tabId);
        }
      } else {
        setStatus(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const grantAllInGesture = async (): Promise<boolean> => {
    try {
      const s = await requestAllPermissions();
      setPerm(s);
      if (s.allSites || s.complete) {
        setStatus('全部权限已授权');
        return true;
      }
      setStatus('权限未完全授予，请在弹窗中选择「允许」');
      return false;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const ensureHostInGesture = async (url: string): Promise<boolean> => {
    const current = perm ?? (await getPermissionStatus());
    if (!current.allSites && !current.complete) {
      return grantAllInGesture();
    }
    try {
      return await requestOriginPermission(url);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const openPip = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      setStatus('没有活动标签页');
      return;
    }
    if (isRestrictedUrl(tab.url)) {
      setStatus('请在普通 https 视频页面使用');
      return;
    }
    setBusy(true);
    setTabId(tab.id);
    setTabUrl(tab.url);
    try {
      if (!(await ensureHostInGesture(tab.url))) return;
      const res = await sendRuntime<{ mode: string }>(
        'pip.open',
        { tabId: tab.id },
        'popup',
      );
      if (!res.ok) setStatus(`${res.error.code}: ${res.error.message}`);
      else if (res.data.mode === 'pending_gesture') {
        setStatus('请到页面点播放器旁的「学习」按钮');
        window.close();
      } else {
        setStatus(`画中画已打开 (${res.data.mode})`);
        window.close();
      }
    } finally {
      setBusy(false);
    }
  };

  const armCapture = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      setStatus('没有活动标签页');
      return;
    }
    if (isRestrictedUrl(tab.url)) {
      setStatus('请在普通 https 视频页面使用');
      return;
    }
    setBusy(true);
    setTabId(tab.id);
    setTabUrl(tab.url);
    try {
      if (!(await ensureHostInGesture(tab.url))) return;
      let streamId: string;
      try {
        streamId = await getTabCaptureStreamId(tab.id);
      } catch (err) {
        setStatus(
          `采集失败: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      const res = await sendRuntime<{ sessionId: string }>(
        'capture.arm',
        { tabId: tab.id, streamId },
        'popup',
      );
      if (!res.ok) setStatus(`${res.error.code}: ${res.error.message}`);
      else {
        setStatus('采集中 · 标签页音频已环回');
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const stopCapture = async () => {
    if (!capture.sessionId) return;
    setBusy(true);
    try {
      await sendRuntime(
        'capture.stop',
        { sessionId: capture.sessionId },
        'popup',
      );
      setStatus('已停止采集');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const setStatusOf = async (id: number, learningStatus: LearningStatus) => {
    await sendRuntime('word.setStatus', { id, learningStatus }, 'popup');
    await loadWords();
  };

  const filteredWords = useMemo(() => {
    const now = Date.now();
    let list = words.slice();
    if (vocabQ) {
      const q = vocabQ.toLowerCase();
      list = list.filter(
        (w) =>
          w.surface.toLowerCase().includes(q) ||
          w.context.toLowerCase().includes(q) ||
          (w.translation?.toLowerCase().includes(q) ?? false),
      );
    }
    if (vocabFilter === 'due') {
      list = list.filter((w) => w.nextReviewAt <= now);
    } else if (vocabFilter !== 'all') {
      list = list.filter(
        (w) => (w.learningStatus ?? 'new') === vocabFilter,
      );
    }
    return list;
  }, [words, vocabFilter, vocabQ]);

  const counts = useMemo(() => {
    const c = { all: words.length, new: 0, learning: 0, learned: 0, due: 0 };
    const now = Date.now();
    for (const w of words) {
      const s = w.learningStatus ?? 'new';
      c[s] += 1;
      if (w.nextReviewAt <= now) c.due += 1;
    }
    return c;
  }, [words]);

  const isRestricted = isRestrictedUrl(tabUrl);
  const needPerm = perm && !perm.allSites && !perm.complete;

  if (view === 'vocab') {
    return (
      <div className="popup popup-vocab">
        <div className="popup-main">
          <div className="popup-header">
            <button
              type="button"
              className="secondary"
              style={{ flex: '0 0 auto', padding: '6px 10px' }}
              onClick={() => setView('home')}
            >
              ← 返回
            </button>
            <div className="popup-brand">生词本</div>
            <span className="popup-version">{counts.all}</span>
          </div>

          <div className="vocab-stats">
            <span>新 {counts.new}</span>
            <span>学 {counts.learning}</span>
            <span>掌握 {counts.learned}</span>
            <span>待复习 {counts.due}</span>
          </div>

          <input
            className="vocab-search"
            placeholder="搜索单词…"
            value={vocabQ}
            onChange={(e) => setVocabQ(e.target.value)}
          />

          <div className="vocab-filters">
            {(
              [
                ['all', '全部'],
                ['new', '新词'],
                ['learning', '学习中'],
                ['learned', '已掌握'],
                ['due', '待复习'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={vocabFilter === id ? 'brand' : 'secondary'}
                onClick={() => setVocabFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="vocab-list">
            {filteredWords.length === 0 && (
              <div className="status">暂无词条。在字幕或网页选词添加。</div>
            )}
            {filteredWords.map((w) => {
              const st = (w.learningStatus ?? 'new') as LearningStatus;
              return (
                <div className="vocab-item" key={w.id}>
                  <div className="vocab-item-top">
                    <strong>{w.surface}</strong>
                    <span className={`vocab-badge vocab-badge-${st}`}>
                      {STATUS_LABEL[st]}
                    </span>
                  </div>
                  {w.kind === 'sentence' && (
                    <div className="vocab-badge vocab-badge-learning" style={{ display: 'inline-block', marginTop: 4 }}>
                      句子
                    </div>
                  )}
                  {w.translation && (
                    <div className="vocab-tr">
                      {w.translation.slice(0, 80)}
                    </div>
                  )}
                  {w.context && (
                    <div className="vocab-ctx">
                      原文：{w.context.slice(0, 100)}
                    </div>
                  )}
                  {w.contextTranslation && (
                    <div className="vocab-ctx">
                      译文：{w.contextTranslation.slice(0, 100)}
                    </div>
                  )}
                  <div className="vocab-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={st === 'new'}
                      onClick={() => w.id != null && void setStatusOf(w.id, 'new')}
                    >
                      新词
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={st === 'learning'}
                      onClick={() =>
                        w.id != null && void setStatusOf(w.id, 'learning')
                      }
                    >
                      学习中
                    </button>
                    <button
                      type="button"
                      className="brand"
                      disabled={st === 'learned'}
                      onClick={() =>
                        w.id != null && void setStatusOf(w.id, 'learned')
                      }
                    >
                      已掌握
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="popup-footer">
          <a
            href={chrome.runtime.getURL('src/options/index.html#/dictionary')}
            target="_blank"
            rel="noreferrer"
          >
            完整生词本
          </a>
          <button
            type="button"
            className="linkish"
            onClick={() => void loadWords()}
          >
            刷新
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="popup">
      <div className="popup-main">
        <div className="popup-header">
          <div className="popup-brand">
            <img src={chrome.runtime.getURL('public/icons/icon48.png')} alt="logo" />
            UniEnglishHelper
          </div>
          <span className="popup-version">v{EXT_VERSION}</span>
        </div>

        {needPerm && (
          <div className="banner-warn">
            权限未完成，部分功能可能不可用。
            <div className="row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="brand"
                disabled={busy}
                onClick={() => void grantAllInGesture()}
              >
                一键授权
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void chrome.tabs.create({ url: getOnboardingUrl() })
                }
              >
                引导页
              </button>
            </div>
          </div>
        )}

        <div className="status">{status}</div>
        {isRestricted && (
          <div className="status" style={{ color: 'var(--rf-destructive)' }}>
            请先打开普通 http(s) 视频网页
          </div>
        )}

        {!isRestricted && tabUrl && (
          <label
            className="site-disable-row"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              fontSize: 12,
              fontWeight: 600,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--rf-border)',
              background: siteDisabled
                ? 'color-mix(in srgb, #e74c3c 12%, transparent)'
                : 'var(--rf-secondary)',
            }}
          >
            <span>在此网站禁用扩展</span>
            <input
              type="checkbox"
              checked={siteDisabled}
              disabled={busy || !appConfig}
              onChange={(e) => void toggleSiteDisable(e.target.checked)}
            />
          </label>
        )}
        {siteDisabled && (
          <div className="status" style={{ color: 'var(--rf-destructive)' }}>
            当前网站已禁用：字幕 / 选区 / PiP 均不会注入
          </div>
        )}

        {!isRestricted && tabUrl && (
          <div
            style={{
              border: '1px solid var(--rf-border)',
              borderRadius: 8,
              padding: '10px 12px',
              marginBottom: 10,
              background: 'color-mix(in srgb, var(--rf-brand) 5%, var(--rf-card))',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <strong style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span>🌐</span> 网页双语翻译
              </strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    fontSize: 11,
                    color:
                      pageTrStatus?.status === 'translating'
                        ? 'var(--rf-brand)'
                        : 'var(--rf-muted-foreground)',
                    fontWeight: 500,
                  }}
                >
                  {pageTrStatus?.status === 'translating'
                    ? `翻译中 ${pageTrStatus.progress.completed}/${pageTrStatus.progress.total || '…'}`
                    : pageTrStatus?.status === 'translated'
                      ? (pageTrStatus.viewMode === 'bilingual' ? '双语对照中' : '仅译文显示')
                      : '就绪'}
                </span>
                <button
                  type="button"
                  className="linkish"
                  title="快速设置"
                  style={{ fontSize: 12, padding: '0 4px', opacity: 0.8 }}
                  onClick={() => setShowTranslateSettings(!showTranslateSettings)}
                >
                  ⚙️
                </button>
              </div>
            </div>

            {showTranslateSettings && appConfig && (
              <div
                style={{
                  background: 'color-mix(in srgb, var(--rf-foreground) 4%, transparent)',
                  borderRadius: 6,
                  padding: '6px 8px',
                  marginBottom: 8,
                  fontSize: 11,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  border: '1px dashed var(--rf-border)',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={appConfig.webPageTranslate?.showFloatingButton !== false}
                    onChange={(e) =>
                      void updateWebPageTranslateConfig({
                        showFloatingButton: e.target.checked,
                      })
                    }
                  />
                  <span>显示页面右下角悬浮翻译球</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(appConfig.webPageTranslate?.autoTranslate)}
                    onChange={(e) =>
                      void updateWebPageTranslateConfig({
                        autoTranslate: e.target.checked,
                      })
                    }
                  />
                  <span>打开网页时自动翻译</span>
                </label>
              </div>
            )}

            {pageTrStatus?.status === 'translated' ? (
              <div className="row" style={{ gap: 6, gridTemplateColumns: '1fr 1fr 1fr' }}>
                <button
                  type="button"
                  className={pageTrStatus.viewMode === 'bilingual' ? 'brand' : 'secondary'}
                  style={{ fontSize: 11, padding: '5px 4px' }}
                  onClick={() => void setPageMode('bilingual')}
                >
                  双语对照
                </button>
                <button
                  type="button"
                  className={pageTrStatus.viewMode === 'translation_only' ? 'brand' : 'secondary'}
                  style={{ fontSize: 11, padding: '5px 4px' }}
                  onClick={() => void setPageMode('translation_only')}
                >
                  仅译文
                </button>
                <button
                  type="button"
                  className="secondary"
                  style={{ fontSize: 11, padding: '5px 4px' }}
                  onClick={() => void restorePage()}
                >
                  恢复原文
                </button>
              </div>
            ) : (
              <div className="row">
                <button
                  type="button"
                  className="brand"
                  disabled={
                    busy ||
                    tabId == null ||
                    isRestricted ||
                    siteDisabled ||
                    pageTrStatus?.status === 'translating'
                  }
                  onClick={() => void translatePage()}
                >
                  {pageTrStatus?.status === 'translating'
                    ? '正在翻译本页...'
                    : '翻译当前网页 (双语对照)'}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="row">
          <button
            type="button"
            className="brand"
            disabled={busy || tabId == null || isRestricted || siteDisabled}
            onClick={() => void openPip()}
          >
            打开学习 PiP
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void loadWords();
              setView('vocab');
            }}
          >
            生词本 ({counts.all})
          </button>
        </div>
        <div className="row">
          <button
            type="button"
            disabled={
              busy ||
              tabId == null ||
              isRestricted ||
              capture.state === 'CaptureLive'
            }
            onClick={() => void armCapture()}
          >
            开始采集
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy || capture.state !== 'CaptureLive'}
            onClick={() => void stopCapture()}
          >
            停止采集
          </button>
        </div>
        <div className="row">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              void refresh();
              void refreshPerm();
            }}
          >
            刷新
          </button>
        </div>

        <ol className="popup-hints">
          <li>播放器「列表」：全部字幕 + 跳转 / 收藏句子</li>
          <li>网页选词：翻译 / 朗读 / 词典 / 加生词</li>
          <li>可在上方禁用当前网站的扩展注入</li>
        </ol>
      </div>

      <div className="popup-footer">
        <a
          href={chrome.runtime.getURL('src/options/index.html')}
          target="_blank"
          rel="noreferrer"
        >
          设置
        </a>
        <span className="popup-version">read-frog style</span>
        <button
          type="button"
          className="linkish"
          onClick={() => void chrome.tabs.create({ url: getOnboardingUrl() })}
        >
          权限
        </button>
      </div>
    </div>
  );
}
