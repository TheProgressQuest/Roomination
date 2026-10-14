import { isSolid } from '../model/conflicts';
import { doorLeaves, featureFrame, toRoom, type Frame } from '../model/features';
import { boundingBox, pointInPolygon, polygonArea, signedArea2, type Box, type Polygon } from '../model/polygon';
import { layoutStair, stairToRoom, totalSteps } from '../model/stairs';
import { localFootprint, type Ring } from '../model/shape';
import type { FloorStyle, Furniture, MaterialKind, Point, Project, RoomFeature, Staircase, SurfaceFinish } from '../model/types';
import { wallBodies, wallDirection, wallOutward } from '../model/wallGeometry';
import { outlinePolygon, wallSegments, type WallSegment } from '../model/walls';
import { shade } from '../render/palette';
import { bodySurface, furnitureParts, visualOf, type FurniturePart } from '../render/furnitureParts';
import type { SurfaceKind } from '../render/materials';

/**
 * The 3D view's description of a project: plain data in room centimetres, derived only
 * from the project and the same geometry functions the 2D plan uses. There is no
 * separate 3D state — the viewer rebuilds from this whenever the project changes.
 *
 * Plan x/y stay as they are; `z` is height above the floor. (The Three.js layer converts
 * to metres with `toScene`.) Rotations are clockwise degrees, as on the plan.
 */

/** Scene units are metres; the project is in centimetres. */
export const CM_PER_SCENE_UNIT = 100;

/**
 * The one place plan coordinates become 3D coordinates: plan x → x, plan y → z (so the
 * plan's "down the page" points towards the default camera), height → y (up).
 */
export function toScene(p: Point, height = 0): { x: number; y: number; z: number } {
  return { x: p.x / CM_PER_SCENE_UNIT, y: height / CM_PER_SCENE_UNIT, z: p.y / CM_PER_SCENE_UNIT };
}

/** A box: centre on the plan, bottom height, size along its own rotated axes. */
export interface Block {
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotation: number;
  color: string;
}

export interface Cylinder {
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
  color: string;
}

export interface Shapes {
  blocks: Block[];
  cylinders: Cylinder[];
}

/** An opening through a wall: `start`–`end` along the wall (cm from its start), `bottom`–`top` in height. */
export interface WallHole {
  start: number;
  end: number;
  bottom: number;
  top: number;
}

export type OpeningMaterial = 'frame' | 'door' | 'glass';

/** One wall and everything set into it, so the whole lot can be hidden together. */
export interface SceneWall {
  wallId: string;
  /** True for the room's boundary walls (which the dollhouse view may hide). */
  outer: boolean;
  /** Unit vector pointing out of the room (outer walls). */
  outward: Point;
  /** Middle of the wall on the plan, for deciding which walls face the camera. */
  centre: Point;
  /**
   * The whole wall's plan outline, ignoring openings: [face A start, face A end, face B end,
   * face B start]. Face A is the room side of an outer wall. Corners are mitered.
   */
  footprint: Polygon;
  /** Start of the wall line and its unit direction: positions along the wall are measured from here. */
  origin: Point;
  direction: Point;
  height: number;
  /** Door and window openings cut right through the wall. */
  holes: WallHole[];
  openings: { material: OpeningMaterial; block: Block }[];
  fixtures: Block[];
}

/** A furniture part with its colour and surface worked out. */
export interface ScenePart extends FurniturePart {
  color: string;
  surface: SurfaceKind;
}

export interface SceneFurniture {
  id: string;
  name: string;
  /** Plan footprint, for highlighting. */
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
  rotation: number;
  /**
   * The piece's parts in its own frame (see render/furnitureParts), colours and surfaces
   * resolved. Drawn and photo-textured pieces have only supporting parts (a table's pedestal).
   */
  parts: ScenePart[];
  /**
   * Drawn outlines and photo-textured pieces: the footprint (local cm, the same outline the
   * plan and collision checks use), extruded from `bottom` to `height`.
   */
  extruded?: { rings: Ring[]; bottom: number; height: number; color: string };
  /** What the piece's own surfaces are made of: the person's choice, or its kind's default. */
  material: MaterialKind;
  finish: SurfaceFinish;
  /** Photo textures by surface (asset ids). */
  textures: { top?: string; front?: string; side?: string };
}

export interface SceneStair {
  id: string;
  steps: Block[];
  landings: Block[];
}

/** Where a staircase going down cuts through the floor, and how deep the stairwell is (cm). */
export interface FloorHole {
  points: Polygon;
  depth: number;
}

/** Everything in the room except furniture (which changes far more often, so it's built separately). */
export interface RoomModel {
  /** Room outline (inner face of the walls). */
  floor: Polygon;
  floorHoles: FloorHole[];
  floorStyle: FloorStyle;
  ceilingHeight: number;
  wallColor: string;
  walls: SceneWall[];
  stairs: SceneStair[];
  /** Free-standing fixtures: on the floor (columns, floor vents) and on the ceiling (lights, ceiling vents). */
  fixtures: { floor: Shapes; ceiling: Shapes };
  /** Everything's plan extent, walls included, for framing the camera. */
  bounds: Box;
}

export interface SceneModel extends RoomModel {
  furniture: SceneFurniture[];
}

/** Used when a door or window is missing a usable height (older or hand-edited files). */
export const DEFAULT_DOOR_HEIGHT = 205;
export const DEFAULT_WINDOW_HEIGHT = 120;
export const DEFAULT_WINDOW_SILL = 90;

const FRAME_COLOR = '#f7f4ee';
const DOOR_COLOR = '#c9a77c';
const GLASS_COLOR = '#bcd7e6';
const FIXTURE_COLOR = '#e7e3dc';
const STAIR_COLOR = '#b98a5c';
const LANDING_COLOR = '#a87b50';
/** Frame and door-leaf thicknesses, in cm. */
const FRAME = 5;
const LEAF = 4;
/** How far hinged doors are shown open (a fraction of fully open). */
const DOOR_AJAR = 0.3;
/** How far the floor hole is drawn inside a "down" staircase's footprint, so floor edges don't flicker. */
const HOLE_INSET = 0.5;

/** Only these parts of a project appear in 3D; anything else changing never triggers a rebuild. */
export type SceneSource = Pick<Project, 'room' | 'furniture' | 'features' | 'stairs'>;

export function buildSceneModel(project: SceneSource): SceneModel {
  return { ...buildRoomModel(project), furniture: buildFurniture(project.furniture) };
}

export function buildFurniture(furniture: Furniture[]): SceneFurniture[] {
  return furniture.map(furnitureBlocks);
}

export function buildRoomModel(project: Pick<Project, 'room' | 'features' | 'stairs'>): RoomModel {
  const { room } = project;
  const ceilingHeight = room.height;
  const segments = wallSegments(room);
  const featuresByWall = new Map<string, RoomFeature[]>();
  const freeFeatures: RoomFeature[] = [];
  for (const feature of project.features) {
    if (feature.placement.type === 'wall') {
      const list = featuresByWall.get(feature.placement.wallId) ?? [];
      list.push(feature);
      featuresByWall.set(feature.placement.wallId, list);
    } else {
      freeFeatures.push(feature);
    }
  }

  // Each wall's full outline, without openings (those become holes in the 3D wall).
  const bodies = wallBodies(room, []);
  const walls: SceneWall[] = segments.map((segment) => {
    const outer = segment.chain === 'outline';
    const d = wallDirection(segment);
    const wall: SceneWall = {
      wallId: segment.id,
      outer,
      outward: wallOutward(segment),
      centre: { x: (segment.start.x + segment.end.x) / 2, y: (segment.start.y + segment.end.y) / 2 },
      footprint: bodies.find((b) => b.wallId === segment.id)!.polygon,
      origin: segment.start,
      direction: d,
      height: ceilingHeight,
      holes: [],
      openings: [],
      fixtures: [],
    };
    for (const feature of featuresByWall.get(segment.id) ?? []) addWallFeature(wall, segment, feature, room, ceilingHeight);
    return wall;
  });

  const stairs = project.stairs.map(stairBlocks);
  const floorHoles = project.stairs
    .filter((s) => s.direction === 'down')
    .flatMap((stair) => stairHole(stair).map((points) => ({ points, depth: stair.rise })));

  const outline = outlinePolygon(room);
  const allPoints = [...outline, ...bodies.flatMap((b) => b.polygon)];
  return {
    floor: outline,
    floorHoles,
    floorStyle: room.floor,
    ceilingHeight,
    wallColor: room.wallColor,
    walls,
    stairs,
    fixtures: freeFixtures(freeFeatures, ceilingHeight),
    bounds: boundingBox(allPoints),
  };
}

// ---------------------------------------------------------------------------
// Walls, doors and windows
// ---------------------------------------------------------------------------

/** The wall's two faces in a wall feature's local frame (local y points into the room). */
function wallFaces(segment: WallSegment): { inner: number; outer: number } {
  return segment.chain === 'outline' ? { inner: 0, outer: -segment.thickness } : { inner: segment.thickness / 2, outer: -segment.thickness / 2 };
}

/** A block given by its extents in a feature's local frame. */
function localBlock(frame: Frame, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string, extraAngle = 0): Block {
  const centre = toRoom(frame, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
  return { ...centre, z: z0, width: x1 - x0, depth: y1 - y0, height: z1 - z0, rotation: frame.angle + extraAngle, color };
}

export function openingHeights(feature: RoomFeature, ceilingHeight: number): { bottom: number; top: number } {
  if (feature.kind === 'door') {
    const height = feature.height > 0 ? feature.height : DEFAULT_DOOR_HEIGHT;
    return { bottom: 0, top: Math.min(height, ceilingHeight) };
  }
  const usable = feature.height > 0;
  const bottom = Math.min(usable ? feature.elevation : DEFAULT_WINDOW_SILL, ceilingHeight);
  const height = usable ? feature.height : DEFAULT_WINDOW_HEIGHT;
  return { bottom, top: Math.min(bottom + height, ceilingHeight) };
}

/** True if the wall is solid at plan point `p` and height `z` (false inside openings). */
export function wallSolidAt(wall: SceneWall, p: Point, z: number): boolean {
  if (z <= 0 || z >= wall.height || !pointInPolygon(p, wall.footprint)) return false;
  const s = (p.x - wall.origin.x) * wall.direction.x + (p.y - wall.origin.y) * wall.direction.y;
  return !wall.holes.some((h) => s > h.start && s < h.end && z > h.bottom && z < h.top);
}

function addWallFeature(wall: SceneWall, segment: WallSegment, feature: RoomFeature, room: Project['room'], ceilingHeight: number) {
  const frame = featureFrame(feature, room);
  const faces = wallFaces(segment);
  const half = feature.width / 2;
  if (feature.kind === 'door' || feature.kind === 'window') {
    const { bottom, top } = openingHeights(feature, ceilingHeight);
    const offset = feature.placement.type === 'wall' ? feature.placement.offset : 0;
    wall.holes.push({ start: offset - half, end: offset + half, bottom, top });
    const add = (material: OpeningMaterial, block: Block) => wall.openings.push({ material, block });
    const f = Math.min(FRAME, feature.width / 6, (top - bottom) / 6);
    const frameBlock = (x0: number, x1: number, z0: number, z1: number) => localBlock(frame, x0, x1, faces.outer - 0.5, faces.inner + 0.5, z0, z1, FRAME_COLOR);
    add('frame', frameBlock(-half, -half + f, bottom, top));
    add('frame', frameBlock(half - f, half, bottom, top));
    add('frame', frameBlock(-half + f, half - f, top - f, top));
    if (feature.kind === 'window') {
      add('frame', frameBlock(-half + f, half - f, bottom, bottom + f));
      const mid = (faces.inner + faces.outer) / 2;
      add('glass', localBlock(frame, -half + f, half - f, mid - 0.5, mid + 0.5, bottom + f, top - f, GLASS_COLOR));
    } else {
      doorPanels(feature, frame, faces, f, top - f).forEach((block) => add('door', block));
    }
    return;
  }
  // Things mounted on the wall's room side: outlets, switches, radiators, wall vents.
  const depth = Math.max(feature.depth, 1);
  const height = Math.max(feature.height, 1);
  wall.fixtures.push(localBlock(frame, -half, half, faces.inner, faces.inner + depth, feature.elevation, feature.elevation + height, FIXTURE_COLOR));
}

/** Door leaves: hinged leaves shown a little open on their swing side; sliding panels in the wall. */
function doorPanels(door: RoomFeature, frame: Frame, faces: { inner: number; outer: number }, f: number, top: number): Block[] {
  const half = door.width / 2 - f;
  if (door.doorType === 'sliding') {
    const panel = half + 2;
    const mid = (faces.inner + faces.outer) / 2;
    // One panel fixed on the right, the other slid part-way across, so the door reads as sliding.
    return [
      localBlock(frame, half - panel, half, mid - LEAF / 2 - 0.5, mid - 0.5, 0, top, DOOR_COLOR),
      localBlock(frame, -half + door.width * 0.25, -half + door.width * 0.25 + panel, mid + 0.5, mid + LEAF / 2 + 0.5, 0, top, DOOR_COLOR),
    ];
  }
  // Inward doors hang on the room-side face; outward ones on the outside face.
  const hingeY = door.swing === 'out' ? faces.outer : faces.inner;
  return doorLeaves({ ...door, width: half * 2 }).map((leaf) => {
    const angle = leaf.closedDeg + (leaf.openDeg - leaf.closedDeg) * DOOR_AJAR;
    const rad = (angle * Math.PI) / 180;
    const hinge = { x: leaf.hinge.x, y: hingeY };
    const centre = { x: hinge.x + (Math.cos(rad) * leaf.radius) / 2, y: hinge.y + (Math.sin(rad) * leaf.radius) / 2 };
    const room = toRoom(frame, centre);
    return { ...room, z: 0, width: leaf.radius, depth: LEAF, height: top, rotation: frame.angle + angle, color: DOOR_COLOR };
  });
}

// ---------------------------------------------------------------------------
// Free-standing features
// ---------------------------------------------------------------------------

function freeFixtures(features: RoomFeature[], ceilingHeight: number): SceneModel['fixtures'] {
  const floor: Shapes = { blocks: [], cylinders: [] };
  const ceiling: Shapes = { blocks: [], cylinders: [] };
  for (const feature of features) {
    if (feature.placement.type !== 'free') continue;
    const { x, y, rotation } = feature.placement;
    const radius = feature.width / 2;
    switch (feature.kind) {
      case 'column': {
        const height = Math.max(1, Math.min(feature.height, ceilingHeight - feature.elevation));
        if (feature.shape === 'round') floor.cylinders.push({ x, y, z: feature.elevation, radius, height, color: FIXTURE_COLOR });
        else floor.blocks.push({ x, y, z: feature.elevation, width: feature.width, depth: feature.depth, height, rotation, color: FIXTURE_COLOR });
        break;
      }
      case 'vent': {
        // Floor vents sit just above the floor and ceiling vents just below the ceiling.
        const onCeiling = feature.ventMount === 'ceiling';
        (onCeiling ? ceiling : floor).blocks.push({ x, y, z: onCeiling ? ceilingHeight - 1 : 0, width: feature.width, depth: feature.depth, height: 1, rotation, color: '#9a958d' });
        break;
      }
      case 'light': {
        const flat = feature.lightType === 'flush' || feature.lightType === 'recessed';
        const height = flat ? Math.min(6, feature.height) : Math.max(2, feature.height);
        const z = flat ? ceilingHeight - height : Math.min(feature.elevation, ceilingHeight - height);
        ceiling.cylinders.push({ x, y, z, radius, height, color: '#f6e7b8' });
        // A thin cord up to the ceiling for hanging lights.
        if (!flat && z + height < ceilingHeight) ceiling.cylinders.push({ x, y, z: z + height, radius: 0.6, height: ceilingHeight - z - height, color: '#77726b' });
        break;
      }
      default:
        floor.blocks.push({ x, y, z: feature.elevation, width: feature.width, depth: Math.max(feature.depth, 1), height: Math.max(feature.height, 1), rotation, color: FIXTURE_COLOR });
    }
  }
  return { floor, ceiling };
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

function furnitureBlocks(item: Furniture): SceneFurniture {
  const surface = bodySurface(item);
  const resolve = (part: FurniturePart): ScenePart => ({
    ...part,
    color: part.color ?? (part.shade ? shade(item.color, part.shade) : item.color),
    surface: part.surface === 'body' ? surface : part.surface,
  });
  const height = isSolid(item) ? item.height : Math.min(item.height, 1.5);
  const textures = item.appearance?.textures ?? {};
  const base = {
    id: item.id,
    name: item.name,
    x: item.x,
    y: item.y,
    width: item.width,
    depth: item.depth,
    height,
    rotation: item.rotation,
    material: surface,
    finish: item.appearance?.finish ?? 'satin',
    textures,
  };
  // Drawn shapes keep their true outline; photo textures need real surfaces to sit on, so a
  // textured rectangle is extruded too (its outline is simply the rectangle).
  // Component-built pieces are drawn from their components (their footprint still collides).
  const extrude = !item.components?.length && (item.shape !== undefined || Object.keys(textures).length > 0);
  if (!extrude) return { ...base, parts: furnitureParts(item).map(resolve) };
  const { rings, parts: convex } = localFootprint(item);
  const visual = visualOf(item);
  if (Object.keys(textures).length === 0 && ['table', 'coffeeTable', 'diningTable', 'desk'].includes(visual) && height > 20) {
    // A drawn table: its real outline as the top, on a pedestal set well inside the shape.
    const top = Math.min(5, Math.max(2.5, height * 0.055));
    const biggest = convex.reduce((best, p) => (polygonArea(p) > polygonArea(best) ? p : best), convex[0]);
    const centre = { x: biggest.reduce((sum, p) => sum + p.x, 0) / biggest.length, y: biggest.reduce((sum, p) => sum + p.y, 0) / biggest.length };
    const room = rings.reduce((min, r) => Math.min(min, distanceToEdges(centre, r.outer), ...r.holes.map((h) => distanceToEdges(centre, h))), Infinity);
    const stem = Math.max(2, Math.min(7, room * 0.25));
    const foot = Math.max(stem * 1.5, Math.min(room * 0.8, 30));
    const cyl = (r: number, z0: number, z1: number, role: FurniturePart['role']): FurniturePart => ({ x: centre.x, y: centre.y, z: z0, width: r * 2, depth: r * 2, height: z1 - z0, shape: 'cylinder', role, surface: 'body', shade: -0.12 });
    return {
      ...base,
      parts: [cyl(foot, 0, 2.5, 'base'), cyl(stem, 2.5, height - top, 'leg')].map(resolve),
      extruded: { rings, bottom: height - top, height, color: item.color },
    };
  }
  return { ...base, parts: [], extruded: { rings, bottom: 0, height, color: item.color } };
}

/** Shortest distance from a point to an outline's edges. */
function distanceToEdges(p: Point, poly: Polygon): number {
  let best = Infinity;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  });
  return best;
}

// ---------------------------------------------------------------------------
// Stairs
// ---------------------------------------------------------------------------

function stairBlocks(stair: Staircase): SceneStair {
  const layout = layoutStair(stair.sections);
  const steps = Math.max(1, totalSteps(stair));
  const riser = stair.rise / steps;
  const sign = stair.direction === 'down' ? -1 : 1;
  const bottomLevel = sign < 0 ? -stair.rise : 0;
  const block = (corners: Point[], level: number, color: string): Block | null => {
    // Up: a solid block from the floor to the tread. Down: from the lower floor up to the tread.
    const z0 = sign > 0 ? 0 : bottomLevel;
    if (level - z0 < 0.01) return null;
    const [a, b, , d] = corners;
    const centre = stairToRoom(stair, { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 });
    const along = { x: b.x - a.x, y: b.y - a.y };
    const angle = (Math.atan2(along.y, along.x) * 180) / Math.PI + stair.rotation;
    return { ...centre, z: z0, width: Math.hypot(along.x, along.y), depth: Math.hypot(d.x - a.x, d.y - a.y), height: level - z0, rotation: angle, color };
  };

  const result: SceneStair = { id: stair.id, steps: [], landings: [] };
  let climbed = 0;
  for (const laid of layout.sections) {
    const { section, corners, heading } = laid;
    if (section.kind === 'landing') {
      const landing = block(corners, sign * climbed * riser, LANDING_COLOR);
      if (landing) result.landings.push(landing);
      continue;
    }
    const count = Math.max(1, section.steps);
    const tread = section.length / count;
    for (let k = 0; k < count; k++) {
      // Each tread is a slice of the flight's rectangle along the direction of travel.
      const from = { x: heading.x * tread * k, y: heading.y * tread * k };
      const to = { x: heading.x * tread * (k + 1), y: heading.y * tread * (k + 1) };
      const slice = [
        add(corners[0], from),
        add(corners[0], to),
        add(corners[3], to),
        add(corners[3], from),
      ];
      const step = block(slice, sign * (climbed + k + 1) * riser, STAIR_COLOR);
      if (step) result.steps.push(step);
    }
    climbed += section.steps;
  }
  return result;
}

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });

/**
 * Where a "down" staircase cuts through the floor: the outline of its footprint
 * (sections merged into one shape), very slightly inset.
 */
function stairHole(stair: Staircase): Polygon[] {
  const sections = layoutStair(stair.sections).sections.map((s) => s.corners);
  return rectilinearOutlines(sections).map((loop) => insetLoop(loop, HOLE_INSET).map((p) => stairToRoom(stair, p)));
}

/**
 * Outer outlines of a union of axis-aligned rectangles (stair sections only ever turn by
 * 90°, so in the staircase's own frame every section is axis-aligned).
 */
export function rectilinearOutlines(rects: Polygon[]): Polygon[] {
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const xs = [...new Set(rects.flatMap((r) => r.map((p) => round(p.x))))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => r.map((p) => round(p.y))))].sort((a, b) => a - b);
  const boxes = rects.map(boundingBox);
  const filled = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= ys.length - 1) return false;
    const cx = (xs[i] + xs[i + 1]) / 2;
    const cy = (ys[j] + ys[j + 1]) / 2;
    return boxes.some((b) => cx > b.minX && cx < b.maxX && cy > b.minY && cy < b.maxY);
  };
  // Directed boundary edges with the filled cell on their right (clockwise on screen).
  const edges = new Map<string, Point>();
  const key = (p: Point) => `${p.x},${p.y}`;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      if (!filled(i, j)) continue;
      const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[j], ys[j + 1]];
      if (!filled(i, j - 1)) edges.set(key({ x: x0, y: y0 }), { x: x1, y: y0 });
      if (!filled(i + 1, j)) edges.set(key({ x: x1, y: y0 }), { x: x1, y: y1 });
      if (!filled(i, j + 1)) edges.set(key({ x: x1, y: y1 }), { x: x0, y: y1 });
      if (!filled(i - 1, j)) edges.set(key({ x: x0, y: y1 }), { x: x0, y: y0 });
    }
  }
  const loops: Polygon[] = [];
  while (edges.size > 0) {
    const [startKey, first] = edges.entries().next().value!;
    edges.delete(startKey);
    const [sx, sy] = startKey.split(',').map(Number);
    const loop: Polygon = [{ x: sx, y: sy }];
    let current = first;
    while (key(current) !== startKey) {
      loop.push(current);
      const next = edges.get(key(current));
      if (!next) break;
      edges.delete(key(current));
      current = next;
    }
    loops.push(removeCollinear(loop));
  }
  // Only outer outlines (clockwise on screen ⇒ positive signed area in y-down coordinates).
  return loops.filter((l) => l.length >= 3 && signedArea2(l) > 0);
}

function removeCollinear(loop: Polygon): Polygon {
  return loop.filter((p, i) => {
    const a = loop[(i - 1 + loop.length) % loop.length];
    const b = loop[(i + 1) % loop.length];
    return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > 1e-9;
  });
}

/** Moves each edge of a rectilinear loop inward by `d` (loops are clockwise on screen). */
function insetLoop(loop: Polygon, d: number): Polygon {
  const n = loop.length;
  return loop.map((p, i) => {
    const prev = loop[(i - 1 + n) % n];
    const next = loop[(i + 1) % n];
    // Inward normal of a clockwise (y-down) edge is to its right: (-dy, dx).
    const n1 = unitRight(prev, p);
    const n2 = unitRight(p, next);
    return { x: p.x + (n1.x + n2.x) * d, y: p.y + (n1.y + n2.y) * d };
  });
}

function unitRight(a: Point, b: Point): Point {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}
