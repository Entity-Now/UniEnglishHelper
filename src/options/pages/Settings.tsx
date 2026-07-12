import React, { useState } from 'react';
import type { AppConfig } from '../../shared/domain/types';

export function SettingsPage(props: {
  config: AppConfig;
  onSave: (partial: Partial<AppConfig>) => Promise<void>;
}) {
  const [form, setForm] = useState(props.config);

  const update = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  return (
    <div>
      <div className="card">
        <h2>Languages</h2>
        <div className="row">
          <div>
            <label>Source</label>
            <input
              value={form.sourceLang}
              onChange={(e) => update('sourceLang', e.target.value)}
            />
          </div>
          <div>
            <label>Target</label>
            <input
              value={form.targetLang}
              onChange={(e) => update('targetLang', e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Translation engine</h2>
        <label>Primary engine</label>
        <select
          value={form.translateEngine}
          onChange={(e) =>
            update(
              'translateEngine',
              e.target.value as AppConfig['translateEngine'],
            )
          }
        >
          <option value="free_mt">Free MT (Google / Microsoft / MyMemory)</option>
          <option value="official_llm">LLM (OpenAI-compatible API key)</option>
          <option value="google_free">Google free only</option>
          <option value="microsoft_free">Microsoft free only</option>
          <option value="mymemory_free">MyMemory free only</option>
        </select>
        <label>Free MT provider</label>
        <select
          value={form.freeMtProvider ?? 'auto'}
          onChange={(e) =>
            update(
              'freeMtProvider',
              e.target.value as AppConfig['freeMtProvider'],
            )
          }
        >
          <option value="auto">Auto failover (Microsoft → Google → MyMemory)</option>
          <option value="microsoft">Microsoft Translator (Edge auth)</option>
          <option value="google">Google Translate (gtx)</option>
          <option value="mymemory">MyMemory</option>
        </select>
        <p className="muted">
          Free channels are unofficial public endpoints: no API key, but rate limits / ToS risk apply.
          Auto mode tries Microsoft first (good batch quality), then Google, then MyMemory.
        </p>
        <button
          type="button"
          className="primary"
          style={{ marginTop: 4 }}
          onClick={async () => {
            // Must run in this click handler (user gesture) — not via SW message.
            try {
              const { ensureFreeMtPermissions } = await import(
                '../../api/translate'
              );
              const ok = await ensureFreeMtPermissions(
                form.freeMtProvider ?? 'auto',
              );
              alert(
                ok
                  ? 'Free MT host permission granted'
                  : 'Permission denied',
              );
            } catch (err) {
              alert(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          Grant free MT network permission
        </button>
      </div>

      <div className="card">
        <h2>Host permissions</h2>
        <label>Access mode</label>
        <select
          value={form.hostAccessMode}
          onChange={(e) =>
            update('hostAccessMode', e.target.value as AppConfig['hostAccessMode'])
          }
        >
          <option value="global">All sites (recommended)</option>
          <option value="per_site">Per-site only</option>
        </select>
        <button
          type="button"
          className="primary"
          style={{ marginTop: 8 }}
          onClick={async () => {
            try {
              const { requestAllPermissions, getOnboardingUrl } = await import(
                '../../shared/permissions'
              );
              const s = await requestAllPermissions();
              alert(
                s.allSites || s.complete
                  ? '全部权限已授权'
                  : '仍有权限未授予，请在弹窗中选择允许',
              );
              if (!s.allSites && !s.complete) {
                void chrome.tabs.create({ url: getOnboardingUrl() });
              }
            } catch (err) {
              alert(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          一键授权全部权限
        </button>
        <p className="muted">
          安装时会请求「读取并更改所有网站数据」。若当时拒绝，请点此按钮或打开首次引导页重新授权。
        </p>
      </div>

      <div className="card">
        <h2>AI Provider</h2>
        <div className="row">
          <div>
            <label>Provider id</label>
            <input
              value={form.ai.providerId}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  ai: { ...f.ai, providerId: e.target.value },
                }))
              }
            />
          </div>
          <div>
            <label>Model</label>
            <input
              value={form.ai.model}
              onChange={(e) =>
                setForm((f) => ({ ...f, ai: { ...f.ai, model: e.target.value } }))
              }
            />
          </div>
        </div>
        <label>API Key (stored in chrome.storage.local)</label>
        <input
          type="password"
          placeholder="sk-…"
          value={form.ai.apiKeys[form.ai.providerId] ?? ''}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              ai: {
                ...f.ai,
                apiKeys: { ...f.ai.apiKeys, [f.ai.providerId]: e.target.value },
              },
            }))
          }
        />
        <label>Base URL (OpenAI-compatible)</label>
        <input
          placeholder="https://api.openai.com/v1"
          value={form.ai.baseUrls?.[form.ai.providerId] ?? ''}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              ai: {
                ...f.ai,
                baseUrls: {
                  ...(f.ai.baseUrls ?? {}),
                  [f.ai.providerId]: e.target.value,
                },
              },
            }))
          }
        />
      </div>

      <div className="card">
        <h2>Features</h2>
        {(
          [
            ['autoTranslate', 'Auto translate cues'],
            ['enableLlmTranslate', 'LLM translate'],
            ['enableUnofficialFreeMt', 'Allow free MT (Google/Microsoft/MyMemory)'],
            ['enableTabCapture', 'Tab audio capture'],
            ['enableEdgeTts', 'Edge TTS (default off)'],
            ['enableYoutubeAdapter', 'YouTube adapter (default off)'],
            ['preferMove', 'Prefer move video into PiP'],
          ] as const
        ).map(([key, label]) => {
          if (key === 'preferMove') {
            return (
              <label className="checkbox" key={key}>
                <input
                  type="checkbox"
                  checked={form.pip.preferMove}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      pip: { ...f.pip, preferMove: e.target.checked },
                    }))
                  }
                />
                {label}
              </label>
            );
          }
          return (
            <label className="checkbox" key={key}>
              <input
                type="checkbox"
                checked={Boolean(form.features[key as keyof AppConfig['features']])}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    features: {
                      ...f.features,
                      [key]: e.target.checked,
                    },
                  }))
                }
              />
              {label}
            </label>
          );
        })}
      </div>

      <div className="card">
        <h2>TTS</h2>
        <p className="hint">
          完整声音列表、语速/音调/音量、按语言选声与试听请到侧栏「朗读 / TTS」。
        </p>
        <label>Engine</label>
        <select
          value={form.tts.engine}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              tts: {
                ...f.tts,
                engine: e.target.value as AppConfig['tts']['engine'],
              },
            }))
          }
        >
          <option value="edge">Edge Read Aloud (recommended)</option>
          <option value="web-speech">Web Speech</option>
          <option value="azure">Azure (not yet)</option>
        </select>
        <label>Default voice</label>
        <input
          value={form.tts.defaultVoice || form.tts.voice || ''}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              tts: {
                ...f.tts,
                defaultVoice: e.target.value,
                voice: e.target.value,
              },
            }))
          }
          placeholder="en-US-AndrewMultilingualNeural"
        />
        <label>Rate (−100…100)</label>
        <input
          type="number"
          min={-100}
          max={100}
          value={Number(form.tts.rate) || 0}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              tts: { ...f.tts, rate: Number(e.target.value) || 0 },
            }))
          }
        />
        <p className="muted">
          Edge TTS 使用非官方端点；请在「朗读 / TTS」页开启并试听。
        </p>
      </div>

      <button type="button" className="primary" onClick={() => props.onSave(form)}>
        Save settings
      </button>
    </div>
  );
}
