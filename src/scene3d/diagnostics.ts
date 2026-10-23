import type { Point } from '../model/types';

/**
 * A small diagnostics hook the 3D view exposes on `window` while it's open, used by the
 * browser tests and performance checks. It only reads local state and never sends anything.
 */

export interface ViewerStats {
  /** CPU time to draw the last frame, ms (GPU time isn't measured). */
  frameMs: number;
  /** Time spent on the last reflection update (High quality mirrors), ms. */
  reflectionMs: number;
  /** Time to build the last room and furniture changes, in ms. */
  buildMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  framesRendered: number;
  pixelRatio: number;
  /** A camera transition is in progress. */
  animating: boolean;
}

export interface Diagnostics3D {
  stats(): ViewerStats;
  /** Where a piece of furniture's centre appears on screen (CSS px within the canvas). */
  pointOnScreen(id: string): Point | null;
  /** Where a plan point (cm) at a height (cm) appears on screen. */
  projectPoint(p: Point, height?: number): Point;
  /** How many walls are showing (the dollhouse view hides some). */
  visibleWalls(): number;
  /** Where the camera is: plan position and height, in cm. */
  cameraPosition(): Point & { height: number };
}

declare global {
  interface Window {
    __roomination3D?: Diagnostics3D;
  }
}
