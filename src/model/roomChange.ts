import { clampFeatureToRoom, findOverlappingOpening } from './features';
import { clampFurnitureToRoom, clampStairToRoom } from './placement';
import type { Project, Room, RoomFeature } from './types';
import { findSegment, nearestWall, pointAlong, validateRoom } from './walls';

/**
 * Applying a change to the room's walls.
 *
 * Whenever walls move, split, merge or are redrawn, everything that depends on them is
 * re-checked here in one place:
 *   - wall features keep their wall and offset, so they move and turn with the wall;
 *   - features whose wall disappeared are re-attached to the nearest wall that fits
 *     (or, for a deleted wall, the change is refused);
 *   - free features, staircases and furniture are nudged back inside the new outline.
 * If anything can't be resolved, the whole change is refused with an explanation —
 * nothing is ever silently deleted or left in an invalid place.
 */

export type OrphanPolicy =
  /** Features on walls that no longer exist move to the nearest wall (merge, redraw). */
  | 'reattach'
  /** Features on a deleted wall block the deletion. */
  | 'reject';

export function applyRoomChange(project: Project, room: Room, orphans: OrphanPolicy = 'reattach'): Project | string {
  const problem = validateRoom(room);
  if (problem) return problem;

  const features: RoomFeature[] = [];
  for (const feature of project.features) {
    const moved = reattach(feature, project.room, room, orphans);
    if (typeof moved === 'string') return moved;
    const placed = clampFeatureToRoom(moved, room);
    if (!placed) return tooBigMessage(moved, room);
    features.push(placed);
  }
  for (const feature of features) {
    const clash = findOverlappingOpening(feature, features);
    if (clash) return `“${feature.name}” and “${clash.name}” would overlap on the same wall. Move one of them first.`;
  }

  const stairs = [];
  for (const stair of project.stairs) {
    const placed = clampStairToRoom(stair, room);
    if (!placed) return `“${stair.name}” wouldn’t fit in the room’s new shape. Move or resize it first.`;
    stairs.push(placed);
  }

  const furniture = [];
  for (const item of project.furniture) {
    const placed = clampFurnitureToRoom(item, room);
    if (!placed) return `“${item.name}” wouldn’t fit in the room’s new shape. Move or shrink it first.`;
    furniture.push(placed);
  }

  return { ...project, room, features, stairs, furniture };
}

function reattach(feature: RoomFeature, before: Room, after: Room, orphans: OrphanPolicy): RoomFeature | string {
  const p = feature.placement;
  if (p.type !== 'wall' || findSegment(after, p.wallId)) return feature;
  if (orphans === 'reject') return `“${feature.name}” is on that wall. Move or delete it first.`;
  const old = findSegment(before, p.wallId);
  if (!old) return feature;
  const anchor = pointAlong(old, p.offset);
  const nearest = nearestWall(after, anchor, feature.width);
  if (!nearest) return `No wall is long enough for “${feature.name}” (${Math.round(feature.width)} cm). Shrink it first.`;
  return { ...feature, placement: { type: 'wall', wallId: nearest.segment.id, offset: nearest.offset } };
}

function tooBigMessage(feature: RoomFeature, room: Room): string {
  const p = feature.placement;
  if (p.type === 'wall') {
    const wall = findSegment(room, p.wallId);
    if (wall) {
      return `“${feature.name}” needs ${Math.round(feature.width)} cm of wall, but its wall would only be ${Math.round(wall.length)} cm. Shrink or move it first.`;
    }
  }
  return `“${feature.name}” wouldn’t fit in the room’s new shape. Move it first.`;
}
