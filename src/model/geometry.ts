import type { Furniture, Room } from './types';

/**
 * Geometry rules shared by every way of changing furniture (dragging, rotating,
 * typing dimensions, resizing the room). Keeping them in one place guarantees
 * that position, size and rotation always stay consistent with each other.
 */

/** Smallest allowed furniture dimension, in cm. */
export const MIN_FURNITURE_SIZE = 5;
/** Smallest allowed room dimension, in cm. */
export const MIN_ROOM_SIZE = 50;
/** Largest allowed room dimension, in cm (100 m — keeps the canvas sane). */
export const MAX_ROOM_SIZE = 10_000;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function normalizeRotation(degrees: number): number {
  const r = degrees % 360;
  // `+ 0` turns -0 into 0 so values compare cleanly.
  return (r < 0 ? r + 360 : r) + 0;
}

/**
 * Half the width and height of the axis-aligned box that encloses a rotated
 * rectangle. A 200×100 sofa rotated 90° occupies 100×200 on the floor.
 */
export function rotatedHalfExtents(
  width: number,
  depth: number,
  rotation: number,
): { halfX: number; halfY: number } {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    halfX: (width * cos + depth * sin) / 2,
    halfY: (width * sin + depth * cos) / 2,
  };
}

/** The floor area a piece covers, as an axis-aligned box in room coordinates. */
export function furnitureBounds(item: Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation'>): Bounds {
  const { halfX, halfY } = rotatedHalfExtents(item.width, item.depth, item.rotation);
  return {
    minX: item.x - halfX,
    minY: item.y - halfY,
    maxX: item.x + halfX,
    maxY: item.y + halfY,
  };
}

/** Whether a piece, at its current size and rotation, could fit in the room at all. */
export function fitsInRoom(item: Pick<Furniture, 'width' | 'depth' | 'rotation'>, room: Room): boolean {
  const { halfX, halfY } = rotatedHalfExtents(item.width, item.depth, item.rotation);
  // Tiny tolerance so floating-point noise (e.g. cos(90°) ≈ 6e-17) never rejects a perfect fit.
  const epsilon = 1e-6;
  return halfX * 2 <= room.width + epsilon && halfY * 2 <= room.length + epsilon;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Moves a piece's centre the minimum distance needed to keep it fully inside the
 * room. Returns null when the piece is too big to fit at its current rotation.
 */
export function clampCenterToRoom<T extends Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation'>>(
  item: T,
  room: Room,
): T | null {
  if (!fitsInRoom(item, room)) return null;
  const { halfX, halfY } = rotatedHalfExtents(item.width, item.depth, item.rotation);
  // When a piece exactly fills a dimension, min and max can cross by a rounding hair.
  const x = halfX * 2 >= room.width ? room.width / 2 : clamp(item.x, halfX, room.width - halfX);
  const y = halfY * 2 >= room.length ? room.length / 2 : clamp(item.y, halfY, room.length - halfY);
  return { ...item, x, y };
}

/** Rounds a length to 0.01 mm so stored numbers stay tidy without losing precision. */
export function roundLength(cm: number): number {
  return Math.round(cm * 1000) / 1000;
}
