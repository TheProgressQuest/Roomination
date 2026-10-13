import { boundingBox, signedArea2 } from './polygon';
import { flattenCubic, flattenShape, isCurved } from './shape';
import type { Point, ShapeVertex } from './types';

/**
 * Editing operations for custom furniture outlines. Each takes the corner list and returns
 * a new one (nothing is changed in place), in the piece's local centimetres. Edge `i` runs
 * from corner `i` to corner `i + 1` (wrapping round), and is curved when corner `i` carries
 * control points.
 */

const next = (points: ShapeVertex[], i: number) => (i + 1) % points.length;
const prev = (points: ShapeVertex[], i: number) => (i - 1 + points.length) % points.length;
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const round = (p: Point): Point => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });

function withCurve(v: Point, c1?: Point, c2?: Point): ShapeVertex {
  return c1 && c2 ? { ...round(v), c1: round(c1), c2: round(c2) } : round(v);
}

/** Moves a corner; the handles of the curves touching it move with it. */
export function moveVertex(points: ShapeVertex[], i: number, to: Point): ShapeVertex[] {
  const delta = sub(to, points[i]);
  const p = prev(points, i);
  return points.map((v, k) => {
    if (k === i) return withCurve(to, v.c1 && add(v.c1, delta), v.c2);
    if (k === p && v.c2) return withCurve(v, v.c1, add(v.c2, delta));
    return v;
  });
}

/** Moves one handle of a curved edge. */
export function moveControl(points: ShapeVertex[], i: number, which: 'c1' | 'c2', to: Point): ShapeVertex[] {
  return points.map((v, k) => (k === i && isCurved(v) ? { ...v, [which]: round(to) } : v));
}

/** Adds a corner part-way along an edge. Curves are split exactly, so the outline doesn't change shape. */
export function insertVertex(points: ShapeVertex[], i: number, t = 0.5): ShapeVertex[] {
  const a = points[i];
  const b = points[next(points, i)];
  let first: ShapeVertex;
  let middle: ShapeVertex;
  if (a.c1 && a.c2) {
    // de Casteljau: split the cubic at t into two cubics.
    const p01 = lerp(a, a.c1, t);
    const p12 = lerp(a.c1, a.c2, t);
    const p23 = lerp(a.c2, b, t);
    const p012 = lerp(p01, p12, t);
    const p123 = lerp(p12, p23, t);
    const split = lerp(p012, p123, t);
    first = withCurve(a, p01, p012);
    middle = withCurve(split, p123, p23);
  } else {
    first = a;
    middle = round(lerp(a, b, t));
  }
  return [...points.slice(0, i), first, middle, ...points.slice(i + 1)];
}

/** Removes a corner (a shape keeps at least three). */
export function deleteVertex(points: ShapeVertex[], i: number): ShapeVertex[] {
  if (points.length <= 3) return points;
  return points.filter((_, k) => k !== i);
}

/** Length of edge `i` in cm (along the curve, for curved edges). */
export function edgeLength(points: ShapeVertex[], i: number): number {
  const a = points[i];
  const b = points[next(points, i)];
  if (!a.c1 || !a.c2) return Math.hypot(b.x - a.x, b.y - a.y);
  let length = 0;
  let last: Point = a;
  for (const p of flattenCubic(a, a.c1, a.c2, b, 0.05)) {
    length += Math.hypot(p.x - last.x, p.y - last.y);
    last = p;
  }
  return length;
}

/**
 * Makes a straight edge exactly `length` cm long by moving its end corner along the edge's
 * direction (like typing a wall length). Curved edges are scaled from their start.
 */
export function setEdgeLength(points: ShapeVertex[], i: number, length: number): ShapeVertex[] {
  const a = points[i];
  const j = next(points, i);
  const b = points[j];
  const current = edgeLength(points, i);
  if (!(length > 0) || current === 0) return points;
  const k = length / current;
  const end = lerp(a, b, k);
  const moved = moveVertex(points, j, end);
  if (!isCurved(a)) return moved;
  return moved.map((v, idx) => (idx === i ? withCurve(v, lerp(a, a.c1!, k), lerp(a, a.c2!, k)) : v));
}

/** +1 when the outline runs clockwise on screen (the stored direction), −1 otherwise. */
function orientation(points: ShapeVertex[]): number {
  return signedArea2(flattenShape({ points })) >= 0 ? 1 : -1;
}

/** The inside angle at corner `i`, in degrees (90 for a square corner, over 180 for an inward notch). */
export function cornerAngle(points: ShapeVertex[], i: number): number {
  const v = points[i];
  const a = sub(points[prev(points, i)], v);
  const b = sub(points[next(points, i)], v);
  const theta = (Math.atan2(b.x * a.y - b.y * a.x, b.x * a.x + b.y * a.y) * 180) / Math.PI;
  const inside = ((theta % 360) + 360) % 360;
  return orientation(points) > 0 ? inside : 360 - inside;
}

/**
 * Sets the inside angle at corner `i` by turning the edge that leaves it about the corner
 * (its length is kept, and the next corner moves).
 */
export function setCornerAngle(points: ShapeVertex[], i: number, degrees: number): ShapeVertex[] {
  if (!(degrees > 0 && degrees < 360)) return points;
  const turn = ((cornerAngle(points, i) - degrees) * Math.PI) / 180 * orientation(points);
  const v = points[i];
  const rotate = (p: Point): Point => {
    const d = sub(p, v);
    return { x: v.x + d.x * Math.cos(turn) - d.y * Math.sin(turn), y: v.y + d.x * Math.sin(turn) + d.y * Math.cos(turn) };
  };
  const j = next(points, i);
  const turned = moveVertex(points, j, rotate(points[j]));
  return isCurved(v) ? turned.map((p, k) => (k === i ? withCurve(p, rotate(v.c1!), rotate(v.c2!)) : p)) : turned;
}

/** Turns a straight edge into a gentle outward curve, or a curved edge back into a straight one. */
export function toggleCurve(points: ShapeVertex[], i: number): ShapeVertex[] {
  const a = points[i];
  if (isCurved(a)) return points.map((v, k) => (k === i ? round(v) : v));
  const b = points[next(points, i)];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  // Outward normal of a clockwise-on-screen outline is (dy, −dx) / length.
  const out = { x: ((b.y - a.y) / len) * orientation(points), y: (-(b.x - a.x) / len) * orientation(points) };
  const bulge = len * 0.25;
  const c1 = add(lerp(a, b, 1 / 3), { x: out.x * bulge, y: out.y * bulge });
  const c2 = add(lerp(a, b, 2 / 3), { x: out.x * bulge, y: out.y * bulge });
  return points.map((v, k) => (k === i ? withCurve(v, c1, c2) : v));
}

/** Overall size of the outline (its bounding box), curves included. */
export function shapeSize(points: ShapeVertex[]): { width: number; depth: number } {
  const box = boundingBox(flattenShape({ points }));
  return { width: box.maxX - box.minX, depth: box.maxY - box.minY };
}

/**
 * Stretches the outline about its centre to `width` × `depth` cm. Curves are measured by their
 * flattened outline, so the stretch is refined a few times until the size is what was typed.
 */
export function resizeShape(points: ShapeVertex[], width: number, depth: number): ShapeVertex[] {
  let result = points;
  for (let pass = 0; pass < 4; pass++) {
    const box = boundingBox(flattenShape({ points: result }));
    const sx = width / Math.max(box.maxX - box.minX, 1e-9);
    const sy = depth / Math.max(box.maxY - box.minY, 1e-9);
    if (Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4) break;
    const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    const scale = (p: Point) => ({ x: centre.x + (p.x - centre.x) * sx, y: centre.y + (p.y - centre.y) * sy });
    result = result.map((v) => withCurve(scale(v), v.c1 && scale(v.c1), v.c2 && scale(v.c2)));
  }
  return result;
}
