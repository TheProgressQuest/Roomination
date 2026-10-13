import { rotatedHalfExtents } from './geometry';
import { resolvePosition } from './placement';
import { arcPoints, convexInsidePolygon, rectPolygon, type Polygon } from './polygon';
import type { FeatureKind, FreePlacement, Point, Room, RoomFeature, WallPlacement } from './types';
import { findSegment, nearestWall, outlinePolygon, outlineSegments, pointAlong, roomBounds, wallSegments } from './walls';

/**
 * Geometry for architectural features (doors, windows, vents, …).
 *
 * Each feature is described in its own LOCAL frame and then placed in the room:
 *   - Wall features: local x runs along the wall segment (start → end), local y points
 *     to the segment's right — INTO the room for outer walls, which are stored
 *     clockwise. The origin is the feature's centre on the wall's inner face.
 *   - Free features: local axes are the feature's own (rotated) axes, origin at its centre.
 * Both reduce to "origin + rotation", so drawing and collision code share one set of
 * local shapes and one transform — and a door's swing turns with its wall automatically.
 */

type RoomWalls = Pick<Room, 'outline' | 'partitions'>;

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

export interface Frame {
  x: number;
  y: number;
  /** Clockwise degrees. */
  angle: number;
}

/** Where a wall position sits in the room, or null if the wall doesn't exist. */
export function wallFrame(placement: Pick<WallPlacement, 'wallId' | 'offset'>, room: RoomWalls): Frame | null {
  const segment = findSegment(room, placement.wallId);
  if (!segment) return null;
  return { ...pointAlong(segment, placement.offset), angle: segment.angle };
}

export function featureFrame(feature: RoomFeature, room: RoomWalls): Frame {
  const p = feature.placement;
  if (p.type === 'free') return { x: p.x, y: p.y, angle: p.rotation };
  // A missing wall only happens with invalid data, which the reducer never stores.
  return wallFrame(p, room) ?? { x: 0, y: 0, angle: 0 };
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
export function featureZones(feature: RoomFeature, room: RoomWalls): Zone[] {
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

/** Snaps a room point onto the nearest wall long enough to hold a feature of `width`. */
export function snapToWall(point: Point, room: RoomWalls, width: number): WallPlacement | null {
  const nearest = nearestWall(room, point, width);
  if (!nearest) return null;
  return { type: 'wall', wallId: nearest.segment.id, offset: clampOffset(nearest.offset, nearest.segment.length, width) };
}

export function clampOffset(offset: number, wallLen: number, width: number): number {
  if (width >= wallLen) return wallLen / 2;
  return Math.min(Math.max(offset, width / 2), wallLen - width / 2);
}

/** Floor footprint of a free feature centred at `centre`. Lights and round columns are circles. */
export function freeFootprint(feature: RoomFeature, centre: Point, rotation: number): Polygon {
  const round = feature.kind === 'light' || (feature.kind === 'column' && feature.shape === 'round');
  if (round) return arcPoints(centre.x, centre.y, feature.width / 2, 0, 360, 16).slice(0, -1);
  return rectPolygon(centre.x, centre.y, feature.width, feature.depth, rotation);
}

function freeExtents(feature: RoomFeature, rotation: number) {
  const round = feature.kind === 'light' || (feature.kind === 'column' && feature.shape === 'round');
  return round ? { halfX: feature.width / 2, halfY: feature.width / 2 } : rotatedHalfExtents(feature.width, feature.depth, rotation);
}

/**
 * Returns the feature adjusted to sit fully inside the room (or fully along its wall),
 * or null if it can't fit there at all. `from` is the last good position while dragging.
 */
export function clampFeatureToRoom(feature: RoomFeature, room: RoomWalls, from?: Point): RoomFeature | null {
  const p = feature.placement;
  if (p.type === 'wall') {
    const segment = findSegment(room, p.wallId);
    if (!segment || feature.width > segment.length + 1e-6) return null;
    return { ...feature, placement: { ...p, offset: clampOffset(p.offset, segment.length, feature.width) } };
  }
  const poly = outlinePolygon(room);
  const centre = resolvePosition(p, {
    roomBox: roomBounds(room),
    ...freeExtents(feature, p.rotation),
    fits: (c) => convexInsidePolygon(freeFootprint(feature, c, p.rotation), poly),
    from,
  });
  if (!centre) return null;
  const placement: FreePlacement = { ...p, x: centre.x, y: centre.y };
  return { ...feature, placement };
}

/** Converts a feature between wall-mounted and free placement, keeping it near where it was. */
export function convertPlacement(feature: RoomFeature, target: 'wall' | 'free', room: RoomWalls): RoomFeature {
  const p = feature.placement;
  if (p.type === target) return feature;
  if (p.type === 'free') {
    const placement = snapToWall(p, room, feature.width);
    return placement ? { ...feature, placement } : feature;
  }
  // Step off the wall into the room, facing the same way.
  const frame = wallFrame(p, room);
  if (!frame) return feature;
  const centre = toRoom(frame, { x: 0, y: feature.depth / 2 + 5 });
  return { ...feature, placement: { type: 'free', x: centre.x, y: centre.y, rotation: frame.angle } };
}

/** The stretch of wall a door or window occupies. */
export function openingSpan(feature: RoomFeature): { wallId: string; start: number; end: number } | null {
  if (!isWallOpening(feature) || feature.placement.type !== 'wall') return null;
  const { wallId, offset } = feature.placement;
  return { wallId, start: offset - feature.width / 2, end: offset + feature.width / 2 };
}

/** Another door or window on the same wall that this opening would overlap, if any. */
export function findOverlappingOpening(feature: RoomFeature, others: RoomFeature[]): RoomFeature | null {
  const span = openingSpan(feature);
  if (!span) return null;
  return findOpeningInSpan(span, others.filter((other) => other.id !== feature.id));
}

function findOpeningInSpan(span: { wallId: string; start: number; end: number }, features: RoomFeature[]): RoomFeature | null {
  for (const other of features) {
    const o = openingSpan(other);
    // Half a centimetre of tolerance lets openings sit exactly side by side.
    if (o && o.wallId === span.wallId && span.start < o.end - 0.5 && o.start < span.end - 0.5) return other;
  }
  return null;
}

/**
 * Finds a spot where a new opening of `width` fits. Outer walls are tried first, starting
 * with `preferredIndex` (e.g. the bottom wall of a rectangle for doors), then interior walls.
 */
export function findFreeWallSpot(features: RoomFeature[], room: RoomWalls, width: number, preferredIndex = 0): WallPlacement | null {
  const outer = outlineSegments(room);
  const ordered = [...outer.slice(preferredIndex % outer.length), ...outer.slice(0, preferredIndex % outer.length)];
  const interior = wallSegments(room).filter((s) => s.chain !== 'outline');
  for (const segment of [...ordered, ...interior]) {
    const len = segment.length;
    if (width > len) continue;
    // Try the middle of the wall first, then step outwards towards the corners.
    for (let step = 0; step <= len / 2; step += 10) {
      for (const candidate of [len / 2 - step, len / 2 + step]) {
        const offset = clampOffset(candidate, len, width);
        const span = { wallId: segment.id, start: offset - width / 2, end: offset + width / 2 };
        if (!findOpeningInSpan(span, features)) return { type: 'wall', wallId: segment.id, offset };
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
