import { describe, expect, it } from 'vitest';
import { findSelfIntersection, polygonArea } from '../model/polygon';
import { applyMask, growMask, maskByEdgeColour, simplifyClosed, softenMask, squareToQuad, traceMask, warpPerspective, type RGBAImage } from './imageOps';

/** A w×h image: a grey background with a brown "sofa" rectangle (or any shape) painted on it. */
function photo(w: number, h: number, inside: (x: number, y: number) => boolean): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b] = inside(x, y) ? [120, 70, 40] : [230 + ((x * 7 + y * 3) % 6), 228, 225];
      data.set([r, g, b, 255], i);
    }
  }
  return { width: w, height: h, data };
}

describe('background removal by colour', () => {
  it('removes a plain background and keeps the furniture', () => {
    const img = photo(60, 40, (x, y) => x >= 15 && x < 45 && y >= 10 && y < 30);
    const mask = maskByEdgeColour(img, 30);
    const kept = mask.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
    expect(kept).toBe(30 * 20);
    expect(mask[20 * 60 + 30]).toBe(255);
    expect(mask[0]).toBe(0);
    const cut = applyMask(img, mask);
    expect(cut.data[3]).toBe(0);
    expect(cut.data[(20 * 60 + 30) * 4 + 3]).toBe(255);
  });

  it('grows, shrinks and softens the kept area', () => {
    const w = 20;
    const h = 20;
    const mask = new Uint8Array(w * h);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) mask[y * w + x] = 255;
    const count = (m: Uint8Array) => m.reduce((n, v) => n + (v > 127 ? 1 : 0), 0);
    expect(count(growMask(mask, w, h, 1))).toBe(12 * 12);
    expect(count(growMask(mask, w, h, -1))).toBe(8 * 8);
    const soft = softenMask(mask, w, h, 1);
    expect(soft[10 * w + 5]).toBeGreaterThan(0);
    expect(soft[10 * w + 5]).toBeLessThan(255);
  });
});

describe('tracing a silhouette', () => {
  it('traces an L-shaped cut-out into a clean outline with the right area', () => {
    const w = 50;
    const h = 40;
    const mask = new Uint8Array(w * h);
    for (let y = 5; y < 35; y++) for (let x = 5; x < 45; x++) if (!(x >= 25 && y >= 20)) mask[y * w + x] = 255;
    const outline = traceMask(mask, w, h)!;
    expect(outline).toHaveLength(6);
    expect(polygonArea(outline)).toBe(40 * 30 - 20 * 15);
    expect(findSelfIntersection(outline)).toBeNull();
  });

  it('ignores specks and keeps the largest piece', () => {
    const w = 30;
    const h = 30;
    const mask = new Uint8Array(w * h);
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) mask[y * w + x] = 255;
    mask[2 * w + 2] = 255;
    expect(polygonArea(traceMask(mask, w, h)!)).toBe(100);
    expect(traceMask(new Uint8Array(100), 10, 10)).toBeNull();
  });

  it('simplifies a staircase of pixels into a straight diagonal', () => {
    const stairs = [];
    for (let i = 0; i < 20; i++) stairs.push({ x: i, y: i }, { x: i + 1, y: i });
    stairs.push({ x: 20, y: 20 }, { x: 0, y: 20 });
    expect(simplifyClosed(stairs, 1).length).toBeLessThanOrEqual(4);
  });
});

describe('perspective correction', () => {
  it('maps the unit square onto the four corners', () => {
    const quad: [any, any, any, any] = [{ x: 10, y: 5 }, { x: 90, y: 15 }, { x: 80, y: 70 }, { x: 5, y: 60 }];
    const H = squareToQuad(quad);
    const map = (u: number, v: number) => {
      const d = H[6] * u + H[7] * v + H[8];
      return { x: (H[0] * u + H[1] * v + H[2]) / d, y: (H[3] * u + H[4] * v + H[5]) / d };
    };
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => {
      expect(map(u, v).x).toBeCloseTo(quad[i].x, 6);
      expect(map(u, v).y).toBeCloseTo(quad[i].y, 6);
    });
  });

  it('straightens a tilted rectangle into a flat one', () => {
    // A brown quadrilateral on grey; warping its corners fills the output with brown.
    const corners: [any, any, any, any] = [{ x: 12, y: 8 }, { x: 52, y: 12 }, { x: 50, y: 38 }, { x: 10, y: 34 }];
    const inQuad = (x: number, y: number) => x > 14 && x < 48 && y > 12 && y < 32;
    const img = photo(64, 48, inQuad);
    const flat = warpPerspective(img, corners, 40, 25);
    const centre = (12 * 40 + 20) * 4;
    expect([flat.data[centre], flat.data[centre + 1], flat.data[centre + 2]]).toEqual([120, 70, 40]);
  });
});
