/**
 * Core data model for Roomination.
 *
 * Every length is stored in CENTIMETRES, in real-world space. Screen pixels never
 * appear here — the floor plan converts to pixels only when drawing.
 *
 * Coordinate system (looking down at the floor plan):
 *   - Origin (0, 0) is the room's top-left inside corner.
 *   - x grows to the right, y grows downward (towards the "bottom" wall).
 *   - Rotation is in degrees, clockwise, around the furniture's centre.
 */

export type UnitSystem = 'metric' | 'imperial';

export interface Room {
  /** Interior width along the x axis, in cm. */
  width: number;
  /** Interior length along the y axis, in cm. */
  length: number;
  /** Ceiling height, in cm. Not drawn yet; kept for future 3D. */
  height: number;
}

export interface Furniture {
  id: string;
  name: string;
  /** Centre of the piece, in cm from the room's top-left corner. */
  x: number;
  y: number;
  /** Size along the piece's own (unrotated) axes, in cm. */
  width: number;
  depth: number;
  /** Height off the floor, in cm. Not drawn in 2D; kept for future 3D. */
  height: number;
  /** Clockwise rotation in degrees, normalised to [0, 360). */
  rotation: number;
  color: string;
}

/** Everything that makes up one saved design. */
export interface Project {
  /** Bumped when the shape of saved data changes, so old saves can be migrated. */
  schemaVersion: 1;
  name: string;
  units: UnitSystem;
  room: Room;
  furniture: Furniture[];
}
