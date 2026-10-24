import type { Point } from '../model/types';
import { attributesOf, SCAN_LIMITS, ScanFormatError, stableId } from './roomPlan';
import type { ScanConfidence, ScanData, ScanObject, ScanOpening, ScanOpeningKind, ScanWall } from './types';

/**
 * `roomination-scan` version 1: a small, documented file a scanner app can write for
 * Roomination directly (see docs/scan-import.md). It is ScanData written out, already in plan
 * terms: centimetres, seen from above, x right, y down, rotations clockwise, a piece's front
 * at +y.
 *
 * {
 *   "format": "roomination-scan", "version": 1, "units": "cm",
 *   "name": "Bedroom",
 *   "walls":    [{ "id": "w1", "start": [0, 0], "end": [400, 0], "height": 250, "confidence": "high" }],
 *   "openings": [{ "id": "d1", "kind": "door", "wallId": "w1", "center": [80, 0], "width": 82, "height": 204, "bottom": 0 }],
 *   "objects":  [{ "id": "o1", "category": "bed", "center": [200, 150], "width": 160, "depth": 205,
 *                  "height": 55, "bottom": 0, "rotation": 0, "confidence": "medium" }],
 *   "floor":    [[0, 0], [400, 0], [400, 350], [0, 350]]
 * }
 *
 * `confidence`, `bottom`, `rotation`, `wallId`, `floor` and `name` are optional. Object
 * categories use RoomPlan's words (bed, sofa, storage, …); anything else is kept as-is and
 * imported as a plain box. Objects may also carry RoomPlan's classification details,
 * `"attributes": { "SofaType": "lShapedExtension" }`, and `"parent": "o1"` (the id of the object
 * the scanner linked it to: a sofa's extension to the sofa, a chair to its table).
 */

export const SCAN_FORMAT = 'roomination-scan';
export const SCAN_FORMAT_VERSION = 1;

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const MAX_CM = SCAN_LIMITS.coordinate * 100;

export function looksLikeScanFile(data: unknown): data is Json {
  return isRecord(data) && data.format === SCAN_FORMAT;
}

function point(v: unknown, label: string): Point {
  if (Array.isArray(v) && v.length === 2 && v.every(finite) && v.every((c) => Math.abs(c) <= MAX_CM)) return { x: v[0], y: v[1] };
  throw new ScanFormatError(`${label} has an invalid position.`);
}

function size(v: unknown, label: string, allowZero = false): number {
  if (finite(v) && (allowZero ? v >= 0 : v > 0) && v <= SCAN_LIMITS.dimension * 100) return v;
  throw new ScanFormatError(`${label} has an invalid size.`);
}

function confidence(v: unknown): ScanConfidence {
  return v === 'high' || v === 'medium' || v === 'low' ? v : 'unknown';
}

function items(data: Json, key: string, limit: number): unknown[] {
  const v = data[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new ScanFormatError(`The scan’s “${key}” aren’t a list.`);
  if (v.length > limit) throw new ScanFormatError(`The scan has too many ${key} (the limit is ${limit.toLocaleString('en')}).`);
  return v;
}

export function parseScanFile(data: unknown, source = 'Roomination scan file'): ScanData {
  if (!looksLikeScanFile(data)) throw new ScanFormatError('That file isn’t a Roomination scan.');
  if (data.version !== SCAN_FORMAT_VERSION) throw new ScanFormatError('This scan file was made for a newer version of Roomination.');
  if (data.units !== undefined && data.units !== 'cm') throw new ScanFormatError('Roomination scan files must use centimetres ("units": "cm").');
  const used = new Set<string>();
  const ids = new Map<string, string>();

  const walls: ScanWall[] = items(data, 'walls', SCAN_LIMITS.walls).map((raw, i) => {
    const label = `Wall ${i + 1}`;
    if (!isRecord(raw)) throw new ScanFormatError(`${label} is damaged.`);
    const id = stableId('scan-wall', raw.id, i, used);
    if (typeof raw.id === 'string') ids.set(raw.id, id);
    return { id, a: point(raw.start, label), b: point(raw.end, label), height: size(raw.height, label), confidence: confidence(raw.confidence), curved: false };
  });

  let assumedSills = 0;
  const openings: ScanOpening[] = items(data, 'openings', SCAN_LIMITS.openings).map((raw, i) => {
    const label = `Opening ${i + 1}`;
    if (!isRecord(raw)) throw new ScanFormatError(`${label} is damaged.`);
    const kind: ScanOpeningKind = raw.kind === 'window' || raw.kind === 'opening' ? raw.kind : 'door';
    if (kind === 'window' && raw.bottom === undefined) assumedSills++;
    return {
      id: stableId(`scan-${kind}`, raw.id, i, used),
      kind,
      wallId: typeof raw.wallId === 'string' ? (ids.get(raw.wallId) ?? null) : null,
      center: point(raw.center, label),
      width: size(raw.width, label),
      height: size(raw.height, label),
      bottom: raw.bottom === undefined ? (kind === 'window' ? 90 : 0) : size(raw.bottom, label, true),
      confidence: confidence(raw.confidence),
    };
  });

  const objectIds = new Map<string, string>();
  const parents: (string | null)[] = [];
  const objects: ScanObject[] = items(data, 'objects', SCAN_LIMITS.objects).map((raw, i) => {
    const label = `Object ${i + 1}`;
    if (!isRecord(raw)) throw new ScanFormatError(`${label} is damaged.`);
    const rotation = raw.rotation === undefined ? 0 : finite(raw.rotation) ? ((raw.rotation % 360) + 360) % 360 : NaN;
    if (!Number.isFinite(rotation)) throw new ScanFormatError(`${label} has an invalid rotation.`);
    const id = stableId('scan-object', raw.id, i, used);
    if (typeof raw.id === 'string') objectIds.set(raw.id, id);
    parents.push(typeof raw.parent === 'string' ? raw.parent : null);
    return {
      id,
      category: typeof raw.category === 'string' ? raw.category.replace(/[^A-Za-z]/g, '').slice(0, 30) || 'unknown' : 'unknown',
      center: point(raw.center, label),
      width: size(raw.width, label),
      depth: size(raw.depth, label),
      height: size(raw.height, label),
      bottom: raw.bottom === undefined ? 0 : size(raw.bottom, label, true),
      rotation,
      confidence: confidence(raw.confidence),
      attributes: attributesOf(raw.attributes),
      parentId: null,
    };
  });
  objects.forEach((o, i) => {
    const parent = parents[i] === null ? undefined : objectIds.get(parents[i]!);
    if (parent && parent !== o.id) o.parentId = parent;
  });

  let floor: Point[] | null = null;
  if (data.floor !== undefined) {
    const raw = items(data, 'floor', SCAN_LIMITS.floorCorners);
    if (raw.length < 3) throw new ScanFormatError('The scan’s floor outline needs at least three corners.');
    floor = raw.map((p, i) => point(p, `Floor corner ${i + 1}`));
  }
  if (walls.length === 0 && !floor) throw new ScanFormatError('The scan doesn’t contain any walls.');
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 60) : 'Scanned room';
  const notes = assumedSills ? [`${assumedSills} window${assumedSills === 1 ? ' has' : 's have'} no sill height in the file; 90 cm is assumed. Check it under Openings.`] : [];
  return { format: 'roomination-scan', source, name, walls, openings, objects, floor, sections: [], notes };
}
