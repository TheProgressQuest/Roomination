import { describe, expect, it } from 'vitest';
import { boundingBox, findSelfIntersection, pointInPolygon, polygonArea, type Polygon } from './polygon';
import {
  CURVE_TOLERANCE,
  convexParts,
  flattenCubic,
  flattenShape,
  footprintInside,
  footprintOverlap,
  localFootprint,
  normaliseShape,
  roomFootprint,
  scaleShape,
  shapeProblem,
  shapeTemplate,
  SHAPE_TEMPLATE_LABELS,
  triangulate,
  type ShapeTemplate,
} from './shape';
import type { FurnitureShape } from './types';

const sq = (x: number, y: number, w: number, h: number): Polygon => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const lShape: FurnitureShape = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 60, y: 100 }, { x: 60, y: 40 }, { x: 0, y: 40 }] };

describe('curves', () => {
  it('flattens a cubic curve to within the tolerance', () => {
    const [p0, p1, p2, p3] = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 0 }];
    const pts = [p0, ...flattenCubic(p0, p1, p2, p3)];
    // Compare densely sampled true curve points with the nearest chord.
    const truePoint = (t: number) => {
      const u = 1 - t;
      return { x: 3 * u * t * t * 200 + t * t * t * 200, y: 3 * u * u * t * 100 + 3 * u * t * t * 100 };
    };
    for (let i = 0; i <= 200; i++) {
      const q = truePoint(i / 200);
      let best = Infinity;
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        const t = Math.max(0, Math.min(1, ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / len2));
        best = Math.min(best, Math.hypot(q.x - (a.x + t * (b.x - a.x)), q.y - (a.y + t * (b.y - a.y))));
      }
      expect(best).toBeLessThanOrEqual(CURVE_TOLERANCE + 1e-9);
    }
    expect(pts.at(-1)).toEqual(p3);
  });

  it('keeps straight edges as single segments', () => {
    expect(flattenShape(lShape)).toHaveLength(6);
  });
});

describe('convex decomposition', () => {
  it('triangulates a concave outline into triangles covering exactly its area', () => {
    const outline = flattenShape(lShape);
    const triangles = triangulate(outline);
    expect(triangles).toHaveLength(outline.length - 2);
    const area = triangles.reduce((sum, t) => sum + polygonArea(t.map((i) => outline[i])), 0);
    expect(area).toBeCloseTo(polygonArea(outline), 6);
  });

  it('merges triangles into a few convex pieces with no gaps or overlaps', () => {
    const outline = flattenShape(lShape);
    const parts = convexParts(outline);
    expect(parts.length).toBeLessThanOrEqual(3);
    expect(parts.reduce((s, p) => s + polygonArea(p), 0)).toBeCloseTo(polygonArea(outline), 6);
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) expect(footprintOverlap([parts[i]], [parts[j]])).toBeLessThan(1e-6);
  });

  it('keeps convex outlines in one piece', () => {
    expect(convexParts(sq(0, 0, 50, 30))).toHaveLength(1);
  });

  it.each(Object.keys(SHAPE_TEMPLATE_LABELS) as ShapeTemplate[])('decomposes the %s template exactly', (template) => {
    const { outline, parts } = localFootprint({ width: 0, depth: 0, shape: shapeTemplate(template) });
    expect(shapeProblem(shapeTemplate(template))).toBeNull();
    expect(parts.reduce((s, p) => s + polygonArea(p), 0)).toBeCloseTo(polygonArea(outline), 4);
  });
});

describe('footprints', () => {
  it('uses the true footprint for overlaps: a piece in the L’s notch does not collide', () => {
    const desk = { x: 0, y: 0, rotation: 0, width: 100, depth: 100, shape: normaliseShape(lShape).shape };
    const deskParts = roomFootprint(desk).parts;
    // The notch is the lower-left 60 × 60 corner (local x −50…10, y −10…50 after centring).
    const inNotch = sq(-45, -5, 50, 50);
    expect(footprintOverlap(deskParts, [inNotch])).toBe(0);
    // A bounding-box check would have reported a collision here.
    expect(footprintOverlap([sq(-50, -50, 100, 100)], [inNotch])).toBeGreaterThan(0);
    // Overlapping the arm does collide, with the exact shared area.
    expect(footprintOverlap(deskParts, [sq(30, 0, 40, 20)])).toBeCloseTo(20 * 20, 6);
  });

  it('rotates as a rigid object without distorting', () => {
    const shape = normaliseShape(lShape).shape;
    const base = roomFootprint({ x: 200, y: 150, rotation: 0, width: 100, depth: 100, shape }).outline;
    for (const rotation of [30, 90, 137, 270]) {
      const turned = roomFootprint({ x: 200, y: 150, rotation, width: 100, depth: 100, shape }).outline;
      expect(polygonArea(turned)).toBeCloseTo(polygonArea(base), 6);
      for (let i = 0; i < base.length; i++) {
        const j = (i + 1) % base.length;
        expect(Math.hypot(turned[j].x - turned[i].x, turned[j].y - turned[i].y)).toBeCloseTo(Math.hypot(base[j].x - base[i].x, base[j].y - base[i].y), 6);
      }
    }
  });

  it('tests room fit with the true footprint, including concave rooms', () => {
    const lRoom = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 150, y: 300 }, { x: 150, y: 150 }, { x: 0, y: 150 }];
    // An L-shaped piece tucked into the L-shaped room's corner fits; its bounding box wouldn't.
    const shape = normaliseShape({ points: [{ x: 0, y: 0 }, { x: 290, y: 0 }, { x: 290, y: 290 }, { x: 160, y: 290 }, { x: 160, y: 140 }, { x: 0, y: 140 }] }).shape;
    const fit = roomFootprint({ x: 150, y: 150, rotation: 0, width: 290, depth: 290, shape });
    expect(footprintInside(fit.parts, lRoom)).toBe(true);
    expect(footprintInside([sq(5, 5, 290, 290)], lRoom)).toBe(false);
  });

  it('uses the rectangle for pieces without a shape', () => {
    const { outline, parts } = localFootprint({ width: 80, depth: 50 });
    expect(boundingBox(outline)).toEqual({ minX: -40, minY: -25, maxX: 40, maxY: 25 });
    expect(parts).toHaveLength(1);
  });
});

describe('shape editing', () => {
  it('rejects self-intersecting outlines with an explanation', () => {
    const bowtie = { points: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }] };
    expect(shapeProblem(bowtie)).toMatch(/crosses itself/);
  });

  it('rejects a curve that makes the outline cross itself', () => {
    const shape = { points: [{ x: 0, y: 0, c1: { x: 50, y: 300 }, c2: { x: 50, y: 300 } }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    expect(shapeProblem(shape)).toMatch(/crosses itself/);
  });

  it('rejects too few corners and slivers', () => {
    expect(shapeProblem({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] })).toMatch(/three corners/);
    expect(shapeProblem({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0.1 }] })).toMatch(/too small/);
  });

  it('normalises: centred on its bounding box, clockwise, curves kept on their edges', () => {
    const counter = { points: [{ x: 0, y: 0 }, { x: 0, y: 50, c1: { x: 10, y: 60 }, c2: { x: 90, y: 60 } }, { x: 100, y: 50 }, { x: 100, y: 0 }] };
    const { shape, width, depth, shift } = normaliseShape(counter);
    expect(width).toBe(100);
    expect(depth).toBeGreaterThan(50);
    const box = boundingBox(flattenShape(shape));
    expect((box.minX + box.maxX) / 2).toBeCloseTo(0, 6);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(0, 1);
    expect(shift.x).toBeCloseTo(50, 6);
    // Same outline, just reversed and moved: the curve still bulges out of the bottom edge.
    expect(polygonArea(flattenShape(shape))).toBeCloseTo(polygonArea(flattenShape(counter)), 1);
    expect(findSelfIntersection(flattenShape(shape))).toBeNull();
    expect(shape.points.filter((p) => p.c1)).toHaveLength(1);
  });

  it('scales to exact new dimensions, curves included', () => {
    const { shape } = normaliseShape(shapeTemplate('kidneyTable'));
    const before = boundingBox(flattenShape(shape));
    const scaled = scaleShape(shape, 2, 0.5);
    const after = boundingBox(flattenShape(scaled));
    // Curves are re-flattened after scaling, so sizes agree to within the flattening tolerance.
    expect(Math.abs(after.maxX - after.minX - (before.maxX - before.minX) * 2)).toBeLessThanOrEqual(2 * CURVE_TOLERANCE);
    expect(Math.abs(after.maxY - after.minY - (before.maxY - before.minY) * 0.5)).toBeLessThanOrEqual(2 * CURVE_TOLERANCE);
  });

  it('flattened curves stay inside a convex hull of their control points (sanity)', () => {
    const { shape } = normaliseShape(shapeTemplate('curvedSofa'));
    const outline = flattenShape(shape);
    const hull = boundingBox(shape.points.flatMap((p) => [p, p.c1, p.c2].filter((q) => q !== undefined)));
    for (const p of outline) expect(pointInPolygon(p, sq(hull.minX - 0.01, hull.minY - 0.01, hull.maxX - hull.minX + 0.02, hull.maxY - hull.minY + 0.02))).toBe(true);
  });
});
