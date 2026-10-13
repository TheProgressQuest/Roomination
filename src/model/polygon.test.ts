import { describe, expect, it } from 'vitest';
import { arcPoints, clipConvex, overlapArea, polygonArea, rectPolygon } from './polygon';

describe('polygon helpers', () => {
  it('computes rectangle area at any rotation', () => {
    expect(polygonArea(rectPolygon(0, 0, 200, 100, 0))).toBeCloseTo(20_000);
    expect(polygonArea(rectPolygon(50, 50, 200, 100, 37))).toBeCloseTo(20_000);
  });

  it('measures partial overlap of axis-aligned rectangles', () => {
    // Two 100×100 squares offset by 50 in x share a 50×100 strip.
    expect(overlapArea(rectPolygon(0, 0, 100, 100, 0), rectPolygon(50, 0, 100, 100, 0))).toBeCloseTo(5_000);
  });

  it('measures overlap of rotated rectangles exactly', () => {
    // A square rotated 45° inside a larger square: fully contained → its whole area.
    const inner = rectPolygon(0, 0, 50, 50, 45);
    expect(overlapArea(inner, rectPolygon(0, 0, 200, 200, 0))).toBeCloseTo(2_500);
    // Diamond centred on a square's corner: exactly a quarter of the diamond overlaps.
    expect(overlapArea(rectPolygon(50, 50, 40, 40, 45), rectPolygon(0, 0, 100, 100, 0))).toBeCloseTo(400);
  });

  it('returns zero for separate or merely touching shapes', () => {
    expect(overlapArea(rectPolygon(0, 0, 100, 100, 0), rectPolygon(300, 0, 100, 100, 0))).toBe(0);
    expect(overlapArea(rectPolygon(0, 0, 100, 100, 0), rectPolygon(100, 0, 100, 100, 0))).toBeCloseTo(0);
  });

  it('works regardless of polygon winding', () => {
    const a = rectPolygon(0, 0, 100, 100, 0);
    const b = rectPolygon(50, 50, 100, 100, 0).reverse();
    expect(polygonArea(clipConvex(a, b))).toBeCloseTo(2_500);
  });

  it('approximates a quarter circle closely', () => {
    const sector = [{ x: 0, y: 0 }, ...arcPoints(0, 0, 100, 0, 90, 64)];
    expect(polygonArea(sector)).toBeCloseTo((Math.PI * 100 * 100) / 4, -1);
  });
});
