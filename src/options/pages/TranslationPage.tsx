import React, { useState } from 'react';
import type { AppConfig } from '../../shared/domain/types';
import { AiPromptEditor } from '../components/AiPromptEditor';
import { LlmConfigCard } from '../components/LlmConfigCard';

export function TranslationPage(props: {
  config: AppConfig;
  onSave: (p: Partial<AppConfig>) => Promise<void>;
}) {
  const [form, setForm] = useState(props.config);

  return (
    <div>
      <h1 className="page-title">翻译</h1>
      <p className="page-desc">
        翻译引擎、免费通道、LLM 配置与 AI 提示词（对应 read-frog Translation）。
      </p>

      <div className="card">
        <h2>翻译引擎</h2>
        <p className="hint">默认免费 MT；配置 API Key 后可切到 LLM。</p>
        <label>主引擎</label>
        <select
          value={form.translateEngine}
          onChange={(e) =>
            setForm({
              ...form,
              translateEngine: e.target.value as AppConfig['translateEngine'],
            })
          }
        >
          <option value="free_mt">免费 MT（推荐）</option>
          <option value="official_llm">LLM（OpenAI 兼容）</option>
          <option value="google_free">仅 Google</option>
          <option value="microsoft_free">仅 Microsoft</option>
          <option value="mymemory_free">仅 MyMemory</option>
        </select>
        <label>免费 MT 通道</label>
        <select
          value={form.freeMtProvider}
          onChange={(e) =>
            setForm({
              ...form,
              freeMtProvider: e.target.value as AppConfig['freeMtProvider'],
            })
          }
        >
          <option value="auto">自动故障切换（MS → Google → MyMemory）</option>
          <option value="microsoft">Microsoft</option>
          <option value="google">Google</option>
          <option value="mymemory">MyMemory</option>
        </select>
        <button
          type="button"
          className="ghost"
          onClick={async () => {
            const { ensureFreeMtPermissions } = await import(
              '../../api/translate'
            );
            const ok = await ensureFreeMtPermissions(form.freeMtProvider);
            alert(ok ? '已授权免费翻译网络' : '授权被拒绝');
          }}
        >
          授权免费翻译网络
        </button>
      </div>

      <LlmConfigCard config={form} onChange={setForm} />


      <AiPromptEditor config={form} onChange={setForm} />

      <div className="card">
        <h2>预取</h2>
        <p className="hint">
          后台预取后续句翻译（不显示下一句字幕，仅缓存）。0 = 关闭。
        </p>
        <label>预取句数</label>
        <input
          type="number"
          min={0}
          max={5}
          value={form.features.prefetchCues}
          onChange={(e) =>
            setForm({
              ...form,
              features: {
                ...form.features,
                prefetchCues: Number(e.target.value) || 0,
              },
            })
          }
        />
      </div>

      <SaveButton label="保存翻译设置" onSave={() => props.onSave(form)} />
    </div>
  );
}

function SaveButton(props: {
  label: string;
  onSave: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  return (
    <>
      <button
        type="button"
        className="primary"
        disabled={saving}
        onClick={() => {
          setSaving(true);
          setMsg('');
          void props
            .onSave()
            .then(() => setMsg('已保存'))
            .catch((e: unknown) =>
              setMsg(e instanceof Error ? e.message : '保存失败'),
            )
            .finally(() => setSaving(false));
        }}
      >
        {saving ? '保存中…' : props.label}
      </button>
      {msg && (
        <div className="save-feedback ok" role="status">
          {msg}
        </div>
      )}
    </>
  );
}
