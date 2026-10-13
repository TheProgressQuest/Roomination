import type { Box } from '../../model/polygon';
import type { Point } from '../../model/types';

/**
 * Maps real-world centimetres to screen pixels: screen = offset + cm × scale.
 * The room (plus its walls) is scaled to fit the available space and centred; nothing
 * outside the plan components deals in pixels.
 */
export interface Viewport {
  /** Pixels per cm. */
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Screen space reserved around the room for measurement labels. */
const MAX_PADDING_PX = 56;
const MIN_PADDING_PX = 36;

/** `extraPadding` makes room for additional labels (e.g. per-wall lengths). */
export function fitViewport(size: { width: number; height: number }, bounds: Box, extraPadding = 0): Viewport {
  const padding = Math.min(MAX_PADDING_PX, Math.max(MIN_PADDING_PX, size.width * 0.08)) + extraPadding;
  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min(Math.max(size.width - padding * 2, 1) / spanX, Math.max(size.height - padding * 2, 1) / spanY);
  return {
    scale,
    offsetX: (size.width - spanX * scale) / 2 - bounds.minX * scale,
    offsetY: (size.height - spanY * scale) / 2 - bounds.minY * scale,
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

/** Flattens room points straight to screen coordinates. */
export function flatScreen(points: Point[], v: Viewport): number[] {
  return points.flatMap((p) => [v.offsetX + p.x * v.scale, v.offsetY + p.y * v.scale]);
}
