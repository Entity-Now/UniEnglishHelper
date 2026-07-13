import React, { useEffect, useRef } from 'react';
import type { SubtitleCue, VocabHighlightConfig } from '../../shared/domain/types';
import { DEFAULT_VOCAB_HIGHLIGHT } from '../../shared/domain/types';
import { isClickableWord, segmentWords } from '../../utils/segmenter';
import {
  colorForStatus,
  highlightClass,
  statusForSurface,
  type HighlightMap,
} from '../../utils/vocab-highlight';

/** Non-passive wheel: block edge overscroll from chaining to the document. */
function useContainOverscroll(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const dy = e.deltaY;
      if (dy === 0) return;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) {
        e.preventDefault();
        return;
      }
      const top = el.scrollTop;
      if ((top <= 0 && dy < 0) || (top >= max - 0.5 && dy > 0)) {
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref]);
}

export function SubtitlePanel(props: {
  cue: SubtitleCue | null;
  onWordClick: (surface: string) => void;
  highlightMap?: HighlightMap;
  vocabHighlight?: VocabHighlightConfig;
}) {
  const { cue, onWordClick, highlightMap = {}, vocabHighlight = DEFAULT_VOCAB_HIGHLIGHT } =
    props;
  const scrollRef = useRef<HTMLDivElement>(null);
  useContainOverscroll(scrollRef);

  if (!cue) {
    return (
      <div ref={scrollRef} className="ueh-subtitle-panel">
        <div className="ueh-cue-en ueh-cue-empty">No subtitle</div>
        <div className="ueh-cue-tr" />
      </div>
    );
  }

  const segs = segmentWords(cue.text);
  return (
    <div ref={scrollRef} className="ueh-subtitle-panel">
      <div className="ueh-cue-en">
        {segs.map((seg) => {
          if (!isClickableWord(seg)) {
            return <span key={seg.index}>{seg.text}</span>;
          }
          const st =
            vocabHighlight.enabled !== false
              ? statusForSurface(highlightMap, seg.text)
              : null;
          const hlCls = highlightClass(st);
          return (
            <span
              key={seg.index}
              className={hlCls ? `ueh-word ${hlCls}` : 'ueh-word'}
              title={st ? `生词 · ${st}` : undefined}
              style={
                st
                  ? {
                      boxShadow: `inset 0 -2px 0 ${colorForStatus(st, vocabHighlight)}`,
                    }
                  : undefined
              }
              onClick={() => onWordClick(seg.text)}
            >
              {seg.text}
            </span>
          );
        })}
      </div>
      {cue.translation?.trim() ? (
        <div className="ueh-cue-tr">{cue.translation}</div>
      ) : (
        <div className="ueh-cue-tr" aria-hidden />
      )}
    </div>
  );
}
