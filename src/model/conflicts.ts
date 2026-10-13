import { featureZones, type Zone, type ZoneType } from './features';
import { overlapArea, polygonArea, rectPolygon, type Polygon } from './polygon';
import type { Furniture, Project, RoomFeature } from './types';

/**
 * Overlap detection between furniture and everything else.
 *
 * Rules:
 *   - Floor coverings (rugs, mats) never conflict with anything.
 *   - Furniture and decorations conflict with each other when they overlap.
 *   - They conflict with room features when they intrude on a feature's zones
 *     (door swings, vent grilles and airflow, outlet access, radiator bodies, …).
 *
 * A conflict is a warning, not a ban. The user may accept a specific one; that
 * acceptance is stored under a key naming that exact pair and constraint type.
 */

export type ConflictType =
  /** Two solid things occupy the same floor. */
  | 'collision'
  /** Furniture covers a feature's working face (e.g. a vent grille). */
  | 'obstruction'
  /** Furniture sits in space that should be kept clear. */
  | 'clearance';

export interface Conflict {
  /** Stable identity used for accepting the overlap (see `conflictKey`). */
  key: string;
  /** The furniture piece causing the conflict. */
  itemId: string;
  /** The other furniture piece or room feature. */
  otherId: string;
  otherIsFeature: boolean;
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

/** Key for one specific relationship; order-independent. */
export function conflictKey(a: string, b: string, type: ConflictType): string {
  const [first, second] = a < b ? [a, b] : [b, a];
  return `${first}|${second}|${type}`;
}

export function isSolid(item: Furniture): boolean {
  return item.category !== 'floorCovering';
}

export function furniturePolygon(item: Furniture): Polygon {
  return rectPolygon(item.x, item.y, item.width, item.depth, item.rotation);
}

/**
 * All current conflicts. Pass `onlyItemId` to check a single piece (used while
 * dragging, so only the moving piece is tested against the rest).
 */
export function findConflicts(project: Project, onlyItemId?: string): Conflict[] {
  const accepted = new Set(project.acceptedOverlaps);
  const solids = project.furniture.filter(isSolid);
  const polygons = new Map(solids.map((item) => [item.id, furniturePolygon(item)]));
  const zonesByFeature = project.features.map((feature) => ({ feature, zones: featureZones(feature, project.room) }));
  const conflicts: Conflict[] = [];

  const add = (itemId: string, otherId: string, otherIsFeature: boolean, type: ConflictType, coverage: number) => {
    const key = conflictKey(itemId, otherId, type);
    conflicts.push({ key, itemId, otherId, otherIsFeature, type, coverage: Math.min(1, coverage), accepted: accepted.has(key) });
  };

  for (let i = 0; i < solids.length; i++) {
    const item = solids[i];
    const itemPoly = polygons.get(item.id)!;

    // Furniture vs furniture: each pair once.
    for (let j = i + 1; j < solids.length; j++) {
      const other = solids[j];
      if (onlyItemId && item.id !== onlyItemId && other.id !== onlyItemId) continue;
      const otherPoly = polygons.get(other.id)!;
      const area = overlapArea(itemPoly, otherPoly);
      if (area > MIN_OVERLAP_AREA) {
        const smaller = Math.min(polygonArea(itemPoly), polygonArea(otherPoly));
        add(item.id, other.id, false, 'collision', area / smaller);
      }
    }

    // Furniture vs room features: report only the most severe zone per feature.
    if (onlyItemId && item.id !== onlyItemId) continue;
    for (const { feature, zones } of zonesByFeature) {
      const hit = firstIntrudedZone(item, itemPoly, zones);
      if (hit) add(item.id, feature.id, true, ZONE_TO_CONFLICT[hit.zone.type], hit.coverage);
    }
  }
  return conflicts;
}

function firstIntrudedZone(item: Furniture, itemPoly: Polygon, zones: Zone[]): { zone: Zone; coverage: number } | null {
  for (const zone of zones) {
    if (item.height < zone.minHeight) continue;
    const area = overlapArea(itemPoly, zone.polygon);
    if (area > MIN_OVERLAP_AREA) return { zone, coverage: area / polygonArea(zone.polygon) };
  }
  return null;
}

/** "about 20%" — overlaps are approximate, so never claim false precision. */
export function formatCoverage(coverage: number): string {
  return `about ${Math.max(1, Math.round(coverage * 100))}%`;
}

/**
 * Plain-language description of a conflict, e.g. "Desk overlaps Bookshelf."
 * For two pieces of furniture, `perspectiveId` (the piece being moved or edited)
 * is named first.
 */
export function describeConflict(conflict: Conflict, project: Project, perspectiveId?: string): string {
  if (!conflict.otherIsFeature && conflict.otherId === perspectiveId) {
    conflict = { ...conflict, itemId: conflict.otherId, otherId: conflict.itemId };
  }
  const item = project.furniture.find((f) => f.id === conflict.itemId);
  const itemName = item?.name ?? 'This piece';
  if (!conflict.otherIsFeature) {
    const other = project.furniture.find((f) => f.id === conflict.otherId);
    return `${itemName} overlaps ${other?.name ?? 'another piece'}.`;
  }
  const feature = project.features.find((f) => f.id === conflict.otherId);
  const featureName = feature?.name ?? 'a room feature';
  const coverage = formatCoverage(conflict.coverage);
  switch (conflict.type) {
    case 'collision':
      return `${itemName} overlaps ${featureName}.`;
    case 'obstruction':
      return `${itemName} covers ${coverage} of ${featureName}.`;
    case 'clearance':
      return clearanceMessage(itemName, feature, featureName, coverage);
  }
}

function clearanceMessage(itemName: string, feature: RoomFeature | undefined, featureName: string, coverage: string): string {
  switch (feature?.kind) {
    case 'door':
      return feature.swing === 'out' || feature.doorType === 'sliding'
        ? `${itemName} is in the walkway of ${featureName}.`
        : `${itemName} is in the swing path of ${featureName} (${coverage} of it).`;
    case 'outlet':
    case 'switch':
      return `${itemName} blocks access to ${featureName}.`;
    default:
      return `${itemName} is inside the clearance zone of ${featureName} (${coverage} of it).`;
  }
}
