import React from 'react';
import type { AppConfig } from '../../shared/domain/types';

export interface LlmConfigCardProps {
  config: AppConfig;
  onChange: React.Dispatch<React.SetStateAction<AppConfig>>;
}

export function LlmConfigCard({ config, onChange }: LlmConfigCardProps) {
  const form = config;
  const setForm = onChange;

  return (
    <div className="card">
      <h2>LLM 接口与模型分工</h2>
      <p className="hint">
        OpenAI 兼容接口（DeepSeek / Gemini 代理 / 本地 Ollama 等）。支持按场景分工配置不同模型，兼顾翻译流速与深度分析体验。
      </p>

      <div className="llm-config-section">
        {/* Section 1: 模型场景分工 */}
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
                <span className="llm-model-badge primary">强推理 · 建议 14b / 27b / 32b</span>
              </div>
              <input
                placeholder="如 27b / 32b / deepseek-chat / gpt-4o"
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
                <span className="llm-model-badge secondary">高吞吐 · 建议 1b / 2b / Mini</span>
              </div>
              <input
                placeholder="如 1b / 2b / qwen2.5:1.5b (留空则使用主模型)"
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

        {/* Section 2: 接口与连接配置 */}
        <div>
          <div className="llm-section-title" style={{ marginTop: 4 }}>
            <span>接口连接与凭据</span>
          </div>
          <div className="llm-connection-grid">
            <div className="llm-connection-field">
              <label>主 Provider ID</label>
              <input
                placeholder="openai-compatible / deepseek / siliconflow"
                value={form.ai.providerId}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    ai: { ...f.ai, providerId: e.target.value },
                  }))
                }
              />
            </div>

            <div className="llm-connection-field">
              <label>Base URL (OpenAI 兼容)</label>
              <input
                placeholder="https://api.openai.com/v1"
                value={form.ai.baseUrls?.[form.ai.providerId] ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    ai: {
                      ...f.ai,
                      baseUrls: {
                        ...(form.ai.baseUrls ?? {}),
                        [form.ai.providerId]: e.target.value,
                      },
                    },
                  }))
                }
              />
            </div>

            <div className="llm-connection-field">
              <label>API Key</label>
              <input
                type="password"
                placeholder="sk-…"
                value={form.ai.apiKeys[form.ai.providerId] ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    ai: {
                      ...f.ai,
                      apiKeys: {
                        ...form.ai.apiKeys,
                        [form.ai.providerId]: e.target.value,
                      },
                    },
                  }))
                }
              />
            </div>

            <div className="llm-connection-field">
              <label>
                翻译专用 Provider ID <span style={{ opacity: 0.65 }}>(可选)</span>
              </label>
              <input
                placeholder="留空则复用主 Provider，本地可填 ollama"
                value={form.ai.translationProviderId ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    ai: { ...f.ai, translationProviderId: e.target.value },
                  }))
                }
              />
            </div>
          </div>
        </div>

        {/* Section 3: 优化与高级开关 */}
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
