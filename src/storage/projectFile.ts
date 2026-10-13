import { allowedPlacement, clampFeatureToRoom, convertPlacement, findOverlappingOpening } from '../model/features';
import { MAX_ROOM_SIZE, clampCenterToRoom, normalizeRotation } from '../model/geometry';
import { DEFAULT_FLOOR, createId } from '../model/sample';
import {
  CURRENT_SCHEMA_VERSION,
  type FloorStyle,
  type Furniture,
  type Placement,
  type Project,
  type Room,
  type RoomFeature,
} from '../model/types';

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
const WALLS = ['top', 'right', 'bottom', 'left'] as const;

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
  if (version !== 1 && version !== 2) return { ok: false, error: 'That project format isn’t recognised.' };

  try {
    return { ok: true, project: buildProject(data) };
  } catch (error) {
    if (error instanceof InvalidProject) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Builds a current-version project. Version 1 (Phase 1) projects simply lack the
 * newer fields, so they get sensible defaults.
 */
function buildProject(data: Record<string, unknown>): Project {
  const name = typeof data.name === 'string' ? data.name.slice(0, MAX_NAME_LENGTH) : 'Imported room';
  const units = data.units === 'imperial' ? 'imperial' : 'metric';
  const room = parseRoom(data.room);

  const rawFurniture = optionalArray(data.furniture, 'furniture');
  const rawFeatures = optionalArray(data.features, 'room features');
  const seenIds = new Set<string>();
  const uniqueId = (id: unknown) => {
    const value = typeof id === 'string' && id.length > 0 && id.length <= 100 && !seenIds.has(id) ? id : createId();
    seenIds.add(value);
    return value;
  };

  const furniture = rawFurniture.map((raw, index) => {
    const item = parseFurniture(raw, index, uniqueId);
    const placed = clampCenterToRoom(item, room);
    if (!placed) fail(`“${item.name}” is too big for the room in this file.`);
    return placed;
  });

  const features: RoomFeature[] = [];
  rawFeatures.forEach((raw, index) => {
    const parsed = parseFeature(raw, index, uniqueId, room);
    const placed = clampFeatureToRoom(parsed, room);
    if (!placed) fail(`Room feature “${parsed.name}” is too big for the room in this file.`);
    const clash = findOverlappingOpening(placed, features);
    if (clash) fail(`“${placed.name}” overlaps “${clash.name}” on the same wall.`);
    features.push(placed);
  });

  const acceptedOverlaps = Array.isArray(data.acceptedOverlaps)
    ? data.acceptedOverlaps.filter((key): key is string => typeof key === 'string' && key.length < 300).slice(0, MAX_ITEMS)
    : [];

  return { schemaVersion: CURRENT_SCHEMA_VERSION, name, units, room, furniture, features, acceptedOverlaps };
}

function parseRoom(raw: unknown): Room {
  if (!isRecord(raw)) fail('The room’s measurements are missing.');
  const [width, length, height] = [raw.width, raw.length, raw.height].map((v) => positive(v, 'room size'));
  if (Math.max(width, length, height) > MAX_ROOM_SIZE) fail('The room in this file is unrealistically large.');
  return { width, length, height, floor: parseFloor(raw.floor) };
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
  return {
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
  };
}

function parseFeature(raw: unknown, index: number, uniqueId: (id: unknown) => string, room: Room): RoomFeature {
  const label = `Room feature ${index + 1}`;
  if (!isRecord(raw)) fail(`${label} is damaged.`);
  const kind = oneOf(raw.kind, FEATURE_KINDS, null);
  if (!kind) fail(`${label} has an unknown type.`);

  const feature: RoomFeature = {
    id: uniqueId(raw.id),
    name: typeof raw.name === 'string' ? raw.name.slice(0, MAX_NAME_LENGTH) : 'Untitled feature',
    kind,
    placement: parsePlacement(raw.placement, label),
    width: positive(raw.width, `${label}’s width`),
    depth: nonNegative(raw.depth, `${label}’s depth`),
    height: nonNegative(raw.height, `${label}’s height`),
    elevation: nonNegative(raw.elevation, `${label}’s height above the floor`),
    clearance: nonNegative(raw.clearance, `${label}’s clearance`),
  };
  // Kind-specific options: keep only valid values for the right kind.
  if (kind === 'door') {
    feature.doorType = oneOf(raw.doorType, ['hinged', 'double', 'sliding'] as const, 'hinged');
    feature.swing = oneOf(raw.swing, ['in', 'out'] as const, 'in');
    feature.hinge = oneOf(raw.hinge, ['left', 'right'] as const, 'left');
  }
  if (kind === 'vent') feature.ventMount = oneOf(raw.ventMount, ['wall', 'floor', 'ceiling'] as const, 'floor');
  if (kind === 'outlet') feature.outletType = oneOf(raw.outletType, ['standard', 'usb', 'gfci', 'highVoltage'] as const, 'standard');
  if (kind === 'light') feature.lightType = oneOf(raw.lightType, ['pendant', 'flush', 'recessed', 'chandelier'] as const, 'pendant');
  if (kind === 'column') feature.shape = oneOf(raw.shape, ['square', 'round'] as const, 'square');
  // Make sure e.g. a door isn't stored as free-standing.
  return convertPlacement(feature, allowedPlacement(feature), room);
}

function parsePlacement(raw: unknown, label: string): Placement {
  if (isRecord(raw) && raw.type === 'wall') {
    const wall = oneOf(raw.wall, WALLS, null);
    if (!wall || !finite(raw.offset)) fail(`${label} has an invalid wall position.`);
    return { type: 'wall', wall, offset: raw.offset };
  }
  if (isRecord(raw) && raw.type === 'free' && [raw.x, raw.y, raw.rotation].every(finite)) {
    return { type: 'free', x: raw.x as number, y: raw.y as number, rotation: normalizeRotation(raw.rotation as number) };
  }
  fail(`${label} has an invalid position.`);
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
