import { findConflicts, furniturePolygon, isSolid, type Conflict } from '../model/conflicts';
import { featureFrame, featureZones, toRoom } from '../model/features';
import { functionWeightFor } from '../model/furnitureKinds';
import { boundingBox, overlapArea, projectOntoSegment, type Polygon } from '../model/polygon';
import { layoutStair, stairPolygons, stairToRoom } from '../model/stairs';
import type { Furniture, FurnitureKind, OptimizerSettings, PlacementPreference, Point, Project, Relationship } from '../model/types';
import { wallBodies } from '../model/wallGeometry';
import { outlinePolygon, wallSegments, type WallSegment } from '../model/walls';
import { analyseCirculation, createGrid, type CirculationGrid, type CirculationResult } from './circulation';

/**
 * Layout scoring. Everything here is measured from geometry; nothing is guessed.
 *
 * Three groups, each 0–100:
 *   - Functional: can you get around and use things?
 *   - Aesthetic: tidy, aligned, balanced — a *subjective* judgement, reported as such.
 *   - Preferences: the user's own wishes and relationships (only if any are set).
 *
 * Overall = 70% × (w·Functional + (1−w)·Aesthetic) + 30% × Preferences, where w is the
 * function weighting (from the mode or the Balanced slider). Without preferences,
 * Overall = w·Functional + (1−w)·Aesthetic.
 *
 * Hard constraints (staying inside the room, not colliding, keeping doorways and stairs
 * clear) are *not* part of the score: layouts that break them are rejected outright,
 * so no weighting can trade them away. See `hardViolations`.
 */

export interface ScoreComponent {
  id: string;
  label: string;
  group: 'functional' | 'aesthetic' | 'preferences';
  /** 0–1. */
  value: number;
  /** Relative weight within its group. */
  weight: number;
  /** Human-readable measurement behind the value, e.g. "2 of 2 doors reachable". */
  detail: string;
}

export interface Scores {
  overall: number;
  functional: number;
  aesthetic: number;
  /** null when no preferences or relationships are set. */
  preferences: number | null;
  components: ScoreComponent[];
}

/** Raw measurements of a layout, used for scores, explanations and trade-offs. */
export interface Metrics {
  circulation: CirculationResult;
  freeFloorM2: number;
  /** Soft conflicts (vents, outlets, switches, radiator clearance, accepted overlaps…). */
  softConflicts: Conflict[];
  /** Per-preference results, keyed `${itemId}:${preference}`. */
  preferences: Map<string, PreferenceResult>;
  /** Per-relationship results, keyed by relationship id. */
  relationships: Map<string, number>;
  usableCount: number;
  usableTotal: number;
}

export interface PreferenceResult {
  /** 0–1, or null when it can't apply (e.g. no window in the room). */
  value: number | null;
  /** Measured quantity, e.g. distance to the nearest window in cm. */
  measured: number | null;
  /** Why it can't apply, if it can't. */
  unavailable?: string;
}

/**
 * Everything about the room that doesn't change while furniture moves, prepared once
 * per optimization run.
 */
export interface LayoutContext {
  project: Project;
  room: Polygon;
  roomCentre: Point;
  roomRadius: number;
  walls: WallSegment[];
  windows: Point[];
  outlets: Point[];
  doorPoints: Point[];
  stairPoints: Point[];
  grid: CirculationGrid;
  /** Furniture that never moves in this run (locked, or not selected). */
  fixedIds: Set<string>;
  settings: OptimizerSettings;
}

export function createContext(project: Project, movableIds: Set<string>, settings: OptimizerSettings): LayoutContext {
  const room = outlinePolygon(project.room);
  const box = boundingBox(room);
  const walkway = settings.walkwayWidth;
  const fixedIds = new Set(project.furniture.filter((f) => !movableIds.has(f.id)).map((f) => f.id));

  // Fixed obstacles for walking: walls (incl. interior walls), solid features, stairs, and fixed solid furniture.
  const fixedObstacles: Polygon[] = [
    ...wallBodies(project.room, project.features).map((b) => b.polygon),
    ...project.stairs.flatMap(stairPolygons),
    // Columns and radiator bodies (their "solid" zone).
    ...project.features.flatMap((f) => featureZones(f, project.room).filter((z) => z.type === 'solid').map((z) => z.polygon)),
    ...project.furniture.filter((f) => fixedIds.has(f.id) && isSolid(f)).map(furniturePolygon),
  ];

  const doorPoints = project.features
    .filter((f) => f.kind === 'door')
    .map((door) => toRoom(featureFrame(door, project.room), { x: 0, y: walkway / 2 + 10 }));
  const stairPoints = project.stairs.flatMap((stair) => {
    const first = layoutStair(stair.sections).sections[0];
    if (!first) return [];
    // Just before the first step, where you'd stand to start climbing.
    const before = { x: first.entry.x - first.heading.x * (walkway / 2 + 10), y: first.entry.y - first.heading.y * (walkway / 2 + 10) };
    return [stairToRoom(stair, before)];
  });

  return {
    project,
    room,
    roomCentre: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
    roomRadius: Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 2,
    walls: wallSegments(project.room),
    windows: project.features.filter((f) => f.kind === 'window').map((w) => featureFrame(w, project.room)),
    outlets: project.features.filter((f) => f.kind === 'outlet').map((o) => featureFrame(o, project.room)),
    doorPoints,
    stairPoints,
    grid: createGrid(room, fixedObstacles),
    fixedIds,
    settings,
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers on furniture
// ---------------------------------------------------------------------------

/** Unit vector of a piece's front (the side you use). */
export function frontOf(item: Pick<Furniture, 'rotation'>): Point {
  const r = (item.rotation * Math.PI) / 180;
  return { x: -Math.sin(r), y: Math.cos(r) };
}

/** A point given in the piece's own frame (x across, y towards the front), in room coordinates. */
export function localToRoom(item: Pick<Furniture, 'x' | 'y' | 'rotation'>, local: Point): Point {
  const r = (item.rotation * Math.PI) / 180;
  return { x: item.x + local.x * Math.cos(r) - local.y * Math.sin(r), y: item.y + local.x * Math.sin(r) + local.y * Math.cos(r) };
}

/** A room point expressed in the piece's own frame. */
function roomToLocal(item: Pick<Furniture, 'x' | 'y' | 'rotation'>, p: Point): Point {
  const r = (item.rotation * Math.PI) / 180;
  const dx = p.x - item.x;
  const dy = p.y - item.y;
  return { x: dx * Math.cos(r) + dy * Math.sin(r), y: -dx * Math.sin(r) + dy * Math.cos(r) };
}

/** Shortest distance between two convex polygons (0 if they touch or overlap). */
export function polygonGap(a: Polygon, b: Polygon): number {
  if (overlapArea(a, b) > 0.5) return 0;
  let best = Infinity;
  for (const [from, to] of [
    [a, b],
    [b, a],
  ]) {
    for (const p of from) {
      for (let i = 0; i < to.length; i++) best = Math.min(best, projectOntoSegment(p, to[i], to[(i + 1) % to.length]).distance);
    }
  }
  return best;
}

/** How close a piece's back edge is to the nearest wall, and how parallel it is. */
function backToWall(item: Furniture, walls: WallSegment[]): { gap: number; parallel: number } {
  const half = item.depth / 2;
  const a = localToRoom(item, { x: -item.width / 2, y: -half });
  const b = localToRoom(item, { x: item.width / 2, y: -half });
  const mid = localToRoom(item, { x: 0, y: -half });
  let best = { gap: Infinity, parallel: 0 };
  for (const wall of walls) {
    const gap = Math.max(projectOntoSegment(a, wall.start, wall.end).distance, projectOntoSegment(b, wall.start, wall.end).distance, projectOntoSegment(mid, wall.start, wall.end).distance);
    // Walls are drawn with thickness outside (outer) or around the line (interior).
    const face = wall.chain === 'outline' ? 0 : wall.thickness / 2;
    const effective = Math.max(0, gap - face);
    if (effective < best.gap) {
      const back = { x: a.x - b.x, y: a.y - b.y };
      const along = { x: wall.end.x - wall.start.x, y: wall.end.y - wall.start.y };
      const cos = Math.abs(back.x * along.x + back.y * along.y) / (Math.hypot(back.x, back.y) * Math.hypot(along.x, along.y) || 1);
      best = { gap: effective, parallel: cos };
    }
  }
  return best;
}

/** 1 when value ≤ good, falling linearly to 0 at bad (or the reverse when good > bad). */
function ramp(value: number, good: number, bad: number): number {
  if (good < bad) return value <= good ? 1 : value >= bad ? 0 : (bad - value) / (bad - good);
  return value >= good ? 1 : value <= bad ? 0 : (value - bad) / (good - bad);
}

function facing(from: Furniture, target: Point): number {
  const f = frontOf(from);
  const d = { x: target.x - from.x, y: target.y - from.y };
  const length = Math.hypot(d.x, d.y) || 1;
  const cos = (f.x * d.x + f.y * d.y) / length;
  // 1 when pointing straight at it, 0 beyond about 60° off.
  return ramp(Math.acos(Math.max(-1, Math.min(1, cos))) * (180 / Math.PI), 10, 60);
}

const SEATING: FurnitureKind[] = ['sofa', 'armchair'];
/** Pieces that, by common convention, stand with their back to a wall. */
const WALL_STANDING: FurnitureKind[] = ['television', 'bookshelf', 'cabinet', 'storage', 'bed'];

// ---------------------------------------------------------------------------
// Measuring a layout
// ---------------------------------------------------------------------------

/** Where a person stands to use a piece, by kind. Pieces with no "use side" return none. */
function usePoints(item: Furniture, project: Project, walkway: number): Point[] {
  const reach = walkway * 0.35;
  const front = localToRoom(item, { x: 0, y: item.depth / 2 + reach });
  const sides = [localToRoom(item, { x: -(item.width / 2 + reach), y: 0 }), localToRoom(item, { x: item.width / 2 + reach, y: 0 })];
  const back = localToRoom(item, { x: 0, y: -(item.depth / 2 + reach) });
  switch (item.kind) {
    case 'decor':
    case 'diningTable':
      return [];
    case 'bed':
      return sides;
    case 'desk':
      // A chair set in front of the desk is the place you use it from.
      return project.relationships.some((r) => r.type === 'inFrontOf' && r.a === item.id) ? [] : [front];
    case 'chair':
    case 'table':
    case 'coffeeTable':
    case 'bedsideTable':
    case 'custom':
      return [front, ...sides, back];
    default:
      return [front];
  }
}

export function measure(project: Project, context: LayoutContext): Metrics {
  const walkway = context.settings.walkwayWidth;
  const solids = project.furniture.filter(isSolid);
  const moving = solids.filter((f) => !context.fixedIds.has(f.id));
  const uses = solids.map((item) => ({ id: item.id, points: usePoints(item, project, walkway) })).filter((u) => u.points.length > 0);
  const circulation = analyseCirculation(context.grid, moving.map(furniturePolygon), { doors: context.doorPoints, stairs: context.stairPoints, uses }, walkway);

  const usedItems = uses.filter((u) => {
    const item = project.furniture.find((f) => f.id === u.id)!;
    return item.kind !== 'bed'; // beds are judged by their access preferences
  });
  const usableCount = usedItems.filter((u) => circulation.usable.get(u.id)?.some(Boolean)).length;

  let blockedCells = 0;
  for (const v of context.grid.fixed) blockedCells += v;
  const freeArea = (context.grid.cols * context.grid.rows - blockedCells) * context.grid.cell ** 2 - solids.filter((f) => !context.fixedIds.has(f.id)).reduce((s, f) => s + f.width * f.depth, 0);

  return {
    circulation,
    freeFloorM2: Math.max(0, freeArea) / 10_000,
    softConflicts: findConflicts(project).filter((c) => !isHard(c, project)),
    preferences: measurePreferences(project, context, circulation),
    relationships: new Map(project.relationships.map((r) => [r.id, relationshipScore(r, project)])),
    usableCount,
    usableTotal: usedItems.length,
  };
}

function measurePreferences(project: Project, context: LayoutContext, circulation: CirculationResult): Map<string, PreferenceResult> {
  const results = new Map<string, PreferenceResult>();
  const nearestOf = (item: Furniture, kinds: FurnitureKind[]) => {
    const others = project.furniture.filter((f) => f.id !== item.id && kinds.includes(f.kind));
    if (others.length === 0) return null;
    return others.reduce((best, f) => (Math.hypot(f.x - item.x, f.y - item.y) < Math.hypot(best.x - item.x, best.y - item.y) ? f : best));
  };
  const distanceTo = (item: Furniture, points: Point[]) => (points.length === 0 ? null : Math.min(...points.map((p) => Math.hypot(p.x - item.x, p.y - item.y))));

  for (const item of project.furniture) {
    for (const preference of item.preferences) {
      const key = `${item.id}:${preference}`;
      results.set(key, measurePreference(item, preference));
    }
  }
  return results;

  function measurePreference(item: Furniture, preference: PlacementPreference): PreferenceResult {
    switch (preference) {
      case 'againstWall':
      // Facing the wall while in use means you sit on the front side looking at the back,
      // so — like "against a wall" — the back should be at a wall.
      case 'facingWall': {
        const { gap, parallel } = backToWall(item, context.walls);
        return { value: ramp(gap, 5, 60) * ramp(parallel, 0.995, 0.9), measured: gap };
      }
      case 'nearWindow': {
        const d = distanceTo(item, context.windows);
        return d === null ? { value: null, measured: null, unavailable: 'There’s no window in this room.' } : { value: ramp(d, 150, 450), measured: d };
      }
      case 'nearOutlet': {
        const d = distanceTo(item, context.outlets);
        return d === null ? { value: null, measured: null, unavailable: 'There’s no outlet in this room.' } : { value: ramp(d, 100, 350), measured: d };
      }
      case 'facingRoom': {
        // You sit with your back to the wall, looking across the piece into the room.
        const toCentre = facing({ ...item, rotation: item.rotation + 180 }, context.roomCentre);
        return { value: toCentre, measured: null };
      }
      case 'facingTelevision': {
        const tv = nearestOf(item, ['television']);
        if (!tv) return { value: null, measured: null, unavailable: 'There’s no TV in this room.' };
        const d = Math.hypot(tv.x - item.x, tv.y - item.y);
        return { value: facing(item, tv) * ramp(d, 450, 700), measured: d };
      }
      case 'nearCoffeeTable': {
        const table = nearestOf(item, ['coffeeTable']);
        if (!table) return { value: null, measured: null, unavailable: 'There’s no coffee table in this room.' };
        const gap = polygonGap(furniturePolygon(item), furniturePolygon(table));
        return { value: ramp(gap, 60, 200), measured: gap };
      }
      case 'nearSeating': {
        const seat = nearestOf(item, ['sofa', 'armchair', 'chair']);
        if (!seat) return { value: null, measured: null, unavailable: 'There’s no seating in this room.' };
        const gap = polygonGap(furniturePolygon(item), furniturePolygon(seat));
        return { value: ramp(gap, 100, 300), measured: gap };
      }
      case 'accessBothSides':
      case 'accessOneSide': {
        const sides = circulation.usable.get(item.id) ?? [];
        const reachable = sides.filter(Boolean).length;
        const needed = preference === 'accessBothSides' ? 2 : 1;
        return { value: Math.min(1, reachable / needed), measured: reachable };
      }
    }
  }
}

/** 0–1: how well a relationship is met, from the pieces' actual positions. */
export function relationshipScore(relationship: Relationship, project: Project): number {
  const a = project.furniture.find((f) => f.id === relationship.a);
  const b = project.furniture.find((f) => f.id === relationship.b);
  if (!a || !b) return 0;
  const gap = polygonGap(furniturePolygon(a), furniturePolygon(b));
  const local = roomToLocal(a, b);
  switch (relationship.type) {
    case 'inFrontOf': {
      // b centred in front of a (full marks within the middle 40% of a's width), with a small gap.
      const lateral = ramp(Math.abs(local.x), a.width * 0.2, a.width / 2);
      const ahead = local.y > 0 ? 1 : 0;
      const spacing = ramp(gap, 50, 140);
      // Chairs face what they're in front of; tables run parallel to it.
      const orientation = b.kind === 'chair' || b.kind === 'armchair' ? facing(b, a) : ramp(angleDifference(a.rotation, b.rotation, 180), 3, 30);
      return lateral * ahead * spacing * orientation;
    }
    case 'faces':
      return facing(a, b) * ramp(gap, 450, 800);
    case 'beside': {
      const alongside = ramp(Math.abs(local.y), a.depth / 2, a.depth / 2 + b.depth);
      const sideways = Math.abs(local.x) > a.width / 2 ? 1 : 0;
      return alongside * sideways * ramp(gap, 15, 80);
    }
    case 'near': {
      const turned = b.kind === 'chair' ? 0.5 + 0.5 * facing(b, a) : 1;
      return ramp(gap, 60, 250) * turned;
    }
  }
}

/** Smallest difference between two angles, modulo `period` degrees. */
function angleDifference(a: number, b: number, period: number): number {
  const d = Math.abs(((a - b) % period) + period) % period;
  return Math.min(d, period - d);
}

/**
 * A conflict the optimizer must never create when it moves something: any collision
 * (with furniture, walls, columns, radiators), standing on stairs, or blocking a door.
 */
export function isHard(conflict: Conflict, project: Project): boolean {
  if (conflict.type === 'collision' || conflict.otherKind === 'stairs') return true;
  return conflict.otherKind === 'feature' && project.features.find((f) => f.id === conflict.otherId)?.kind === 'door';
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function score(project: Project, metrics: Metrics, context: LayoutContext, functionWeight = functionWeightFor(context.settings)): Scores {
  const c = metrics.circulation;
  const components: ScoreComponent[] = [];
  const add = (component: ScoreComponent) => components.push({ ...component, value: Math.max(0, Math.min(1, component.value)) });

  // --- Functional -------------------------------------------------------------
  const destinations = context.doorPoints.length - 1 + context.stairPoints.length;
  add({
    id: 'connectivity',
    label: 'Doors and stairs reachable',
    group: 'functional',
    weight: 3,
    value: c.connectivity,
    detail: destinations <= 0 ? 'Only one entrance, so nothing to connect' : `${destinations - c.unreachableDoors - c.unreachableStairs} of ${destinations} reachable from the main door`,
  });
  add({
    id: 'walkable',
    label: 'Walkable floor',
    group: 'functional',
    weight: 2,
    value: c.reachableFloor,
    detail: `${Math.round(c.reachableFloor * 100)}% of open floor can be walked to`,
  });
  add({
    id: 'narrow',
    label: 'No narrow squeezes',
    group: 'functional',
    weight: 1,
    value: 1 - Math.min(1, c.narrowShare * 4),
    detail: `${Math.round(c.narrowShare * 100)}% of open floor only reachable by squeezing`,
  });
  add({
    id: 'pockets',
    label: 'No cut-off corners',
    group: 'functional',
    weight: 1,
    value: 1 - Math.min(1, c.pocketShare * 4),
    detail: `${Math.round(c.pocketShare * 100)}% of open floor is cut off`,
  });
  if (metrics.usableTotal > 0) {
    add({
      id: 'usable',
      label: 'Furniture is usable',
      group: 'functional',
      weight: 2,
      value: metrics.usableCount / metrics.usableTotal,
      detail: `${metrics.usableCount} of ${metrics.usableTotal} pieces can be reached from their usable side`,
    });
  }
  const clearancePenalty = metrics.softConflicts.reduce((sum, conflict) => sum + softPenalty(conflict, project), 0);
  add({
    id: 'clearances',
    label: 'Vents, outlets and radiators clear',
    group: 'functional',
    weight: 2,
    value: 1 - clearancePenalty,
    detail: metrics.softConflicts.length === 0 ? 'Nothing blocked' : `${metrics.softConflicts.length} partly blocked`,
  });

  // --- Aesthetic (subjective) -------------------------------------------------
  const solids = project.furniture.filter(isSolid);
  if (solids.length > 0) {
    const wallAngles = context.walls.map((w) => w.angle);
    const alignment = solids.map((f) => ramp(Math.min(...wallAngles.map((a) => angleDifference(f.rotation, a, 90))), 1, 20));
    add({
      id: 'alignment',
      label: 'Lined up with the walls',
      group: 'aesthetic',
      weight: 2,
      value: mean(alignment),
      detail: `${alignment.filter((v) => v >= 0.99).length} of ${solids.length} pieces square to a wall`,
    });

    const awkward = solids.filter((f) => hasAwkwardGap(f, solids, context, project));
    add({
      id: 'spacing',
      label: 'Tidy spacing',
      group: 'aesthetic',
      weight: 1.5,
      value: 1 - awkward.length / solids.length,
      detail: awkward.length === 0 ? 'No awkward 3–25 cm gaps' : `${awkward.length} piece${awkward.length === 1 ? ' has' : 's have'} an awkward 3–25 cm gap`,
    });

    const totalArea = solids.reduce((s, f) => s + f.width * f.depth, 0);
    const centroid = { x: solids.reduce((s, f) => s + f.x * f.width * f.depth, 0) / totalArea, y: solids.reduce((s, f) => s + f.y * f.width * f.depth, 0) / totalArea };
    const offset = Math.hypot(centroid.x - context.roomCentre.x, centroid.y - context.roomCentre.y);
    add({
      id: 'balance',
      label: 'Visual balance',
      group: 'aesthetic',
      weight: 1,
      value: 1 - offset / (context.roomRadius * 0.6),
      detail: `Furniture's centre of mass is ${Math.round(offset)} cm from the room's centre`,
    });

    const wallStanding = solids.filter((f) => WALL_STANDING.includes(f.kind));
    if (wallStanding.length > 0) {
      const against = wallStanding.map((f) => {
        const { gap, parallel } = backToWall(f, context.walls);
        return ramp(gap, 5, 40) * ramp(parallel, 0.995, 0.9);
      });
      add({
        id: 'wallStanding',
        label: 'TVs, shelves, storage and beds against walls',
        group: 'aesthetic',
        weight: 2,
        value: mean(against),
        detail: `${against.filter((v) => v > 0.8).length} of ${wallStanding.length} with their back to a wall`,
      });
    }

    const seating = solids.filter((f) => SEATING.includes(f.kind));
    const focus = solids.find((f) => f.kind === 'television') ?? solids.find((f) => f.kind === 'coffeeTable');
    if (focus && seating.length > 0) {
      // Seats should face the focus — and a TV should face the seats.
      const seatCentre = { x: mean(seating.map((s) => s.x)), y: mean(seating.map((s) => s.y)) };
      const facings = [...seating.map((s) => facing(s, focus)), ...(focus.kind === 'television' ? [facing(focus, seatCentre)] : [])];
      add({
        id: 'orientation',
        label: 'Seating and TV face each other',
        group: 'aesthetic',
        weight: 1.5,
        value: mean(facings),
        detail: `${seating.filter((s) => facing(s, focus) > 0.8).length} of ${seating.length} seats face the ${focus.name}${focus.kind === 'television' ? (facing(focus, seatCentre) > 0.8 ? ', and it faces them' : ', but it doesn’t face them') : ''}`,
      });
      if (seating.length >= 2 && focus.kind === 'television') {
        const sides = seating.map((s) => Math.sign(roomToLocal(focus, s).x) * s.width * s.depth);
        const left = -sides.filter((v) => v < 0).reduce((a, b) => a + b, 0);
        const right = sides.filter((v) => v > 0).reduce((a, b) => a + b, 0);
        const centred = seating.filter((s) => Math.abs(roomToLocal(focus, s).x) < s.width / 4).reduce((a, s) => a + s.width * s.depth, 0);
        add({
          id: 'symmetry',
          label: 'Symmetry around the TV',
          group: 'aesthetic',
          weight: 1,
          value: 1 - Math.abs(left - right) / (left + right + centred || 1),
          detail: 'Seating area on each side of the TV’s centre line',
        });
      }
    }
  }

  // --- Preferences -------------------------------------------------------------
  const prefValues: number[] = [];
  for (const result of metrics.preferences.values()) if (result.value !== null) prefValues.push(result.value);
  for (const value of metrics.relationships.values()) prefValues.push(value);
  if (prefValues.length > 0) {
    add({
      id: 'preferences',
      label: 'Your preferences and relationships',
      group: 'preferences',
      weight: 1,
      value: mean(prefValues),
      detail: `${prefValues.filter((v) => v >= 0.8).length} of ${prefValues.length} fully met`,
    });
  }

  const groupScore = (group: ScoreComponent['group']) => {
    const parts = components.filter((p) => p.group === group);
    const weight = parts.reduce((s, p) => s + p.weight, 0);
    return weight === 0 ? null : (100 * parts.reduce((s, p) => s + p.value * p.weight, 0)) / weight;
  };
  const functional = groupScore('functional') ?? 0;
  const aesthetic = groupScore('aesthetic') ?? 100;
  const preferences = groupScore('preferences');
  const blend = functionWeight * functional + (1 - functionWeight) * aesthetic;
  const overall = preferences === null ? blend : 0.7 * blend + 0.3 * preferences;
  return { overall, functional, aesthetic, preferences, components };
}

/** How much a soft conflict costs, 0–1. Vents covered matter most. */
function softPenalty(conflict: Conflict, project: Project): number {
  if (conflict.otherKind !== 'feature') return 0;
  const kind = project.features.find((f) => f.id === conflict.otherId)?.kind;
  if (kind === 'vent') return conflict.type === 'obstruction' ? 0.4 * conflict.coverage + 0.15 : 0.15 * conflict.coverage + 0.05;
  if (kind === 'outlet' || kind === 'switch') return 0.12;
  if (kind === 'radiator') return 0.2 * conflict.coverage + 0.05;
  return 0.1 * conflict.coverage;
}

/** A gap of 3–25 cm to a wall or an unrelated piece looks accidental: neither flush nor clear. */
function hasAwkwardGap(item: Furniture, solids: Furniture[], context: LayoutContext, project: Project): boolean {
  const poly = furniturePolygon(item);
  const nearestWall = Math.min(...poly.map((p) => Math.min(...context.walls.filter((w) => w.chain === 'outline').map((w) => projectOntoSegment(p, w.start, w.end).distance))));
  if (nearestWall > 3 && nearestWall < 25) return true;
  const related = new Set(project.relationships.filter((r) => r.a === item.id || r.b === item.id).flatMap((r) => [r.a, r.b]));
  return solids.some((other) => {
    if (other.id === item.id || related.has(other.id)) return false;
    const gap = polygonGap(poly, furniturePolygon(other));
    return gap > 3 && gap < 25;
  });
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

