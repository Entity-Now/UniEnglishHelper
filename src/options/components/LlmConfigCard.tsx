import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { AppConfig, LlmProtocol } from '../../shared/domain/types';
import {
  fetchProviderModels,
  getProviderPreset,
  hasLlmCredentials,
  isLocalLlmEndpoint,
  LLM_PROTOCOL_LABELS,
  LLM_PROVIDER_PRESETS,
  resolveBaseUrl,
  resolveProtocol,
  type DiscoveredModel,
} from '../../api/ai-provider';

export interface LlmConfigCardProps {
  config: AppConfig;
  onChange: React.Dispatch<React.SetStateAction<AppConfig>>;
}

interface ScanState {
  status: 'idle' | 'scanning' | 'success' | 'error';
  models: DiscoveredModel[];
  endpoint?: string;
  latencyMs?: number;
  error?: string;
}

const INITIAL_SCAN_STATE: ScanState = {
  status: 'idle',
  models: [],
};

function formatModelOption(m: DiscoveredModel): string {
  const meta: string[] = [];
  if (m.label && m.label !== m.id) meta.push(m.label);
  if (m.parameterSize) meta.push(m.parameterSize);
  if (m.quantization) meta.push(m.quantization);
  return meta.length > 0 ? `${m.id} (${meta.join(' · ')})` : m.id;
}

function useProviderModelScanner(
  config: AppConfig,
  providerId: string,
  enabled: boolean,
) {
  const [scan, setScan] = useState<ScanState>(INITIAL_SCAN_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const trimmedId = providerId.trim();
  const baseUrl = trimmedId ? config.ai.baseUrls?.[trimmedId] ?? '' : '';
  const apiKey = trimmedId ? config.ai.apiKeys?.[trimmedId] ?? '' : '';
  const protocol = trimmedId ? resolveProtocol(config, trimmedId) : 'openai';
  const canScan = enabled && Boolean(trimmedId) && hasLlmCredentials(config, trimmedId);

  const runScan = useCallback(
    async (forceRefresh = false) => {
      if (!trimmedId) {
        setScan(INITIAL_SCAN_STATE);
        return;
      }
      if (!hasLlmCredentials(configRef.current, trimmedId)) {
        setScan(INITIAL_SCAN_STATE);
        return;
      }

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setScan((prev) => ({
        ...prev,
        status: 'scanning',
        error: undefined,
      }));

      try {
        const res = await fetchProviderModels(configRef.current, trimmedId, {
          forceRefresh,
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        setScan({
          status: 'success',
          models: res.models,
          endpoint: res.endpoint,
          latencyMs: res.latencyMs,
        });
      } catch (err) {
        if (ac.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        const friendly = /failed to fetch|networkerror|aborted/i.test(msg)
          ? '无法连接到服务，请确认地址正确且服务已启动'
          : msg;
        setScan((prev) => ({
          status: 'error',
          models: prev.models,
          error: friendly,
        }));
      }
    },
    [trimmedId],
  );

  useEffect(() => {
    if (!canScan) {
      abortRef.current?.abort();
      setScan(INITIAL_SCAN_STATE);
      return;
    }
    const timer = setTimeout(() => {
      void runScan(false);
    }, 450);
    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [canScan, trimmedId, baseUrl, apiKey, protocol, runScan]);

  return { scan, rescan: () => void runScan(true), canScan };
}

function ScanStatusBar({
  scan,
  canScan,
  onRescan,
  label,
}: {
  scan: ScanState;
  canScan: boolean;
  onRescan: () => void;
  label?: string;
}) {
  return (
    <div className="llm-scan-bar">
      <div className="llm-scan-status" title={scan.endpoint || undefined}>
        {scan.status === 'scanning' && (
          <span className="llm-scan-badge scanning">⏳ 正在扫描{label ? ` ${label}` : ''}模型列表…</span>
        )}
        {scan.status === 'success' && (
          <span className="llm-scan-badge success">
            ✓ {scan.models.length > 0
              ? `已发现 ${scan.models.length} 个模型${scan.latencyMs ? ` · ${scan.latencyMs}ms` : ''}`
              : '接口已连通，但未返回模型列表（可手动填写）'}
          </span>
        )}
        {scan.status === 'error' && (
          <span className="llm-scan-badge error">⚠ {scan.error}</span>
        )}
        {scan.status === 'idle' && (
          <span className="llm-scan-badge idle">
            {canScan
              ? '准备自动扫描 models 接口…'
              : '填写 API Key 或选择本地服务后将自动扫描可用模型'}
          </span>
        )}
      </div>
      <button
        type="button"
        className="ghost llm-scan-btn"
        disabled={!canScan || scan.status === 'scanning'}
        onClick={onRescan}
      >
        {scan.status === 'scanning' ? '扫描中…' : '扫描模型'}
      </button>
    </div>
  );
}

export function LlmConfigCard({ config, onChange }: LlmConfigCardProps) {
  const form = config;
  const setForm = onChange;
  const uid = useId();

  const mainProviderId = form.ai.providerId.trim() || 'openai-compatible';
  const mainPreset = getProviderPreset(mainProviderId);
  const mainProtocol = resolveProtocol(form, mainProviderId);
  const mainResolvedUrl = resolveBaseUrl(form, mainProviderId, mainProtocol);
  const mainIsLocal = isLocalLlmEndpoint(mainResolvedUrl);

  const transProviderId = (form.ai.translationProviderId ?? '').trim();
  const hasSeparateTransProvider =
    Boolean(transProviderId) && transProviderId !== mainProviderId;
  const transPreset = hasSeparateTransProvider
    ? getProviderPreset(transProviderId)
    : undefined;
  const transProtocol = hasSeparateTransProvider
    ? resolveProtocol(form, transProviderId)
    : mainProtocol;
  const transResolvedUrl = hasSeparateTransProvider
    ? resolveBaseUrl(form, transProviderId, transProtocol)
    : mainResolvedUrl;
  const transIsLocal = isLocalLlmEndpoint(transResolvedUrl);

  const mainScanner = useProviderModelScanner(form, mainProviderId, true);
  const transScanner = useProviderModelScanner(
    form,
    transProviderId,
    hasSeparateTransProvider,
  );

  const availableMainModels = mainScanner.scan.models;
  const availableTransModels = hasSeparateTransProvider
    ? transScanner.scan.models
    : availableMainModels;

  const isKnownMainPreset = Boolean(mainPreset);
  const isKnownTransPreset = !transProviderId || Boolean(getProviderPreset(transProviderId));

  const mainModelInList = availableMainModels.some((m) => m.id === form.ai.model);
  const transModelInList =
    !form.ai.translationModel ||
    availableTransModels.some((m) => m.id === form.ai.translationModel);

  const handleMainProviderChange = (nextId: string) => {
    const preset = getProviderPreset(nextId);
    setForm((f) => {
      const nextProtocols = { ...(f.ai.protocols ?? {}) };
      if (preset && !nextProtocols[nextId]) {
        nextProtocols[nextId] = preset.protocol;
      }
      return {
        ...f,
        ai: {
          ...f.ai,
          providerId: nextId,
          protocols: nextProtocols,
        },
      };
    });
  };

  const handleTransProviderChange = (nextId: string) => {
    const preset = nextId ? getProviderPreset(nextId) : undefined;
    setForm((f) => {
      const nextProtocols = { ...(f.ai.protocols ?? {}) };
      if (preset && !nextProtocols[nextId]) {
        nextProtocols[nextId] = preset.protocol;
      }
      return {
        ...f,
        ai: {
          ...f.ai,
          translationProviderId: nextId,
          protocols: nextProtocols,
        },
      };
    });
  };

  return (
    <div className="card">
      <h2>LLM 接口与模型分工</h2>
      <p className="hint">
        支持 OpenAI、Anthropic (Claude)、Ollama、LM Studio、Splash、DeepSeek、Gemini 等多协议框架。自动扫描 models 接口并按场景分工配置大模型与极速翻译小模型。
      </p>

      <div className="llm-config-section">
        {/* Section 1: 主接口连接与协议 */}
        <div>
          <div className="llm-section-title">
            <span>主接口连接与协议</span>
          </div>
          <div className="llm-connection-grid">
            <div className="llm-connection-field">
              <label htmlFor={`${uid}-main-provider`}>服务框架 / Provider</label>
              <select
                id={`${uid}-main-provider`}
                value={mainProviderId}
                onChange={(e) => handleMainProviderChange(e.target.value)}
              >
                {!isKnownMainPreset && (
                  <option value={mainProviderId}>自定义 ({mainProviderId})</option>
                )}
                {LLM_PROVIDER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="llm-connection-field">
              <label htmlFor={`${uid}-main-protocol`}>接口协议</label>
              <select
                id={`${uid}-main-protocol`}
                value={mainProtocol}
                onChange={(e) => {
                  const nextProto = e.target.value as LlmProtocol;
                  setForm((f) => ({
                    ...f,
                    ai: {
                      ...f.ai,
                      protocols: {
                        ...(f.ai.protocols ?? {}),
                        [mainProviderId]: nextProto,
                      },
                    },
                  }));
                }}
              >
                {(['openai', 'anthropic', 'ollama'] as const).map((proto) => (
                  <option key={proto} value={proto}>
                    {LLM_PROTOCOL_LABELS[proto]}
                  </option>
                ))}
              </select>
            </div>

            <div className="llm-connection-field">
              <label htmlFor={`${uid}-main-url`}>Base URL</label>
              <input
                id={`${uid}-main-url`}
                placeholder={mainPreset?.defaultBaseUrl || 'https://api.openai.com/v1'}
                value={form.ai.baseUrls?.[mainProviderId] ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    ai: {
                      ...f.ai,
                      baseUrls: {
                        ...(f.ai.baseUrls ?? {}),
                        [mainProviderId]: e.target.value,
                      },
                    },
                  }))
                }
              />
            </div>

            <div className="llm-connection-field">
              <label htmlFor={`${uid}-main-key`}>
                API Key {mainIsLocal && <span style={{ opacity: 0.65 }}>(本地可留空)</span>}
              </label>
              <input
                id={`${uid}-main-key`}
                type="password"
                placeholder={
                  mainIsLocal
                    ? '本地服务无需填写'
                    : mainProtocol === 'anthropic'
                      ? 'sk-ant-…'
                      : 'sk-…'
                }
                value={form.ai.apiKeys[mainProviderId] ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    ai: {
                      ...f.ai,
                      apiKeys: {
                        ...f.ai.apiKeys,
                        [mainProviderId]: e.target.value,
                      },
                    },
                  }))
                }
              />
            </div>
          </div>

          <ScanStatusBar
            scan={mainScanner.scan}
            canScan={mainScanner.canScan}
            onRescan={mainScanner.rescan}
          />
        </div>

        {/* Section 2: 模型场景分工 */}
        <div>
          <div className="llm-section-title">
            <span>分场景模型路由</span>
          </div>
          <div className="llm-models-grid">
            {/* 卡片 A: 复杂任务大模型 */}
            <div className="llm-model-card">
              <div className="llm-model-card-header">
                <span className="llm-model-name">
                  <span>🎯</span>
                  <span>主模型 / 复杂指令大模型</span>
                </span>
                <span className="llm-model-badge primary">强推理 · 建议 14b / 27b / Claude / GPT</span>
              </div>

              {availableMainModels.length > 0 && (
                <select
                  aria-label="选择主模型"
                  className="llm-model-select"
                  value={mainModelInList ? form.ai.model : ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      setForm((f) => ({
                        ...f,
                        ai: { ...f.ai, model: e.target.value },
                      }));
                    }
                  }}
                >
                  {!mainModelInList && (
                    <option value="">
                      {form.ai.model
                        ? `当前手动输入：${form.ai.model}`
                        : '— 从扫描结果选择主模型 —'}
                    </option>
                  )}
                  {availableMainModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {formatModelOption(m)}
                    </option>
                  ))}
                </select>
              )}

              <input
                placeholder="手动输入或选择，如 claude-sonnet-4-5 / qwen3.8:27b / gpt-4o"
                value={form.ai.model}
                onChange={(e) =>
                  setForm((f) => ({ ...f, ai: { ...f.ai, model: e.target.value } }))
                }
              />
              <p className="llm-model-desc">
                用于运行指令、单词/短语深度讲解、语法拆解、简单改写、背单词深度分析等高推理任务。
              </p>
            </div>

            {/* 卡片 B: 快速翻译小模型 */}
            <div className="llm-model-card">
              <div className="llm-model-card-header">
                <span className="llm-model-name">
                  <span>⚡</span>
                  <span>字幕与网页极速翻译小模型</span>
                </span>
                <span className="llm-model-badge secondary">
                  {hasSeparateTransProvider
                    ? `独立源 · ${transProviderId}`
                    : '高吞吐 · 建议 1b / 4b / Mini / Haiku'}
                </span>
              </div>

              {availableTransModels.length > 0 && (
                <select
                  aria-label="选择翻译模型"
                  className="llm-model-select"
                  value={transModelInList ? (form.ai.translationModel ?? '') : '__custom__'}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') return;
                    setForm((f) => ({
                      ...f,
                      ai: { ...f.ai, translationModel: e.target.value },
                    }));
                  }}
                >
                  <option value="">（留空：自动复用主模型）</option>
                  {!transModelInList && (
                    <option value="__custom__">
                      当前手动输入：{form.ai.translationModel}
                    </option>
                  )}
                  {availableTransModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {formatModelOption(m)}
                    </option>
                  ))}
                </select>
              )}

              <input
                placeholder="留空则复用主模型，如 qwen2.5:1.5b / claude-haiku-4-5"
                value={form.ai.translationModel ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    ai: { ...f.ai, translationModel: e.target.value },
                  }))
                }
              />
              <p className="llm-model-desc">
                专用于视频字幕实时翻译与整页全文翻译等大批量、高时效场景。留空时自动复用主模型。
              </p>
            </div>
          </div>
        </div>

        {/* Section 3: 翻译专用独立接口（可选） */}
        <div className="llm-subprovider-box">
          <div className="llm-connection-grid">
            <div className="llm-connection-field">
              <label htmlFor={`${uid}-trans-provider`}>
                翻译专用 Provider <span style={{ opacity: 0.65 }}>(可选，用于混合云端 + 本地)</span>
              </label>
              <select
                id={`${uid}-trans-provider`}
                value={transProviderId}
                onChange={(e) => handleTransProviderChange(e.target.value)}
              >
                <option value="">复用主 Provider（默认）</option>
                {!isKnownTransPreset && (
                  <option value={transProviderId}>自定义 ({transProviderId})</option>
                )}
                {LLM_PROVIDER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {hasSeparateTransProvider && (
              <div className="llm-connection-field">
                <label htmlFor={`${uid}-trans-protocol`}>
                  翻译专用协议 ({transProviderId})
                </label>
                <select
                  id={`${uid}-trans-protocol`}
                  value={transProtocol}
                  onChange={(e) => {
                    const nextProto = e.target.value as LlmProtocol;
                    setForm((f) => ({
                      ...f,
                      ai: {
                        ...f.ai,
                        protocols: {
                          ...(f.ai.protocols ?? {}),
                          [transProviderId]: nextProto,
                        },
                      },
                    }));
                  }}
                >
                  {(['openai', 'anthropic', 'ollama'] as const).map((proto) => (
                    <option key={proto} value={proto}>
                      {LLM_PROTOCOL_LABELS[proto]}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {hasSeparateTransProvider && (
              <>
                <div className="llm-connection-field">
                  <label htmlFor={`${uid}-trans-url`}>
                    翻译专用 Base URL ({transProviderId})
                  </label>
                  <input
                    id={`${uid}-trans-url`}
                    placeholder={
                      transPreset?.defaultBaseUrl || 'http://localhost:11434'
                    }
                    value={form.ai.baseUrls?.[transProviderId] ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        ai: {
                          ...f.ai,
                          baseUrls: {
                            ...(f.ai.baseUrls ?? {}),
                            [transProviderId]: e.target.value,
                          },
                        },
                      }))
                    }
                  />
                </div>
                <div className="llm-connection-field">
                  <label htmlFor={`${uid}-trans-key`}>
                    翻译专用 API Key ({transProviderId}
                    {transIsLocal ? '，本地可留空' : ''})
                  </label>
                  <input
                    id={`${uid}-trans-key`}
                    type="password"
                    placeholder={
                      transIsLocal
                        ? '本地 Ollama / LM Studio / Splash 无需填写'
                        : transProtocol === 'anthropic'
                          ? 'sk-ant-…'
                          : 'sk-…'
                    }
                    value={form.ai.apiKeys[transProviderId] ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        ai: {
                          ...f.ai,
                          apiKeys: {
                            ...f.ai.apiKeys,
                            [transProviderId]: e.target.value,
                          },
                        },
                      }))
                    }
                  />
                </div>
              </>
            )}
          </div>

          {hasSeparateTransProvider && (
            <ScanStatusBar
              scan={transScanner.scan}
              canScan={transScanner.canScan}
              onRescan={transScanner.rescan}
              label={transProviderId}
            />
          )}
        </div>

        {/* Section 4: 优化与高级开关 */}
        <div>
          <label className="checkbox" style={{ margin: '4px 0 0', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.ai.disableThinking !== false}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  ai: {
                    ...f.ai,
                    disableThinking: e.target.checked,
                  },
                }))
              }
            />
            <span>关闭 Thinking 深度思考（推荐开启，大幅减少等待时间，避免思考链污染翻译）</span>
          </label>
        </div>
      </div>
    </div>
  );
}
