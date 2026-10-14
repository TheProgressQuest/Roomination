import { isSolid } from '../model/conflicts';
import { featureZones } from '../model/features';
import type { Polygon } from '../model/polygon';
import { roomFootprint } from '../model/shape';
import { stairPolygons } from '../model/stairs';
import type { Furniture, FurnitureKind, Point, Project, Relationship } from '../model/types';
import { wallSegments } from '../model/walls';

/**
 * Practical checks on a layout: the things a person notices straight away that a score can
 * miss — a chair facing a wall, no room to pull a desk chair out, a sofa turned away from
 * the TV, a bed you can only get into from one side. Everything is measured from geometry.
 *
 * Used three ways: as scoring components, as explanations, and in tests that catch
 * impractical suggestions.
 */

/** Where a person is and which way they look when using a piece (local frame: +y is the piece's front). */
export interface Occupant {
  /** Position in the piece's local frame. */
  at: Point;
  /** Unit direction they face, local frame. */
  facing: Point;
}

const SEATS: FurnitureKind[] = ['sofa', 'armchair', 'chair'];

/** How a person uses a piece, or null for pieces nobody sits at or in. */
export function occupantOf(item: Pick<Furniture, 'kind' | 'width' | 'depth'>): Occupant | null {
  switch (item.kind) {
    case 'sofa':
    case 'armchair':
    case 'chair':
      // Seated, looking out of the front.
      return { at: { x: 0, y: 0 }, facing: { x: 0, y: 1 } };
    case 'desk':
      // Sitting at the front edge, looking across the desk.
      return { at: { x: 0, y: item.depth / 2 + 35 }, facing: { x: 0, y: -1 } };
    case 'bed':
      // Sitting up against the headboard, looking towards the foot of the bed.
      return { at: { x: 0, y: -item.depth / 2 + 30 }, facing: { x: 0, y: 1 } };
    default:
      return null;
  }
}

/**
 * Free space needed in front of a piece to use it comfortably (cm), not counting what
 * belongs there (a desk's chair, a sofa's coffee table). Null when it doesn't matter.
 */
export function frontNeed(kind: FurnitureKind): number | null {
  switch (kind) {
    case 'desk':
      return 75; // pull the chair out and sit down
    case 'sofa':
    case 'armchair':
      return 45; // legroom
    case 'chair':
      return 40;
    case 'storage':
    case 'cabinet':
    case 'bookshelf':
      return 60; // open doors, take things out
    case 'television':
      return 120; // a TV pressed against something can't be watched
    case 'bed':
      return 50; // the foot of the bed
    default:
      return null;
  }
}

export function toRoom(item: Pick<Furniture, 'x' | 'y' | 'rotation'>, p: Point): Point {
  const r = (item.rotation * Math.PI) / 180;
  return { x: item.x + p.x * Math.cos(r) - p.y * Math.sin(r), y: item.y + p.x * Math.sin(r) + p.y * Math.cos(r) };
}

export function directionToRoom(item: Pick<Furniture, 'rotation'>, d: Point): Point {
  const r = (item.rotation * Math.PI) / 180;
  return { x: d.x * Math.cos(r) - d.y * Math.sin(r), y: d.x * Math.sin(r) + d.y * Math.cos(r) };
}

type Segment = [Point, Point];

/**
 * Everything solid a piece can run into, prepared once and shared by every check: the room's
 * fixed edges (walls, columns, radiators, stairs — built once per optimizer run) and each
 * piece's outline edges (built once per layout).
 */
export interface Obstacles {
  fixed: Segment[];
  pieces: Map<string, Segment[]>;
}

/** Rays start this far inside the piece, so an edge flush against a wall still "sees" the wall. */
const RAY_INSET = 0.5;

/**
 * Clear distance from an edge point of a piece, outwards along `dir`, to the first obstacle,
 * ignoring the pieces in `exclude` (Infinity if none). 0 when it's flush against something.
 */
function rayHit(edgePoint: Point, dir: Point, obstacles: Obstacles, exclude: Set<string>): number {
  const origin = { x: edgePoint.x - dir.x * RAY_INSET, y: edgePoint.y - dir.y * RAY_INSET };
  let best = rayHitSegments(origin, dir, obstacles.fixed);
  for (const [id, edges] of obstacles.pieces) if (!exclude.has(id)) best = Math.min(best, rayHitSegments(origin, dir, edges));
  return Math.max(0, best - RAY_INSET);
}

function rayHitSegments(origin: Point, dir: Point, segments: Segment[]): number {
  let best = Infinity;
  for (const [a, b] of segments) {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dir.x * ey - dir.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - origin.x) * ey - (a.y - origin.y) * ex) / den;
    const u = ((a.x - origin.x) * dir.y - (a.y - origin.y) * dir.x) / den;
    if (t >= 0 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
}

const edgesOf = (poly: Polygon): [Point, Point][] => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);

/** The room's edges that never move: walls (interior ones at their thickness), solid features, stairs. */
export function fixedObstacleEdges(project: Project): Segment[] {
  const edges: Segment[] = [];
  for (const wall of wallSegments(project.room)) {
    if (wall.chain === 'outline') edges.push([wall.start, wall.end]);
    else {
      // Interior walls are as thick as they're drawn.
      const len = wall.length || 1;
      const n = { x: (-(wall.end.y - wall.start.y) / len) * (wall.thickness / 2), y: ((wall.end.x - wall.start.x) / len) * (wall.thickness / 2) };
      edges.push([{ x: wall.start.x + n.x, y: wall.start.y + n.y }, { x: wall.end.x + n.x, y: wall.end.y + n.y }]);
      edges.push([{ x: wall.start.x - n.x, y: wall.start.y - n.y }, { x: wall.end.x - n.x, y: wall.end.y - n.y }]);
    }
  }
  for (const feature of project.features) for (const z of featureZones(feature, project.room)) if (z.type === 'solid') edges.push(...edgesOf(z.polygon));
  for (const stair of project.stairs) for (const poly of stairPolygons(stair)) edges.push(...edgesOf(poly));
  return edges;
}

/** Obstacles for one layout (pass the fixed edges when they've already been worked out). */
export function obstaclesFor(project: Project, fixed: Segment[] = fixedObstacleEdges(project)): Obstacles {
  const pieces = new Map<string, Segment[]>();
  for (const f of project.furniture) if (isSolid(f)) pieces.set(f.id, roomFootprint(f).rings.flatMap((r) => [r.outer, ...r.holes].flatMap(edgesOf)));
  return { fixed, pieces };
}

/**
 * Clear distance in front of a piece (cm): the smallest distance from its front edge, along
 * its front direction, to anything solid — sampled at three points across the front.
 * Pieces that belong in front of it (its chair, its coffee table) don't count.
 */
export function frontClearance(item: Furniture, obstacles: Obstacles, partners: Set<string>): number {
  const exclude = new Set([item.id, ...partners]);
  const dir = directionToRoom(item, { x: 0, y: 1 });
  let best = Infinity;
  for (const t of [-0.35, 0, 0.35]) {
    const from = toRoom(item, { x: item.width * t, y: item.depth / 2 });
    best = Math.min(best, rayHit(from, dir, obstacles, exclude));
  }
  return best;
}

/** Side clearances of a bed (cm): space beside each long side, measured outwards from the middle and the foot half. */
export function bedSideClearances(bed: Furniture, obstacles: Obstacles, partners: Set<string>): [number, number] {
  const exclude = new Set([bed.id, ...partners]);
  const side = (s: 1 | -1) => {
    const dir = directionToRoom(bed, { x: s, y: 0 });
    return Math.min(...[0, 0.25].map((t) => rayHit(toRoom(bed, { x: (s * bed.width) / 2, y: bed.depth * t }), dir, obstacles, exclude)));
  };
  return [side(-1), side(1)];
}

/** The angle (degrees) between where a piece faces and the direction to a point. */
export function facingAngle(item: Pick<Furniture, 'x' | 'y' | 'rotation'>, target: Point): number {
  const f = directionToRoom(item, { x: 0, y: 1 });
  const dx = target.x - item.x;
  const dy = target.y - item.y;
  const len = Math.hypot(dx, dy) || 1;
  return (Math.acos(Math.max(-1, Math.min(1, (f.x * dx + f.y * dy) / len))) * 180) / Math.PI;
}

/** Pieces that sensibly sit in front of another (its "partners"), so they don't count as obstructions. */
export function partnersOf(item: Furniture, relationships: Relationship[]): Set<string> {
  const ids = new Set<string>();
  for (const r of relationships) {
    if (r.a === item.id && (r.type === 'inFrontOf' || r.type === 'near')) ids.add(r.b);
    if (r.b === item.id && r.type === 'inFrontOf') ids.add(r.a);
  }
  return ids;
}

export type IssueKind = 'facesObstacle' | 'awayFromTv' | 'crampedDesk' | 'pairApart' | 'bedSideBlocked';

export interface PracticalIssue {
  kind: IssueKind;
  itemId: string;
  /** Plain-language description with the measured value. */
  message: string;
}

/**
 * Practical problems in a layout. `relationships` should include the assumed pairings
 * (see semantics.ts) so partners are recognised.
 */
export function practicalIssues(project: Project, relationships: Relationship[]): PracticalIssue[] {
  const issues: PracticalIssue[] = [];
  const obstacles = obstaclesFor(project);
  const solids = project.furniture.filter(isSolid);
  const byId = new Map(project.furniture.map((f) => [f.id, f]));
  for (const item of solids) {
    const need = frontNeed(item.kind);
    if (need !== null) {
      const clear = frontClearance(item, obstacles, partnersOf(item, relationships));
      if (clear < need) {
        const kind: IssueKind = item.kind === 'desk' ? 'crampedDesk' : 'facesObstacle';
        issues.push({
          kind,
          itemId: item.id,
          message:
            item.kind === 'desk'
              ? `${item.name}: only ${Math.round(clear)} cm to pull a chair out (needs about ${need} cm).`
              : `${item.name} faces something only ${Math.round(clear)} cm away (needs about ${need} cm).`,
        });
      }
    }
    if (item.kind === 'bed' && item.width >= 120) {
      const [left, right] = bedSideClearances(item, obstacles, partnersOf(item, relationships));
      const blocked = [left, right].filter((d) => d < 45).length;
      if (blocked > 0) issues.push({ kind: 'bedSideBlocked', itemId: item.id, message: `${item.name}: ${blocked === 2 ? 'neither side has' : 'one side has no'} room to get in (${Math.round(Math.min(left, right))} cm).` });
    }
  }
  const tv = solids.find((f) => f.kind === 'television');
  if (tv) {
    for (const seat of solids.filter((f) => f.kind === 'sofa')) {
      const angle = facingAngle(seat, tv);
      if (angle > 60) issues.push({ kind: 'awayFromTv', itemId: seat.id, message: `${seat.name} is turned ${Math.round(angle)}° away from the ${tv.name}.` });
    }
  }
  for (const r of relationships) {
    const a = byId.get(r.a);
    const b = byId.get(r.b);
    if (!a || !b || r.type === 'faces') continue;
    const limit = r.type === 'beside' ? 40 : r.type === 'inFrontOf' ? 120 : 90;
    const gap = Math.hypot(a.x - b.x, a.y - b.y) - (Math.max(a.width, a.depth) + Math.max(b.width, b.depth)) / 2;
    if (gap > limit) issues.push({ kind: 'pairApart', itemId: b.id, message: `${b.name} is ${Math.round(gap)} cm from the ${a.name} it goes with.` });
  }
  return issues;
}

export const isSeat = (kind: FurnitureKind) => SEATS.includes(kind);
