import type { Point } from '../model/types';

/**
 * A room scan as it was MEASURED, before Roomination interprets it.
 *
 * Every scan format (Apple RoomPlan JSON, 3D Model Anything bundles, `roomination-scan`
 * files) is read into this one shape. It is never changed afterwards: the review screen
 * keeps the person's corrections separately and the converter re-applies them, so the
 * original measurements are always available to compare against and to reset to.
 *
 * Units and axes are Roomination's plan conventions: centimetres, seen from above, x to the
 * right, y downwards (RoomPlan's metres × 100, its X → x and Z → y, which is a top view
 * without mirroring), rotations clockwise in degrees. Heights are measured from the floor.
 */

/** The scanner's own confidence label. Never turned into a percentage. */
export type ScanConfidence = 'high' | 'medium' | 'low' | 'unknown';

export interface ScanWall {
  /** Stable id derived from the scanner's identifier (the same scan gives the same ids). */
  id: string;
  /** Ends of the wall's inner face. */
  a: Point;
  b: Point;
  height: number;
  confidence: ScanConfidence;
  /** RoomPlan reported a curve; Roomination draws it straight between its ends. */
  curved: boolean;
}

export type ScanOpeningKind = 'door' | 'window' | 'opening';

export interface ScanOpening {
  id: string;
  kind: ScanOpeningKind;
  /** The scanner's wall id (already turned into a `ScanWall.id`), when it gave one. */
  wallId: string | null;
  /** Centre of the opening, on (or near) the wall's face. */
  center: Point;
  width: number;
  height: number;
  /** Bottom edge above the floor (window sill; 0 for doors). */
  bottom: number;
  confidence: ScanConfidence;
}

export interface ScanObject {
  id: string;
  /** The scanner's category word, e.g. "storage", "sofa" (RoomPlan's list), or "unknown". */
  category: string;
  center: Point;
  /** Along the object's own x axis. */
  width: number;
  /** Along its front–back axis (front at +y, as for every Roomination piece). */
  depth: number;
  height: number;
  /** Bottom above the floor (a wall-mounted TV is well above it). */
  bottom: number;
  /** Clockwise degrees, 0 = front facing down the plan. */
  rotation: number;
  confidence: ScanConfidence;
}

/** A labelled area of the scan (RoomPlan "sections", iOS 17+), e.g. "kitchen". */
export interface ScanSection {
  label: string;
  center: Point;
}

export type ScanFormat = 'roomplan' | 'house-capture' | 'roomination-scan';

export interface ScanData {
  format: ScanFormat;
  /** Plain description of where it came from, e.g. "Apple RoomPlan JSON (room 2 of a 3D Model Anything bundle)". */
  source: string;
  /** Suggested project name. */
  name: string;
  walls: ScanWall[];
  openings: ScanOpening[];
  objects: ScanObject[];
  /** The floor's outline, when the scanner recorded one (RoomPlan iOS 17+). */
  floor: Point[] | null;
  sections: ScanSection[];
  /** Things noticed while reading the file (skipped elements, unusual values), in plain words. */
  notes: string[];
}
