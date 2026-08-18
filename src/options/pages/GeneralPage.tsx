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
        <h2>网页全文翻译</h2>
        <p className="hint">
          浏览普通网页或英文文档时提供段落双语对照与全文翻译能力。
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.webPageTranslate?.enabled !== false}
            onChange={(e) =>
              setForm({
                ...form,
                webPageTranslate: {
                  ...form.webPageTranslate,
                  enabled: e.target.checked,
                },
              })
            }
          />
          启用网页翻译
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={Boolean(form.webPageTranslate?.autoTranslate)}
            onChange={(e) =>
              setForm({
                ...form,
                webPageTranslate: {
                  ...form.webPageTranslate,
                  autoTranslate: e.target.checked,
                },
              })
            }
          />
          自动翻译（打开网页时自动触发翻译）
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.webPageTranslate?.showFloatingButton !== false}
            onChange={(e) =>
              setForm({
                ...form,
                webPageTranslate: {
                  ...form.webPageTranslate,
                  showFloatingButton: e.target.checked,
                },
              })
            }
          />
          在页面右下角显示悬浮翻译按钮
        </label>

        <div className="row" style={{ marginTop: 10 }}>
          <div className="field">
            <label>默认显示模式</label>
            <select
              value={form.webPageTranslate?.displayMode ?? 'bilingual'}
              onChange={(e) =>
                setForm({
                  ...form,
                  webPageTranslate: {
                    ...form.webPageTranslate,
                    displayMode: e.target.value as 'bilingual' | 'translation_only',
                  },
                })
              }
            >
              <option value="bilingual">双语对照（推荐）</option>
              <option value="translation_only">仅显示译文</option>
            </select>
          </div>
          <div className="field">
            <label>译文字号缩放 (%)</label>
            <input
              type="number"
              min={60}
              max={160}
              value={form.webPageTranslate?.fontSizeScale ?? 88}
              onChange={(e) =>
                setForm({
                  ...form,
                  webPageTranslate: {
                    ...form.webPageTranslate,
                    fontSizeScale: Number(e.target.value) || 88,
                  },
                })
              }
            />
          </div>
        </div>

        <div className="field" style={{ marginTop: 10 }}>
          <label>译文颜色</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {[
              ['跟随网页 (自适应深浅色)', ''],
              ['柔和灰', '#6b7280'],
              ['浅灰', '#9ca3af'],
              ['经典蓝', '#2563eb'],
              ['墨绿', '#059669'],
              ['暖紫', '#7c3aed'],
            ].map(([label, colorVal]) => (
              <button
                key={label}
                type="button"
                className="secondary"
                style={{
                  fontSize: 12,
                  padding: '3px 8px',
                  borderColor:
                    (form.webPageTranslate?.translationColor ?? '') === colorVal
                      ? 'var(--rf-brand)'
                      : undefined,
                  fontWeight:
                    (form.webPageTranslate?.translationColor ?? '') === colorVal
                      ? 'bold'
                      : 'normal',
                }}
                onClick={() =>
                  setForm({
                    ...form,
                    webPageTranslate: {
                      ...form.webPageTranslate,
                      translationColor: colorVal,
                    },
                  })
                }
              >
                {label}
              </button>
            ))}
            <input
              type="color"
              value={form.webPageTranslate?.translationColor || '#6b7280'}
              onChange={(e) =>
                setForm({
                  ...form,
                  webPageTranslate: {
                    ...form.webPageTranslate,
                    translationColor: e.target.value,
                  },
                })
              }
              style={{
                width: 32,
                height: 28,
                padding: 0,
                cursor: 'pointer',
                border: '1px solid var(--rf-border)',
                borderRadius: 4,
              }}
              title="自定义颜色"
            />
          </div>
        </div>

        <div
          style={{
            marginTop: 12,
            padding: '10px 14px',
            borderRadius: 6,
            background: 'var(--rf-secondary)',
            border: '1px solid var(--rf-border)',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            Stay hungry, stay foolish.
          </div>
          <div
            style={{
              marginTop: '0.25em',
              fontSize: `${(form.webPageTranslate?.fontSizeScale ?? 88) / 100}em`,
              color: form.webPageTranslate?.translationColor || '#6b7280',
              lineHeight: 1.5,
            }}
          >
            求知若饥，虚心若愚。（排版预览）
          </div>
        </div>
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
