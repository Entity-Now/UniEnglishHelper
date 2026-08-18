import React, { useState } from 'react';
import type { AppConfig } from '../../shared/domain/types';
import {
  DEFAULT_SUBTITLE_TRANSLATE_SYSTEM_PROMPT,
  DEFAULT_SUBTITLE_TRANSLATE_PROMPT,
} from '../../utils/constants/prompt';
import { DEFAULT_WORD_EXPLAIN_SYSTEM_PROMPT_TEMPLATE } from '../../utils/prompts/word-explain';

export function AiPromptEditor(props: {
  config: AppConfig;
  onChange: (config: AppConfig) => void;
}) {
  const { config, onChange } = props;

  const [activeTab, setActiveTab] = useState<'subtitles' | 'wordExplain'>('subtitles');

  const customPattern = config.videoSubtitles?.customPromptsConfig?.patterns?.[0];
  const subtitleSystemPrompt =
    customPattern?.systemPrompt ?? DEFAULT_SUBTITLE_TRANSLATE_SYSTEM_PROMPT;
  const subtitleUserPrompt =
    customPattern?.prompt ?? DEFAULT_SUBTITLE_TRANSLATE_PROMPT;
  const wordExplainPrompt =
    config.wordShow?.customSystemPrompt ??
    DEFAULT_WORD_EXPLAIN_SYSTEM_PROMPT_TEMPLATE;

  const isSubtitleCustomized = Boolean(
    config.videoSubtitles?.customPromptsConfig?.promptId &&
      customPattern &&
      (customPattern.systemPrompt !== DEFAULT_SUBTITLE_TRANSLATE_SYSTEM_PROMPT ||
        customPattern.prompt !== DEFAULT_SUBTITLE_TRANSLATE_PROMPT),
  );

  const isWordExplainCustomized = Boolean(
    config.wordShow?.customSystemPrompt &&
      config.wordShow.customSystemPrompt !==
        DEFAULT_WORD_EXPLAIN_SYSTEM_PROMPT_TEMPLATE,
  );

  const handleUpdateSubtitlePrompts = (
    newSys: string,
    newUser: string,
  ) => {
    onChange({
      ...config,
      videoSubtitles: {
        ...config.videoSubtitles,
        customPromptsConfig: {
          promptId: 'custom-subtitles',
          patterns: [
            {
              id: 'custom-subtitles',
              name: '自定义字幕翻译',
              systemPrompt: newSys,
              prompt: newUser,
            },
          ],
        },
      },
    });
  };

  const handleResetSubtitlePrompts = () => {
    onChange({
      ...config,
      videoSubtitles: {
        ...config.videoSubtitles,
        customPromptsConfig: {
          promptId: null,
          patterns: [],
        },
      },
    });
  };

  const handleUpdateWordExplainPrompt = (newSys: string) => {
    onChange({
      ...config,
      wordShow: {
        ...config.wordShow,
        customSystemPrompt: newSys,
      },
    });
  };

  const handleResetWordExplainPrompt = () => {
    onChange({
      ...config,
      wordShow: {
        ...config.wordShow,
        customSystemPrompt: undefined,
      },
    });
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>AI 提示词配置（AI Prompts）</h2>
          <p className="hint" style={{ margin: '4px 0 0' }}>
            自定义视频字幕翻译和生词 AI 释义时发送给模型的提示词模板。
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          type="button"
          className={activeTab === 'subtitles' ? 'primary' : 'ghost'}
          onClick={() => setActiveTab('subtitles')}
          style={{ fontSize: 13, padding: '5px 12px' }}
        >
          视频字幕翻译 Prompt {isSubtitleCustomized && <span style={{ opacity: 0.8 }}>(已自定义)</span>}
        </button>
        <button
          type="button"
          className={activeTab === 'wordExplain' ? 'primary' : 'ghost'}
          onClick={() => setActiveTab('wordExplain')}
          style={{ fontSize: 13, padding: '5px 12px' }}
        >
          单词释义 Prompt {isWordExplainCustomized && <span style={{ opacity: 0.8 }}>(已自定义)</span>}
        </button>
      </div>

      {activeTab === 'subtitles' && (
        <div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>系统提示词（System Prompt）</span>
              <span className="hint" style={{ fontWeight: 400 }}>
                支持变量：<code>{'{{targetLanguage}}'}</code>, <code>{'{{webTitle}}'}</code>, <code>{'{{videoSummary}}'}</code>
              </span>
            </label>
            <textarea
              rows={8}
              value={subtitleSystemPrompt}
              onChange={(e) =>
                handleUpdateSubtitlePrompts(e.target.value, subtitleUserPrompt)
              }
              placeholder="请输入字幕翻译系统提示词..."
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>用户提示词（User Prompt）</span>
              <span className="hint" style={{ fontWeight: 400 }}>
                支持变量：<code>{'{{targetLanguage}}'}</code>, <code>{'{{input}}'}</code>
              </span>
            </label>
            <textarea
              rows={3}
              value={subtitleUserPrompt}
              onChange={(e) =>
                handleUpdateSubtitlePrompts(subtitleSystemPrompt, e.target.value)
              }
              placeholder="请输入字幕翻译用户提示词..."
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="ghost"
              disabled={!isSubtitleCustomized}
              onClick={handleResetSubtitlePrompts}
              style={{ fontSize: 12 }}
            >
              恢复字幕翻译默认提示词
            </button>
          </div>
        </div>
      )}

      {activeTab === 'wordExplain' && (
        <div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>单词释义系统提示词（System Prompt）</span>
              <span className="hint" style={{ fontWeight: 400 }}>
                支持变量：<code>{'{{sourceLanguage}}'}</code>, <code>{'{{targetLanguage}}'}</code>, <code>{'{{langLevel}}'}</code>
              </span>
            </label>
            <textarea
              rows={12}
              value={wordExplainPrompt}
              onChange={(e) => handleUpdateWordExplainPrompt(e.target.value)}
              placeholder="请输入单词释义系统提示词..."
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="ghost"
              disabled={!isWordExplainCustomized}
              onClick={handleResetWordExplainPrompt}
              style={{ fontSize: 12 }}
            >
              恢复单词释义默认提示词
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
