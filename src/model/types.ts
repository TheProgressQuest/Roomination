/**
 * Core data model for Roomination.
 *
 * Every length is stored in CENTIMETRES, in real-world space. Screen pixels never
 * appear here — the floor plan converts to pixels only when drawing.
 *
 * Coordinate system (looking down at the floor plan):
 *   - Origin (0, 0) is the room's top-left inside corner.
 *   - x grows to the right, y grows downward (towards the "bottom" wall).
 *   - Rotation is in degrees, clockwise, around an object's centre.
 */

export type UnitSystem = 'metric' | 'imperial';

export interface Point {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

export type FloorPreset = 'plain' | 'hardwood' | 'lightOak' | 'darkWalnut' | 'tile' | 'concrete' | 'carpet';

/** How the room's floor surface looks. Purely visual — never affects geometry. */
export interface FloorStyle {
  preset: FloorPreset;
  color: string;
  /** Pattern size multiplier (1 = realistic default, e.g. 15 cm planks, 30 cm tiles). */
  scale: number;
  /** Pattern rotation in degrees. */
  angle: number;
  /** 0–1: how strongly grain, grout or fibres show. */
  intensity: number;
}

export interface Room {
  /** Interior width along the x axis, in cm. */
  width: number;
  /** Interior length along the y axis, in cm. */
  length: number;
  /** Ceiling height, in cm. Kept for future 3D. */
  height: number;
  floor: FloorStyle;
}

// ---------------------------------------------------------------------------
// Furniture (anything the user moves around)
// ---------------------------------------------------------------------------

/**
 * Determines layering and collisions:
 *   - furniture / decoration: solid; warn when they overlap each other or room features
 *   - floorCovering: rugs and mats; drawn underneath and allowed to overlap anything
 */
export type FurnitureCategory = 'furniture' | 'floorCovering' | 'decoration';

export type FurnitureTexture = 'plain' | 'striped' | 'checked' | 'bordered' | 'woven';

export interface Furniture {
  id: string;
  name: string;
  category: FurnitureCategory;
  /** Centre of the piece, in cm from the room's top-left corner. */
  x: number;
  y: number;
  /** Size along the piece's own (unrotated) axes, in cm. */
  width: number;
  depth: number;
  /** Height off the floor, in cm. Used to decide whether a piece blocks wall switches etc. */
  height: number;
  /** Clockwise rotation in degrees, normalised to [0, 360). */
  rotation: number;
  color: string;
  /** Surface pattern. Shown on floor coverings. */
  texture: FurnitureTexture;
}

// ---------------------------------------------------------------------------
// Room features (doors, windows, outlets, …)
// ---------------------------------------------------------------------------

export type Wall = 'top' | 'right' | 'bottom' | 'left';

/**
 * Attached to a wall. `offset` is the position of the feature's centre along the wall,
 * measured in room coordinates: x for the top/bottom walls, y for the left/right walls.
 */
export interface WallPlacement {
  type: 'wall';
  wall: Wall;
  offset: number;
}

/** Stands freely in the room (or on the ceiling), positioned by its centre. */
export interface FreePlacement {
  type: 'free';
  x: number;
  y: number;
  rotation: number;
}

export type Placement = WallPlacement | FreePlacement;

export type FeatureKind =
  | 'door'
  | 'window'
  | 'vent'
  | 'outlet'
  | 'switch'
  | 'light'
  | 'radiator'
  | 'column';

export type DoorType = 'hinged' | 'double' | 'sliding';
export type VentMount = 'wall' | 'floor' | 'ceiling';
export type OutletType = 'standard' | 'usb' | 'gfci' | 'highVoltage';
export type LightType = 'pendant' | 'flush' | 'recessed' | 'chandelier';
export type ColumnShape = 'square' | 'round';

/**
 * A fixed architectural element. Shared fields apply to every kind; the optional
 * fields at the bottom only apply to the kinds named in their comments.
 */
export interface RoomFeature {
  id: string;
  name: string;
  kind: FeatureKind;
  placement: Placement;
  /** Size along the wall (wall features) or along the local x axis (free features), in cm. */
  width: number;
  /** How far it projects into the room (wall features) or local y size (free features), in cm. */
  depth: number;
  /** Vertical size, in cm (door/window opening height, radiator height, …). */
  height: number;
  /** Height of the feature's bottom edge above the floor, in cm (e.g. window sill, outlet). */
  elevation: number;
  /** Space to keep clear in front of / around it, in cm. 0 = none. */
  clearance: number;

  /** door */
  doorType?: DoorType;
  /** door: opens into the room or out of it */
  swing?: 'in' | 'out';
  /** door: hinge side as seen from inside the room, facing the door */
  hinge?: 'left' | 'right';
  /** vent */
  ventMount?: VentMount;
  /** outlet */
  outletType?: OutletType;
  /** light */
  lightType?: LightType;
  /** column */
  shape?: ColumnShape;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const CURRENT_SCHEMA_VERSION = 2;

/** Everything that makes up one saved design. */
export interface Project {
  /** Bumped when the shape of saved data changes, so old saves can be migrated. */
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  name: string;
  units: UnitSystem;
  room: Room;
  furniture: Furniture[];
  features: RoomFeature[];
  /**
   * Overlaps the user has explicitly accepted. Each key names one specific pair of
   * objects and one kind of constraint (see `conflictKey`), never a global switch.
   */
  acceptedOverlaps: string[];
}
