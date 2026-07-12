import React from 'react';

export function LoadingDots(props: { label?: string }) {
  return (
    <span className="muted" aria-live="polite">
      {props.label ?? 'Loading'}
      <span className="ueh-loading-dots">…</span>
    </span>
  );
}
