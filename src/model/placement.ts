import { boundingBox, convexInsidePolygon, type Box } from './polygon';
import { footprintInside, roomFootprint } from './shape';
import { layoutStair, stairToRoom } from './stairs';
import type { Furniture, Point, Room, Staircase } from './types';
import { nearestWall, outlinePolygon, roomBounds } from './walls';

/**
 * Keeping things inside a (possibly concave) room.
 *
 * `resolvePosition` answers: "the user wants this object centred at `target`; where is
 * the nearest place it actually fits?" It is used for furniture, free-standing features
 * and staircases, each of which supplies its own `fits(centre)` test.
 */

export interface ResolveOptions {
  /** Bounding box of the room boundary. */
  roomBox: Box;
  /** Half the object's axis-aligned extent at its current rotation. */
  halfX: number;
  halfY: number;
  /** Does the object fit with its centre here? */
  fits: (centre: Point) => boolean;
  /**
   * Where the object was last known to fit (while dragging). Lets it slide along walls
   * instead of jumping, and keeps every pointer move cheap.
   */
  from?: Point;
}

export function resolvePosition(target: Point, options: ResolveOptions): Point | null {
  const { fits, from, roomBox, halfX, halfY } = options;
  if (fits(target)) return target;
  if (halfX * 2 > roomBox.maxX - roomBox.minX + 1e-6 || halfY * 2 > roomBox.maxY - roomBox.minY + 1e-6) return null;

  const candidates: Point[] = [];

  // 1. Clamp into the room's bounding box. For rectangular rooms this alone gives the
  //    exact minimal move, matching the original Phase 1 behaviour.
  const clampAxis = (v: number, half: number, min: number, max: number) => (half * 2 >= max - min ? (min + max) / 2 : Math.min(Math.max(v, min + half), max - half));
  const boxed = { x: clampAxis(target.x, halfX, roomBox.minX, roomBox.maxX), y: clampAxis(target.y, halfY, roomBox.minY, roomBox.maxY) };
  if (fits(boxed)) candidates.push(boxed);

  // 2. While dragging: slide along one axis, or stop at the last point on the way that fits.
  if (from && fits(from)) {
    for (const slide of [
      { x: target.x, y: from.y },
      { x: from.x, y: target.y },
    ]) {
      if (fits(slide)) candidates.push(slide);
    }
    candidates.push(lastFittingPoint(from, target, fits));
  }
  if (candidates.length > 0) return closest(target, candidates);

  // 3. Search outward in rings for the nearest centre that fits, then refine towards the target.
  return spiralSearch(target, options);
}

function closest(target: Point, points: Point[]): Point {
  return points.reduce((best, p) => (distance(p, target) < distance(best, target) ? p : best));
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Binary search along good → bad for the furthest point that still fits. */
function lastFittingPoint(good: Point, bad: Point, fits: (p: Point) => boolean): Point {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (fits(lerp(good, bad, mid))) lo = mid;
    else hi = mid;
  }
  return lerp(good, bad, lo);
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function spiralSearch(target: Point, { roomBox, fits }: ResolveOptions): Point | null {
  const span = Math.hypot(roomBox.maxX - roomBox.minX, roomBox.maxY - roomBox.minY);
  // About 100 rings across the room: fine enough to find narrow spots in normal rooms (an
  // L-shaped stair in one leg of an L-shaped room may have a valid strip ~30 cm wide), and
  // the total effort stays bounded however large the room. The search stops at the first
  // ring with a fit, so typical searches are short.
  const step = Math.max(2, span / 100);
  for (let r = step; r <= span; r += step) {
    const samples = Math.max(12, Math.ceil((2 * Math.PI * r) / step));
    const found: Point[] = [];
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      const p = { x: target.x + Math.cos(a) * r, y: target.y + Math.sin(a) * r };
      if (fits(p)) found.push(p);
    }
    if (found.length > 0) {
      // Pull the best sample back towards the target as far as it still fits.
      return closest(target, found.map((p) => lastFittingPoint(p, target, fits)));
    }
  }
  return null;
}

/**
 * Moves a piece the minimum needed to sit fully inside the room's real outline (not just
 * its bounding box), or returns null if it can't fit anywhere at this size and rotation.
 */
export function clampFurnitureToRoom<T extends Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation' | 'shape'>>(
  item: T,
  room: Pick<Room, 'outline'>,
  from?: Point,
): T | null {
  const poly = outlinePolygon(room);
  // The true footprint (a drawn shape, or the rectangle), placed with its centre at c.
  const placed = (c: Point) => roomFootprint({ ...item, x: c.x, y: c.y });
  const box = boundingBox(placed({ x: 0, y: 0 }).rings.flatMap((r) => r.outer));
  const centre = resolvePosition(item, {
    roomBox: roomBounds(room),
    halfX: Math.max(-box.minX, box.maxX),
    halfY: Math.max(-box.minY, box.maxY),
    fits: (c) => footprintInside(placed(c).parts, poly),
    from,
  });
  return centre ? { ...item, x: centre.x, y: centre.y } : null;
}

/** Moves a staircase the minimum needed so every section sits inside the room, or null. */
export function clampStairToRoom(stair: Staircase, room: Pick<Room, 'outline'>, from?: Point): Staircase | null {
  const poly = outlinePolygon(room);
  const layout = layoutStair(stair.sections);
  const local = layout.sections.flatMap((s) => s.corners);
  const box = boundingBox(local.map((p) => stairToRoom({ x: 0, y: 0, rotation: stair.rotation }, p)));
  const centre = resolvePosition(stair, {
    roomBox: roomBounds(room),
    halfX: (box.maxX - box.minX) / 2,
    halfY: (box.maxY - box.minY) / 2,
    fits: (c) => layout.sections.every((s) => convexInsidePolygon(s.corners.map((p) => stairToRoom({ ...c, rotation: stair.rotation }, p)), poly)),
    from,
  });
  return centre ? { ...stair, x: centre.x, y: centre.y } : null;
}

/**
 * Backs a piece onto the nearest wall, facing into the room (its front, +y, along the wall's
 * inward side), keeping its height above the floor. For mirrors, wall cabinets, wall lights and
 * shelves. Returns the new position and turn, or null when there is no wall.
 */
export function mountOnWall(item: Pick<Furniture, 'x' | 'y' | 'depth'>, room: Pick<Room, 'outline' | 'partitions'>): { x: number; y: number; rotation: number } | null {
  const near = nearestWall(room, item, 10);
  if (!near) return null;
  const { segment, offset } = near;
  const rad = (segment.angle * Math.PI) / 180;
  const along = { x: segment.start.x + Math.cos(rad) * offset, y: segment.start.y + Math.sin(rad) * offset };
  // A wall's inward side is to its right (outlines run clockwise): (−sin, cos) of its angle.
  const inward = { x: -Math.sin(rad), y: Math.cos(rad) };
  const r = (v: number) => Math.round(v * 10) / 10;
  return { x: r(along.x + inward.x * (item.depth / 2)), y: r(along.y + inward.y * (item.depth / 2)), rotation: r(((segment.angle % 360) + 360) % 360) };
}
