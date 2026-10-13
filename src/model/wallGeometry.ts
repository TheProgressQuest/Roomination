import { openingSpan } from './features';
import type { Polygon } from './polygon';
import type { Point, Room, RoomFeature } from './types';
import { outlineSegments, partitionSegments, pointAlong, type WallSegment } from './walls';

/**
 * The solid shape of every wall, in room cm, for drawing (and later for 3D extrusion).
 *
 * - Outer walls sit OUTSIDE the room outline (the outline is the inner face), with
 *   mitered corners so neighbouring walls join cleanly even at odd angles.
 * - Interior walls are centred on their line.
 * - Door and window openings are real gaps: a wall's body is split around them.
 */

export interface WallBody {
  wallId: string;
  polygon: Polygon;
}

/** Miters longer than this many thicknesses are cut flat (very sharp corners). */
const MITER_LIMIT = 4;

/** Unit vector from a wall's start to its end. */
export const wallDirection = (s: WallSegment): Point => ({ x: (s.end.x - s.start.x) / s.length, y: (s.end.y - s.start.y) / s.length });
/** Outward normal of an outer wall (outline is clockwise, so outward is to the left). */
export const wallOutward = (s: WallSegment): Point => {
  const d = wallDirection(s);
  return { x: d.y, y: -d.x };
};

const offsetPoint = (p: Point, n: Point, t: number): Point => ({ x: p.x + n.x * t, y: p.y + n.y * t });

/**
 * Outer corner where the outer faces of walls `a` (arriving) and `b` (leaving) meet.
 * When no clean miter exists (straight continuation, or a very sharp corner), each wall
 * ends square at its own thickness: `side` says which wall is asking.
 */
function miter(a: WallSegment, b: WallSegment, side: 'arriving' | 'leaving'): Point {
  const corner = b.start;
  const pa = offsetPoint(corner, wallOutward(a), a.thickness);
  const pb = offsetPoint(corner, wallOutward(b), b.thickness);
  const da = wallDirection(a);
  const db = wallDirection(b);
  const denominator = da.x * db.y - da.y * db.x;
  const square = side === 'arriving' ? pa : pb;
  if (Math.abs(denominator) < 1e-9) return square; // straight continuation
  // Intersect line pa + s·da with pb + t·db.
  const s = ((pb.x - pa.x) * db.y - (pb.y - pa.y) * db.x) / denominator;
  const point = { x: pa.x + da.x * s, y: pa.y + da.y * s };
  const limit = MITER_LIMIT * Math.max(a.thickness, b.thickness);
  return Math.hypot(point.x - corner.x, point.y - corner.y) > limit ? square : point;
}

/** Stretches of a wall not taken up by door/window openings, as [from, to] distances. */
function solidStretches(segment: WallSegment, features: RoomFeature[]): [number, number][] {
  const gaps = features
    .map(openingSpan)
    .filter((s): s is NonNullable<typeof s> => s !== null && s.wallId === segment.id)
    .sort((a, b) => a.start - b.start);
  const stretches: [number, number][] = [];
  let cursor = 0;
  for (const gap of gaps) {
    if (gap.start > cursor + 0.01) stretches.push([cursor, Math.min(gap.start, segment.length)]);
    cursor = Math.max(cursor, gap.end);
  }
  if (cursor < segment.length - 0.01) stretches.push([cursor, segment.length]);
  return stretches;
}

export function wallBodies(room: Pick<Room, 'outline' | 'partitions'>, features: RoomFeature[]): WallBody[] {
  const bodies: WallBody[] = [];
  const outer = outlineSegments(room);
  outer.forEach((segment, i) => {
    const previous = outer[(i - 1 + outer.length) % outer.length];
    const next = outer[(i + 1) % outer.length];
    const startOuter = miter(previous, segment, 'leaving');
    const endOuter = miter(segment, next, 'arriving');
    const n = wallOutward(segment);
    for (const [from, to] of solidStretches(segment, features)) {
      const a = pointAlong(segment, from);
      const b = pointAlong(segment, to);
      const aOut = from <= 0.01 ? startOuter : offsetPoint(a, n, segment.thickness);
      const bOut = to >= segment.length - 0.01 ? endOuter : offsetPoint(b, n, segment.thickness);
      bodies.push({ wallId: segment.id, polygon: [a, b, bOut, aOut] });
    }
  });

  for (const partition of room.partitions) {
    for (const segment of partitionSegments(partition)) {
      const n = wallOutward(segment);
      const half = segment.thickness / 2;
      for (const [from, to] of solidStretches(segment, features)) {
        // Extend by half a thickness at the chain's joints so corners close neatly.
        const extendStart = from <= 0.01 && segment.index > 0 ? half : 0;
        const extendEnd = to >= segment.length - 0.01 && segment.index < partition.nodes.length - 2 ? half : 0;
        const a = pointAlong(segment, from - extendStart);
        const b = pointAlong(segment, to + extendEnd);
        bodies.push({ wallId: segment.id, polygon: [offsetPoint(a, n, half), offsetPoint(b, n, half), offsetPoint(b, n, -half), offsetPoint(a, n, -half)] });
      }
    }
  }
  return bodies;
}
