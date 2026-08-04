import React, { useEffect, useRef } from 'react';
import type { SubtitleCue, VocabHighlightConfig } from '../../shared/domain/types';
import { DEFAULT_VOCAB_HIGHLIGHT } from '../../shared/domain/types';
import { isClickableWord, segmentWords } from '../../utils/segmenter';
import {
  colorForStatus,
  entryForSurface,
  highlightClass,
  shortGloss,
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
  let hasGloss = false;
  const wordNodes = segs.map((seg) => {
    if (!isClickableWord(seg)) {
      return <span key={seg.index}>{seg.text}</span>;
    }
    const entry =
      vocabHighlight.enabled !== false
        ? entryForSurface(highlightMap, seg.text)
        : null;
    const st = entry?.status ?? null;
    const hlCls = highlightClass(st);
    const full = entry?.translation?.trim() || '';
    const gloss = shortGloss(full);
    if (gloss) hasGloss = true;
    const tip = full
      ? `${seg.text} · ${full}`
      : st
        ? `生词 · ${st}`
        : undefined;
    return (
      <span
        key={seg.index}
        className={[
          'ueh-word',
          hlCls,
          gloss ? 'ueh-word-has-gloss' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        title={tip}
        data-gloss={full || undefined}
        style={
          st
            ? {
                boxShadow: `inset 0 -2px 0 ${colorForStatus(st, vocabHighlight)}`,
              }
            : undefined
        }
        onClick={() => onWordClick(seg.text)}
      >
        {gloss ? (
          <>
            <span className="ueh-word-surface">{seg.text}</span>
            <span className="ueh-word-gloss">{gloss}</span>
          </>
        ) : (
          seg.text
        )}
      </span>
    );
  });
  return (
    <div ref={scrollRef} className="ueh-subtitle-panel">
      <div
        className={
          hasGloss ? 'ueh-cue-en ueh-en-has-gloss' : 'ueh-cue-en'
        }
      >
        {wordNodes}
      </div>
      {cue.translation?.trim() ? (
        <div className="ueh-cue-tr">{cue.translation}</div>
      ) : (
        <div className="ueh-cue-tr" aria-hidden />
      )}
    </div>
  );
}
