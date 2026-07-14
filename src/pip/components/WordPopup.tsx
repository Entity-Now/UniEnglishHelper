import React from 'react';

export type WordPopupEngine = 'llm' | 'free_mt' | 'none';

function IconBtn(props: {
  label: string;
  onClick?: () => void;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`ueh-ibtn${props.primary ? ' primary' : ''}`}
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

const IcoAdd = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <line x1="12" x2="12" y1="11" y2="17" />
    <line x1="9" x2="15" y1="14" y2="14" />
  </svg>
);

const IcoTts = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

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
        <div className="ueh-word-popup-actions ueh-ibtn-row">
          {props.onAdd ? (
            <IconBtn label="加生词本" primary onClick={props.onAdd}>
              <IcoAdd />
            </IconBtn>
          ) : null}
          {props.onTts ? (
            <IconBtn label="朗读" onClick={props.onTts}>
              <IcoTts />
            </IconBtn>
          ) : null}
        </div>
      )}
    </div>
  );
}
