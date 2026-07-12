import React, { useCallback, useEffect, useState } from 'react';
import {
  getPermissionStatus,
  requestAllPermissions,
  setBootstrapDone,
  type PermissionStatus,
} from '../shared/permissions';
import { EXT_VERSION } from '../shared/version';
import { CONFIG_STORAGE_KEY } from '../shared/constants';
import { DEFAULT_APP_CONFIG } from '../shared/domain/types';

export function OnboardingApp() {
  const [status, setStatus] = useState<PermissionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    const s = await getPermissionStatus();
    setStatus(s);
    return s;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const grantAll = async () => {
    setBusy(true);
    setMessage('');
    try {
      // Request in this click stack (user gesture)
      const s = await requestAllPermissions();
      setStatus(s);
      // Prefer global host mode once broad access exists
      if (s.allSites || s.complete) {
        // Persist global host mode without going through SW
        const stored = await chrome.storage.local.get(CONFIG_STORAGE_KEY);
        const prev = (stored[CONFIG_STORAGE_KEY] as object) ?? {};
        await chrome.storage.local.set({
          [CONFIG_STORAGE_KEY]: {
            ...DEFAULT_APP_CONFIG,
            ...prev,
            hostAccessMode: 'global',
          },
        });
        await setBootstrapDone(true);
        setMessage('全部权限已就绪，可以开始使用了。');
      } else {
        setMessage(
          '部分权限仍未授予。请再次点击授权，并在浏览器弹窗中选择「允许」。',
        );
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const openOptions = () => {
    void chrome.runtime.openOptionsPage();
  };

  const ready = status?.allSites || status?.complete;

  return (
    <div className="wrap">
      <h1>欢迎使用 UniEnglishHelper</h1>
      <p className="lead">
        v{EXT_VERSION} · 首次启动需要授权网站与网络权限，用于画中画字幕、标签页
        音频采集、免费翻译与 TTS。建议一次授权全部，避免后续功能因权限不足失败。
      </p>

      {ready ? (
        <div className="banner success">
          权限已就绪。你可以关闭本页，打开任意视频网站，点击扩展图标使用 Open
          PiP / Start capture。
        </div>
      ) : (
        <div className="banner warn">
          尚未完成授权。请点击下方按钮，并在浏览器弹出的权限对话框中选择「允许」。
        </div>
      )}

      <div className="card">
        <h2>将申请的能力</h2>
        <ul>
          <li>
            <strong>所有网站</strong>（http/https）：注入学习脚本、打开画中画、读取字幕
          </li>
          <li>
            <strong>标签页音频采集</strong>：保存句子原声（tabCapture）
          </li>
          <li>
            <strong>免费翻译接口</strong>：Google / Microsoft / MyMemory
          </li>
          <li>
            <strong>Edge TTS（可选）</strong>：标准发音朗读
          </li>
          <li>
            <strong>本地存储</strong>：生词本、音频片段、缓存（不会上传账号）
          </li>
        </ul>
      </div>

      <div className="card">
        <h2>当前状态</h2>
        {!status ? (
          <p>检查中…</p>
        ) : (
          <div className="status-grid">
            <div className="status-row">
              <span>所有网站访问</span>
              <span className={status.allSites ? 'ok' : 'bad'}>
                {status.allSites ? '已授权' : '未授权'}
              </span>
            </div>
            <div className="status-row">
              <span>免费翻译网络</span>
              <span className={status.freeMt ? 'ok' : 'bad'}>
                {status.freeMt ? '已授权' : '未授权'}
              </span>
            </div>
            <div className="status-row">
              <span>Edge TTS 网络</span>
              <span className={status.edgeTts ? 'ok' : 'bad'}>
                {status.edgeTts ? '已授权' : '未授权'}
              </span>
            </div>
            <div className="status-row">
              <span>整体</span>
              <span className={ready ? 'ok' : 'bad'}>
                {ready ? '可以使用' : '需要授权'}
              </span>
            </div>
          </div>
        )}

        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void grantAll()}
          >
            {busy ? '请求中…' : ready ? '重新确认全部权限' : '一键授权全部权限'}
          </button>
          <button type="button" className="secondary" onClick={openOptions}>
            打开设置
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void refresh()}
          >
            刷新状态
          </button>
        </div>

        {message && <p className="note">{message}</p>}
        <p className="note">
          说明：Chrome/Edge 要求权限弹窗必须由你点击按钮触发；安装时浏览器也可能已经弹出过
          「读取和更改所有网站数据」——若当时已允许，此处会显示已授权。
        </p>
      </div>
    </div>
  );
}
