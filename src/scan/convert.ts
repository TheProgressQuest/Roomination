import { featureDefaults, findOverlappingOpening, clampFeatureToRoom, clampOffset } from '../model/features';
import { MIN_FURNITURE_SIZE } from '../model/geometry';
import { clampFurnitureToRoom, clampStairToRoom } from '../model/placement';
import { boundingBox, isClockwise, polygonArea, projectOntoSegment } from '../model/polygon';
import { createEmptyProject, DEFAULT_FLOOR, DEFAULT_WALL_COLOR } from '../model/sample';
import type { Furniture, Partition, Point, Project, Room, RoomFeature, Staircase, WallNode } from '../model/types';
import { DEFAULT_WALL_THICKNESS, findSegment, MIN_WALL_LENGTH, nearestWall, outlineSegments, segmentInsidePolygon, setWallLength, validateRoom, wallLabel } from '../model/walls';
import { parseProjectFile, serializeProject } from '../storage/projectFile';
import { BOX, catalogueName, categoryLabel, pieceFor, STAIRS, suggestPiece, type Suggestion } from './furnitureMap';
import { sectionName } from './roomPlan';
import type { ScanConfidence, ScanData, ScanObject, ScanOpening, ScanOpeningKind, ScanWall } from './types';

/**
 * Turns a measured scan plus the person's review choices into a Roomination project.
 *
 * The scan itself is never modified: `buildFromScan` is a pure function of (scan, review),
 * re-run on every change in the review screen, so "reset to measured" always works and the
 * preview always shows exactly what will be created.
 *
 * Steps:
 *  1. Orientation: optionally turn the plan so its walls line up with the grid (the average
 *     wall direction, weighted by length, folded into a quarter turn), plus quarter turns the
 *     person adds. Turning is rigid: no length or angle inside the room changes.
 *  2. Outline: wall ends within JOIN_DISTANCE of each other are joined into a corner (where
 *     the two walls' lines cross, or halfway between the ends). The largest closed loop of
 *     walls becomes the room outline; other walls inside it become interior walls. Gaps in an
 *     incomplete scan are closed with clearly marked walls; with no usable walls, the scanned
 *     floor outline is used.
 *  3. Doors, windows and openings attach to the wall the scanner linked them to (or the
 *     nearest wall), at their measured position, width, height and sill height.
 *  4. Objects become catalogue pieces stretched to their measured size, or plain boxes.
 *  5. The result goes through the same validation as any opened project file.
 */

/** Wall ends closer than this (cm) are treated as meeting at a corner. */
export const JOIN_DISTANCE = 30;
/** Gaps up to this long (cm) are closed with an added wall; longer ones fail the outline. */
const MAX_GAP = 600;
/** Openings farther than this (cm) from every wall can't be attached. */
const MAX_OPENING_DISTANCE = 60;
/** Objects whose bottom is this high (cm) hang on a wall or sit on something else. */
const MOUNTED_HEIGHT = 30;

// ---------------------------------------------------------------------------
// Review state: the person's choices, kept apart from the measurements
// ---------------------------------------------------------------------------

export interface OpeningEdit {
  include?: boolean;
  kind?: ScanOpeningKind;
  width?: number;
  height?: number;
  bottom?: number;
}

export interface ObjectEdit {
  include?: boolean;
  /** Replaces the scanner's category (e.g. "storage" → "bed"). */
  category?: string;
  /** A catalogue id, `box` or `stairs`, replacing Roomination's suggestion. */
  as?: string;
  width?: number;
  depth?: number;
  height?: number;
}

export interface AddedOpening {
  id: string;
  kind: ScanOpeningKind;
  /** Index of the outer wall (in the built outline). */
  wall: number;
  offset: number;
  width: number;
  height: number;
  bottom: number;
}

export interface AddedPiece {
  id: string;
  category: string;
  as: string;
  width: number;
  depth: number;
  height: number;
}

export interface Review {
  name: string;
  /** Line the walls up with the plan's grid. */
  straighten: boolean;
  /** Extra clockwise quarter turns, 0–3. */
  quarterTurns: number;
  /** Ceiling height override (cm); null = from the scan. */
  ceiling: number | null;
  /** Length overrides for outer walls (cm), by wall id. */
  wallLengths: Record<string, number>;
  openings: Record<string, OpeningEdit>;
  objects: Record<string, ObjectEdit>;
  addedOpenings: AddedOpening[];
  addedPieces: AddedPiece[];
}

export function initialReview(scan: ScanData): Review {
  const objects: Record<string, ObjectEdit> = {};
  // Things on walls or on other furniture would sit on the floor in the plan, on top of
  // whatever is below them, so they start unticked (but listed, never dropped).
  for (const o of scan.objects) if (o.bottom >= MOUNTED_HEIGHT) objects[o.id] = { include: false };
  return { name: scan.name, straighten: true, quarterTurns: 0, ceiling: null, wallLengths: {}, openings: {}, objects, addedOpenings: [], addedPieces: [] };
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type NoteLevel = 'check' | 'assumed' | 'info';

export interface Note {
  level: NoteLevel;
  text: string;
  /** The wall, opening or object it's about. */
  itemId?: string;
}

export interface BuiltWall {
  id: string;
  label: string;
  /** Length the scanner measured (null for walls Roomination added to close a gap). */
  measured: number | null;
  /** Length in the created room. */
  length: number;
  confidence: ScanConfidence;
  added: boolean;
  /** Part of the outline (false: an interior wall). */
  outer: boolean;
}

export interface BuiltOpening {
  id: string;
  /** What the scanner reported. */
  measured: ScanOpening | null;
  kind: ScanOpeningKind;
  width: number;
  height: number;
  bottom: number;
  include: boolean;
  /** "Wall 3", once placed. */
  wall: string | null;
  confidence: ScanConfidence;
  /** Why it couldn't be placed, if it couldn't. */
  problem: string | null;
  added: boolean;
}

export interface BuiltObject {
  id: string;
  measured: ScanObject | null;
  /** The category in use (the scanner's, unless the person changed it). */
  category: string;
  section: string | null;
  suggestion: Suggestion;
  as: string;
  name: string;
  width: number;
  depth: number;
  height: number;
  include: boolean;
  confidence: ScanConfidence;
  problem: string | null;
  added: boolean;
}

export interface BuildResult {
  /** The project to create, or null if the walls can't make a valid room yet. */
  project: Project | null;
  /** Why there's no project. */
  problem: string | null;
  walls: BuiltWall[];
  openings: BuiltOpening[];
  objects: BuiltObject[];
  notes: Note[];
  /** Degrees the plan was turned (clockwise) to line it up. */
  turnedBy: number;
  /** How far the walls were from the grid before straightening (degrees, −45 to 45). */
  skew: number;
  /** The scan's walls after turning, for drawing when no room can be built. */
  rawWalls: { a: Point; b: Point; id: string }[];
  outlineFrom: 'walls' | 'floor' | 'none';
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const round1 = (v: number) => Math.round(v * 10) / 10 || 0;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function rotate(p: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** The walls' common direction, folded into −45°…45° (0 = already lined up with the grid). */
export function wallSkew(walls: Pick<ScanWall, 'a' | 'b'>[]): number {
  let sx = 0;
  let sy = 0;
  for (const w of walls) {
    const len = dist(w.a, w.b);
    const angle = Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 4; // ×4 folds the four grid directions together
    sx += Math.cos(angle) * len;
    sy += Math.sin(angle) * len;
  }
  if (Math.hypot(sx, sy) < 1e-9) return 0;
  return (Math.atan2(sy, sx) / 4) * (180 / Math.PI);
}

/** Where the infinite lines through ab and cd cross, or null if they're nearly parallel. */
function lineCrossing(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  const sin = Math.abs(denom) / (Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y));
  if (!(sin > Math.sin((15 * Math.PI) / 180))) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

interface Edge {
  wallId: string;
  /** Corner indices. */
  from: number;
  to: number;
}

interface Loop {
  points: Point[];
  /** walls[i] runs from points[i] to points[i + 1]; null = an added wall closing a gap. */
  walls: (string | null)[];
}

/**
 * Joins nearby wall ends into corners and finds the room's outline. Returns the loop (if one
 * can be made), the walls not in it, and how far any corner moved from a measured end.
 */
export function traceOutline(walls: Pick<ScanWall, 'id' | 'a' | 'b'>[]): { loop: Loop | null; others: string[]; gaps: number; maxShift: number } {
  // Union-find over the 2n wall ends.
  const ends = walls.flatMap((w) => [w.a, w.b]);
  const parent = ends.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      if (i >> 1 === j >> 1) continue; // a wall's own two ends
      if (dist(ends[i], ends[j]) <= JOIN_DISTANCE) parent[find(i)] = find(j);
    }
  }
  const clusters = new Map<number, number[]>();
  ends.forEach((_, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), i]));
  const cornerOf = new Map<number, number>();
  const corners: Point[] = [];
  let maxShift = 0;
  for (const members of clusters.values()) {
    let p: Point | null = null;
    if (members.length === 2) {
      const [i, j] = members;
      const wi = walls[i >> 1];
      const wj = walls[j >> 1];
      const crossing = lineCrossing(wi.a, wi.b, wj.a, wj.b);
      if (crossing && dist(crossing, ends[i]) <= JOIN_DISTANCE * 2 && dist(crossing, ends[j]) <= JOIN_DISTANCE * 2) p = crossing;
    }
    if (!p) {
      const n = members.length;
      p = { x: members.reduce((s, i) => s + ends[i].x, 0) / n, y: members.reduce((s, i) => s + ends[i].y, 0) / n };
    }
    for (const i of members) {
      maxShift = Math.max(maxShift, dist(p, ends[i]));
      cornerOf.set(i, corners.length);
    }
    corners.push(p);
  }

  const edges: Edge[] = [];
  walls.forEach((w, k) => {
    const from = cornerOf.get(2 * k)!;
    const to = cornerOf.get(2 * k + 1)!;
    if (from !== to) edges.push({ wallId: w.id, from, to });
  });

  // Closed loops: repeatedly remove dangling walls; what remains with every corner shared by
  // exactly two walls is one or more loops.
  const alive = new Set(edges.map((_, i) => i));
  const degree = () => {
    const d = new Map<number, number>();
    for (const i of alive) {
      d.set(edges[i].from, (d.get(edges[i].from) ?? 0) + 1);
      d.set(edges[i].to, (d.get(edges[i].to) ?? 0) + 1);
    }
    return d;
  };
  for (let changed = true; changed; ) {
    changed = false;
    const d = degree();
    for (const i of [...alive]) {
      if (d.get(edges[i].from) === 1 || d.get(edges[i].to) === 1) {
        alive.delete(i);
        changed = true;
      }
    }
  }
  const d = degree();
  const loops: Loop[] = [];
  const used = new Set<number>();
  for (const start of alive) {
    if (used.has(start)) continue;
    const loop: Loop = { points: [], walls: [] };
    let edge = start;
    let at = edges[start].from;
    let ok = true;
    while (!used.has(edge)) {
      used.add(edge);
      if (d.get(at) !== 2) ok = false;
      const e = edges[edge];
      const next = e.from === at ? e.to : e.from;
      loop.points.push(corners[at]);
      loop.walls.push(e.wallId);
      at = next;
      const following = [...alive].find((i) => !used.has(i) && (edges[i].from === at || edges[i].to === at));
      if (following === undefined) break;
      edge = following;
    }
    if (ok && loop.points.length >= 3) loops.push(loop);
  }
  let loop = loops.sort((a, b) => polygonArea(b.points) - polygonArea(a.points))[0] ?? null;
  let gaps = 0;

  // No closed loop: chain the walls end to end, closing gaps with added walls.
  if (!loop && edges.length >= 2) {
    const chained = chainWithGaps(edges, corners);
    if (chained) {
      loop = chained.loop;
      gaps = chained.gaps;
    }
  }
  const inLoop = new Set(loop?.walls.filter((w): w is string => w !== null));
  return { loop, others: walls.map((w) => w.id).filter((id) => !inLoop.has(id)), gaps, maxShift };
}

/**
 * For a scan whose walls don't close: follows the longest run of connected walls, then hops
 * to the nearest loose end of another run, repeatedly, and finally closes back to the start.
 * Every hop longer than a joined corner becomes an added wall (marked for checking).
 */
function chainWithGaps(edges: Edge[], corners: Point[]): { loop: Loop; gaps: number } | null {
  // Runs of walls connected through corners shared by exactly two walls.
  const byCorner = new Map<number, number[]>();
  edges.forEach((e, i) => {
    byCorner.set(e.from, [...(byCorner.get(e.from) ?? []), i]);
    byCorner.set(e.to, [...(byCorner.get(e.to) ?? []), i]);
  });
  if ([...byCorner.values()].some((list) => list.length > 2)) return null;
  const seen = new Set<number>();
  const runs: { corners: number[]; walls: string[] }[] = [];
  for (let i = 0; i < edges.length; i++) {
    if (seen.has(i)) continue;
    // Walk to one end of this run, then collect it from there.
    let edge = i;
    let at = edges[i].from;
    for (const visited = new Set<number>(); ; ) {
      visited.add(edge);
      const other = (byCorner.get(at) ?? []).find((j) => j !== edge);
      if (other === undefined || visited.has(other)) break;
      edge = other;
      at = edges[other].from === at ? edges[other].to : edges[other].from;
    }
    const run = { corners: [at], walls: [] as string[] };
    for (;;) {
      seen.add(edge);
      const e = edges[edge];
      at = e.from === at ? e.to : e.from;
      run.corners.push(at);
      run.walls.push(e.wallId);
      const next = (byCorner.get(at) ?? []).find((j) => !seen.has(j));
      if (next === undefined) break;
      edge = next;
    }
    runs.push(run);
  }
  const length = (r: (typeof runs)[number]) => r.corners.slice(1).reduce((s, c, k) => s + dist(corners[r.corners[k]], corners[c]), 0);
  runs.sort((a, b) => length(b) - length(a));
  const main = runs.shift()!;
  const points = main.corners.map((c) => corners[c]);
  const wallIds: (string | null)[] = [...main.walls];
  let gaps = 0;
  while (runs.length) {
    const tail = points[points.length - 1];
    let best: { k: number; reverse: boolean; d: number } | null = null;
    runs.forEach((r, k) => {
      const head = corners[r.corners[0]];
      const end = corners[r.corners[r.corners.length - 1]];
      for (const [p, reverse] of [[head, false], [end, true]] as const) {
        const dd = dist(tail, p);
        if (!best || dd < best.d) best = { k, reverse, d: dd };
      }
    });
    const pick = best!;
    if (pick.d > MAX_GAP) return null;
    const run = runs.splice(pick.k, 1)[0];
    const cs = pick.reverse ? [...run.corners].reverse() : run.corners;
    const ws = pick.reverse ? [...run.walls].reverse() : run.walls;
    wallIds.push(null);
    gaps++;
    points.push(...cs.map((c) => corners[c]));
    wallIds.push(...ws);
  }
  if (dist(points[0], points[points.length - 1]) > MAX_GAP) return null;
  wallIds.push(null);
  gaps++;
  if (points.length < 3) return null;
  return { loop: { points, walls: wallIds }, gaps };
}

// ---------------------------------------------------------------------------
// Building the project
// ---------------------------------------------------------------------------

function nearestSection(scan: ScanData, p: Point): string | null {
  let best: { label: string; d: number } | null = null;
  for (const s of scan.sections) {
    const d = dist(s.center, p);
    if (!best || d < best.d) best = { label: s.label, d };
  }
  return best?.label ?? null;
}

const OPENING_NAMES: Record<ScanOpeningKind, string> = { door: 'Door', window: 'Window', opening: 'Doorway' };

export function buildFromScan(scan: ScanData, review: Review): BuildResult {
  const notes: Note[] = [...scan.notes.map((text) => ({ level: 'info' as const, text }))];

  // 1. Orientation ------------------------------------------------------------
  const skew = wallSkew(scan.walls.length ? scan.walls : (scan.floor ?? []).map((p, i, f) => ({ a: p, b: f[(i + 1) % f.length] })));
  const turnedBy = (review.straighten ? -skew : 0) + (((review.quarterTurns % 4) + 4) % 4) * 90;
  const turn = (p: Point) => rotate(p, turnedBy);
  const walls = scan.walls.map((w) => ({ ...w, a: turn(w.a), b: turn(w.b) }));
  const rawWalls = walls.map(({ id, a, b }) => ({ id, a, b }));

  // 2. Outline ------------------------------------------------------------------
  const traced = walls.length >= 2 ? traceOutline(walls) : { loop: null, others: walls.map((w) => w.id), gaps: 0, maxShift: 0 };
  let loop = traced.loop;
  let outlineFrom: BuildResult['outlineFrom'] = loop ? 'walls' : 'none';
  if (!loop && scan.floor) {
    const floor = scan.floor.map(turn);
    loop = { points: floor, walls: floor.map((_, i) => `scan-floor-edge-${i + 1}`) };
    outlineFrom = 'floor';
    notes.push({ level: 'check', text: 'The scanned walls don’t form a closed room, so the outline comes from the scanned floor. Doors and windows are attached to the nearest wall.' });
  }
  const empty = (problem: string): BuildResult => ({ project: null, problem, walls: [], openings: [], objects: [], notes, turnedBy, skew, rawWalls, outlineFrom });
  if (!loop) return empty('The scanned walls don’t join up into a room, even allowing for small gaps. Try scanning the room again, slowly following every wall.');

  // Clockwise on screen, so each wall's right side faces into the room.
  let { points, walls: loopWalls } = loop;
  if (!isClockwise(points)) {
    points = [...points].reverse();
    // Reversed, the wall between points[i] and points[i+1] is the one that was between them before.
    const n = loopWalls.length;
    loopWalls = points.map((_, i) => loopWalls[(n - 2 - i + n) % n]);
  }
  const box = boundingBox(points);
  const shift = (p: Point): Point => ({ x: round1(p.x - box.minX), y: round1(p.y - box.minY) });
  const usedIds = new Set<string>();
  let gapCount = 0;
  const outline: WallNode[] = points.map((p, i) => {
    let id = loopWalls[i] ?? `scan-added-wall-${++gapCount}`;
    while (usedIds.has(id)) id = `${id}-x`;
    usedIds.add(id);
    return { id, ...shift(p), thickness: DEFAULT_WALL_THICKNESS };
  });
  const wallById = new Map(scan.walls.map((w) => [w.id, w]));

  // Ceiling: the most common wall height, weighted by length.
  const heights = scan.walls.filter((w) => usedIds.has(w.id)).map((w) => ({ h: w.height, len: dist(w.a, w.b) }));
  const measuredCeiling = weightedMedian(heights) ?? 250;
  const ceiling = review.ceiling ?? round1(measuredCeiling);
  if (heights.length) {
    const lo = Math.min(...heights.map((h) => h.h));
    const hi = Math.max(...heights.map((h) => h.h));
    if (hi - lo > 10) notes.push({ level: 'check', text: `Wall heights vary from ${round1(lo)} to ${round1(hi)} cm (a lower ceiling, beam or slope?). Roomination uses one ceiling height for the room: ${ceiling} cm.` });
  }

  // Interior walls: scanned walls inside the outline that aren't part of it.
  const partitions: Partition[] = [];
  const poly = outline.map(({ x, y }) => ({ x, y }));
  for (const id of traced.others) {
    const w = walls.find((x) => x.id === id)!;
    const a = shift(w.a);
    const b = shift(w.b);
    if (dist(a, b) < MIN_WALL_LENGTH) continue;
    if (segmentInsidePolygon(a, b, poly)) {
      partitions.push({ id: `${id}-interior`, nodes: [{ id, ...a, thickness: 10 }, { id: `${id}-end`, ...b, thickness: 10 }] });
    } else {
      notes.push({ level: 'check', text: `A scanned wall (${round1(dist(a, b))} cm) lies outside the room’s outline, perhaps seen through a doorway, and isn’t included.`, itemId: id });
    }
  }

  let room: Room = { outline, partitions, height: ceiling, floor: DEFAULT_FLOOR, wallColor: DEFAULT_WALL_COLOR };

  // The person's corrected wall lengths (each moves that wall's far corner along the wall).
  for (const [id, length] of Object.entries(review.wallLengths)) {
    if (!findSegment(room, id)) continue;
    const next = setWallLength(room, id, length);
    if (typeof next === 'string') notes.push({ level: 'check', text: `${wallLabel(room, id)}: ${next}`, itemId: id });
    else room = { ...next, outline: next.outline.map((n) => ({ ...n, x: round1(n.x), y: round1(n.y) })) };
  }

  const builtWalls: BuiltWall[] = outlineSegments(room).map((s) => {
    const scanned = wallById.get(s.id);
    return {
      id: s.id,
      label: wallLabel(room, s.id),
      measured: scanned ? round1(dist(scanned.a, scanned.b)) : null,
      length: round1(s.length),
      confidence: scanned?.confidence ?? 'unknown',
      added: !scanned && outlineFrom === 'walls',
      outer: true,
    };
  });
  for (const p of partitions) {
    const scanned = wallById.get(p.nodes[0].id);
    builtWalls.push({ id: p.nodes[0].id, label: wallLabel(room, p.nodes[0].id), measured: scanned ? round1(dist(scanned.a, scanned.b)) : null, length: round1(dist(p.nodes[0], p.nodes[1])), confidence: scanned?.confidence ?? 'unknown', added: false, outer: false });
  }
  if (traced.gaps > 0 && outlineFrom === 'walls') {
    notes.push({ level: 'check', text: `The scan missed ${traced.gaps === 1 ? 'part of a wall' : `${traced.gaps} stretches of wall`}. Roomination closed the outline with ${traced.gaps === 1 ? 'a straight wall' : 'straight walls'} (marked “added”). Check ${traced.gaps === 1 ? 'it' : 'them'} against the real room.` });
  }
  if (traced.maxShift > 0.5 && outlineFrom === 'walls') {
    notes.push({ level: 'info', text: `Wall ends that nearly met were joined into corners; the largest move was ${round1(traced.maxShift)} cm. Each wall’s measured and final lengths are listed under Room.` });
  }
  if (Math.abs(skew) > 0.05 && review.straighten) notes.push({ level: 'info', text: `The plan was turned ${round1(Math.abs(skew))}° to line the walls up with the grid. Turning doesn’t change any length or angle in the room.` });
  if (scan.walls.some((w) => w.curved && usedIds.has(w.id))) notes.push({ level: 'check', text: 'A curved wall is drawn as a straight wall between its ends.' });
  notes.push({ level: 'assumed', text: `Wall thickness isn’t measured by the scanner; walls are drawn ${DEFAULT_WALL_THICKNESS} cm thick on the outside of the room, so the room’s inside measurements are exactly as scanned.` });

  const problem = validateRoom(room);
  if (problem) {
    const result = empty(`The walls can’t make a valid room yet: ${problem}`);
    return { ...result, walls: builtWalls };
  }

  // 3. Doors, windows and openings -----------------------------------------------
  const features: RoomFeature[] = [];
  const builtOpenings: BuiltOpening[] = [];
  let doorsAssumed = false;
  const placeOpening = (o: { id: string; kind: ScanOpeningKind; center?: Point; wallId: string | null; width: number; height: number; bottom: number; offset?: number }): { wall: string | null; problem: string | null } => {
    let segment = o.wallId ? findSegment(room, o.wallId) : null;
    let offset = o.offset ?? 0;
    if (segment && o.center && o.offset === undefined) offset = projectOntoSegment(o.center, segment.start, segment.end).t * segment.length;
    if (!segment && o.center) {
      const near = nearestWall(room, o.center);
      if (!near || near.distance > MAX_OPENING_DISTANCE) return { wall: null, problem: 'It isn’t near any wall of the room, so it can’t be placed.' };
      segment = near.segment;
      offset = near.offset;
    }
    if (!segment) return { wall: null, problem: 'Its wall isn’t part of the room.' };
    if (!(o.width > 0) || !(o.height > 0)) return { wall: wallLabel(room, segment.id), problem: 'Its width and height must be more than 0.' };
    if (o.width > segment.length) return { wall: wallLabel(room, segment.id), problem: `It’s wider than ${wallLabel(room, segment.id)}.` };
    const bottom = o.kind === 'window' ? o.bottom : 0;
    if (bottom >= ceiling - 5) return { wall: wallLabel(room, segment.id), problem: `Its bottom (${round1(bottom)} cm) is at or above the ceiling (${ceiling} cm).` };
    if (bottom + o.height > ceiling + 0.5) notes.push({ level: 'info', text: `${OPENING_NAMES[o.kind]} on ${wallLabel(room, segment.id)} reaches above the ceiling, so it’s drawn up to the ceiling.`, itemId: o.id });
    const defaults = featureDefaults(o.kind === 'window' ? 'window' : 'door', room);
    const feature: RoomFeature = {
      ...defaults,
      id: o.id,
      name: OPENING_NAMES[o.kind],
      placement: { type: 'wall', wallId: segment.id, offset: round1(clampOffset(offset, segment.length, o.width)) },
      width: round1(o.width),
      height: round1(Math.min(o.height, ceiling - bottom)),
      elevation: round1(bottom),
      ...(o.kind === 'opening' ? { doorType: 'opening' as const } : {}),
    };
    const placed = clampFeatureToRoom(feature, room);
    if (!placed) return { wall: wallLabel(room, segment.id), problem: 'It doesn’t fit on its wall.' };
    const clash = findOverlappingOpening(placed, features);
    if (clash) return { wall: wallLabel(room, segment.id), problem: `It overlaps “${clash.name}” on the same wall. Adjust one of them or leave one out.` };
    features.push(placed);
    if (o.kind === 'door') doorsAssumed = true;
    return { wall: wallLabel(room, segment.id), problem: null };
  };

  for (const o of scan.openings) {
    const edit = review.openings[o.id] ?? {};
    const kind = edit.kind ?? o.kind;
    const built: BuiltOpening = {
      id: o.id,
      measured: o,
      kind,
      width: edit.width ?? round1(o.width),
      height: edit.height ?? round1(o.height),
      bottom: kind === 'window' ? (edit.bottom ?? round1(o.bottom)) : 0,
      include: edit.include ?? true,
      wall: null,
      confidence: o.confidence,
      problem: null,
      added: false,
    };
    if (built.include) {
      const turned = turn(o.center);
      const placed = placeOpening({ id: o.id, kind, center: { x: turned.x - box.minX, y: turned.y - box.minY }, wallId: o.wallId && findSegment(room, o.wallId) ? o.wallId : null, width: built.width, height: built.height, bottom: built.bottom });
      built.wall = placed.wall;
      built.problem = placed.problem;
    }
    builtOpenings.push(built);
  }
  for (const a of review.addedOpenings) {
    const wall = room.outline[a.wall];
    const built: BuiltOpening = { id: a.id, measured: null, kind: a.kind, width: a.width, height: a.height, bottom: a.kind === 'window' ? a.bottom : 0, include: true, wall: null, confidence: 'unknown', problem: null, added: true };
    const placed = wall ? placeOpening({ id: a.id, kind: a.kind, wallId: wall.id, width: a.width, height: a.height, bottom: built.bottom, offset: a.offset }) : { wall: null, problem: 'That wall no longer exists.' };
    built.wall = placed.wall;
    built.problem = placed.problem;
    builtOpenings.push(built);
  }
  for (const b of builtOpenings) if (b.include && b.problem) notes.push({ level: 'check', text: `${OPENING_NAMES[b.kind]}${b.wall ? ` on ${b.wall}` : ''} is left out: ${b.problem}`, itemId: b.id });
  if (doorsAssumed) notes.push({ level: 'assumed', text: 'Which way doors swing and where they’re hinged isn’t measured; each door opens into the room, hinged on the left. Change it in the door’s settings.' });
  if (scan.openings.length === 0 && review.addedOpenings.length === 0) notes.push({ level: 'check', text: 'The scan found no doors or windows. Add any it missed under Openings.' });

  // 4. Furniture ---------------------------------------------------------------------
  const furniture: Furniture[] = [];
  const stairs: Staircase[] = [];
  const builtObjects: BuiltObject[] = [];
  const centre = { x: (box.maxX - box.minX) / 2, y: (box.maxY - box.minY) / 2 };
  const placePiece = (b: BuiltObject, at: Point, rotation: number) => {
    if (b.as === STAIRS) {
      const stair: Staircase = {
        id: b.id,
        name: 'Stairs',
        x: round1(at.x),
        y: round1(at.y),
        rotation: round1(rotation),
        direction: 'up',
        rise: round1(Math.max(b.height, 20)),
        sections: [{ id: `${b.id}-flight`, kind: 'flight', length: round1(b.depth), width: round1(b.width), steps: Math.max(2, Math.round(b.depth / 25)), turn: 'straight' }],
      };
      const placed = clampStairToRoom(stair, room);
      if (!placed) return 'It doesn’t fit inside the room at this size.';
      stairs.push(placed);
      notes.push({ level: 'assumed', text: 'Stairs: the scan doesn’t say which end is the bottom, so the staircase goes up from its front. Turn it if needed.', itemId: b.id });
      return null;
    }
    const t = pieceFor(b.as, b.category, b);
    const item: Furniture = { ...t, id: b.id, x: round1(at.x), y: round1(at.y), rotation: round1(((rotation % 360) + 360) % 360), locked: false, preferences: [] };
    const placed = clampFurnitureToRoom(item, room);
    if (!placed) return 'It doesn’t fit inside the room at this size and angle.';
    const moved = dist(placed, item);
    if (moved > 2) notes.push({ level: 'info', text: `${b.name} was moved ${round1(moved)} cm to sit inside the walls.`, itemId: b.id });
    furniture.push({ ...placed, x: round1(placed.x), y: round1(placed.y) });
    return null;
  };

  for (const o of scan.objects) {
    const edit = review.objects[o.id] ?? {};
    const category = edit.category ?? o.category;
    const section = nearestSection(scan, o.center);
    const measured = { width: round1(o.width), depth: round1(o.depth), height: round1(o.height) };
    const size = { width: edit.width ?? measured.width, depth: edit.depth ?? measured.depth, height: edit.height ?? measured.height };
    const suggestion = suggestPiece(category, measured, section);
    const as = edit.as ?? suggestion.as;
    const b: BuiltObject = {
      id: o.id,
      measured: o,
      category,
      section,
      suggestion,
      as,
      name: as === BOX || as === STAIRS ? (as === STAIRS ? 'Stairs' : `Scanned ${categoryLabel(category).toLowerCase()}`) : (catalogueName(as) ?? categoryLabel(category)),
      ...size,
      include: edit.include ?? true,
      confidence: o.confidence,
      problem: null,
      added: false,
    };
    if (!(b.width >= MIN_FURNITURE_SIZE && b.depth >= MIN_FURNITURE_SIZE)) b.problem = `It must be at least ${MIN_FURNITURE_SIZE} cm wide and deep.`;
    else if (!(b.height > 0)) b.problem = 'Its height must be more than 0.';
    if (b.include && !b.problem) {
      const turned = turn(o.center);
      b.problem = placePiece(b, { x: turned.x - box.minX, y: turned.y - box.minY }, o.rotation + turnedBy);
    }
    if (o.bottom >= MOUNTED_HEIGHT) notes.push({ level: 'check', text: `${categoryLabel(o.category)} is ${round1(o.bottom)} cm above the floor (on a wall, or standing on other furniture). Roomination places furniture on the floor, so it starts unticked; tick it to add it anyway.`, itemId: o.id });
    builtObjects.push(b);
  }
  for (const a of review.addedPieces) {
    const b: BuiltObject = { id: a.id, measured: null, category: a.category, section: null, suggestion: { as: a.as, reason: 'Added by you.' }, as: a.as, name: a.as === BOX ? `${categoryLabel(a.category)}` : (catalogueName(a.as) ?? categoryLabel(a.category)), width: a.width, depth: a.depth, height: a.height, include: true, confidence: 'unknown', problem: null, added: true };
    b.problem = b.width >= MIN_FURNITURE_SIZE && b.depth >= MIN_FURNITURE_SIZE && b.height > 0 ? placePiece(b, centre, 0) : `It must be at least ${MIN_FURNITURE_SIZE} cm wide and deep, and more than 0 high.`;
    builtObjects.push(b);
  }
  for (const b of builtObjects) if (b.include && b.problem) notes.push({ level: 'check', text: `${b.name} is left out: ${b.problem}`, itemId: b.id });
  const lowConfidence = [...builtOpenings, ...builtObjects].filter((x) => x.include && x.confidence === 'low').length;
  if (lowConfidence) notes.push({ level: 'check', text: `The scanner was unsure about ${lowConfidence} item${lowConfidence === 1 ? '' : 's'} (marked “low”). Check ${lowConfidence === 1 ? 'it' : 'them'} against the real room.` });

  // 5. The project, validated like any opened file -------------------------------------
  const name = review.name.trim().slice(0, 60) || 'Scanned room';
  const draft: Project = { ...createEmptyProject(room, name), furniture, features, stairs };
  const checked = parseProjectFile(serializeProject(draft));
  if (!checked.ok) return { ...empty(checked.error), walls: builtWalls, openings: builtOpenings, objects: builtObjects };
  return { project: checked.project, problem: null, walls: builtWalls, openings: builtOpenings, objects: builtObjects, notes, turnedBy, skew, rawWalls, outlineFrom };
}

function weightedMedian(values: { h: number; len: number }[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a.h - b.h);
  const total = sorted.reduce((s, v) => s + v.len, 0);
  let run = 0;
  for (const v of sorted) {
    run += v.len;
    if (run >= total / 2) return v.h;
  }
  return sorted[sorted.length - 1].h;
}

/** A readable section name for an object's area, e.g. "Kitchen". */
export function sectionLabel(section: string | null): string | null {
  return section ? sectionName(section) : null;
}
