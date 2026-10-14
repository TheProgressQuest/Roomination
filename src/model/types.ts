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

/**
 * A corner in a chain of walls. Wall segment *i* runs from node *i* to node *i + 1*;
 * the segment takes its id and thickness from its START node. Neighbouring segments
 * share a node, so moving a corner always keeps both walls connected.
 */
export interface WallNode {
  id: string;
  /** Position of the wall's inner face corner, in cm. */
  x: number;
  y: number;
  /** Thickness of the segment that starts here, in cm (drawn outside the room for outer walls). */
  thickness: number;
}

/** A freestanding interior wall: an open chain of nodes (at least two). */
export interface Partition {
  id: string;
  nodes: WallNode[];
}

export interface Room {
  /**
   * The room boundary: a closed chain of at least 3 nodes, stored clockwise on screen
   * so every wall's right-hand side faces into the room.
   */
  outline: WallNode[];
  partitions: Partition[];
  /** Ceiling height, in cm (the height walls are drawn in 3D). */
  height: number;
  floor: FloorStyle;
  /** Wall surface colour in the 3D view. Purely visual. */
  wallColor: string;
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

/**
 * What a piece is *for*. Used by the layout optimizer (e.g. a desk wants a chair in front
 * of it). Independent of `category`, which controls layering and collisions.
 */
export type FurnitureKind =
  | 'desk'
  | 'chair'
  | 'sofa'
  | 'armchair'
  | 'bed'
  | 'bedsideTable'
  | 'table'
  | 'diningTable'
  | 'coffeeTable'
  | 'bookshelf'
  | 'cabinet'
  | 'storage'
  | 'television'
  | 'decor'
  | 'custom';

/**
 * Optional, per-piece placement wishes for the optimizer. A piece's "front" is the side
 * you use (a sofa's seat, a desk's chair side, a bed's foot) — local +y, where the front
 * line is drawn on the plan.
 */
export type PlacementPreference =
  | 'againstWall'
  | 'nearWindow'
  | 'nearOutlet'
  /** You face the wall while using it (desk against a wall). */
  | 'facingWall'
  /** You face into the room while using it (desk with your back to the wall). */
  | 'facingRoom'
  | 'facingTelevision'
  | 'nearCoffeeTable'
  | 'nearSeating'
  /** Bed: both long sides reachable. */
  | 'accessBothSides'
  /** Bed: at least one long side reachable. */
  | 'accessOneSide';

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
  /** What the piece is for (optimizer). */
  kind: FurnitureKind;
  /** Locked pieces can't be dragged, nudged or moved by the optimizer until unlocked. */
  locked: boolean;
  preferences: PlacementPreference[];
  /** A drawn outline instead of a plain rectangle (custom furniture). */
  shape?: FurnitureShape;
  /** Space to keep free in front of the piece, in cm (0 or missing = none). */
  clearance?: number;
  /** Material, finish and photo textures. Missing = the default look for its type. */
  appearance?: FurnitureAppearance;
}

/**
 * One corner of a custom outline, in the piece's local frame (cm): x across its width,
 * y across its depth with the front at +y, origin at the centre of the outline's bounding
 * box. When `c1` and `c2` are present, the edge from this corner to the next is a cubic
 * Bézier curve with those control points.
 */
export interface ShapeVertex {
  x: number;
  y: number;
  c1?: Point;
  c2?: Point;
}

/**
 * A custom furniture footprint. `points` is the main outline (a simple polygon whose edges may
 * be curved). A shape may also have holes (a ring-shaped bench) and further separate parts
 * ("islands", e.g. a modular sofa whose sections don't touch), each with its own holes.
 * Shapes made in the Shape Builder keep their recipe in `source` so they can be re-edited;
 * the outlines here are always the result of that recipe.
 */
export interface FurnitureShape {
  points: ShapeVertex[];
  holes?: ShapeVertex[][];
  islands?: { points: ShapeVertex[]; holes?: ShapeVertex[][] }[];
  source?: BuilderNode[];
}

export type PrimitiveKind = 'rectangle' | 'square' | 'circle' | 'ellipse' | 'triangle' | 'polygon' | 'arc' | 'outline';

/**
 * One step of a Shape Builder recipe, in the piece's local cm.
 *   - shape: a basic shape centred at (x, y), turned `rotation` degrees, `width` × `depth`.
 *     `sides` for regular polygons; `sweep` (degrees) for curved sections (an arc of a ring
 *     whose band is `depth` thick); `points` for a free outline.
 *   - union (merge), subtract (first minus the rest), intersect: combine their children.
 *   - group: keeps its children separate but moves them together.
 */
export type BuilderNode =
  | {
      id: string;
      type: 'shape';
      kind: PrimitiveKind;
      x: number;
      y: number;
      rotation: number;
      width: number;
      depth: number;
      sides?: number;
      sweep?: number;
      points?: ShapeVertex[];
    }
  | { id: string; type: 'union' | 'subtract' | 'intersect' | 'group'; children: BuilderNode[] };

export type MaterialKind = 'fabric' | 'leather' | 'wood' | 'metal' | 'glass' | 'stone' | 'ceramic' | 'plastic' | 'custom';
export type SurfaceFinish = 'matte' | 'satin' | 'gloss';

/** How a piece looks. Photos are referenced by asset id (stored on this device). */
export interface FurnitureAppearance {
  material: MaterialKind;
  finish: SurfaceFinish;
  /** Photo textures for particular surfaces. */
  textures?: { top?: string; front?: string; side?: string };
  /** Reference photos (front, side, top, …) kept with the piece. */
  photos?: string[];
}

/**
 * How two specific pieces belong together (never inferred from categories):
 *   - inFrontOf: `b` sits in front of `a` (chair at a desk, coffee table before a sofa)
 *   - faces:     `a` faces `b` (sofa facing a TV)
 *   - beside:    `b` stands beside `a` (bedside table next to a bed)
 *   - near:      the two stay close (dining chairs around a table)
 */
export type RelationshipType = 'inFrontOf' | 'faces' | 'beside' | 'near';

export interface Relationship {
  id: string;
  type: RelationshipType;
  a: string;
  b: string;
}

// ---------------------------------------------------------------------------
// Room features (doors, windows, outlets, …)
// ---------------------------------------------------------------------------

/**
 * Attached to one wall segment (outer or partition). `offset` is the distance in cm
 * from the segment's start node to the feature's centre, so the feature moves and
 * turns with its wall.
 */
export interface WallPlacement {
  type: 'wall';
  wallId: string;
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
// Staircases
// ---------------------------------------------------------------------------

/**
 * One rectangular piece of a staircase. Sections are laid out one after another from
 * the previous section's exit; a landing can turn the stair 90° left or right.
 */
export interface StairSection {
  id: string;
  kind: 'flight' | 'landing';
  /** Length along the direction of travel, in cm. */
  length: number;
  /** Width across the direction of travel, in cm. */
  width: number;
  /** Number of treads (flights only). */
  steps: number;
  /** Where the next section goes (landings only; flights always continue straight). */
  turn: 'straight' | 'left' | 'right';
}

export interface Staircase {
  id: string;
  name: string;
  /** Centre of the staircase's footprint, in cm. */
  x: number;
  y: number;
  /** Clockwise rotation in degrees. */
  rotation: number;
  /** Whether the stair goes up or down from the first section. */
  direction: 'up' | 'down';
  /** Total height climbed, in cm (approximate; used for the per-step estimate). */
  rise: number;
  sections: StairSection[];
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Layout optimizer
// ---------------------------------------------------------------------------

export type OptimizerMode = 'functional' | 'balanced' | 'aesthetic' | 'fengShui' | 'custom';

/** How much each kind of score counts, in percent (they add up to 100). */
export interface OptimizerWeights {
  functional: number;
  aesthetic: number;
  fengShui: number;
}

/** What a room is mainly for; chooses sensible optimizer defaults (the person can override). */
export type RoomPurpose = 'living' | 'bedroom' | 'office' | 'studio' | 'dining' | 'multipurpose';
export type OptimizerEffort = 'quick' | 'standard' | 'thorough';

export interface OptimizerSettings {
  mode: OptimizerMode;
  /** 0–1: how much function counts versus aesthetics in Balanced mode. */
  functionWeight: number;
  /** Comfortable walking width to keep clear, in cm. A personal preference, not a building standard. */
  walkwayWidth: number;
  effort: OptimizerEffort;
  /** Same project + settings + seed ⇒ same suggestions. */
  seed: number;
  /** Custom mode's weights. */
  weights: OptimizerWeights;
  /** What the room is for (null: guessed from its furniture). */
  purpose: RoomPurpose | null;
  /** Assume the usual pairings (desk + chair, sofa → TV, …) the person hasn't drawn. */
  assumePairings: boolean;
}

/**
 * How the Bagua map is laid over the room. Traditions differ, and they aren't interchangeable:
 *   - entrance: the "Western"/BTB approach — a 3×3 grid aligned to the wall with the main door.
 *   - compass:  the classical approach — eight directions taken from the room's real compass
 *               orientation, which the person must enter (it's never guessed from the screen).
 */
export type BaguaMethod = 'entrance' | 'compass';

/** Optional Feng Shui (an interpretive design philosophy). Saved with the project. */
export interface FengShuiSettings {
  enabled: boolean;
  method: BaguaMethod;
  showBagua: boolean;
  /** Compass bearing of the plan's "up" direction, degrees clockwise from true north (compass method). */
  northBearing: number | null;
  /** The main entrance (a door id); the first door when not set. */
  entranceId: string | null;
}

/** A remembered arrangement: only positions and rotations, keyed by furniture id. */
export interface SavedLayout {
  id: string;
  name: string;
  createdAt: number;
  positions: { id: string; x: number; y: number; rotation: number }[];
}

export const CURRENT_SCHEMA_VERSION = 7;

/** Everything that makes up one saved design. */
export interface Project {
  /** Bumped when the shape of saved data changes, so old saves can be migrated. */
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  name: string;
  units: UnitSystem;
  room: Room;
  furniture: Furniture[];
  features: RoomFeature[];
  stairs: Staircase[];
  relationships: Relationship[];
  optimizer: OptimizerSettings;
  savedLayouts: SavedLayout[];
  /** Optional Feng Shui settings (missing in projects from before Phase 4). */
  fengShui?: FengShuiSettings;
  /**
   * Overlaps the user has explicitly accepted. Each key names one specific pair of
   * objects and one kind of constraint (see `conflictKey`), never a global switch.
   */
  acceptedOverlaps: string[];
}
