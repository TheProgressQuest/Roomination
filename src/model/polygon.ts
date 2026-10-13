import type { Point } from './types';

/**
 * Convex polygon helpers used for collision detection.
 *
 * Every shape we test (rotated rectangles, door swing sectors, clearance zones) is
 * convex, which lets us compute the exact overlap area with a simple clipping
 * algorithm instead of approximations. Polygons are lists of points in room cm.
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
function signedArea2(poly: Polygon): number {
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
