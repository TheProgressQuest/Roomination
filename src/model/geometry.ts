import type { Furniture } from './types';

/**
 * Geometry rules shared by every way of changing furniture (dragging, rotating,
 * typing dimensions, resizing the room). Keeping them in one place guarantees
 * that position, size and rotation always stay consistent with each other.
 */

/** Smallest allowed furniture dimension, in cm (mirrors and wall art are only 1–3 cm deep). */
export const MIN_FURNITURE_SIZE = 1;
/** Smallest allowed width/length when resizing a rectangular room, in cm. */
export const MIN_ROOM_SIZE = 50;

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

/** Rounds a length to 0.01 mm so stored numbers stay tidy without losing precision. */
export function roundLength(cm: number): number {
  return Math.round(cm * 1000) / 1000;
}
