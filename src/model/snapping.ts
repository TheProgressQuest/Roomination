import { projectOntoSegment } from './polygon';
import type { Point } from './types';

/**
 * Snapping for drawing walls and dragging corners. Pure: given the raw pointer position
 * (in room cm) it returns the snapped point and any guide lines to draw.
 *
 * Priority, strongest first: existing corners → existing walls → angle from the previous
 * point → horizontal/vertical alignment with other corners → grid.
 */

export interface SnapSettings {
  endpoints: boolean;
  walls: boolean;
  grid: boolean;
  /** Grid step in cm. */
  gridSize: number;
  alignment: boolean;
  angles: boolean;
  /** Angle step in degrees (e.g. 15, 45, 90). */
  angleStep: number;
}

export const DEFAULT_SNAP: SnapSettings = {
  endpoints: true,
  walls: true,
  grid: true,
  gridSize: 5,
  alignment: true,
  angles: true,
  angleStep: 15,
};

export type SnapKind = 'endpoint' | 'wall' | 'angle' | 'alignment' | 'grid' | 'none';

export interface SnapResult {
  point: Point;
  kind: SnapKind;
  /** Dashed guide lines explaining the snap (room cm). */
  guides: { from: Point; to: Point }[];
}

export interface SnapContext {
  /** Corners that can be snapped onto exactly. */
  corners: Point[];
  /** Walls that a point can slide onto. */
  segments: { start: Point; end: Point }[];
  /** The previously placed point, for angle snapping while drawing. */
  previous?: Point;
}

/**
 * @param tolerance how close (in cm) the pointer must be to snap — the caller converts
 *   a fixed on-screen distance to cm so snapping feels the same at every zoom level.
 */
export function snapPoint(raw: Point, context: SnapContext, settings: SnapSettings, tolerance: number): SnapResult {
  if (settings.endpoints) {
    const corner = nearest(raw, context.corners);
    if (corner && corner.distance <= tolerance) return { point: corner.point, kind: 'endpoint', guides: [] };
  }

  if (settings.walls) {
    let best: { point: Point; distance: number } | null = null;
    for (const s of context.segments) {
      const projection = projectOntoSegment(raw, s.start, s.end);
      if (projection.distance <= tolerance && (!best || projection.distance < best.distance)) best = projection;
    }
    if (best) return { point: best.point, kind: 'wall', guides: [] };
  }

  const previous = context.previous;
  if (settings.angles && previous) {
    const dx = raw.x - previous.x;
    const dy = raw.y - previous.y;
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      const step = (settings.angleStep * Math.PI) / 180;
      const angle = Math.round(Math.atan2(dy, dx) / step) * step;
      const along = { x: Math.cos(angle), y: Math.sin(angle) };
      const projected = dx * along.x + dy * along.y;
      // Distance from the pointer to the snapped ray.
      const offRay = Math.abs(dx * along.y - dy * along.x);
      // A pointer still on (or very near) the previous point isn't drawing a wall yet;
      // angle-snapping it would invent a tiny wall in some arbitrary direction.
      const snappedLength = settings.grid ? roundTo(projected, settings.gridSize) : projected;
      if (projected > tolerance && snappedLength > 0 && offRay <= tolerance) {
        const point = { x: previous.x + along.x * snappedLength, y: previous.y + along.y * snappedLength };
        return { point: clean(point), kind: 'angle', guides: [{ from: previous, to: point }] };
      }
    }
  }

  let { x, y } = raw;
  let alignedX = false;
  let alignedY = false;
  const guideSources: Point[] = [];
  if (settings.alignment) {
    const references = previous ? [...context.corners, previous] : context.corners;
    const ax = nearestBy(references, (p) => Math.abs(p.x - raw.x));
    const ay = nearestBy(references, (p) => Math.abs(p.y - raw.y));
    if (ax && Math.abs(ax.x - raw.x) <= tolerance) {
      x = ax.x;
      alignedX = true;
      guideSources.push(ax);
    }
    if (ay && Math.abs(ay.y - raw.y) <= tolerance) {
      y = ay.y;
      alignedY = true;
      guideSources.push(ay);
    }
  }
  // Grid-snap only the coordinates that alignment didn't already fix.
  if (settings.grid && !alignedX) x = roundTo(x, settings.gridSize);
  if (settings.grid && !alignedY) y = roundTo(y, settings.gridSize);
  const point = clean({ x, y });
  const kind: SnapKind = alignedX || alignedY ? 'alignment' : settings.grid ? 'grid' : 'none';
  return { point, kind, guides: guideSources.map((from) => ({ from, to: point })) };
}

function roundTo(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

/** Avoids values like 199.99999999 from trigonometry. */
function clean(p: Point): Point {
  return { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 };
}

function nearest(p: Point, points: Point[]): { point: Point; distance: number } | null {
  let best: { point: Point; distance: number } | null = null;
  for (const q of points) {
    const distance = Math.hypot(q.x - p.x, q.y - p.y);
    if (!best || distance < best.distance) best = { point: q, distance };
  }
  return best;
}

function nearestBy(points: Point[], score: (p: Point) => number): Point | null {
  let best: Point | null = null;
  for (const p of points) if (!best || score(p) < score(best)) best = p;
  return best;
}
