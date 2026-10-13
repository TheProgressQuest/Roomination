import type { Point } from './types';

/**
 * Polygon helpers for collision detection and room boundaries.
 *
 * Furniture, door swings and clearance zones are convex, so overlaps between them are
 * computed exactly by clipping. Rooms may be concave (L- or U-shaped); clipping a
 * concave room by a convex shape still yields the exact shared area, which is how
 * "is this piece fully inside the room?" is answered. Polygons are lists of points in cm.
 */

export type Polygon = Point[];

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Corners of a w×h rectangle centred at (cx, cy), rotated clockwise by `rotation` degrees. */
export function rectPolygon(cx: number, cy: number, w: number, h: number, rotation: number): Polygon {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = w / 2;
  const hh = h / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }));
}

/** Area of a simple polygon (shoelace formula). Always positive. */
export function polygonArea(poly: Polygon): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function boundingBox(poly: Polygon): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of poly) {
    box.minX = Math.min(box.minX, p.x);
    box.minY = Math.min(box.minY, p.y);
    box.maxX = Math.max(box.maxX, p.x);
    box.maxY = Math.max(box.maxY, p.y);
  }
  return box;
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/** Signed area ×2; positive when the polygon winds clockwise on screen (y down). */
export function signedArea2(poly: Polygon): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * Intersection of two convex polygons (Sutherland–Hodgman clipping): the subject
 * polygon is cut by each edge of the clip polygon in turn, keeping the inside part.
 */
export function clipConvex(subject: Polygon, clip: Polygon): Polygon {
  // Make the clip polygon's winding consistent so "inside" is always the same side.
  const orientation = Math.sign(signedArea2(clip)) || 1;
  let output = subject;
  for (let i = 0; i < clip.length && output.length > 0; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const side = (p: Point) => orientation * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const previous = input[(j + input.length - 1) % input.length];
      const currentInside = side(current) >= 0;
      const previousInside = side(previous) >= 0;
      if (currentInside !== previousInside) {
        // The edge crosses the clip line: keep the crossing point.
        const sp = side(previous);
        const sc = side(current);
        const t = sp / (sp - sc);
        output.push({ x: previous.x + (current.x - previous.x) * t, y: previous.y + (current.y - previous.y) * t });
      }
      if (currentInside) output.push(current);
    }
  }
  return output;
}

/** Area shared by two convex polygons, in cm². Cheap bounding-box test first. */
export function overlapArea(a: Polygon, b: Polygon): number {
  if (!boxesOverlap(boundingBox(a), boundingBox(b))) return 0;
  const clipped = clipConvex(a, b);
  return clipped.length < 3 ? 0 : polygonArea(clipped);
}

/** Points along a circular arc (angles in degrees, clockwise from +x, y down). */
export function arcPoints(cx: number, cy: number, radius: number, fromDeg: number, toDeg: number, segments: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const deg = fromDeg + ((toDeg - fromDeg) * i) / segments;
    const rad = (deg * Math.PI) / 180;
    points.push({ x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) });
  }
  return points;
}

// ---------------------------------------------------------------------------
// General (possibly concave) polygons
// ---------------------------------------------------------------------------

export function isClockwise(poly: Polygon): boolean {
  return signedArea2(poly) > 0;
}

/** Even-odd ray casting. Points exactly on an edge may go either way. */
export function pointInPolygon(p: Point, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** True when segments ab and cd cross or touch (including collinear overlap). */
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const onSegment = (p: Point, q: Point, r: Point) =>
    Math.min(p.x, q.x) - 1e-9 <= r.x && r.x <= Math.max(p.x, q.x) + 1e-9 && Math.min(p.y, q.y) - 1e-9 <= r.y && r.y <= Math.max(p.y, q.y) + 1e-9;
  const eps = 1e-9;
  return (
    (Math.abs(d1) < eps && onSegment(c, d, a)) ||
    (Math.abs(d2) < eps && onSegment(c, d, b)) ||
    (Math.abs(d3) < eps && onSegment(a, b, c)) ||
    (Math.abs(d4) < eps && onSegment(a, b, d))
  );
}

/**
 * The first pair of edges that cross in a closed polygon, or null if it is simple.
 * Neighbouring edges share a corner, so only non-adjacent pairs are compared.
 */
export function findSelfIntersection(poly: Polygon): [number, number] | null {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return [i, j];
    }
  }
  return null;
}

/** Closest point to `p` on segment ab, and how far along it is (0 = a, 1 = b). */
export function projectOntoSegment(p: Point, a: Point, b: Point): { point: Point; t: number; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { point, t, distance: Math.hypot(p.x - point.x, p.y - point.y) };
}

/**
 * Whether a convex shape lies entirely inside a (possibly concave) polygon: the part
 * of the polygon inside the shape must be the whole shape. A small tolerance absorbs
 * floating-point noise for pieces standing flush against a wall.
 */
export function convexInsidePolygon(shape: Polygon, container: Polygon): boolean {
  const shapeArea = polygonArea(shape);
  if (shapeArea === 0) return shape.every((p) => pointInPolygon(p, container));
  const clipped = clipConvex(container, shape);
  const inside = clipped.length < 3 ? 0 : polygonArea(clipped);
  return inside >= shapeArea * (1 - 1e-6) - 1e-6;
}
