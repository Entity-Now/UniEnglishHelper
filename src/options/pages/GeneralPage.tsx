import React, { useState } from 'react';
import type { AppConfig } from '../../shared/domain/types';

export function GeneralPage(props: {
  config: AppConfig;
  onSave: (p: Partial<AppConfig>) => Promise<void>;
}) {
  const [form, setForm] = useState(props.config);
  const [saving, setSaving] = useState(false);
  const [localMsg, setLocalMsg] = useState('');

  const save = async () => {
    setSaving(true);
    setLocalMsg('');
    try {
      await props.onSave(form);
      setLocalMsg('已保存通用设置');
    } catch (e) {
      setLocalMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h1 className="page-title">通用设置</h1>
      <p className="page-desc">语言、主机权限与核心能力开关（对齐 read-frog General）。</p>

      <div className="card">
        <h2>语言</h2>
        <p className="hint">源语言 / 目标语言用于字幕翻译与释义。</p>
        <div className="row">
          <div className="field">
            <label>源语言</label>
            <input
              value={form.sourceLang}
              onChange={(e) => setForm({ ...form, sourceLang: e.target.value })}
            />
          </div>
          <div className="field">
            <label>目标语言</label>
            <input
              value={form.targetLang}
              onChange={(e) => setForm({ ...form, targetLang: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>主机访问</h2>
        <p className="hint">推荐「所有网站」，避免逐站授权导致功能不可用。</p>
        <label>模式</label>
        <select
          value={form.hostAccessMode}
          onChange={(e) =>
            setForm({
              ...form,
              hostAccessMode: e.target.value as AppConfig['hostAccessMode'],
            })
          }
        >
          <option value="global">所有网站（推荐）</option>
          <option value="per_site">按站点授权</option>
        </select>
        <button
          type="button"
          className="primary"
          onClick={async () => {
            const { requestAllPermissions } = await import(
              '../../shared/permissions'
            );
            await requestAllPermissions();
            await props.onSave(form);
            setLocalMsg('权限已请求，配置已保存');
          }}
        >
          一键授权全部权限
        </button>
      </div>

      <div className="card">
        <h2>功能开关</h2>
        {(
          [
            ['autoTranslate', '自动翻译当前字幕'],
            ['enableLlmTranslate', '允许使用 LLM 翻译'],
            ['enableUnofficialFreeMt', '允许免费 MT（Google/Microsoft/MyMemory）'],
            ['enableTabCapture', '标签页原声采集'],
            ['enableEdgeTts', 'Edge TTS（非官方）'],
            ['enableYoutubeAdapter', 'YouTube 深度适配'],
          ] as const
        ).map(([key, label]) => (
          <label className="checkbox" key={key}>
            <input
              type="checkbox"
              checked={Boolean(form.features[key])}
              onChange={(e) =>
                setForm({
                  ...form,
                  features: { ...form.features, [key]: e.target.checked },
                })
              }
            />
            {label}
          </label>
        ))}
      </div>

      <button type="button" className="primary" disabled={saving} onClick={() => void save()}>
        {saving ? '保存中…' : '保存通用设置'}
      </button>
      {localMsg && (
        <div className="save-feedback ok" role="status">
          {localMsg}
        </div>
      )}
    </div>
  );
}
