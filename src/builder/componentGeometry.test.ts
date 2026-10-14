import { describe, expect, it } from 'vitest';
import * as clip from 'polygon-clipping';
import { boundingBox, polygonArea, pointInPolygon, signedArea2, type Polygon } from '../model/polygon';
import type { EdgeAttachment, FurnitureComponent, FurnitureShape } from '../model/types';
import { curvedOutline, edgeBand, footprintEdges, footprintSeat, insetRing, recomputeComponents } from './componentGeometry';

const attach = (from: number, to = from, extra: Partial<EdgeAttachment> = {}): EdgeAttachment => ({ from, to, startTrim: 0, endTrim: 0, inset: 0, thickness: 20, miterStart: true, miterEnd: true, ...extra });
const ring = (p: Polygon): clip.Polygon => [[...p.map((q) => [q.x, q.y] as clip.Pair), [p[0].x, p[0].y]]];
const overlap = (a: Polygon, b: Polygon) => clip.intersection(ring(a), ring(b)).reduce((sum, poly) => sum + polygonArea(poly[0].slice(0, -1).map(([x, y]) => ({ x, y }))), 0);
const near = (a: number, b: number, tol = 0.6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

/** A loveseat whose back is two sections meeting at an angle (clockwise on screen). */
const angled: FurnitureShape = {
  points: [
    { x: -85, y: -15 },
    { x: 0, y: -48 },
    { x: 85, y: -15 },
    { x: 75, y: 48 },
    { x: -75, y: 48 },
  ],
};
const loveseat = { width: 170, depth: 96, shape: angled };
const footprint = angled.points.map((p) => ({ x: p.x, y: p.y }));
const insideFootprint = (poly: Polygon) => poly.every((p) => pointInPolygon(p, footprint) || footprint.some((f, i) => Math.hypot(f.x - p.x, f.y - p.y) < 0.05 || onSegment(p, f, footprint[(i + 1) % footprint.length])));
const onSegment = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  return Math.abs(cross) / Math.hypot(b.x - a.x, b.y - a.y) < 0.05;
};

describe('footprint edges', () => {
  it('numbers a plain piece back, right, front, left', () => {
    const edges = footprintEdges({ width: 200, depth: 90 });
    expect(edges.map((e) => e.length)).toEqual([200, 90, 200, 90]);
    expect(edges[0].points[0]).toEqual({ x: -100, y: -45 });
    expect(edges[2].points[0]).toEqual({ x: 100, y: 45 });
  });

  it('flattens curved edges and keeps their numbering', () => {
    const shape: FurnitureShape = { points: [{ x: -50, y: -20, c1: { x: -20, y: -50 }, c2: { x: 20, y: -50 } }, { x: 50, y: -20 }, { x: 50, y: 30 }, { x: -50, y: 30 }] };
    const edges = footprintEdges({ width: 100, depth: 72, shape });
    expect(edges).toHaveLength(4);
    expect(edges[0].points.length).toBeGreaterThan(3);
    expect(edges[0].length).toBeGreaterThan(100);
  });
});

describe('insetRing', () => {
  it('shrinks a square exactly by the inset on every side', () => {
    const square = [{ x: -50, y: -50 }, { x: 50, y: -50 }, { x: 50, y: 50 }, { x: -50, y: 50 }];
    const inner = insetRing(square, 10)!;
    const box = boundingBox(inner);
    near(box.minX, -40, 0.01);
    near(box.maxY, 40, 0.01);
    near(polygonArea(inner), 6400, 1);
  });

  it('works on concave outlines (an L-shape)', () => {
    const l = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 }];
    const inner = insetRing(l, 5)!;
    near(polygonArea(inner), 90 * 30 + 30 * 60, 15);
    expect(inner.every((p) => pointInPolygon(p, l))).toBe(true);
  });
});

describe('edgeBand', () => {
  it('runs along the back of a plain sofa, exactly as thick as asked', () => {
    const band = edgeBand({ width: 200, depth: 90 }, attach(0, 0, { thickness: 20 }))!;
    const box = boundingBox(band);
    expect(box).toEqual({ minX: -100, minY: -45, maxX: 100, maxY: -25 });
  });

  it('can stand off the edge and be trimmed at both ends', () => {
    const band = edgeBand({ width: 200, depth: 90 }, attach(0, 0, { thickness: 15, inset: 2, startTrim: 10, endTrim: 30, miterStart: false, miterEnd: false }))!;
    const box = boundingBox(band);
    near(box.minY, -43, 0.01);
    near(box.maxY, -28, 0.01);
    near(box.minX, -90, 0.01);
    near(box.maxX, 70, 0.01);
  });

  it('follows two angled back sections that meet neatly without overlapping', () => {
    const left = edgeBand(loveseat, attach(0, 0, { thickness: 18 }))!;
    const right = edgeBand(loveseat, attach(1, 1, { thickness: 18 }))!;
    expect(insideFootprint(left)).toBe(true);
    expect(insideFootprint(right)).toBe(true);
    // Mitred at the shared corner: they touch but don't overlap.
    expect(overlap(left, right)).toBeLessThan(0.5);
    // And together they cover the whole band along both edges.
    const both = edgeBand(loveseat, attach(0, 1, { thickness: 18 }))!;
    near(polygonArea(left) + polygonArea(right), polygonArea(both), 2);
  });

  it('wraps around a corner into an L-shaped arm-and-back band', () => {
    const square = edgeBand({ width: 200, depth: 90 }, attach(3, 0, { thickness: 20, miterStart: false, miterEnd: false }))!;
    near(polygonArea(square), 200 * 20 + 70 * 20, 1);
    // Mitred ends lose a 20 × 20 half-square at each end (where the front and the right arm would meet them).
    const mitred = edgeBand({ width: 200, depth: 90 }, attach(3, 0, { thickness: 20 }))!;
    near(polygonArea(mitred), 200 * 20 + 70 * 20 - 2 * 200, 1);
  });

  it('gives nothing when trimmed away entirely', () => {
    expect(edgeBand({ width: 100, depth: 50 }, attach(0, 0, { thickness: 10, startTrim: 60, endTrim: 60 }))).toBeNull();
  });
});

describe('footprintSeat', () => {
  const back = (id: string, edge: number): FurnitureComponent => {
    const outline = edgeBand(loveseat, attach(edge, edge, { thickness: 18 }))!;
    return { id, name: id, type: 'backrest', shape: 'polygon', x: 0, y: 0, z: 0, width: 1, depth: 1, height: 40, rotation: 0, outline };
  };

  it('fills the footprint minus the backrests, with a gap', () => {
    const components = [back('b1', 0), back('b2', 1)];
    const seat: FurnitureComponent = { id: 's', name: 'Seat', type: 'cushion', shape: 'footprint', x: 0, y: 0, z: 0, width: 1, depth: 1, height: 14, rotation: 0, inset: 1.5, cut: ['b1', 'b2'] };
    const outline = footprintSeat({ ...loveseat, components }, seat)!;
    expect(outline).not.toBeNull();
    expect(insideFootprint(outline)).toBe(true);
    for (const b of components) expect(overlap(outline, b.outline!)).toBeLessThan(0.5);
    // The seat is most of what's left: it's deep, as on a deep-seat loveseat.
    expect(boundingBox(outline).maxY - boundingBox(outline).minY).toBeGreaterThan(55);
  });

  it('splits into cushions across the front edge, with a gap between them', () => {
    const base: FurnitureComponent = { id: 's', name: 'Seat', type: 'cushion', shape: 'footprint', x: 0, y: 0, z: 0, width: 1, depth: 1, height: 14, rotation: 0, inset: 1 };
    const whole = footprintSeat(loveseat, base)!;
    const left = footprintSeat(loveseat, { ...base, split: { along: 3, count: 2, index: 0, gap: 2 } })!;
    const right = footprintSeat(loveseat, { ...base, split: { along: 3, count: 2, index: 1, gap: 2 } })!;
    expect(overlap(left, right)).toBeLessThan(0.01);
    expect(polygonArea(left) + polygonArea(right)).toBeLessThan(polygonArea(whole));
    expect(polygonArea(left) + polygonArea(right)).toBeGreaterThan(polygonArea(whole) * 0.95);
  });
});

describe('curvedOutline', () => {
  it('bends a panel back by the sweep, symmetric and as wide as its chord', () => {
    const outline = curvedOutline(120, 12, 60);
    const box = boundingBox(outline);
    near(box.minX, -box.maxX, 0.01);
    expect(box.maxX - box.minX).toBeGreaterThanOrEqual(120);
    expect(box.maxX - box.minX).toBeLessThan(135);
    expect(signedArea2(outline)).toBeGreaterThan(0);
  });
});

describe('recomputeComponents', () => {
  it('stores bands and seats as outlines centred on their own box, in the piece frame', () => {
    const components: FurnitureComponent[] = [
      { id: 'b', name: 'Back', type: 'backrest', shape: 'edge', x: 0, y: 0, z: 10, width: 1, depth: 20, height: 50, rotation: 30, edges: attach(0, 0, { miterStart: false, miterEnd: false }) },
      { id: 's', name: 'Seat', type: 'cushion', shape: 'footprint', x: 0, y: 0, z: 10, width: 1, depth: 1, height: 14, rotation: 0, inset: 1, cut: ['b'] },
    ];
    const { components: out, failed } = recomputeComponents({ width: 200, depth: 90, components });
    expect(failed).toEqual([]);
    const backrest = out[0];
    expect(backrest.rotation).toBe(0);
    expect({ x: backrest.x, y: backrest.y, width: backrest.width, depth: backrest.depth }).toEqual({ x: 0, y: -35, width: 200, depth: 20 });
    const box = boundingBox(backrest.outline!);
    expect(box).toEqual({ minX: -100, minY: -10, maxX: 100, maxY: 10 });
    const seat = out[1];
    near(seat.y - seat.depth / 2, -24, 0.01);
    near(seat.y + seat.depth / 2, 44, 0.01);
  });

  it('reports components that can no longer be made, keeping them unchanged', () => {
    const band: FurnitureComponent = { id: 'b', name: 'Arm', type: 'armrest', shape: 'edge', x: 1, y: 2, z: 0, width: 5, depth: 10, height: 50, rotation: 0, edges: attach(1, 1, { startTrim: 50, endTrim: 50, thickness: 10 }) };
    const { components, failed } = recomputeComponents({ width: 100, depth: 60, components: [band] });
    expect(failed).toEqual(['Arm']);
    expect(components[0]).toEqual(band);
  });
});
