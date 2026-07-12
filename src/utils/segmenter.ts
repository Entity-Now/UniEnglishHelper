export interface WordSegment {
  text: string;
  isWordLike: boolean;
  index: number;
}

export function segmentWords(text: string, locale = 'en'): WordSegment[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
    const out: WordSegment[] = [];
    let index = 0;
    for (const { segment, isWordLike } of segmenter.segment(text)) {
      out.push({ text: segment, isWordLike: Boolean(isWordLike), index });
      index += 1;
    }
    return out;
  }

  // Fallback: simple regex split keeping separators
  const parts = text.split(/(\s+|[.,!?;:'"()[\]{}])/);
  return parts
    .filter((p) => p.length > 0)
    .map((textPart, index) => ({
      text: textPart,
      isWordLike: /[A-Za-z0-9]/.test(textPart),
      index,
    }));
}

export function isClickableWord(segment: WordSegment): boolean {
  if (!segment.isWordLike) return false;
  if (/^\d+$/.test(segment.text)) return false;
  if (segment.text.length === 1 && !/[A-Za-z]/.test(segment.text)) return false;
  return true;
}
