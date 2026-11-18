import React, { useState } from 'react';

/** Lightweight help tooltip (read-frog HelpTooltip parity, no base-ui). */
export function HelpTooltip(props: {
  children: React.ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', marginLeft: 6 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={props.label ?? '帮助'}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: '1px solid var(--rf-border)',
          background: 'transparent',
          color: 'var(--rf-muted-foreground)',
          fontSize: 11,
          cursor: 'help',
          padding: 0,
          lineHeight: 1,
        }}
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '120%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            minWidth: 180,
            maxWidth: 280,
            padding: '8px 10px',
            borderRadius: 8,
            background: 'var(--rf-card)',
            border: '1px solid var(--rf-border)',
            color: 'var(--rf-card-foreground)',
            fontSize: 12,
            lineHeight: 1.4,
            boxShadow: '0 8px 24px rgba(0,0,0,.22)',
            pointerEvents: 'none',
          }}
        >
          {props.children}
        </span>
      )}
    </span>
  );
}
