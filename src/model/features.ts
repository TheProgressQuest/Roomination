import { rotatedHalfExtents } from './geometry';
import { arcPoints, type Polygon } from './polygon';
import type { FeatureKind, FreePlacement, Point, Room, RoomFeature, Wall, WallPlacement } from './types';

/**
 * Geometry for architectural features (doors, windows, vents, …).
 *
 * Each feature is described in its own LOCAL frame and then placed in the room:
 *   - Wall features: local x runs along the wall, local y points INTO the room,
 *     and the origin is the feature's centre on the wall's inside face.
 *   - Free features: local axes are the feature's own (rotated) axes, origin at its centre.
 * Both cases reduce to "origin + rotation", so drawing and collision code can share
 * one set of local shapes and one transform.
 */

export const WALLS: Wall[] = ['top', 'right', 'bottom', 'left'];

/**
 * Rotation that maps local axes onto each wall. Local +x is the viewer's right when
 * standing in the room facing that wall, and local +y points back into the room.
 */
export const WALL_ANGLE: Record<Wall, number> = { top: 0, right: 90, bottom: 180, left: 270 };

/** Which kinds may be wall-mounted vs free-standing. Vents can be either. */
export function allowedPlacement(feature: Pick<RoomFeature, 'kind' | 'ventMount'>): 'wall' | 'free' {
  switch (feature.kind) {
    case 'door':
    case 'window':
    case 'outlet':
    case 'switch':
    case 'radiator':
      return 'wall';
    case 'light':
    case 'column':
      return 'free';
    case 'vent':
      return feature.ventMount === 'wall' ? 'wall' : 'free';
  }
}

/** Doors and windows cut real openings in the wall, so they can't overlap each other. */
export function isWallOpening(feature: Pick<RoomFeature, 'kind'>): boolean {
  return feature.kind === 'door' || feature.kind === 'window';
}

export function wallLength(wall: Wall, room: Pick<Room, 'width' | 'length'>): number {
  return wall === 'top' || wall === 'bottom' ? room.width : room.length;
}

export interface Frame {
  x: number;
  y: number;
  /** Clockwise degrees. */
  angle: number;
}

/** Where a wall position sits in the room. */
export function wallFrame(placement: Pick<WallPlacement, 'wall' | 'offset'>, room: Pick<Room, 'width' | 'length'>): Frame {
  const { wall, offset } = placement;
  const angle = WALL_ANGLE[wall];
  switch (wall) {
    case 'top':
      return { x: offset, y: 0, angle };
    case 'right':
      return { x: room.width, y: offset, angle };
    case 'bottom':
      return { x: offset, y: room.length, angle };
    case 'left':
      return { x: 0, y: offset, angle };
  }
}

export function featureFrame(feature: RoomFeature, room: Pick<Room, 'width' | 'length'>): Frame {
  const p = feature.placement;
  return p.type === 'wall' ? wallFrame(p, room) : { x: p.x, y: p.y, angle: p.rotation };
}

/** Converts a point from a frame's local coordinates into room coordinates. */
export function toRoom(frame: Frame, local: Point): Point {
  const rad = (frame.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: frame.x + local.x * cos - local.y * sin, y: frame.y + local.x * sin + local.y * cos };
}

/** A local-space rectangle spanning x0..x1, y0..y1. */
function localRect(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function circlePolygon(radius: number, segments = 24): Point[] {
  return arcPoints(0, 0, radius, 0, 360, segments).slice(0, -1);
}

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

/** One swinging door leaf, in the door's local frame (angles: clockwise from +x). */
export interface DoorLeaf {
  hinge: Point;
  radius: number;
  /** Angle of the leaf when closed (lying in the wall). */
  closedDeg: number;
  /** Angle of the leaf when fully open (perpendicular to the wall). */
  openDeg: number;
}

/**
 * The leaves of a hinged or double door. Inward doors swing towards local +y (into
 * the room); outward doors towards −y. A "left" hinge sits on the viewer's left
 * when facing the door from inside the room.
 */
export function doorLeaves(door: Pick<RoomFeature, 'width' | 'doorType' | 'swing' | 'hinge'>): DoorLeaf[] {
  const half = door.width / 2;
  const open = door.swing === 'out' ? -90 : 90;
  if (door.doorType === 'sliding') return [];
  if (door.doorType === 'double') {
    return [
      { hinge: { x: -half, y: 0 }, radius: half, closedDeg: 0, openDeg: open },
      { hinge: { x: half, y: 0 }, radius: half, closedDeg: 180, openDeg: 180 - open },
    ];
  }
  return door.hinge === 'right'
    ? [{ hinge: { x: half, y: 0 }, radius: door.width, closedDeg: 180, openDeg: 180 - open }]
    : [{ hinge: { x: -half, y: 0 }, radius: door.width, closedDeg: 0, openDeg: open }];
}

// ---------------------------------------------------------------------------
// Zones: the floor areas furniture should stay out of
// ---------------------------------------------------------------------------

/**
 * - solid:     the feature physically occupies this floor (radiator, column)
 * - footprint: the feature's working face (vent grille); covering it obstructs it
 * - clearance: space to keep free (door swing, outlet access, vent airflow)
 */
export type ZoneType = 'solid' | 'footprint' | 'clearance';

export interface Zone {
  type: ZoneType;
  polygon: Polygon;
  /** Furniture shorter than this doesn't count (e.g. a low table under a light switch). */
  minHeight: number;
}

/** How far in front of a wall vent counts as covering its grille, in cm. */
const WALL_VENT_FACE_DEPTH = 15;
/** Extra reach on each side of outlets and switches, in cm. */
const ACCESS_SIDE_MARGIN = 10;
/**
 * Wall-mounted items only count as blocked by furniture that reaches within this
 * many cm of their bottom edge (a 75 cm desk doesn't block a switch at 110 cm).
 */
const HEIGHT_TOLERANCE = 10;

/** Zones in room coordinates, most severe first. */
export function featureZones(feature: RoomFeature, room: Pick<Room, 'width' | 'length'>): Zone[] {
  const frame = featureFrame(feature, room);
  return localZones(feature).map((zone) => ({ ...zone, polygon: zone.polygon.map((p) => toRoom(frame, p)) }));
}

/** Zones in the feature's own local frame (used for drawing, so they move with the feature). */
export function localZones(feature: RoomFeature): Zone[] {
  const { width: w, depth: d, clearance: c } = feature;
  const reachHeight = Math.max(0, feature.elevation - HEIGHT_TOLERANCE);
  const zones: Zone[] = [];

  switch (feature.kind) {
    case 'door': {
      const leaves = doorLeaves(feature);
      if (feature.swing !== 'out' && leaves.length > 0) {
        // The swing path: a pie slice per leaf. Each slice is convex, as clipping requires.
        for (const leaf of leaves) {
          const arc = arcPoints(leaf.hinge.x, leaf.hinge.y, leaf.radius, leaf.closedDeg, leaf.openDeg, 12);
          zones.push({ type: 'clearance', polygon: [leaf.hinge, ...arc], minHeight: 0 });
        }
      } else if (c > 0) {
        // Outward and sliding doors still need a clear walkway inside.
        zones.push({ type: 'clearance', polygon: localRect(-w / 2, 0, w / 2, c), minHeight: 0 });
      }
      break;
    }
    case 'vent': {
      if (feature.ventMount === 'ceiling') break;
      if (feature.ventMount === 'wall') {
        zones.push({ type: 'footprint', polygon: localRect(-w / 2, 0, w / 2, WALL_VENT_FACE_DEPTH), minHeight: reachHeight });
        if (c > 0) zones.push({ type: 'clearance', polygon: localRect(-w / 2, 0, w / 2, c), minHeight: reachHeight });
      } else {
        zones.push({ type: 'footprint', polygon: localRect(-w / 2, -d / 2, w / 2, d / 2), minHeight: 0 });
        if (c > 0) {
          zones.push({ type: 'clearance', polygon: localRect(-w / 2 - c, -d / 2 - c, w / 2 + c, d / 2 + c), minHeight: 0 });
        }
      }
      break;
    }
    case 'outlet':
    case 'switch': {
      if (c > 0) {
        const reach = w / 2 + ACCESS_SIDE_MARGIN;
        zones.push({ type: 'clearance', polygon: localRect(-reach, 0, reach, c), minHeight: reachHeight });
      }
      break;
    }
    case 'radiator': {
      zones.push({ type: 'solid', polygon: localRect(-w / 2, 0, w / 2, d), minHeight: 0 });
      if (c > 0) zones.push({ type: 'clearance', polygon: localRect(-w / 2, 0, w / 2, d + c), minHeight: 0 });
      break;
    }
    case 'column': {
      const round = feature.shape === 'round';
      zones.push({
        type: 'solid',
        polygon: round ? circlePolygon(w / 2) : localRect(-w / 2, -d / 2, w / 2, d / 2),
        minHeight: 0,
      });
      if (c > 0) {
        zones.push({
          type: 'clearance',
          polygon: round ? circlePolygon(w / 2 + c) : localRect(-w / 2 - c, -d / 2 - c, w / 2 + c, d / 2 + c),
          minHeight: 0,
        });
      }
      break;
    }
    case 'window':
    case 'light':
      break;
  }
  return zones;
}

// ---------------------------------------------------------------------------
// Placement rules
// ---------------------------------------------------------------------------

/** Snaps a room point onto the nearest wall, keeping a feature of `width` fully on it. */
export function snapToWall(point: Point, room: Pick<Room, 'width' | 'length'>, width: number): WallPlacement {
  const distances: Record<Wall, number> = {
    top: point.y,
    bottom: room.length - point.y,
    left: point.x,
    right: room.width - point.x,
  };
  const wall = WALLS.reduce((best, w) => (distances[w] < distances[best] ? w : best), 'top' as Wall);
  const along = wall === 'top' || wall === 'bottom' ? point.x : point.y;
  return { type: 'wall', wall, offset: clampOffset(along, wallLength(wall, room), width) };
}

export function clampOffset(offset: number, wallLen: number, width: number): number {
  if (width >= wallLen) return wallLen / 2;
  return Math.min(Math.max(offset, width / 2), wallLen - width / 2);
}

/** Size of a free feature's floor footprint used for keeping it inside the room. */
function freeExtents(feature: RoomFeature, rotation: number) {
  const round = feature.kind === 'light' || (feature.kind === 'column' && feature.shape === 'round');
  return round
    ? { halfX: feature.width / 2, halfY: feature.width / 2 }
    : rotatedHalfExtents(feature.width, feature.depth, rotation);
}

/**
 * Returns the feature with its placement adjusted to sit fully inside the room
 * (or fully along its wall), or null if it is too big to fit at all.
 */
export function clampFeatureToRoom(feature: RoomFeature, room: Pick<Room, 'width' | 'length'>): RoomFeature | null {
  const p = feature.placement;
  if (p.type === 'wall') {
    const len = wallLength(p.wall, room);
    if (feature.width > len + 1e-6) return null;
    // Projection into the room must fit across the room too.
    const across = p.wall === 'top' || p.wall === 'bottom' ? room.length : room.width;
    if (feature.depth > across + 1e-6) return null;
    return { ...feature, placement: { ...p, offset: clampOffset(p.offset, len, feature.width) } };
  }
  const { halfX, halfY } = freeExtents(feature, p.rotation);
  if (halfX * 2 > room.width + 1e-6 || halfY * 2 > room.length + 1e-6) return null;
  const clamp = (v: number, half: number, max: number) => (half * 2 >= max ? max / 2 : Math.min(Math.max(v, half), max - half));
  const placement: FreePlacement = { ...p, x: clamp(p.x, halfX, room.width), y: clamp(p.y, halfY, room.length) };
  return { ...feature, placement };
}

/** Converts a feature between wall-mounted and free placement, keeping it near where it was. */
export function convertPlacement(feature: RoomFeature, target: 'wall' | 'free', room: Pick<Room, 'width' | 'length'>): RoomFeature {
  const p = feature.placement;
  if (p.type === target) return feature;
  if (p.type === 'free') {
    return { ...feature, placement: snapToWall(p, room, feature.width) };
  }
  // Step off the wall into the room, facing the same way.
  const frame = wallFrame(p, room);
  const centre = toRoom(frame, { x: 0, y: feature.depth / 2 + 5 });
  return { ...feature, placement: { type: 'free', x: centre.x, y: centre.y, rotation: frame.angle } };
}

/** The interval a wall opening occupies along its wall. */
export function openingSpan(feature: RoomFeature): { wall: Wall; start: number; end: number } | null {
  if (!isWallOpening(feature) || feature.placement.type !== 'wall') return null;
  const { wall, offset } = feature.placement;
  return { wall, start: offset - feature.width / 2, end: offset + feature.width / 2 };
}

/** Another door or window on the same wall that this opening would overlap, if any. */
export function findOverlappingOpening(feature: RoomFeature, others: RoomFeature[]): RoomFeature | null {
  const span = openingSpan(feature);
  if (!span) return null;
  return findOpeningInSpan(span, others.filter((other) => other.id !== feature.id));
}

function findOpeningInSpan(span: { wall: Wall; start: number; end: number }, features: RoomFeature[]): RoomFeature | null {
  for (const other of features) {
    const o = openingSpan(other);
    // Half a centimetre of tolerance lets openings sit exactly side by side.
    if (o && o.wall === span.wall && span.start < o.end - 0.5 && o.start < span.end - 0.5) return other;
  }
  return null;
}

/** Finds a spot along the walls where a new opening of `width` fits, preferring `preferred`. */
export function findFreeWallSpot(
  features: RoomFeature[],
  room: Pick<Room, 'width' | 'length'>,
  width: number,
  preferred: Wall,
): WallPlacement | null {
  const order = [preferred, ...WALLS.filter((w) => w !== preferred)];
  for (const wall of order) {
    const len = wallLength(wall, room);
    if (width > len) continue;
    // Try the middle of the wall first, then step outwards towards the corners.
    for (let step = 0; step <= len / 2; step += 10) {
      for (const candidate of [len / 2 - step, len / 2 + step]) {
        const offset = clampOffset(candidate, len, width);
        const span = { wall, start: offset - width / 2, end: offset + width / 2 };
        if (!findOpeningInSpan(span, features)) return { type: 'wall', wall, offset };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Defaults for new features
// ---------------------------------------------------------------------------

export const FEATURE_LABELS: Record<FeatureKind, string> = {
  door: 'Door',
  window: 'Window',
  vent: 'Vent',
  outlet: 'Outlet',
  switch: 'Light switch',
  light: 'Ceiling light',
  radiator: 'Radiator',
  column: 'Column',
};

/** Sensible real-world defaults (cm) for each kind. Placement is decided by the caller. */
export function featureDefaults(kind: FeatureKind, room: Pick<Room, 'height'>): Omit<RoomFeature, 'id' | 'placement'> {
  const name = FEATURE_LABELS[kind];
  switch (kind) {
    case 'door':
      return { name, kind, width: 80, depth: 0, height: 205, elevation: 0, clearance: 50, doorType: 'hinged', swing: 'in', hinge: 'left' };
    case 'window':
      return { name, kind, width: 120, depth: 0, height: 120, elevation: 90, clearance: 0 };
    case 'vent':
      return { name: 'Floor vent', kind, width: 30, depth: 12, height: 2, elevation: 0, clearance: 30, ventMount: 'floor' };
    case 'outlet':
      return { name, kind, width: 8, depth: 3, height: 12, elevation: 30, clearance: 30, outletType: 'standard' };
    case 'switch':
      return { name, kind, width: 8, depth: 2, height: 12, elevation: 110, clearance: 30 };
    case 'light':
      return { name, kind, width: 40, depth: 40, height: 30, elevation: Math.max(0, room.height - 30), clearance: 0, lightType: 'pendant' };
    case 'radiator':
      return { name, kind, width: 100, depth: 12, height: 60, elevation: 10, clearance: 30 };
    case 'column':
      return { name, kind, width: 40, depth: 40, height: room.height, elevation: 0, clearance: 0, shape: 'square' };
  }
}
