import React from 'react';

export function WordPopup(props: {
  text: string;
  surface?: string;
  context?: string;
  loading?: boolean;
  onAdd?: () => void;
  onTts?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="ueh-panel" role="dialog" aria-label="单词释义">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        {props.surface && (
          <strong style={{ fontSize: 18, color: 'oklch(88% 0.08 82)' }}>
            {props.surface}
          </strong>
        )}
        {props.onClose && (
          <button type="button" onClick={props.onClose} aria-label="关闭">
            ×
          </button>
        )}
      </div>
      {props.context && (
        <div
          style={{
            fontSize: 11,
            opacity: 0.65,
            marginTop: 4,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {props.context}
        </div>
      )}
      <div
        style={{
          marginTop: 10,
          fontSize: 13,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {props.loading ? '查询中…' : props.text}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 12,
          flexWrap: 'wrap',
        }}
      >
        {props.onAdd && (
          <button type="button" onClick={props.onAdd}>
            加生词本
          </button>
        )}
        {props.onTts && (
          <button type="button" onClick={props.onTts}>
            朗读
          </button>
        )}
      </div>
    </div>
  );
}
