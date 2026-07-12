import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AppConfig } from '../../shared/domain/types';
import {
  EDGE_TTS_FALLBACK_VOICE,
  EDGE_TTS_VOICE_GROUPS,
  EDGE_TTS_VOICE_ITEMS,
  getDefaultTTSVoiceForLanguage,
  getEdgeTTSVoiceItem,
  MAX_TTS_PITCH,
  MAX_TTS_RATE,
  MAX_TTS_VOLUME,
  MIN_TTS_PITCH,
  MIN_TTS_RATE,
  MIN_TTS_VOLUME,
  parseTtsNumber,
  toSignedProsody,
  TTS_LANGUAGE_OPTIONS,
  type TTSLanguageCode,
  type TTSVoiceItem,
} from '../../types/config/tts';
import { sendRuntime } from '../../shared/messaging/client';
import {
  playTtsAudioChunks,
  stopTtsPlayback,
} from '../../utils/tts-playback/play-chunks';

const PREVIEW_SAMPLES: Record<string, string> = {
  en: 'Hello! This is a preview of the selected Edge TTS voice.',
  'en-US': 'Hello! This is a preview of the selected Edge TTS voice.',
  'en-GB': 'Hello! This is a preview of the selected Edge TTS voice.',
  'zh-CN': '你好！这是所选 Edge 语音的试听效果。',
  'zh-TW': '你好！這是所選 Edge 語音的試聽效果。',
  'zh-HK': '你好！呢個係所選 Edge 語音嘅試聽效果。',
  ja: 'こんにちは。選択した Edge TTS 音声のプレビューです。',
  ko: '안녕하세요. 선택한 Edge TTS 음성 미리듣기입니다.',
  fr: 'Bonjour ! Voici un aperçu de la voix Edge TTS sélectionnée.',
  de: 'Hallo! Dies ist eine Vorschau der gewählten Edge-TTS-Stimme.',
  es: '¡Hola! Esta es una vista previa de la voz Edge TTS seleccionada.',
  default: 'Hello! This is a preview of the selected Edge TTS voice.',
};

type HealthStatus = {
  available?: boolean;
  reason?: string;
  circuitOpen?: boolean;
  browserSupported?: boolean;
  featureEnabled?: boolean;
  error?: { code?: string; message?: string };
};

export function TtsPage(props: {
  config: AppConfig;
  onSave: (p: Partial<AppConfig>) => Promise<void>;
}) {
  const [form, setForm] = useState(props.config);
  const [lang, setLang] = useState<TTSLanguageCode | string>('en');
  const [voiceQuery, setVoiceQuery] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewMsg, setPreviewMsg] = useState('');
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const abortPreview = useRef(false);

  useEffect(() => {
    setForm(props.config);
  }, [props.config]);

  useEffect(() => {
    return () => {
      abortPreview.current = true;
      stopTtsPlayback();
    };
  }, []);

  const tts = form.tts;
  const selectedLangVoice =
    tts.languageVoices?.[lang] ??
    tts.defaultVoice ??
    EDGE_TTS_FALLBACK_VOICE;

  const filteredGroups = useMemo(() => {
    const q = voiceQuery.trim().toLowerCase();
    if (!q) return EDGE_TTS_VOICE_GROUPS;
    return EDGE_TTS_VOICE_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((item) => voiceItemMatches(item, q)),
    })).filter((g) => g.items.length > 0);
  }, [voiceQuery]);

  const voiceMeta = getEdgeTTSVoiceItem(
    tts.defaultVoice || tts.voice || EDGE_TTS_FALLBACK_VOICE,
  );

  const patchTts = (partial: Partial<AppConfig['tts']>) => {
    setForm((f) => {
      const nextTts = { ...f.tts, ...partial };
      if (partial.defaultVoice) nextTts.voice = partial.defaultVoice;
      if (partial.voice && !partial.defaultVoice) {
        nextTts.defaultVoice = partial.voice;
      }
      return { ...f, tts: nextTts };
    });
  };

  const setLanguageVoice = (voice: string) => {
    patchTts({
      languageVoices: {
        ...tts.languageVoices,
        [lang]: voice,
      },
    });
  };

  const resetLanguageVoice = () => {
    const def = getDefaultTTSVoiceForLanguage(
      lang,
      tts.defaultVoice || EDGE_TTS_FALLBACK_VOICE,
    );
    setLanguageVoice(def);
  };

  const refreshHealth = async () => {
    setHealthLoading(true);
    try {
      const res = await sendRuntime<HealthStatus>(
        'tts.health',
        {},
        'options',
      );
      if (res.ok) setHealth(res.data);
      else
        setHealth({
          available: false,
          reason: 'error',
          error: { message: res.error.message, code: res.error.code },
        });
    } finally {
      setHealthLoading(false);
    }
  };

  useEffect(() => {
    void refreshHealth();
  }, []);

  const runPreview = async (forcedVoice?: string) => {
    abortPreview.current = false;
    setPreviewMsg('');
    stopTtsPlayback();

    if (tts.engine === 'web-speech') {
      const sample =
        PREVIEW_SAMPLES[lang] ?? PREVIEW_SAMPLES.default ?? 'Hello';
      if (typeof speechSynthesis !== 'undefined') {
        const u = new SpeechSynthesisUtterance(sample);
        u.lang =
          forcedVoice?.match(/^[a-z]{2}-[A-Z]{2}/)?.[0] ??
          (typeof lang === 'string' ? lang : 'en-US');
        const rateNum = Number(tts.rate) || 0;
        // Map −100…100 roughly to 0.5…1.5
        u.rate = Math.max(0.5, Math.min(1.5, 1 + rateNum / 200));
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
        setPreviewMsg('Web Speech 试听中…');
      }
      return;
    }

    if (!form.features.enableEdgeTts) {
      setPreviewMsg('请先启用 Edge TTS');
      return;
    }

    setPreviewing(true);
    try {
      // Persist current form before preview so background uses latest values
      await props.onSave({
        tts: form.tts,
        features: form.features,
      });

      const sample =
        PREVIEW_SAMPLES[lang] ?? PREVIEW_SAMPLES.default ?? 'Hello';
      const res = await sendRuntime<{
        mode: string;
        voice: string;
        chunks: Array<{ audioBase64: string; contentType: string; text: string }>;
      }>(
        'tts.synthChunks',
        {
          text: sample,
          voice: forcedVoice,
        },
        'options',
      );

      if (!res.ok) {
        setPreviewMsg(res.error.message);
        return;
      }
      if (abortPreview.current) return;

      setPreviewMsg(
        `合成完成（${res.data.chunks.length} 段）· ${res.data.voice}，播放中…`,
      );
      const ok = await playTtsAudioChunks(res.data.chunks);
      if (!abortPreview.current) {
        setPreviewMsg(ok ? '试听完成' : '已停止');
      }
    } catch (e) {
      setPreviewMsg(e instanceof Error ? e.message : '试听失败');
    } finally {
      setPreviewing(false);
    }
  };

  const stopPreview = () => {
    abortPreview.current = true;
    stopTtsPlayback();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    setPreviewing(false);
    setPreviewMsg('已停止');
  };

  return (
    <div>
      <h1 className="page-title">
        朗读 / TTS{' '}
        <span className="badge-beta" title="Public Beta">
          Public Beta
        </span>
      </h1>
      <p className="page-desc">
        对齐 read-frog Text-to-Speech：Edge 神经语音、按语言选声、语速/音调/音量，以及分段顺序播放（避免 MP3 拼接卡顿）。
      </p>

      <div className="card">
        <h2>引擎与开关</h2>
        <p className="hint">
          Edge Read Aloud 为非官方接口，可能随时失效；默认已开启，可随时关闭。
        </p>
        <label>TTS 引擎</label>
        <select
          value={tts.engine}
          onChange={(e) =>
            patchTts({
              engine: e.target.value as AppConfig['tts']['engine'],
            })
          }
        >
          <option value="edge">Edge Read Aloud（推荐，神经语音）</option>
          <option value="web-speech">Web Speech（浏览器自带）</option>
          <option value="azure">Azure（未接入）</option>
        </select>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.features.enableEdgeTts}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                features: {
                  ...f.features,
                  enableEdgeTts: e.target.checked,
                },
              }))
            }
          />
          启用 Edge TTS（需网络；非官方端点）
        </label>

        <div className="tts-health">
          <div className="tts-health-row">
            <strong>服务状态</strong>
            <button
              type="button"
              className="ghost"
              disabled={healthLoading}
              onClick={() => void refreshHealth()}
            >
              {healthLoading ? '检查中…' : '重新检查'}
            </button>
          </div>
          {health ? (
            <p className={`muted ${health.available ? 'ok-text' : 'bad-text'}`}>
              {health.available
                ? 'Edge TTS 可用'
                : `不可用：${health.reason ?? 'unknown'}${
                    health.error?.message ? ` — ${health.error.message}` : ''
                  }`}
              {health.circuitOpen ? '（熔断开启中）' : ''}
            </p>
          ) : (
            <p className="muted">尚未检查</p>
          )}
        </div>
      </div>

      <div className="card">
        <h2>按语言选择声音</h2>
        <p className="hint">
          朗读时会根据文本语言选用对应声音；未映射语言回退到默认声音。
        </p>
        <label>语言</label>
        <select value={lang} onChange={(e) => setLang(e.target.value)}>
          {TTS_LANGUAGE_OPTIONS.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>

        <label>该语言的声音</label>
        <VoicePicker
          value={selectedLangVoice}
          query={voiceQuery}
          onQueryChange={setVoiceQuery}
          groups={filteredGroups}
          onChange={setLanguageVoice}
        />

        <div className="tts-actions">
          <button
            type="button"
            className="primary"
            disabled={previewing}
            onClick={() => void runPreview(selectedLangVoice)}
          >
            {previewing ? '合成/播放中…' : '▶ 试听'}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!previewing}
            onClick={stopPreview}
          >
            停止
          </button>
          <button
            type="button"
            className="ghost"
            onClick={resetLanguageVoice}
            disabled={
              selectedLangVoice ===
              getDefaultTTSVoiceForLanguage(
                lang,
                tts.defaultVoice || EDGE_TTS_FALLBACK_VOICE,
              )
            }
          >
            重置为默认
          </button>
        </div>
        {previewMsg && (
          <div className="save-feedback ok" role="status">
            {previewMsg}
          </div>
        )}
      </div>

      <div className="card">
        <h2>默认声音（回退）</h2>
        <p className="hint">
          当文本语言没有单独配置时使用。当前：{' '}
          <code>{voiceMeta.voice}</code> · {voiceMeta.language} ·{' '}
          {voiceMeta.gender} · {voiceMeta.type}
        </p>
        <label>默认 Edge 声音</label>
        <VoicePicker
          value={tts.defaultVoice || tts.voice || EDGE_TTS_FALLBACK_VOICE}
          query={voiceQuery}
          onQueryChange={setVoiceQuery}
          groups={filteredGroups}
          onChange={(voice) => patchTts({ defaultVoice: voice, voice })}
        />
        <p className="muted">
          共 {EDGE_TTS_VOICE_ITEMS.length} 个可用声音（已隐藏区域受限的 HD /
          DragonHD）。
        </p>
      </div>

      <div className="card">
        <h2>语速 / 音调 / 音量</h2>
        <p className="hint">
          取值 −100～100，写入 Edge SSML：
          rate <code>{toSignedProsody(Number(tts.rate) || 0, '%')}</code> · pitch{' '}
          <code>{toSignedProsody(Number(tts.pitch) || 0, 'Hz')}</code> · volume{' '}
          <code>{toSignedProsody(Number(tts.volume) || 0, '%')}</code>
        </p>

        <div className="row">
          <ProsodyField
            label={`语速 Rate（${MIN_TTS_RATE}…${MAX_TTS_RATE}）`}
            value={Number(tts.rate) || 0}
            min={MIN_TTS_RATE}
            max={MAX_TTS_RATE}
            onChange={(rate) => patchTts({ rate })}
          />
          <ProsodyField
            label={`音调 Pitch（${MIN_TTS_PITCH}…${MAX_TTS_PITCH}）`}
            value={Number(tts.pitch) || 0}
            min={MIN_TTS_PITCH}
            max={MAX_TTS_PITCH}
            onChange={(pitch) => patchTts({ pitch })}
          />
          <ProsodyField
            label={`音量 Volume（${MIN_TTS_VOLUME}…${MAX_TTS_VOLUME}）`}
            value={Number(tts.volume) || 0}
            min={MIN_TTS_VOLUME}
            max={MAX_TTS_VOLUME}
            onChange={(volume) => patchTts({ volume })}
          />
        </div>
      </div>

      <SaveButton
        label="保存 TTS 设置"
        onSave={() =>
          props.onSave({
            tts: form.tts,
            features: form.features,
          })
        }
      />
    </div>
  );
}

function voiceItemMatches(item: TTSVoiceItem, q: string): boolean {
  return `${item.voice} ${item.language} ${item.type} ${item.gender}`
    .toLowerCase()
    .includes(q);
}

function genderClass(gender: TTSVoiceItem['gender']): string {
  if (gender.startsWith('Male')) return 'badge-male';
  if (gender.startsWith('Female')) return 'badge-female';
  if (gender === 'Neutral') return 'badge-neutral';
  return '';
}

function VoicePicker(props: {
  value: string;
  query: string;
  onQueryChange: (q: string) => void;
  groups: typeof EDGE_TTS_VOICE_GROUPS;
  onChange: (voice: string) => void;
}) {
  const meta = getEdgeTTSVoiceItem(props.value);
  return (
    <div className="voice-picker">
      <input
        type="search"
        placeholder="搜索声音 / 语言 / 性别…"
        value={props.query}
        onChange={(e) => props.onQueryChange(e.target.value)}
        aria-label="搜索声音"
      />
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        size={8}
        className="voice-select"
      >
        {/* Ensure current value is always present */}
        {!props.groups.some((g) =>
          g.items.some((i) => i.voice === props.value),
        ) && (
          <option value={props.value}>
            {props.value} ({meta.language})
          </option>
        )}
        {props.groups.map((group) => (
          <optgroup key={group.language} label={group.language}>
            {group.items.map((item) => (
              <option key={item.voice} value={item.voice}>
                {item.voice} · {item.gender} · {item.type}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="voice-meta">
        <span className="badge-type">{meta.type}</span>
        <span className={`badge-gender ${genderClass(meta.gender)}`}>
          {meta.gender}
        </span>
        <span className="muted">{meta.language}</span>
      </div>
    </div>
  );
}

function ProsodyField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="field">
      <label>{props.label}</label>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={1}
        value={props.value}
        onChange={(e) =>
          props.onChange(
            parseTtsNumber(e.target.value, props.min, props.max, 0),
          )
        }
      />
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={1}
        value={props.value}
        onChange={(e) =>
          props.onChange(
            parseTtsNumber(e.target.value, props.min, props.max, props.value),
          )
        }
      />
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
