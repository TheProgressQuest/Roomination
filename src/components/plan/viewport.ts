import type { Point, Room } from '../../model/types';

/**
 * Maps real-world centimetres to screen pixels. The whole room is scaled to fit
 * the available space and centred; nothing outside the plan components deals in pixels.
 */
export interface Viewport {
  /** Pixels per cm. */
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Wall thickness as drawn, in px (visual only; walls sit outside the interior). */
  wallPx: number;
}

/** Screen space reserved around the room for walls and measurement labels. */
const MAX_PADDING_PX = 56;
const MIN_PADDING_PX = 36;

export function fitViewport(size: { width: number; height: number }, room: Pick<Room, 'width' | 'length'>): Viewport {
  const padding = Math.min(MAX_PADDING_PX, Math.max(MIN_PADDING_PX, size.width * 0.08));
  const availableW = Math.max(size.width - padding * 2, 1);
  const availableH = Math.max(size.height - padding * 2, 1);
  const scale = Math.min(availableW / room.width, availableH / room.length);
  return {
    scale,
    offsetX: (size.width - room.width * scale) / 2,
    offsetY: (size.height - room.length * scale) / 2,
    wallPx: Math.min(14, Math.max(6, scale * 12)),
  };
}

export function toScreen(v: Viewport, p: Point): Point {
  return { x: v.offsetX + p.x * v.scale, y: v.offsetY + p.y * v.scale };
}

export function toRoomPoint(v: Viewport, p: Point): Point {
  return { x: (p.x - v.offsetX) / v.scale, y: (p.y - v.offsetY) / v.scale };
}

/** Flattens points into the [x1, y1, x2, y2, …] form Konva lines expect, scaled to px. */
export function flatPx(points: Point[], scale: number): number[] {
  return points.flatMap((p) => [p.x * scale, p.y * scale]);
}
