import { isSolid } from '../model/conflicts';
import { featureFrame, toRoom as featureToRoom } from '../model/features';
import type { Furniture, Point, Project, Relationship, RoomFeature, RoomPurpose } from '../model/types';
import { wallSegments } from '../model/walls';
import type { CirculationResult } from './circulation';
import { bedSideClearances, directionToRoom, frontClearance, occupantOf, partnersOf, toRoom, type Obstacles } from './practical';

/**
 * Feng Shui / Harmony: an optional, interpretive design philosophy.
 *
 * These scores express traditional arrangement principles — commanding position, a clear
 * entrance, balanced and conversational seating, open circulation — as measurable
 * geometry. They are preference scores, not measurements of luck, health or fortune, and
 * they never override the hard rules (doors, stairs, collisions, staying in the room).
 *
 * "Flow" uses the walking-space analysis as a practical stand-in for the openness some
 * Feng Shui approaches emphasise; nothing here measures an "energy".
 */

export interface CommandingResult {
  itemId: string;
  /** 0–1: the entrance is within the occupant's view. */
  seesEntrance: number;
  /** 0–1: the occupant is out of the doorway's direct line (1 = clear of it). */
  outOfDoorLine: number;
  /** 0–1: a solid wall supports the occupant's back (beds: the headboard). */
  support: number;
  /** Angle between where the occupant looks and the entrance, degrees. */
  angleToEntrance: number;
}

export interface FengShuiComponent {
  id: string;
  label: string;
  value: number;
  weight: number;
  detail: string;
}

export interface FengShuiResult {
  /** 0–100 interpretive preference score. */
  score: number;
  components: FengShuiComponent[];
  commanding: CommandingResult[];
}

/** The main entrance: the chosen door, or the first door. */
export function mainEntrance(project: Project): RoomFeature | null {
  const doors = project.features.filter((f) => f.kind === 'door');
  return doors.find((d) => d.id === project.fengShui?.entranceId) ?? doors[0] ?? null;
}

const ramp = (value: number, good: number, bad: number) =>
  good < bad ? (value <= good ? 1 : value >= bad ? 0 : (bad - value) / (bad - good)) : value >= good ? 1 : value <= bad ? 0 : (value - bad) / (good - bad);
const mean = (v: number[]) => (v.length === 0 ? 1 : v.reduce((a, b) => a + b, 0) / v.length);

/** Pieces whose position matters most: beds, desks and the main seating. */
function principalPieces(project: Project, purpose: RoomPurpose): Furniture[] {
  const solids = project.furniture.filter(isSolid);
  const beds = solids.filter((f) => f.kind === 'bed');
  const desks = solids.filter((f) => f.kind === 'desk');
  const sofa = solids.filter((f) => f.kind === 'sofa').sort((a, b) => b.width * b.depth - a.width * a.depth)[0];
  switch (purpose) {
    case 'bedroom':
      return beds;
    case 'office':
      return desks;
    case 'living':
      return sofa ? [sofa] : solids.filter((f) => f.kind === 'armchair').slice(0, 1);
    default:
      return [...beds, ...desks, ...(sofa ? [sofa] : [])];
  }
}

/** How well a piece holds the "commanding position" relative to the entrance. */
export function commandingPosition(item: Furniture, project: Project, door: RoomFeature): CommandingResult {
  const occupant = occupantOf(item)!;
  const at = toRoom(item, occupant.at);
  const look = directionToRoom(item, occupant.facing);
  const frame = featureFrame(door, project.room);
  const doorPoint = featureToRoom(frame, { x: 0, y: 0 });
  const toDoor = { x: doorPoint.x - at.x, y: doorPoint.y - at.y };
  const distance = Math.hypot(toDoor.x, toDoor.y) || 1;
  const angle = (Math.acos(Math.max(-1, Math.min(1, (look.x * toDoor.x + look.y * toDoor.y) / distance))) * 180) / Math.PI;

  // The doorway's straight-ahead line into the room: the occupant shouldn't sit in it.
  const rad = (frame.angle * Math.PI) / 180;
  const into = { x: -Math.sin(rad), y: Math.cos(rad) };
  const across = { x: Math.cos(rad), y: Math.sin(rad) };
  const rel = { x: at.x - doorPoint.x, y: at.y - doorPoint.y };
  const ahead = rel.x * into.x + rel.y * into.y;
  const sideways = Math.abs(rel.x * across.x + rel.y * across.y);
  const inLine = ahead > 0 && sideways < door.width / 2 + 30;

  // Support: something solid close behind the occupant (a wall, or a headboard against one).
  const behind = { x: -look.x, y: -look.y };
  const back = item.kind === 'bed' ? toRoom(item, { x: 0, y: -item.depth / 2 }) : at;
  const backGap = rayToWalls(project, back, behind);
  const windowBehind = item.kind === 'bed' && windowNear(project, back, item.width / 2 + 10);
  const support = ramp(backGap, item.kind === 'bed' ? 10 : 90, item.kind === 'bed' ? 60 : 250) * (windowBehind ? 0.5 : 1);

  return {
    itemId: item.id,
    seesEntrance: ramp(angle, 80, 135),
    outOfDoorLine: inLine ? ramp(ahead, 400, 0) * 0.3 : 1,
    support,
    angleToEntrance: angle,
  };
}

function rayToWalls(project: Project, from: Point, dir: Point): number {
  let best = Infinity;
  for (const w of wallSegments(project.room)) {
    const ex = w.end.x - w.start.x;
    const ey = w.end.y - w.start.y;
    const den = dir.x * ey - dir.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((w.start.x - from.x) * ey - (w.start.y - from.y) * ex) / den;
    const u = ((w.start.x - from.x) * dir.y - (w.start.y - from.y) * dir.x) / den;
    if (t >= -1 && u >= 0 && u <= 1) best = Math.min(best, Math.max(0, t));
  }
  return best;
}

function windowNear(project: Project, p: Point, reach: number): boolean {
  return project.features.some((f) => f.kind === 'window' && Math.hypot(featureFrame(f, project.room).x - p.x, featureFrame(f, project.room).y - p.y) < reach + f.width / 2);
}

/**
 * Feng Shui preference score for a layout. `relationships` should include assumed pairings
 * (bedside tables, desk chairs) so partners aren't mistaken for obstructions.
 */
export function scoreFengShui(project: Project, purpose: RoomPurpose, circulation: CirculationResult, relationships: Relationship[], obstacles: Obstacles): FengShuiResult {
  const door = mainEntrance(project);
  const components: FengShuiComponent[] = [];
  const commanding: CommandingResult[] = [];
  const solids = project.furniture.filter(isSolid);

  if (door) {
    for (const item of principalPieces(project, purpose)) commanding.push(commandingPosition(item, project, door));
    if (commanding.length > 0) {
      const name = (id: string) => project.furniture.find((f) => f.id === id)?.name ?? 'piece';
      const sees = commanding.filter((c) => c.seesEntrance >= 0.8).length;
      components.push({
        id: 'commanding',
        label: 'Commanding position',
        weight: 3,
        value: mean(commanding.map((c) => 0.45 * c.seesEntrance + 0.3 * c.outOfDoorLine + 0.25 * c.support)),
        detail: `${sees} of ${commanding.length} (${commanding.map((c) => name(c.itemId)).join(', ')}) can see the entrance${commanding.some((c) => c.outOfDoorLine < 1) ? '; one sits in line with the doorway' : ''}`,
      });
    }

    // A clear, welcoming entrance: nothing crowding the first metre inside the door.
    const frame = featureFrame(door, project.room);
    const inside = featureToRoom(frame, { x: 0, y: 60 });
    const nearest = Math.min(Infinity, ...solids.map((f) => Math.hypot(f.x - inside.x, f.y - inside.y) - Math.max(f.width, f.depth) / 2));
    components.push({
      id: 'entry',
      label: 'Open entrance',
      weight: 1.5,
      value: ramp(nearest, 100, 20),
      detail: Number.isFinite(nearest) ? `Nearest piece about ${Math.max(0, Math.round(nearest))} cm from the space inside the door` : 'Nothing near the entrance',
    });
  }

  if (purpose === 'bedroom' || purpose === 'studio') {
    for (const bed of solids.filter((f) => f.kind === 'bed' && f.width >= 120)) {
      const [l, r] = bedSideClearances(bed, obstacles, partnersOf(bed, relationships));
      const sides = relationships.filter((rel) => rel.a === bed.id && rel.type === 'beside').map((rel) => project.furniture.find((f) => f.id === rel.b)).filter((f): f is Furniture => !!f);
      const leftSide = sides.some((s) => toLocalX(bed, s) < 0);
      const rightSide = sides.some((s) => toLocalX(bed, s) > 0);
      components.push({
        id: 'bedBalance',
        label: 'Balanced bed',
        weight: 2,
        value: 0.6 * Math.min(ramp(l, 60, 20), ramp(r, 60, 20)) + 0.4 * (sides.length === 0 ? 1 : leftSide && rightSide ? 1 : 0.4),
        detail: `${Math.round(Math.min(l, r))} cm on the narrower side${sides.length > 1 ? (leftSide && rightSide ? ', bedside tables on both sides' : ', bedside tables on one side') : ''}`,
      });
    }
  }

  if (purpose === 'office' || purpose === 'studio') {
    for (const desk of solids.filter((f) => f.kind === 'desk')) {
      const clear = frontClearance(desk, obstacles, partnersOf(desk, relationships));
      components.push({ id: 'workspace', label: 'Uncramped workspace', weight: 1.5, value: ramp(clear, 110, 60), detail: `${Math.round(Math.min(clear, 999))} cm free behind the seated person` });
    }
  }

  if (purpose === 'living' || purpose === 'studio' || purpose === 'multipurpose') {
    const seats = solids.filter((f) => f.kind === 'sofa' || f.kind === 'armchair');
    if (seats.length >= 2) {
      const centre = { x: mean(seats.map((s) => s.x)), y: mean(seats.map((s) => s.y)) };
      const facingIn = seats.map((s) => {
        const f = directionToRoom(s, { x: 0, y: 1 });
        const d = { x: centre.x - s.x, y: centre.y - s.y };
        const len = Math.hypot(d.x, d.y) || 1;
        return ramp((Math.acos(Math.max(-1, Math.min(1, (f.x * d.x + f.y * d.y) / len))) * 180) / Math.PI, 50, 110);
      });
      const spread = Math.max(...seats.map((s) => Math.hypot(s.x - centre.x, s.y - centre.y)));
      components.push({
        id: 'conversation',
        label: 'Conversational seating',
        weight: 2,
        value: mean(facingIn) * ramp(spread, 200, 380),
        detail: `${facingIn.filter((v) => v >= 0.8).length} of ${seats.length} seats turned towards each other`,
      });
    }
  }

  components.push({
    id: 'flow',
    label: 'Open circulation (flow)',
    weight: 2,
    value: 0.5 * circulation.reachableFloor + 0.5 * ramp(circulation.detour, 1.1, 1.8),
    detail: `${Math.round(circulation.reachableFloor * 100)}% of open floor reachable; walks ${Math.round((circulation.detour - 1) * 100)}% longer than in an empty room`,
  });

  const weight = components.reduce((s, c) => s + c.weight, 0);
  const score = (100 * components.reduce((s, c) => s + Math.max(0, Math.min(1, c.value)) * c.weight, 0)) / weight;
  return { score, components, commanding };
}

function toLocalX(item: Furniture, p: Point): number {
  const r = (item.rotation * Math.PI) / 180;
  return (p.x - item.x) * Math.cos(r) + (p.y - item.y) * Math.sin(r);
}

