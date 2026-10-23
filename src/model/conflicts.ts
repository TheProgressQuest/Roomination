import { featureZones, openingSpan, type Zone, type ZoneType } from './features';
import { boundingBox, polygonArea, rectPolygon, type Polygon } from './polygon';
import { footprintArea, footprintOverlap, localFootprint, pieceToRoom, roomFootprint } from './shape';
import { stairPolygons } from './stairs';
import type { Furniture, Partition, Project, RoomFeature } from './types';
import { partitionSegments, pointAlong } from './walls';

/**
 * Overlap detection between furniture and everything else.
 *
 * Rules:
 *   - Floor coverings (rugs, mats) never conflict with anything.
 *   - Furniture and decorations conflict with each other when they overlap.
 *   - They conflict with obstacles when they intrude on an obstacle's zones:
 *       room features (door swings, vent grilles, outlet access, radiators, columns),
 *       staircases (kept clear as circulation space) and interior walls (solid).
 *
 * A conflict is a warning, not a ban. The user may accept a specific one; that
 * acceptance is stored under a key naming that exact pair and constraint type.
 * (The outer walls are different: furniture is kept inside them by placement rules.)
 */

export type ConflictType =
  /** Two solid things occupy the same floor. */
  | 'collision'
  /** Furniture covers a working face (a vent grille) or circulation space (stairs). */
  | 'obstruction'
  /** Furniture sits in space that should be kept clear. */
  | 'clearance';

export type ObstacleKind = 'furniture' | 'feature' | 'stairs' | 'wall';

export interface Conflict {
  /** Stable identity used for accepting the overlap (see `conflictKey`). */
  key: string;
  /** The furniture piece causing the conflict. */
  itemId: string;
  /** The other furniture piece, room feature, staircase or interior wall. */
  otherId: string;
  otherKind: ObstacleKind;
  type: ConflictType;
  /** Fraction (0–1) of the other object's zone that is covered. */
  coverage: number;
  accepted: boolean;
}

/** Overlaps smaller than this (cm²) are treated as touching, not overlapping. */
const MIN_OVERLAP_AREA = 1;

const ZONE_TO_CONFLICT: Record<ZoneType, ConflictType> = {
  solid: 'collision',
  footprint: 'obstruction',
  clearance: 'clearance',
};
const SEVERITY: ZoneType[] = ['solid', 'footprint', 'clearance'];

/** Key for a piece standing in the space another piece keeps clear in front of it (order matters). */
export function furnitureClearanceKey(itemId: string, ownerId: string): string {
  return `${itemId}|in-front-of|${ownerId}`;
}

/** Key for one specific relationship; order-independent. */
export function conflictKey(a: string, b: string, type: ConflictType): string {
  const [first, second] = a < b ? [a, b] : [b, a];
  return `${first}|${second}|${type}`;
}

export function isSolid(item: Furniture): boolean {
  return item.category !== 'floorCovering';
}

/** A piece's true outline in the room (its drawn shape, or its rectangle). */
export function furniturePolygon(item: Furniture): Polygon {
  return roomFootprint(item).outline;
}

/** The space a piece asks to keep free in front of it (across its full width), or null. */
export function furnitureClearanceZone(item: Furniture): Polygon | null {
  const depth = item.clearance ?? 0;
  if (depth <= 0) return null;
  const box = boundingBox(localFootprint(item).rings.flatMap((r) => r.outer));
  return [
    { x: box.minX, y: box.maxY },
    { x: box.maxX, y: box.maxY },
    { x: box.maxX, y: box.maxY + depth },
    { x: box.minX, y: box.maxY + depth },
  ].map((p) => pieceToRoom(item, p));
}

interface Obstacle {
  id: string;
  kind: Exclude<ObstacleKind, 'furniture'>;
  zones: Zone[];
}

/** Everything that isn't furniture but that furniture should respect. */
export function obstacles(project: Project): Obstacle[] {
  const openings = openingsByWall(project.features);
  return [
    ...project.features.map((feature) => ({ id: feature.id, kind: 'feature' as const, zones: featureZones(feature, project.room) })),
    ...project.stairs.map((stair) => ({
      id: stair.id,
      kind: 'stairs' as const,
      zones: stairPolygons(stair).map((polygon) => ({ type: 'footprint' as const, polygon, minHeight: 0 })),
    })),
    ...project.room.partitions.map((partition) => ({
      id: partition.id,
      kind: 'wall' as const,
      zones: partitionBodies(partition, openings).map((polygon) => ({ type: 'solid' as const, polygon, minHeight: 0 })),
    })),
  ];
}

type Span = NonNullable<ReturnType<typeof openingSpan>>;

/** Door and window openings, grouped by the wall they're in. */
function openingsByWall(features: RoomFeature[]): Map<string, Span[]> {
  const byWall = new Map<string, Span[]>();
  for (const span of features.map(openingSpan)) {
    if (span) byWall.set(span.wallId, [...(byWall.get(span.wallId) ?? []), span]);
  }
  return byWall;
}

/** The solid parts of an interior wall: each segment's thickness, minus door and window openings. */
function partitionBodies(partition: Partition, openings: Map<string, Span[]>): Polygon[] {
  const bodies: Polygon[] = [];
  for (const segment of partitionSegments(partition)) {
    const gaps = [...(openings.get(segment.id) ?? [])].sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const [from, to] of [...gaps.map((g) => [g.start, g.end]), [segment.length, segment.length]]) {
      if (from - cursor > 0.5) {
        const centre = pointAlong(segment, (cursor + from) / 2);
        bodies.push(rectPolygon(centre.x, centre.y, from - cursor, segment.thickness, segment.angle));
      }
      cursor = Math.max(cursor, to);
    }
  }
  return bodies;
}

/**
 * All current conflicts. While dragging, only the moving thing is checked: pass
 * `onlyItemId` for a piece of furniture, or `onlyObstacleId` for a feature or staircase.
 */
export function findConflicts(project: Project, onlyItemId?: string, onlyObstacleId?: string): Conflict[] {
  const accepted = new Set(project.acceptedOverlaps);
  const solids = project.furniture.filter(isSolid);
  const footprints = new Map(solids.map((item) => [item.id, roomFootprint(item)]));
  const clearances = solids.flatMap((owner) => {
    const zone = furnitureClearanceZone(owner);
    return zone ? [{ owner, zone }] : [];
  });
  const others = onlyObstacleId ? obstacles(project).filter((o) => o.id === onlyObstacleId) : obstacles(project);
  const conflicts: Conflict[] = [];

  const add = (itemId: string, otherId: string, otherKind: ObstacleKind, type: ConflictType, coverage: number, key = conflictKey(itemId, otherId, type)) => {
    conflicts.push({ key, itemId, otherId, otherKind, type, coverage: Math.min(1, coverage), accepted: accepted.has(key) });
  };

  for (let i = 0; i < solids.length; i++) {
    const item = solids[i];
    const itemPrint = footprints.get(item.id)!;

    // Furniture vs furniture: each pair once (not needed when checking one obstacle).
    for (let j = i + 1; j < solids.length && !onlyObstacleId; j++) {
      const other = solids[j];
      if (onlyItemId && item.id !== onlyItemId && other.id !== onlyItemId) continue;
      const otherPrint = footprints.get(other.id)!;
      // A mirror above a vanity, or a wall cabinet above a worktop, doesn't collide with it.
      if (!overlapsVertically(item, other)) continue;
      const area = footprintOverlap(itemPrint.parts, otherPrint.parts);
      if (area > MIN_OVERLAP_AREA) {
        const smaller = Math.min(footprintArea(itemPrint), footprintArea(otherPrint));
        add(item.id, other.id, 'furniture', 'collision', area / smaller);
      }
    }

    // Furniture standing in the space another piece keeps clear in front of it.
    for (const { owner, zone } of onlyObstacleId ? [] : clearances) {
      if (owner.id === item.id || (onlyItemId && item.id !== onlyItemId && owner.id !== onlyItemId)) continue;
      // The space kept clear in front of a piece is floor space to walk or sit in.
      if ((item.elevation ?? 0) > 0) continue;
      const area = footprintOverlap(itemPrint.parts, [zone]);
      // Directional: "A in front of B" and "B in front of A" are different things to accept.
      if (area > MIN_OVERLAP_AREA) add(item.id, owner.id, 'furniture', 'clearance', area / polygonArea(zone), furnitureClearanceKey(item.id, owner.id));
    }

    // Furniture vs obstacles: report only the most severe kind of intrusion per obstacle.
    if (onlyItemId && item.id !== onlyItemId) continue;
    for (const obstacle of others) {
      const hit = worstIntrusion(item, itemPrint.parts, obstacle.zones);
      if (hit) add(item.id, obstacle.id, obstacle.kind, ZONE_TO_CONFLICT[hit.type], hit.coverage);
    }
  }
  return conflicts;
}

/**
 * The most severe zone type the piece intrudes on. Coverage sums every zone of that
 * type, so multi-part obstacles (an L-shaped stair, a double door's two swings) report
 * one combined percentage.
 */
function worstIntrusion(item: Furniture, itemParts: Polygon[], zones: Zone[]): { type: ZoneType; coverage: number } | null {
  for (const type of SEVERITY) {
    // A raised piece reaches from its elevation to its top.
    const ofType = zones.filter((z) => z.type === type && (item.elevation ?? 0) + item.height >= z.minHeight);
    if (ofType.length === 0) continue;
    const area = ofType.reduce((sum, z) => sum + footprintOverlap(itemParts, [z.polygon]), 0);
    if (area > MIN_OVERLAP_AREA) {
      const total = ofType.reduce((sum, z) => sum + polygonArea(z.polygon), 0);
      return { type, coverage: area / total };
    }
  }
  return null;
}

/** Whether two pieces' height ranges (bottom to top) overlap. */
export function overlapsVertically(a: Pick<Furniture, 'height' | 'elevation'>, b: Pick<Furniture, 'height' | 'elevation'>): boolean {
  const a0 = a.elevation ?? 0;
  const b0 = b.elevation ?? 0;
  return a0 < b0 + b.height - 0.5 && b0 < a0 + a.height - 0.5;
}

/** "about 20%" — overlaps are approximate, so never claim false precision. */
export function formatCoverage(coverage: number): string {
  return `about ${Math.max(1, Math.round(coverage * 100))}%`;
}

/** Display name of whatever a conflict's `otherId` refers to. */
export function obstacleName(conflict: Pick<Conflict, 'otherId' | 'otherKind'>, project: Project): string {
  switch (conflict.otherKind) {
    case 'furniture':
      return project.furniture.find((f) => f.id === conflict.otherId)?.name ?? 'another piece';
    case 'feature':
      return project.features.find((f) => f.id === conflict.otherId)?.name ?? 'a room feature';
    case 'stairs':
      return project.stairs.find((s) => s.id === conflict.otherId)?.name ?? 'the stairs';
    case 'wall':
      return 'an interior wall';
  }
}

/**
 * Plain-language description of a conflict, e.g. "Desk overlaps Bookshelf."
 * For two pieces of furniture, `perspectiveId` (the piece being moved or edited)
 * is named first.
 */
export function describeConflict(conflict: Conflict, project: Project, perspectiveId?: string): string {
  // Name the piece being moved first — but only for collisions, which read the same either way.
  if (conflict.otherKind === 'furniture' && conflict.type === 'collision' && conflict.otherId === perspectiveId) {
    conflict = { ...conflict, itemId: conflict.otherId, otherId: conflict.itemId };
  }
  const itemName = project.furniture.find((f) => f.id === conflict.itemId)?.name ?? 'This piece';
  const otherName = obstacleName(conflict, project);
  const coverage = formatCoverage(conflict.coverage);
  if (conflict.otherKind === 'stairs') return `${itemName} blocks ${otherName} (${coverage} of the stair footprint).`;
  if (conflict.otherKind === 'furniture' && conflict.type === 'clearance') return `${itemName} is in the space kept clear in front of ${otherName} (${coverage} of it).`;
  switch (conflict.type) {
    case 'collision':
      return `${itemName} overlaps ${otherName}.`;
    case 'obstruction':
      return `${itemName} covers ${coverage} of ${otherName}.`;
    case 'clearance':
      return clearanceMessage(itemName, project.features.find((f) => f.id === conflict.otherId), otherName, coverage);
  }
}

function clearanceMessage(itemName: string, feature: RoomFeature | undefined, featureName: string, coverage: string): string {
  switch (feature?.kind) {
    case 'door':
      return feature.swing === 'out' || feature.doorType === 'sliding' || feature.doorType === 'opening'
        ? `${itemName} is in the walkway of ${featureName}.`
        : `${itemName} is in the swing path of ${featureName} (${coverage} of it).`;
    case 'outlet':
    case 'switch':
      return `${itemName} blocks access to ${featureName}.`;
    default:
      return `${itemName} is inside the clearance zone of ${featureName} (${coverage} of it).`;
  }
}
