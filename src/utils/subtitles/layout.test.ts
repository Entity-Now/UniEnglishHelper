import { describe, expect, it } from 'vitest';
import {
  applySubtitleLayerLayout,
  clampPositionPercent,
  describeSubtitlePlacement,
  resolveSubtitlePlacement,
} from './layout';

describe('subtitle layout', () => {
  it('clamps position percent', () => {
    expect(clampPositionPercent(-5)).toBe(0);
    expect(clampPositionPercent(12)).toBe(12);
    expect(clampPositionPercent(99)).toBe(45);
    expect(clampPositionPercent(Number.NaN)).toBe(10);
  });

  it('defaults to stacked translation below at bottom', () => {
    const p = resolveSubtitlePlacement({});
    expect(p.layout).toBe('stacked');
    expect(p.flexDirection).toBe('column');
    expect(p.stackAnchor).toBe('bottom');
    expect(p.percent).toBe(10);
  });

  it('stacked + above uses column-reverse', () => {
    const p = resolveSubtitlePlacement({
      layout: 'stacked',
      translationPosition: 'above',
      position: { percent: 15, anchor: 'top' },
    });
    expect(p.layout).toBe('stacked');
    expect(p.flexDirection).toBe('column-reverse');
    expect(p.stackAnchor).toBe('top');
    expect(p.percent).toBe(15);
  });

  it('split + above puts translation on top and original on bottom', () => {
    const p = resolveSubtitlePlacement({
      layout: 'split',
      translationPosition: 'above',
      position: { percent: 8, anchor: 'bottom' },
    });
    expect(p.layout).toBe('split');
    expect(p.translationEdge).toBe('top');
    expect(p.originalEdge).toBe('bottom');
    expect(p.percent).toBe(8);
  });

  it('split + below reverses edges (original top / translation bottom)', () => {
    const p = resolveSubtitlePlacement({
      layout: 'split',
      translationPosition: 'below',
    });
    expect(p.originalEdge).toBe('top');
    expect(p.translationEdge).toBe('bottom');
  });

  it('describes placement for UI labels', () => {
    expect(
      describeSubtitlePlacement(
        resolveSubtitlePlacement({
          layout: 'split',
          translationPosition: 'above',
        }),
      ),
    ).toContain('译文顶');
    expect(
      describeSubtitlePlacement(
        resolveSubtitlePlacement({
          layout: 'stacked',
          translationPosition: 'below',
          position: { percent: 10, anchor: 'bottom' },
        }),
      ),
    ).toContain('堆叠');
  });

  it('stacked layout puts bilingual order on the inner card', () => {
    const layer = document.createElement('div');
    const card = document.createElement('div');
    card.id = 'ueh-sub-card';
    const original = document.createElement('div');
    const translation = document.createElement('div');
    card.append(original, translation);
    layer.append(card);

    applySubtitleLayerLayout(layer, original, translation, {
      placement: resolveSubtitlePlacement({
        layout: 'stacked',
        translationPosition: 'above',
      }),
    });

    expect(layer.classList.contains('ueh-sub-stacked')).toBe(true);
    expect(card.style.display).toBe('flex');
    expect(card.style.flexDirection).toBe('column-reverse');
    expect(layer.style.flexDirection).toBe('column');
  });

  it('split layout makes the inner card display:contents', () => {
    const layer = document.createElement('div');
    const card = document.createElement('div');
    card.className = 'ueh-sub-card';
    const original = document.createElement('div');
    const translation = document.createElement('div');
    card.append(original, translation);
    layer.append(card);

    applySubtitleLayerLayout(layer, original, translation, {
      placement: resolveSubtitlePlacement({
        layout: 'split',
        translationPosition: 'below',
      }),
    });

    expect(layer.classList.contains('ueh-sub-split')).toBe(true);
    expect(card.style.display).toBe('contents');
    expect(original.style.position).toBe('absolute');
    expect(translation.style.position).toBe('absolute');
  });
});
