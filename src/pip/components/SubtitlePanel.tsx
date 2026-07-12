import React from 'react';
import type { SubtitleCue } from '../../shared/domain/types';
import { isClickableWord, segmentWords } from '../../utils/segmenter';

export function SubtitlePanel(props: {
  cue: SubtitleCue | null;
  onWordClick: (surface: string) => void;
}) {
  const { cue, onWordClick } = props;
  if (!cue) {
    return (
      <>
        <div className="ueh-cue-en">No subtitle</div>
        <div className="ueh-cue-tr" />
      </>
    );
  }

  const segs = segmentWords(cue.text);
  return (
    <>
      <div className="ueh-cue-en">
        {segs.map((seg) =>
          isClickableWord(seg) ? (
            <span
              key={seg.index}
              className="ueh-word"
              onClick={() => onWordClick(seg.text)}
            >
              {seg.text}
            </span>
          ) : (
            <span key={seg.index}>{seg.text}</span>
          ),
        )}
      </div>
      <div className="ueh-cue-tr">{cue.translation ?? ''}</div>
    </>
  );
}
