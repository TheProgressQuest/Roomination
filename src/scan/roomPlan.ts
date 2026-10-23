import type { Point } from '../model/types';
import type { ScanConfidence, ScanData, ScanObject, ScanOpening, ScanOpeningKind, ScanSection, ScanWall } from './types';

/**
 * Reads Apple RoomPlan's `CapturedRoom` / `CapturedStructure` JSON (what `JSONEncoder` writes
 * for them on iOS 16–18, and what 3D Model Anything saves as `rooms/room-N.json` and
 * `structure.json`) into a measured `ScanData`.
 *
 * The JSON, as written by Swift's Codable:
 *   - `walls`, `doors`, `windows`, `openings`, `floors`: surfaces; `objects`: furniture boxes;
 *     `sections` (iOS 17+): labelled areas.
 *   - `category` is an enum written as a one-key object: `{"wall":{}}`, `{"door":{"isOpen":true}}`,
 *     `{"storage":{}}`. `confidence` likewise: `{"high":{}}`. Plain strings are accepted too.
 *   - `transform` is a 4×4 matrix, column-major: 16 numbers, or 4 columns of 4. Its last column
 *     is the element's centre; its first column runs along the element's width, its third
 *     column is its depth axis (a surface's normal; an object's front, "usually").
 *   - `dimensions` is [width, height, depth] in metres (depth is 0 for surfaces).
 *   - Coordinates are metres in the scan's own world: +Y up (gravity), right-handed.
 *
 * Projecting to the plan: x = X × 100, y = Z × 100. Looking down from above with X to the
 * right, Z points down the screen, so this keeps left and right the right way round.
 */

/** Upper limits that no real single-floor scan approaches; larger files are refused. */
export const SCAN_LIMITS = {
  walls: 1000,
  openings: 1000,
  objects: 2000,
  sections: 200,
  floorCorners: 2000,
  /** Metres from the scan's origin. */
  coordinate: 1000,
  /** Largest single dimension, metres. */
  dimension: 100,
};

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export class ScanFormatError extends Error {}

/** True if the data looks like a RoomPlan room or structure (and not something else entirely). */
export function looksLikeRoomPlan(data: unknown): data is Json {
  return isRecord(data) && Array.isArray(data.walls) && ['doors', 'windows', 'openings', 'objects', 'floors', 'identifier', 'version'].some((k) => k in data);
}

/** The enum case name of a Codable enum value: `{"door":{…}}` → "door"; "door" → "door". */
export function enumCase(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (isRecord(v)) {
    const keys = Object.keys(v);
    if (keys.length === 1) return keys[0];
  }
  return null;
}

function confidenceOf(v: unknown): ScanConfidence {
  const c = enumCase(v);
  return c === 'high' || c === 'medium' || c === 'low' ? c : 'unknown';
}

interface Pose {
  /** Centre, metres. */
  t: [number, number, number];
  /** Width axis (first column) and depth axis (third column). */
  x: [number, number, number];
  z: [number, number, number];
}

/** Reads a column-major 4×4 matrix, rejecting anything that isn't a plain rigid placement. */
function poseOf(v: unknown): Pose | null {
  let m: number[] | null = null;
  if (Array.isArray(v) && v.length === 16 && v.every(finite)) m = v as number[];
  else if (Array.isArray(v) && v.length === 4 && v.every((c) => Array.isArray(c) && c.length === 4 && c.every(finite))) m = (v as number[][]).flat();
  if (!m) return null;
  const x: [number, number, number] = [m[0], m[1], m[2]];
  const y: [number, number, number] = [m[4], m[5], m[6]];
  const z: [number, number, number] = [m[8], m[9], m[10]];
  const t: [number, number, number] = [m[12], m[13], m[14]];
  const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
  // A rotation's columns have unit length; anything else (scaled, skewed or broken) is refused.
  if (![x, y, z].every((c) => Math.abs(len(c) - 1) < 0.02)) return null;
  if (t.some((c) => Math.abs(c) > SCAN_LIMITS.coordinate)) return null;
  return { t, x, z };
}

function dimensionsOf(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(finite)) return null;
  if (v.some((d) => d < 0 || d > SCAN_LIMITS.dimension)) return null;
  return [v[0], v[1], v[2]];
}

function pointOf(v: unknown): [number, number, number] | null {
  if (Array.isArray(v) && v.length === 3 && v.every(finite) && v.every((c) => Math.abs(c) <= SCAN_LIMITS.coordinate)) return [v[0], v[1], v[2]];
  return null;
}

const plan = (X: number, Z: number): Point => ({ x: X * 100, y: Z * 100 });

/** Turns a scanner identifier into a short, stable id that's safe to store. */
export function stableId(prefix: string, raw: unknown, index: number, used: Set<string>): string {
  const cleaned = typeof raw === 'string' ? raw.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 36) : '';
  let id = cleaned ? `${prefix}-${cleaned}` : `${prefix}-${index + 1}`;
  for (let n = 2; used.has(id); n++) id = `${cleaned ? `${prefix}-${cleaned}` : `${prefix}-${index + 1}`}-${n}`;
  used.add(id);
  return id;
}

function list(data: Json, key: string, limit: number, label: string): unknown[] {
  const value = data[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ScanFormatError(`The scan’s ${label} aren’t in the expected format.`);
  if (value.length > limit) throw new ScanFormatError(`The scan has too many ${label} (${value.length.toLocaleString('en')}; the limit is ${limit.toLocaleString('en')}).`);
  return value;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function parseRoomPlan(data: unknown, source: string, name = 'Scanned room'): ScanData {
  if (!looksLikeRoomPlan(data)) throw new ScanFormatError('That file isn’t a RoomPlan room scan.');
  const notes: string[] = [];
  const used = new Set<string>();

  const rawWalls = list(data, 'walls', SCAN_LIMITS.walls, 'walls');
  const rawFloors = list(data, 'floors', SCAN_LIMITS.walls, 'floors');
  const rawDoors = list(data, 'doors', SCAN_LIMITS.openings, 'doors');
  const rawWindows = list(data, 'windows', SCAN_LIMITS.openings, 'windows');
  const rawOpenings = list(data, 'openings', SCAN_LIMITS.openings, 'openings');
  const rawObjects = list(data, 'objects', SCAN_LIMITS.objects, 'objects');
  const rawSections = list(data, 'sections', SCAN_LIMITS.sections, 'sections');

  // A merged structure can span several floors ("stories"); a plan shows one.
  const storyOf = (e: unknown) => (isRecord(e) && finite(e.story) ? e.story : 0);
  const stories = new Map<number, number>();
  for (const w of rawWalls) stories.set(storyOf(w), (stories.get(storyOf(w)) ?? 0) + 1);
  const story = [...stories.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
  if (stories.size > 1) notes.push(`The scan covers ${stories.size} floors of a building; only the floor with the most walls (${plural(stories.get(story) ?? 0, 'wall')}) is imported.`);
  const onStory = (e: unknown) => storyOf(e) === story;

  // Floor height: the floor surface if there is one, otherwise the lowest wall bottom.
  let floorY: number | null = null;
  let floorPose: Pose | null = null;
  let floorCorners: unknown = null;
  for (const f of rawFloors) {
    if (!isRecord(f) || !onStory(f)) continue;
    const pose = poseOf(f.transform);
    if (pose) {
      floorY = pose.t[1];
      floorPose = pose;
      floorCorners = f.polygonCorners;
      break;
    }
  }

  const walls: ScanWall[] = [];
  const wallIds = new Map<string, string>();
  let skipped = 0;
  let sloped = 0;
  const wallBottoms: number[] = [];
  rawWalls.forEach((raw, i) => {
    if (!isRecord(raw) || !onStory(raw)) return;
    const pose = poseOf(raw.transform);
    const dims = dimensionsOf(raw.dimensions);
    if (!pose || !dims || dims[0] <= 0) {
      skipped++;
      return;
    }
    const along = Math.hypot(pose.x[0], pose.x[2]);
    if (along < 0.9) {
      // Its width runs mostly up or down: not a wall a floor plan can show.
      sloped++;
      return;
    }
    const ux = pose.x[0] / along;
    const uz = pose.x[2] / along;
    const half = dims[0] / 2;
    const id = stableId('scan-wall', raw.identifier, i, used);
    if (typeof raw.identifier === 'string') wallIds.set(raw.identifier, id);
    wallBottoms.push(pose.t[1] - dims[1] / 2);
    walls.push({
      id,
      a: plan(pose.t[0] - ux * half, pose.t[2] - uz * half),
      b: plan(pose.t[0] + ux * half, pose.t[2] + uz * half),
      height: dims[1] * 100,
      confidence: confidenceOf(raw.confidence),
      curved: isRecord(raw.curve),
    });
  });
  if (skipped) notes.push(`${plural(skipped, 'wall')} had missing or invalid measurements and ${skipped === 1 ? 'was' : 'were'} left out.`);
  if (sloped) notes.push(`${plural(sloped, 'sloped surface')} reported as ${sloped === 1 ? 'a wall' : 'walls'} can’t be shown on a floor plan and ${sloped === 1 ? 'was' : 'were'} left out.`);
  if (floorY === null) floorY = wallBottoms.length ? Math.min(...wallBottoms) : 0;
  const fy = floorY;

  const openings: ScanOpening[] = [];
  let badOpenings = 0;
  const addOpenings = (raws: unknown[], fallback: ScanOpeningKind) => {
    raws.forEach((raw, i) => {
      if (!isRecord(raw) || !onStory(raw)) return;
      const pose = poseOf(raw.transform);
      const dims = dimensionsOf(raw.dimensions);
      if (!pose || !dims || dims[0] <= 0 || dims[1] <= 0) {
        badOpenings++;
        return;
      }
      const category = enumCase(raw.category);
      const kind: ScanOpeningKind = category === 'door' || category === 'window' || category === 'opening' ? category : fallback;
      const parent = typeof raw.parentIdentifier === 'string' ? (wallIds.get(raw.parentIdentifier) ?? null) : null;
      const bottom = (pose.t[1] - dims[1] / 2 - fy) * 100;
      openings.push({
        id: stableId(`scan-${kind}`, raw.identifier, i, used),
        kind,
        wallId: parent,
        center: plan(pose.t[0], pose.t[2]),
        width: dims[0] * 100,
        height: dims[1] * 100,
        // A few centimetres either way of the floor is measurement noise for a door.
        bottom: kind === 'window' ? Math.max(0, bottom) : Math.abs(bottom) < 10 ? 0 : Math.max(0, bottom),
        confidence: confidenceOf(raw.confidence),
      });
    });
  };
  addOpenings(rawDoors, 'door');
  addOpenings(rawWindows, 'window');
  addOpenings(rawOpenings, 'opening');
  if (badOpenings) notes.push(`${plural(badOpenings, 'door or window')} had missing or invalid measurements and ${badOpenings === 1 ? 'was' : 'were'} left out.`);

  const objects: ScanObject[] = [];
  let badObjects = 0;
  rawObjects.forEach((raw, i) => {
    if (!isRecord(raw) || !onStory(raw)) return;
    const pose = poseOf(raw.transform);
    const dims = dimensionsOf(raw.dimensions);
    if (!pose || !dims || dims.some((d) => d <= 0)) {
      badObjects++;
      return;
    }
    // Roomination's rotation turns a piece's front (+y) to face `front`: (−sin θ, cos θ).
    const front = { x: pose.z[0], y: pose.z[2] };
    const rotation = Math.hypot(front.x, front.y) < 0.2 ? 0 : (((Math.atan2(-front.x, front.y) * 180) / Math.PI) % 360 + 360) % 360;
    const category = (enumCase(raw.category) ?? 'unknown').replace(/[^A-Za-z]/g, '').slice(0, 30) || 'unknown';
    objects.push({
      id: stableId('scan-object', raw.identifier, i, used),
      category,
      center: plan(pose.t[0], pose.t[2]),
      width: dims[0] * 100,
      depth: dims[2] * 100,
      height: dims[1] * 100,
      bottom: Math.max(0, (pose.t[1] - dims[1] / 2 - fy) * 100),
      rotation,
      confidence: confidenceOf(raw.confidence),
    });
  });
  if (badObjects) notes.push(`${plural(badObjects, 'object')} had missing or invalid measurements and ${badObjects === 1 ? 'was' : 'were'} left out.`);

  const sections: ScanSection[] = [];
  for (const raw of rawSections) {
    if (!isRecord(raw) || !onStory(raw)) continue;
    const label = enumCase(raw.label);
    const centre = pointOf(raw.center);
    if (label && centre) sections.push({ label: label.replace(/[^A-Za-z]/g, '').slice(0, 30), center: plan(centre[0], centre[2]) });
  }

  let floor: Point[] | null = null;
  if (floorPose && Array.isArray(floorCorners) && floorCorners.length >= 3 && floorCorners.length <= SCAN_LIMITS.floorCorners) {
    const corners = floorCorners.map(pointOf);
    if (corners.every((c) => c !== null)) {
      const { t, x, z } = floorPose;
      // Corners are in the floor's own frame; its second axis is y = z × x.
      const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
      floor = (corners as [number, number, number][]).map(([a, b, c]) => plan(t[0] + x[0] * a + y[0] * b + z[0] * c, t[2] + x[2] * a + y[2] * b + z[2] * c));
    }
  }

  if (walls.length === 0 && !floor) throw new ScanFormatError('The scan doesn’t contain any walls Roomination can use.');
  const label = sections.length === 1 ? sectionName(sections[0].label) : null;
  return { format: 'roomplan', source, name: label ?? name, walls, openings, objects, floor, sections, notes };
}

const SECTION_NAMES: Record<string, string> = {
  livingRoom: 'Living room',
  kitchen: 'Kitchen',
  diningRoom: 'Dining room',
  bedroom: 'Bedroom',
  bathroom: 'Bathroom',
};

export function sectionName(label: string): string | null {
  return SECTION_NAMES[label] ?? null;
}
