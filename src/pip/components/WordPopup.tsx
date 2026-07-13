import React from 'react';

export type WordPopupEngine = 'llm' | 'free_mt' | 'none';

/**
 * Floating word-explain card for the React PiP shell.
 * Fixed overlay + high z-index so it is never clipped by the flex layout
 * or covered by the toolbar / subtitle panel.
 *
 * When LLM fails, background explainWord falls back to free MT quickly;
 * pass `engine` / `note` so the user sees the switch.
 */
export function WordPopup(props: {
  text: string;
  surface?: string;
  context?: string;
  /** Translated subtitle sentence (if already available). */
  contextTranslation?: string;
  loading?: boolean;
  /** Which backend produced the text */
  engine?: WordPopupEngine;
  /** Fallback / error hint from explainWord */
  note?: string;
  onAdd?: () => void;
  onTts?: () => void;
  onClose?: () => void;
}) {
  const badge =
    props.loading
      ? null
      : props.engine === 'free_mt'
        ? { cls: 'free', label: '免费翻译' }
        : props.engine === 'llm'
          ? { cls: 'llm', label: 'AI 释义' }
          : props.engine === 'none'
            ? { cls: 'none', label: '不可用' }
            : null;

  return (
    <div className="ueh-word-popup" role="dialog" aria-label="单词释义">
      <div className="ueh-word-popup-head">
        <div className="ueh-word-popup-title-row">
          {props.surface ? (
            <strong className="ueh-word-popup-surface">{props.surface}</strong>
          ) : (
            <strong className="ueh-word-popup-surface">释义</strong>
          )}
          {badge ? (
            <span className={`ueh-word-popup-badge ${badge.cls}`}>
              {badge.label}
            </span>
          ) : null}
        </div>
        {props.onClose ? (
          <button
            type="button"
            className="ueh-word-popup-close"
            onClick={props.onClose}
            aria-label="关闭"
          >
            ×
          </button>
        ) : null}
      </div>
      {props.context ? (
        <div className="ueh-word-popup-ctx" title={props.context}>
          <div>原文：{props.context}</div>
          {props.contextTranslation?.trim() ? (
            <div className="ueh-word-popup-ctx-tr">
              译文：{props.contextTranslation.trim()}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="ueh-word-popup-body">
        {props.loading ? '查询中…' : props.text}
      </div>
      {!props.loading && props.note ? (
        <div className="ueh-word-popup-note" role="status">
          {props.note}
        </div>
      ) : null}
      {(props.onAdd || props.onTts) && (
        <div className="ueh-word-popup-actions">
          {props.onAdd ? (
            <button type="button" className="primary" onClick={props.onAdd}>
              加生词本
            </button>
          ) : null}
          {props.onTts ? (
            <button type="button" className="secondary" onClick={props.onTts}>
              朗读
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
