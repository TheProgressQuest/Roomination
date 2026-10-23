import { allowedPlacement, clampFeatureToRoom, convertPlacement, findOverlappingOpening } from '../model/features';
import { normalizeRotation } from '../model/geometry';
import { clampFurnitureToRoom, clampStairToRoom } from '../model/placement';
import { DEFAULT_OPTIMIZER, FURNITURE_KIND_LABELS, PREFERENCE_LABELS, guessKind } from '../model/furnitureKinds';
import { DEFAULT_CEILING_HEIGHT, DEFAULT_FLOOR, DEFAULT_WALL_COLOR, createId } from '../model/sample';
import {
  CURRENT_SCHEMA_VERSION,
  type BuilderNode,
  type ComponentEdgeStyle,
  type ComponentShape,
  type ComponentType,
  type FurnitureComponent,
  type PrimitiveKind,
  type SeamStyle,
  type UpholsteryPattern,
  type FengShuiSettings,
  type FloorStyle,
  type Furniture,
  type FurnitureAppearance,
  type FurnitureShape,
  type MaterialKind,
  type Point,
  type ShapeVertex,
  type SurfaceFinish,
  type FurnitureKind,
  type OptimizerSettings,
  type Partition,
  type PlacementPreference,
  type Relationship,
  type RelationshipType,
  type SavedLayout,
  type ScanItemRecord,
  type ScanRecord,
  type Placement,
  type Project,
  type Room,
  type RoomFeature,
  type Staircase,
  type StairSection,
  type WallNode,
} from '../model/types';
import { DEFAULT_WALL_THICKNESS, MAX_ROOM_SPAN, MAX_WALL_THICKNESS, findSegment, validateRoom } from '../model/walls';
import { MAX_SHAPE_POINTS, normaliseShape, pieceToRoom, shapeProblem } from '../model/shape';
import { COMPONENT_TYPE_LABELS, MAX_COMPONENTS, shiftComponents } from '../model/components';

/**
 * Reading projects from untrusted sources: browser storage (possibly written by an
 * older version of the app) and user-imported files.
 *
 * `parseProject` never throws. It migrates old formats, checks every field, and
 * either returns a clean project that satisfies all the editor's geometry rules or
 * a plain-language reason why it couldn't.
 */

export type ParseResult = { ok: true; project: Project } | { ok: false; error: string };

export const EXPORT_FORMAT = 'roomination-project';

/** Generous limits so a malicious or corrupt file can't freeze the app. */
const MAX_ITEMS = 2000;
const MAX_NAME_LENGTH = 120;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const FLOOR_PRESETS = ['plain', 'hardwood', 'lightOak', 'darkWalnut', 'tile', 'concrete', 'carpet'] as const;
const CATEGORIES = ['furniture', 'floorCovering', 'decoration'] as const;
const TEXTURES = ['plain', 'striped', 'checked', 'bordered', 'woven'] as const;
const FEATURE_KINDS = ['door', 'window', 'vent', 'outlet', 'switch', 'light', 'radiator', 'column'] as const;
const KINDS = Object.keys(FURNITURE_KIND_LABELS) as FurnitureKind[];
const PREFERENCES = Object.keys(PREFERENCE_LABELS) as PlacementPreference[];
const RELATIONSHIP_TYPES: RelationshipType[] = ['inFrontOf', 'faces', 'beside', 'near'];
/**
 * Versions 1–2 stored rectangles with named walls. They become a clockwise outline whose
 * node ids are fixed, so legacy `{ wall: 'top', offset }` placements can be converted.
 */
const LEGACY_WALLS = ['top', 'right', 'bottom', 'left'] as const;
const LEGACY_WALL_ID = { top: 'wall-top', right: 'wall-right', bottom: 'wall-bottom', left: 'wall-left' } as const;
const MAX_WALL_NODES = 500;
const MAX_STAIR_SECTIONS = 50;

/** Wraps a project for download, with a marker so we can recognise our own files. */
export function serializeProject(project: Project): string {
  return JSON.stringify({ format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), project }, null, 2);
}

/** Parses the text of an imported file. */
export function parseProjectFile(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file isn’t valid JSON, so it can’t be a Roomination project.' };
  }
  // Accept both our export wrapper and a bare project object.
  if (isRecord(data) && data.format === EXPORT_FORMAT) data = data.project;
  return parseProject(data);
}

export function parseProject(data: unknown): ParseResult {
  try {
    return parseUnsafe(data);
  } catch {
    // Belt and braces: no file should ever be able to crash the app.
    return { ok: false, error: 'That file couldn’t be read as a Roomination project.' };
  }
}

class InvalidProject extends Error {}

function fail(message: string): never {
  throw new InvalidProject(message);
}

function parseUnsafe(data: unknown): ParseResult {
  if (!isRecord(data)) return { ok: false, error: 'That file isn’t a Roomination project.' };
  const version = data.schemaVersion;
  if (typeof version !== 'number') return { ok: false, error: 'That file isn’t a Roomination project.' };
  if (version > CURRENT_SCHEMA_VERSION) {
    return { ok: false, error: 'This project was made with a newer version of Roomination. Please update the app.' };
  }
  if (![1, 2, 3, 4, 5, 6, 7].includes(version)) return { ok: false, error: 'That project format isn’t recognised.' };

  try {
    return { ok: true, project: buildProject(data, version) };
  } catch (error) {
    if (error instanceof InvalidProject) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Builds a current-version project. Older versions simply lack the newer fields (or
 * describe the room as a rectangle), so they are converted with sensible defaults.
 */
function buildProject(data: Record<string, unknown>, version: number): Project {
  const name = typeof data.name === 'string' ? data.name.slice(0, MAX_NAME_LENGTH) : 'Imported room';
  const units = data.units === 'imperial' ? 'imperial' : 'metric';
  const seenIds = new Set<string>();
  const uniqueId = (id: unknown) => {
    const value = typeof id === 'string' && id.length > 0 && id.length <= 100 && !seenIds.has(id) ? id : createId();
    seenIds.add(value);
    return value;
  };
  const room = version < 3 ? parseLegacyRoom(data.room) : parseRoom(data.room, uniqueId);
  // Reserve wall ids so no furniture, feature or stair in the file can reuse one.
  for (const node of [...room.outline, ...room.partitions.flatMap((p) => p.nodes)]) seenIds.add(node.id);
  const problem = validateRoom(room);
  if (problem) fail(`The walls in this file aren’t valid: ${problem}`);

  const rawFurniture = optionalArray(data.furniture, 'furniture');
  const rawFeatures = optionalArray(data.features, 'room features');
  const rawStairs = optionalArray(data.stairs, 'staircases');

  const furniture = rawFurniture.map((raw, index) => {
    const item = parseFurniture(raw, index, uniqueId);
    const placed = clampFurnitureToRoom(item, room);
    if (!placed) fail(`“${item.name}” doesn’t fit in the room in this file.`);
    return placed;
  });

  const stairs = rawStairs.map((raw, index) => {
    const stair = parseStair(raw, index, uniqueId);
    const placed = clampStairToRoom(stair, room);
    if (!placed) fail(`“${stair.name}” doesn’t fit in the room in this file.`);
    return placed;
  });

  const features: RoomFeature[] = [];
  rawFeatures.forEach((raw, index) => {
    const parsed = parseFeature(raw, index, uniqueId, room, version);
    const placed = clampFeatureToRoom(parsed, room);
    if (!placed) fail(`Room feature “${parsed.name}” is too big for the room in this file.`);
    const clash = findOverlappingOpening(placed, features);
    if (clash) fail(`“${placed.name}” overlaps “${clash.name}” on the same wall.`);
    features.push(placed);
  });

  const acceptedOverlaps = Array.isArray(data.acceptedOverlaps)
    ? data.acceptedOverlaps.filter((key): key is string => typeof key === 'string' && key.length < 300).slice(0, MAX_ITEMS)
    : [];

  const ids = new Set(furniture.map((f) => f.id));
  const fengShui = parseFengShui(data.fengShui, features);
  const scan = parseScanRecord(data.scan);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name,
    units,
    room,
    furniture,
    features,
    stairs,
    relationships: parseRelationships(data.relationships, ids),
    optimizer: parseOptimizer(data.optimizer),
    savedLayouts: parseSavedLayouts(data.savedLayouts, ids),
    acceptedOverlaps,
    ...(fengShui ? { fengShui } : {}),
    ...(scan ? { scan } : {}),
  };
}

/** Relationships between pieces that exist; anything else is dropped (they're optional). */
function parseRelationships(raw: unknown, ids: Set<string>): Relationship[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.slice(0, MAX_ITEMS).flatMap((r): Relationship[] => {
    if (!isRecord(r)) return [];
    const type = oneOf(r.type, RELATIONSHIP_TYPES, null);
    const a = typeof r.a === 'string' ? r.a : '';
    const b = typeof r.b === 'string' ? r.b : '';
    if (!type || !ids.has(a) || !ids.has(b) || a === b) return [];
    const id = typeof r.id === 'string' && r.id.length <= 100 && !seen.has(r.id) ? r.id : createId();
    seen.add(id);
    return [{ id, type, a, b }];
  });
}

/** Optimizer settings: a broken value isn't worth rejecting a project — use the default. */
function parseOptimizer(raw: unknown): OptimizerSettings {
  if (!isRecord(raw)) return DEFAULT_OPTIMIZER;
  const d = DEFAULT_OPTIMIZER;
  return {
    mode: oneOf(raw.mode, ['functional', 'balanced', 'aesthetic', 'fengShui', 'custom'] as const, d.mode),
    functionWeight: finite(raw.functionWeight) && raw.functionWeight >= 0 && raw.functionWeight <= 1 ? raw.functionWeight : d.functionWeight,
    walkwayWidth: finite(raw.walkwayWidth) && raw.walkwayWidth >= 40 && raw.walkwayWidth <= 200 ? raw.walkwayWidth : d.walkwayWidth,
    effort: oneOf(raw.effort, ['quick', 'standard', 'thorough'] as const, d.effort),
    seed: finite(raw.seed) && Number.isInteger(raw.seed) && raw.seed >= 0 && raw.seed < 2 ** 31 ? raw.seed : d.seed,
    weights: parseWeights(raw.weights) ?? d.weights,
    purpose: oneOf(raw.purpose, ['living', 'bedroom', 'office', 'studio', 'dining', 'multipurpose'] as const, null),
    assumePairings: typeof raw.assumePairings === 'boolean' ? raw.assumePairings : d.assumePairings,
  };
}

/** Custom weights: three non-negative numbers, rescaled to add up to exactly 100. */
function parseWeights(raw: unknown): OptimizerSettings['weights'] | null {
  if (!isRecord(raw)) return null;
  const values = [raw.functional, raw.aesthetic, raw.fengShui];
  if (!values.every((v) => finite(v) && v >= 0)) return null;
  const [f, a, fs] = values as number[];
  const total = f + a + fs;
  if (total <= 0) return null;
  const functional = Math.round((f / total) * 100);
  const aesthetic = Math.round((a / total) * 100);
  return { functional, aesthetic, fengShui: 100 - functional - aesthetic };
}

/** Feng Shui settings; anything unusable is dropped (Feng Shui is optional). */
function parseFengShui(raw: unknown, features: RoomFeature[]): FengShuiSettings | null {
  if (!isRecord(raw)) return null;
  const doors = new Set(features.filter((f) => f.kind === 'door').map((f) => f.id));
  return {
    enabled: raw.enabled === true,
    method: oneOf(raw.method, ['entrance', 'compass'] as const, 'entrance'),
    showBagua: raw.showBagua === true,
    northBearing: finite(raw.northBearing) ? normalizeRotation(raw.northBearing) : null,
    entranceId: typeof raw.entranceId === 'string' && doors.has(raw.entranceId) ? raw.entranceId : null,
  };
}

/** Saved arrangements keep only entries for pieces that still exist. */
function parseSavedLayouts(raw: unknown, ids: Set<string>): SavedLayout[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.slice(0, 100).flatMap((l): SavedLayout[] => {
    if (!isRecord(l) || !Array.isArray(l.positions)) return [];
    const positions = l.positions.flatMap((p) =>
      isRecord(p) && typeof p.id === 'string' && ids.has(p.id) && [p.x, p.y, p.rotation].every(finite)
        ? [{ id: p.id, x: p.x as number, y: p.y as number, rotation: normalizeRotation(p.rotation as number) }]
        : [],
    );
    if (positions.length === 0) return [];
    const id = typeof l.id === 'string' && l.id.length <= 100 && !seen.has(l.id) ? l.id : createId();
    seen.add(id);
    return [{
      id,
      name: typeof l.name === 'string' ? l.name.slice(0, MAX_NAME_LENGTH) : 'Saved layout',
      createdAt: finite(l.createdAt) ? l.createdAt : 0,
      positions,
    }];
  });
}

/** Versions 1–2: a width × length rectangle becomes a 4-wall clockwise outline. */
function parseLegacyRoom(raw: unknown): Room {
  if (!isRecord(raw)) fail('The room’s measurements are missing.');
  const [width, length, height] = [raw.width, raw.length, raw.height].map((v) => positive(v, 'room size'));
  if (Math.max(width, length, height) > MAX_ROOM_SPAN) fail('The room in this file is unrealistically large.');
  const node = (wall: (typeof LEGACY_WALLS)[number], x: number, y: number): WallNode => ({ id: LEGACY_WALL_ID[wall], x, y, thickness: DEFAULT_WALL_THICKNESS });
  return {
    outline: [node('top', 0, 0), node('right', width, 0), node('bottom', width, length), node('left', 0, length)],
    partitions: [],
    height,
    floor: parseFloor(raw.floor),
    wallColor: DEFAULT_WALL_COLOR,
  };
}

function parseRoom(raw: unknown, uniqueId: (id: unknown) => string): Room {
  if (!isRecord(raw)) fail('The room’s walls are missing.');
  // Ceiling height has always been saved, but a hand-edited file may lack it.
  const height = raw.height === undefined ? DEFAULT_CEILING_HEIGHT : positive(raw.height, 'ceiling height');
  if (height > MAX_ROOM_SPAN) fail('The ceiling in this file is unrealistically high.');
  if (!Array.isArray(raw.outline) || raw.outline.length < 3) fail('The room’s outline needs at least three walls.');
  const outline = parseNodes(raw.outline, uniqueId, 'outline');
  const partitions: Partition[] = optionalArray(raw.partitions, 'interior walls').map((p) => {
    if (!isRecord(p) || !Array.isArray(p.nodes) || p.nodes.length < 2) fail('An interior wall in this file is damaged.');
    return { id: uniqueId(p.id), nodes: parseNodes(p.nodes, uniqueId, 'interior wall') };
  });
  return {
    outline,
    partitions,
    height,
    floor: parseFloor(raw.floor),
    // The colour picker and the 3D renderer only understand #rrggbb.
    wallColor: typeof raw.wallColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.wallColor) ? raw.wallColor : DEFAULT_WALL_COLOR,
  };
}

function parseNodes(raw: unknown[], uniqueId: (id: unknown) => string, what: string): WallNode[] {
  if (raw.length > MAX_WALL_NODES) fail(`This file has too many corners in its ${what} to load safely.`);
  return raw.map((n) => {
    if (!isRecord(n) || !finite(n.x) || !finite(n.y)) fail(`A corner in the room’s ${what} is damaged.`);
    const thickness = finite(n.thickness) && n.thickness > 0 && n.thickness <= MAX_WALL_THICKNESS ? n.thickness : DEFAULT_WALL_THICKNESS;
    return { id: uniqueId(n.id), x: n.x, y: n.y, thickness };
  });
}

/** A broken floor style isn't worth rejecting a whole project over — fall back to plain. */
function parseFloor(raw: unknown): FloorStyle {
  if (!isRecord(raw)) return DEFAULT_FLOOR;
  return {
    preset: oneOf(raw.preset, FLOOR_PRESETS, DEFAULT_FLOOR.preset),
    color: color(raw.color, DEFAULT_FLOOR.color),
    scale: finite(raw.scale) && raw.scale >= 0.25 && raw.scale <= 4 ? raw.scale : 1,
    angle: finite(raw.angle) ? normalizeRotation(raw.angle) : 0,
    intensity: finite(raw.intensity) && raw.intensity >= 0 && raw.intensity <= 1 ? raw.intensity : 0.5,
  };
}

function parseFurniture(raw: unknown, index: number, uniqueId: (id: unknown) => string): Furniture {
  const label = `Furniture item ${index + 1}`;
  if (!isRecord(raw)) fail(`${label} is damaged.`);
  if (![raw.x, raw.y, raw.rotation].every(finite)) fail(`${label} has an invalid position.`);
  const item: Furniture = {
    id: uniqueId(raw.id),
    name: typeof raw.name === 'string' ? raw.name.slice(0, MAX_NAME_LENGTH) : 'Untitled piece',
    category: oneOf(raw.category, CATEGORIES, 'furniture'),
    x: raw.x as number,
    y: raw.y as number,
    width: positive(raw.width, `${label}’s width`),
    depth: positive(raw.depth, `${label}’s depth`),
    height: positive(raw.height, `${label}’s height`),
    rotation: normalizeRotation(raw.rotation as number),
    color: color(raw.color, '#e9a178'),
    texture: oneOf(raw.texture, TEXTURES, 'plain'),
    // Older projects had no kinds: make a conservative guess from the name.
    kind: oneOf(raw.kind, KINDS, null) ?? guessKind(typeof raw.name === 'string' ? raw.name : ''),
    locked: raw.locked === true,
    preferences: Array.isArray(raw.preferences) ? [...new Set(raw.preferences.filter((p): p is PlacementPreference => PREFERENCES.includes(p)))] : [],
  };
  const clearance = finite(raw.clearance) && raw.clearance > 0 && raw.clearance <= MAX_CLEARANCE ? raw.clearance : undefined;
  if (clearance) item.clearance = clearance;
  // Older apps ignore it (the piece then stands on the floor); nothing else changes.
  if (finite(raw.elevation) && raw.elevation > 0 && raw.elevation <= MAX_ROOM_SPAN) item.elevation = raw.elevation;
  const appearance = parseAppearance(raw.appearance);
  if (appearance) item.appearance = appearance;
  const components = parseComponents(raw.components);
  if (components) item.components = components;
  if (raw.shape === undefined) return item;
  return withShape(item, parseShape(raw.shape, label));
}

/** A reusable piece: everything about it except where it stands and how it's linked. */
export type FurnitureTemplate = Omit<Furniture, 'id' | 'x' | 'y' | 'rotation' | 'locked' | 'preferences'>;

/** Validates a saved library template with the same rules as project furniture; null if unusable. */
export function parseFurnitureTemplate(raw: unknown): FurnitureTemplate | null {
  if (!isRecord(raw)) return null;
  try {
    const { id: _id, x: _x, y: _y, rotation: _r, locked: _l, preferences: _p, ...template } = parseFurniture({ ...raw, id: 'template', x: 0, y: 0, rotation: 0 }, 0, (id) => String(id));
    return template;
  } catch {
    return null;
  }
}

/** Attaches a shape, keeping width/depth equal to its outline and the piece exactly where it was. */
function withShape(item: Furniture, shape: FurnitureShape): Furniture {
  const normal = normaliseShape(shape);
  // The outline's centre may move when re-centred; move the piece the same amount (rotated),
  // and its components back by it, so nothing moves in the room.
  const at = pieceToRoom(item, normal.shift);
  const moved = item.components ? { components: shiftComponents(item.components, -normal.shift.x, -normal.shift.y) } : {};
  return { ...item, ...moved, shape: normal.shape, width: normal.width, depth: normal.depth, x: at.x, y: at.y };
}

/** A custom outline from a file. Throws (with a plain reason) if it can't be used. */
export function parseShape(raw: unknown, label: string): FurnitureShape {
  if (!isRecord(raw)) fail(`${label}’s shape is damaged.`);
  let budget = MAX_SHAPE_POINTS;
  const outline = (list: unknown): ShapeVertex[] => {
    if (!Array.isArray(list)) fail(`${label}’s shape is damaged.`);
    budget -= list.length;
    if (budget < 0) fail(`${label}’s shape has too many corners to load safely.`);
    return parseVertices(list, () => fail(`A corner of ${label}’s shape is damaged.`));
  };
  const holesOf = (list: unknown): ShapeVertex[][] | undefined => {
    if (list === undefined) return undefined;
    if (!Array.isArray(list) || list.length > MAX_HOLES) fail(`${label}’s shape is damaged.`);
    return list.length > 0 ? list.map(outline) : undefined;
  };
  const shape: FurnitureShape = { points: outline(raw.points) };
  const holes = holesOf(raw.holes);
  if (holes) shape.holes = holes;
  if (raw.islands !== undefined) {
    if (!Array.isArray(raw.islands) || raw.islands.length > MAX_ISLANDS) fail(`${label}’s shape is damaged.`);
    const islands = raw.islands.map((island) => {
      if (!isRecord(island)) fail(`${label}’s shape is damaged.`);
      const h = holesOf(island.holes);
      return { points: outline(island.points), ...(h ? { holes: h } : {}) };
    });
    if (islands.length > 0) shape.islands = islands;
  }
  const problem = shapeProblem(shape);
  if (problem) fail(`${label}’s shape can’t be used: ${problem}`);
  // The builder recipe is only for re-editing: a damaged one is dropped, never trusted.
  const source = parseBuilderNodes(raw.source);
  if (source) shape.source = source;
  return shape;
}

const MAX_HOLES = 50;
const MAX_ISLANDS = 50;
const MAX_BUILDER_NODES = 200;
const MAX_BUILDER_DEPTH = 8;
const PRIMITIVES: PrimitiveKind[] = ['rectangle', 'square', 'circle', 'ellipse', 'triangle', 'polygon', 'arc', 'outline'];
const OPERATIONS = ['union', 'subtract', 'intersect', 'group'] as const;

function parseVertices(list: unknown[], onError: () => never): ShapeVertex[] {
  const point = (p: unknown): Point | null => (isRecord(p) && finite(p.x) && finite(p.y) ? { x: p.x, y: p.y } : null);
  return list.map((v) => {
    const corner = point(v);
    if (!corner) onError();
    const c1 = isRecord(v) ? point(v.c1) : null;
    const c2 = isRecord(v) ? point(v.c2) : null;
    return c1 && c2 ? { ...corner, c1, c2 } : corner;
  });
}

/** A Shape Builder recipe, or undefined if it's missing or damaged in any way. */
export function parseBuilderNodes(raw: unknown): BuilderNode[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  let count = 0;
  let corners = 0;
  const invalid = (): never => {
    throw new Error('invalid');
  };
  const node = (n: unknown, depth: number): BuilderNode => {
    if (++count > MAX_BUILDER_NODES || depth > MAX_BUILDER_DEPTH || !isRecord(n) || typeof n.id !== 'string' || n.id.length > 100) invalid();
    const r = n as Record<string, unknown>;
    if (r.type === 'shape') {
      const kind = r.kind as PrimitiveKind;
      if (!PRIMITIVES.includes(kind)) invalid();
      const size = (v: unknown) => (finite(v) && v > 0 && v <= MAX_ROOM_SPAN ? v : invalid());
      const place = (v: unknown) => (finite(v) && Math.abs(v) <= MAX_ROOM_SPAN ? v : invalid());
      const shape: BuilderNode = { id: r.id as string, type: 'shape', kind, x: place(r.x), y: place(r.y), rotation: normalizeRotation(place(r.rotation)), width: size(r.width), depth: size(r.depth) };
      if (r.sides !== undefined) shape.sides = finite(r.sides) && Number.isInteger(r.sides) && r.sides >= 3 && r.sides <= 64 ? r.sides : invalid();
      if (r.sweep !== undefined) shape.sweep = finite(r.sweep) && r.sweep > 0 && r.sweep <= 360 ? r.sweep : invalid();
      if (r.points !== undefined) {
        if (!Array.isArray(r.points) || r.points.length < 3) invalid();
        corners += (r.points as unknown[]).length;
        if (corners > MAX_SHAPE_POINTS) invalid();
        shape.points = parseVertices(r.points as unknown[], invalid);
      }
      if (kind === 'outline' && !shape.points) invalid();
      return shape;
    }
    if (!OPERATIONS.includes(r.type as (typeof OPERATIONS)[number]) || !Array.isArray(r.children)) invalid();
    return { id: r.id as string, type: r.type as (typeof OPERATIONS)[number], children: (r.children as unknown[]).map((c) => node(c, depth + 1)) };
  };
  try {
    const nodes = raw.map((n) => node(n, 0));
    return nodes.length > 0 ? nodes : undefined;
  } catch {
    return undefined;
  }
}

const COMPONENT_TYPES = Object.keys(COMPONENT_TYPE_LABELS) as ComponentType[];
const COMPONENT_SHAPES: ComponentShape[] = ['box', 'cylinder', 'ellipsoid', 'polygon', 'curved', 'edge', 'footprint'];
const EDGE_STYLES: ComponentEdgeStyle[] = ['square', 'rounded', 'bevel'];
const PATTERNS: UpholsteryPattern[] = ['plain', 'stripes', 'check', 'herringbone', 'boucle'];
const SEAMS: SeamStyle[] = ['none', 'piped', 'stitched', 'tufted'];
const MAX_COMPONENT_SIZE = 2000;

/**
 * Component-built furniture. Components only change how a piece looks, so a damaged one is
 * dropped (never rejecting the project); sizes, outlines and lists are bounded.
 */
export function parseComponents(raw: unknown): FurnitureComponent[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  let corners = 0;
  const seen = new Set<string>();
  const out: FurnitureComponent[] = [];
  for (const r of raw.slice(0, MAX_COMPONENTS)) {
    if (!isRecord(r) || typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 100 || seen.has(r.id)) continue;
    const type = oneOf(r.type, COMPONENT_TYPES, null);
    const shape = oneOf(r.shape, COMPONENT_SHAPES, null);
    const place = (v: unknown) => (finite(v) && Math.abs(v) <= MAX_COMPONENT_SIZE ? v : null);
    const size = (v: unknown) => (finite(v) && v > 0 && v <= MAX_COMPONENT_SIZE ? v : null);
    const [x, y, z] = [place(r.x), place(r.y), place(r.z)];
    const [width, depth, height] = [size(r.width), size(r.depth), size(r.height)];
    if (!type || !shape || x === null || y === null || z === null || width === null || depth === null || height === null || !finite(r.rotation)) continue;
    const c: FurnitureComponent = {
      id: r.id,
      name: typeof r.name === 'string' ? r.name.slice(0, MAX_NAME_LENGTH) : 'Component',
      type,
      shape,
      x,
      y,
      z,
      width,
      depth,
      height,
      rotation: normalizeRotation(r.rotation),
    };
    if (typeof r.parentId === 'string' && r.parentId.length <= 100 && r.parentId !== r.id) c.parentId = r.parentId;
    if (finite(r.tilt) && Math.abs(r.tilt) <= 89) c.tilt = r.tilt;
    if (finite(r.radius) && r.radius >= 0 && r.radius <= MAX_COMPONENT_SIZE) c.radius = r.radius;
    const edgeStyle = oneOf(r.edgeStyle, EDGE_STYLES, null);
    if (edgeStyle) c.edgeStyle = edgeStyle;
    if (Array.isArray(r.outline) && r.outline.length >= 3 && corners + r.outline.length <= MAX_SHAPE_POINTS) {
      const pts = r.outline.map((p) => (isRecord(p) && place(p.x) !== null && place(p.y) !== null ? { x: p.x as number, y: p.y as number } : null));
      if (pts.every((p) => p !== null)) {
        c.outline = pts as Point[];
        corners += pts.length;
      }
    }
    if (finite(r.sweep) && r.sweep > 0 && r.sweep <= 300) c.sweep = r.sweep;
    if (isRecord(r.edges) && [r.edges.from, r.edges.to].every((v) => finite(v) && Number.isInteger(v) && v >= 0 && v < MAX_SHAPE_POINTS)) {
      const len = (v: unknown) => (finite(v) && v >= 0 && v <= MAX_COMPONENT_SIZE ? v : 0);
      c.edges = { from: r.edges.from as number, to: r.edges.to as number, startTrim: len(r.edges.startTrim), endTrim: len(r.edges.endTrim), inset: len(r.edges.inset), thickness: len(r.edges.thickness) || depth, miterStart: r.edges.miterStart === true, miterEnd: r.edges.miterEnd === true };
    }
    if (finite(r.inset) && r.inset >= 0 && r.inset <= MAX_COMPONENT_SIZE) c.inset = r.inset;
    if (Array.isArray(r.cut)) {
      const cut = r.cut.filter((k): k is string => typeof k === 'string' && k.length <= 100).slice(0, MAX_COMPONENTS);
      if (cut.length) c.cut = [...new Set(cut)];
    }
    if (isRecord(r.split) && [r.split.along, r.split.count, r.split.index].every((v) => finite(v) && Number.isInteger(v) && v >= 0) && (r.split.count as number) >= 1 && (r.split.count as number) <= 12) {
      c.split = { along: r.split.along as number, count: r.split.count as number, index: Math.min(r.split.index as number, (r.split.count as number) - 1), gap: finite(r.split.gap) && r.split.gap >= 0 && r.split.gap <= 50 ? r.split.gap : 0 };
    }
    if (finite(r.taper) && r.taper > 0 && r.taper <= 10) c.taper = r.taper;
    if (r.color !== undefined) {
      const hex = color(r.color, '');
      if (hex) c.color = hex;
    }
    const material = oneOf(r.material, MATERIALS, null);
    if (material) c.material = material;
    const finish = oneOf(r.finish, FINISHES, null);
    if (finish) c.finish = finish;
    if (finite(r.roughness) && r.roughness >= 0 && r.roughness <= 1) c.roughness = r.roughness;
    if (finite(r.textureScale) && r.textureScale >= 0.1 && r.textureScale <= 10) c.textureScale = r.textureScale;
    const pattern = oneOf(r.pattern, PATTERNS, null);
    if (pattern) c.pattern = pattern;
    const seams = oneOf(r.seams, SEAMS, null);
    if (seams) c.seams = seams;
    if (r.locked === true) c.locked = true;
    if (r.hidden === true) c.hidden = true;
    seen.add(c.id);
    out.push(c);
  }
  // Parents that weren't kept are let go (their children stay, placed on their own).
  for (const c of out) if (c.parentId && !seen.has(c.parentId)) delete c.parentId;
  return out.length > 0 ? out : undefined;
}

const MATERIALS: MaterialKind[] = ['fabric', 'cotton', 'linen', 'velvet', 'leather', 'wood', 'metal', 'glass', 'stone', 'ceramic', 'plastic', 'water', 'mirror', 'custom'];
const FINISHES: SurfaceFinish[] = ['matte', 'satin', 'gloss'];
/** Photos are referenced by the SHA-256 of their bytes. */
const ASSET_ID = /^[0-9a-f]{64}$/;
const MAX_PHOTOS = 12;
const MAX_CLEARANCE = 500;

/** A piece's look. Anything unrecognised is dropped rather than rejecting the project. */
export function parseAppearance(raw: unknown): FurnitureAppearance | undefined {
  if (!isRecord(raw)) return undefined;
  const id = (v: unknown) => (typeof v === 'string' && ASSET_ID.test(v) ? v : undefined);
  const appearance: FurnitureAppearance = {
    material: oneOf(raw.material, MATERIALS, 'custom'),
    finish: oneOf(raw.finish, FINISHES, 'matte'),
  };
  if (isRecord(raw.textures)) {
    const textures = { top: id(raw.textures.top), front: id(raw.textures.front), side: id(raw.textures.side) };
    const kept = Object.fromEntries(Object.entries(textures).filter(([, v]) => v !== undefined));
    if (Object.keys(kept).length > 0) appearance.textures = kept;
  }
  if (Array.isArray(raw.photos)) {
    const photos = [...new Set(raw.photos.map(id).filter((v): v is string => v !== undefined))].slice(0, MAX_PHOTOS);
    if (photos.length > 0) appearance.photos = photos;
  }
  return appearance;
}

/** Every photo a project refers to (textures and reference photos). */
export function projectAssetIds(project: Pick<Project, 'furniture'>): string[] {
  return [...new Set(project.furniture.flatMap(furnitureAssetIds))];
}

export function furnitureAssetIds(item: Pick<Furniture, 'appearance'>): string[] {
  const a = item.appearance;
  if (!a) return [];
  return [...Object.values(a.textures ?? {}), ...(a.photos ?? [])].filter((v): v is string => typeof v === 'string');
}

function parseFeature(raw: unknown, index: number, uniqueId: (id: unknown) => string, room: Room, version: number): RoomFeature {
  const label = `Room feature ${index + 1}`;
  if (!isRecord(raw)) fail(`${label} is damaged.`);
  const kind = oneOf(raw.kind, FEATURE_KINDS, null);
  if (!kind) fail(`${label} has an unknown type.`);

  const feature: RoomFeature = {
    id: uniqueId(raw.id),
    name: typeof raw.name === 'string' ? raw.name.slice(0, MAX_NAME_LENGTH) : 'Untitled feature',
    kind,
    placement: version < 3 ? parseLegacyPlacement(raw.placement, label, room) : parsePlacement(raw.placement, label, room),
    width: positive(raw.width, `${label}’s width`),
    depth: nonNegative(raw.depth, `${label}’s depth`),
    height: nonNegative(raw.height, `${label}’s height`),
    elevation: nonNegative(raw.elevation, `${label}’s height above the floor`),
    clearance: nonNegative(raw.clearance, `${label}’s clearance`),
  };
  // Kind-specific options: keep only valid values for the right kind.
  if (kind === 'door') {
    feature.doorType = oneOf(raw.doorType, ['hinged', 'double', 'sliding', 'opening'] as const, 'hinged');
    feature.swing = oneOf(raw.swing, ['in', 'out'] as const, 'in');
    feature.hinge = oneOf(raw.hinge, ['left', 'right'] as const, 'left');
  }
  if (kind === 'vent') feature.ventMount = oneOf(raw.ventMount, ['wall', 'floor', 'ceiling'] as const, 'floor');
  if (kind === 'outlet') feature.outletType = oneOf(raw.outletType, ['standard', 'usb', 'gfci', 'highVoltage'] as const, 'standard');
  if (kind === 'light') feature.lightType = oneOf(raw.lightType, ['pendant', 'flush', 'recessed', 'chandelier'] as const, 'pendant');
  if (kind === 'column') feature.shape = oneOf(raw.shape, ['square', 'round'] as const, 'square');
  // Make sure e.g. a door isn't stored as free-standing.
  const converted = convertPlacement(feature, allowedPlacement(feature), room);
  if (allowedPlacement(converted) === 'wall' && converted.placement.type !== 'wall') fail(`No wall in this file is long enough for “${converted.name}”.`);
  return converted;
}

function parsePlacement(raw: unknown, label: string, room: Room): Placement {
  if (isRecord(raw) && raw.type === 'wall') {
    if (typeof raw.wallId !== 'string' || !findSegment(room, raw.wallId) || !finite(raw.offset)) fail(`${label} is attached to a wall that doesn’t exist.`);
    return { type: 'wall', wallId: raw.wallId, offset: raw.offset };
  }
  return parseFreePlacement(raw, label);
}

/**
 * Versions 1–2 measured wall offsets in room coordinates (x for top/bottom, y for
 * left/right). In the clockwise outline the bottom and left walls run backwards, so
 * those offsets are flipped to "distance from the wall's start".
 */
function parseLegacyPlacement(raw: unknown, label: string, room: Room): Placement {
  if (isRecord(raw) && raw.type === 'wall') {
    const wall = oneOf(raw.wall, LEGACY_WALLS, null);
    if (!wall || !finite(raw.offset)) fail(`${label} has an invalid wall position.`);
    const width = room.outline[1].x;
    const length = room.outline[2].y;
    const offset = wall === 'bottom' ? width - raw.offset : wall === 'left' ? length - raw.offset : raw.offset;
    return { type: 'wall', wallId: LEGACY_WALL_ID[wall], offset };
  }
  return parseFreePlacement(raw, label);
}

function parseFreePlacement(raw: unknown, label: string): Placement {
  if (isRecord(raw) && raw.type === 'free' && [raw.x, raw.y, raw.rotation].every(finite)) {
    return { type: 'free', x: raw.x as number, y: raw.y as number, rotation: normalizeRotation(raw.rotation as number) };
  }
  fail(`${label} has an invalid position.`);
}

function parseStair(raw: unknown, index: number, uniqueId: (id: unknown) => string): Staircase {
  const label = `Staircase ${index + 1}`;
  if (!isRecord(raw)) fail(`${label} is damaged.`);
  if (![raw.x, raw.y, raw.rotation].every(finite)) fail(`${label} has an invalid position.`);
  if (!Array.isArray(raw.sections) || raw.sections.length === 0 || raw.sections.length > MAX_STAIR_SECTIONS) fail(`${label}’s sections are damaged.`);
  const sections: StairSection[] = raw.sections.map((s) => {
    if (!isRecord(s)) fail(`A section of ${label} is damaged.`);
    const kind = oneOf(s.kind, ['flight', 'landing'] as const, null);
    if (!kind) fail(`A section of ${label} has an unknown type.`);
    const steps = finite(s.steps) ? Math.max(0, Math.round(s.steps)) : 0;
    return {
      id: uniqueId(s.id),
      kind,
      length: positive(s.length, `${label}’s section length`),
      width: positive(s.width, `${label}’s section width`),
      steps: Math.min(steps, 100),
      turn: kind === 'landing' ? oneOf(s.turn, ['straight', 'left', 'right'] as const, 'straight') : 'straight',
    };
  });
  return {
    id: uniqueId(raw.id),
    name: typeof raw.name === 'string' ? raw.name.slice(0, MAX_NAME_LENGTH) : 'Stairs',
    x: raw.x as number,
    y: raw.y as number,
    rotation: normalizeRotation(raw.rotation as number),
    direction: raw.direction === 'down' ? 'down' : 'up',
    rise: finite(raw.rise) && raw.rise >= 0 && raw.rise <= 2000 ? raw.rise : 270,
    sections,
  };
}

// ---------------------------------------------------------------------------
// Room-scan history (optional, read-only; anything damaged is dropped, never the project)
// ---------------------------------------------------------------------------

const MAX_SCAN_ITEMS = 5000;
const MAX_SCAN_NOTES = 200;
const MAX_SCAN_TEXT = 400;
const CORRECTION_KEYS = ['length', 'width', 'depth', 'height', 'bottom', 'kind', 'category', 'as', 'include'] as const;

const text = (v: unknown, max = MAX_SCAN_TEXT) => (typeof v === 'string' ? v.slice(0, max) : '');
const scanNumber = (v: unknown) => (finite(v) && Math.abs(v) <= 1e7 ? v : null);

function parseScanRecord(raw: unknown): ScanRecord | null {
  if (!isRecord(raw) || !isRecord(raw.transform) || !Array.isArray(raw.items)) return null;
  const t = raw.transform;
  const rotation = scanNumber(t.rotation);
  const offsetX = scanNumber(t.offsetX);
  const offsetY = scanNumber(t.offsetY);
  if (rotation === null || offsetX === null || offsetY === null) return null;
  const ceiling = isRecord(raw.ceiling) ? raw.ceiling : {};
  const items: ScanItemRecord[] = [];
  for (const item of raw.items.slice(0, MAX_SCAN_ITEMS)) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || item.id.length > 100) continue;
    const type = oneOf(item.type, ['wall', 'opening', 'object'] as const, null);
    if (!type) continue;
    let measured: ScanItemRecord['measured'] = null;
    if (isRecord(item.measured)) {
      const width = scanNumber(item.measured.width);
      const height = scanNumber(item.measured.height);
      if (width !== null && height !== null) {
        measured = { width, height };
        const depth = scanNumber(item.measured.depth);
        const bottom = scanNumber(item.measured.bottom);
        if (depth !== null) measured.depth = depth;
        if (bottom !== null) measured.bottom = bottom;
      }
    }
    const corrections: ScanItemRecord['corrections'] = {};
    if (isRecord(item.corrections)) {
      for (const key of CORRECTION_KEYS) {
        const v = item.corrections[key];
        if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) corrections[key] = v;
        else if (typeof v === 'string') corrections[key] = v.slice(0, 60);
      }
    }
    items.push({
      id: item.id,
      type,
      origin: oneOf(item.origin, ['scanned', 'reconstructed', 'added'] as const, 'scanned'),
      category: text(item.category, 30) || 'unknown',
      confidence: oneOf(item.confidence, ['high', 'medium', 'low', 'unknown'] as const, 'unknown'),
      measured,
      ...(typeof item.inferred === 'string' ? { inferred: item.inferred.slice(0, 60) } : {}),
      ...(typeof item.inferredName === 'string' ? { inferredName: item.inferredName.slice(0, 80) } : {}),
      corrections,
      excluded: item.excluded === true,
    });
  }
  const notes = Array.isArray(raw.notes)
    ? raw.notes
        .slice(0, MAX_SCAN_NOTES)
        .filter(isRecord)
        .map((n) => ({ level: oneOf(n.level, ['check', 'assumed', 'info'] as const, 'info'), text: text(n.text) }))
        .filter((n) => n.text)
    : [];
  return {
    source: text(raw.source, 200) || 'Room scan',
    format: oneOf(raw.format, ['roomplan', 'house-capture', 'roomination-scan'] as const, 'roomplan'),
    importedAt: finite(raw.importedAt) && raw.importedAt >= 0 && raw.importedAt < 1e14 ? raw.importedAt : 0,
    transform: { rotation, offsetX, offsetY, straightened: t.straightened === true, quarterTurns: finite(t.quarterTurns) ? Math.round(t.quarterTurns) % 4 : 0 },
    ceiling: { measured: scanNumber(ceiling.measured), corrected: scanNumber(ceiling.corrected) },
    items,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Small validators
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positive(value: unknown, what: string): number {
  if (!finite(value) || value <= 0) fail(`The ${what} must be a positive number.`);
  return value;
}

function nonNegative(value: unknown, what: string): number {
  if (!finite(value) || value < 0) fail(`The ${what} must be zero or more.`);
  return value;
}

function optionalArray(value: unknown, what: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`The ${what} list is damaged.`);
  if (value.length > MAX_ITEMS) fail(`This file has too many ${what} to load safely.`);
  return value;
}

function oneOf<T extends string, F>(value: unknown, options: readonly T[], fallback: F): T | F {
  return options.includes(value as T) ? (value as T) : fallback;
}

/** Only plain hex colours are allowed (they end up in canvas and CSS styles). */
function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}
