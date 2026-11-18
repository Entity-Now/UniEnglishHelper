import React, { useEffect, useRef } from 'react';
import { renderSafeMarkdownToElement } from '../utils/dom/safe-markdown';

export function SafeMarkdown(props: {
  markdown: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    renderSafeMarkdownToElement(ref.current, props.markdown);
  }, [props.markdown]);

  return <div ref={ref} className={props.className} />;
}
