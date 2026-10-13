import { featureDefaults } from './features';
import { DEFAULT_OPTIMIZER } from './furnitureKinds';
import { DEFAULT_STAIR_WIDTH, stairPreset } from './stairs';
import type { FeatureKind, FloorStyle, Furniture, Placement, Project, Room, RoomFeature, Staircase } from './types';
import { CURRENT_SCHEMA_VERSION } from './types';
import { rectangleOutline } from './walls';

/** Warm, distinguishable furniture colours. Names are read out by screen readers. */
export const FURNITURE_COLORS = [
  { name: 'Terracotta', value: '#e9a178' },
  { name: 'Sage', value: '#8fb996' },
  { name: 'Honey', value: '#f2c879' },
  { name: 'Sky', value: '#9bb7d4' },
  { name: 'Lavender', value: '#c9a7d8' },
  { name: 'Rose', value: '#d98f8f' },
  { name: 'Linen', value: '#e8dcc6' },
  { name: 'Slate', value: '#7d8a99' },
];

export function createId(): string {
  // randomUUID is only available on HTTPS/localhost; fall back for e.g. testing over a LAN IP.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createFurniture(fields: Partial<Furniture> & Pick<Furniture, 'x' | 'y'>): Furniture {
  return {
    id: createId(),
    name: 'New piece',
    category: 'furniture',
    width: 80,
    depth: 50,
    height: 75,
    rotation: 0,
    color: FURNITURE_COLORS[0].value,
    texture: 'plain',
    kind: 'custom',
    locked: false,
    preferences: [],
    ...fields,
  };
}

export function createFeature(
  kind: FeatureKind,
  placement: Placement,
  room: Pick<Room, 'height'>,
  overrides: Partial<RoomFeature> = {},
): RoomFeature {
  return { id: createId(), ...featureDefaults(kind, room), placement, ...overrides };
}

export function createStaircase(shape: 'straight' | 'L' | 'U', centre: { x: number; y: number }, overrides: Partial<Staircase> = {}): Staircase {
  return {
    id: createId(),
    name: 'Stairs',
    x: centre.x,
    y: centre.y,
    rotation: 0,
    direction: 'up',
    rise: 270,
    sections: stairPreset(shape, DEFAULT_STAIR_WIDTH, createId),
    ...overrides,
  };
}

export const DEFAULT_FLOOR: FloorStyle = { preset: 'plain', color: '#fffaf2', scale: 1, angle: 0, intensity: 0.5 };

/** A rectangular room with fresh wall ids. Walls run clockwise: top, right, bottom, left. */
export function createRectangularRoom(width: number, length: number, height = 250, floor: FloorStyle = DEFAULT_FLOOR): Room {
  return { outline: rectangleOutline(width, length, createId), partitions: [], height, floor };
}

export function createEmptyProject(room: Room = createRectangularRoom(400, 350), name = 'My room'): Project {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name,
    units: 'metric',
    room,
    furniture: [],
    features: [],
    stairs: [],
    relationships: [],
    optimizer: DEFAULT_OPTIMIZER,
    savedLayouts: [],
    acceptedOverlaps: [],
  };
}

/** A cosy living room so first-time visitors have something to play with. */
export function createSampleProject(): Project {
  const room = createRectangularRoom(480, 380, 260, { preset: 'lightOak', color: '#e2c79f', scale: 1, angle: 0, intensity: 0.5 });
  const [top, right, , left] = room.outline;
  // Offsets run from each wall's start corner, clockwise round the room.
  const wall = (start: { id: string }, offset: number): Placement => ({ type: 'wall', wallId: start.id, offset });
  const free = (x: number, y: number, rotation = 0): Placement => ({ type: 'free', x, y, rotation });

  // Fronts face the way the piece is used: the sofa (rotated 180°) faces up towards the TV.
  const sofa = createFurniture({ name: 'Sofa', kind: 'sofa', x: 240, y: 330, width: 220, depth: 90, height: 85, rotation: 180, color: '#e9a178' });
  const coffeeTable = createFurniture({ name: 'Coffee table', kind: 'coffeeTable', x: 240, y: 220, width: 110, depth: 60, height: 45, color: '#f2c879' });
  const tv = createFurniture({ name: 'TV console', kind: 'television', x: 240, y: 25, width: 160, depth: 40, height: 55, color: '#9bb7d4' });

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: 'Sample living room',
    units: 'metric',
    room,
    furniture: [
      createFurniture({ name: 'Rug', category: 'floorCovering', x: 240, y: 220, width: 200, depth: 140, height: 1, color: '#c9a7d8', texture: 'bordered' }),
      sofa,
      coffeeTable,
      tv,
      createFurniture({ name: 'Armchair', kind: 'armchair', x: 70, y: 200, width: 80, depth: 80, height: 90, rotation: 270, color: '#8fb996' }),
      createFurniture({ name: 'Bookshelf', kind: 'bookshelf', x: 455, y: 150, width: 100, depth: 35, height: 180, rotation: 90, color: '#c9a7d8', preferences: ['againstWall'] }),
      createFurniture({ name: 'Plant', kind: 'decor', category: 'decoration', x: 445, y: 330, width: 45, depth: 45, height: 120, color: '#8fb996' }),
    ],
    relationships: [
      { id: createId(), type: 'inFrontOf', a: sofa.id, b: coffeeTable.id },
      { id: createId(), type: 'faces', a: sofa.id, b: tv.id },
    ],
    optimizer: DEFAULT_OPTIMIZER,
    savedLayouts: [],
    features: [
      createFeature('door', wall(left, 60), room, { name: 'Front door', hinge: 'left' }),
      createFeature('window', wall(top, 90), room, { width: 120 }),
      createFeature('window', wall(right, 280), room, { name: 'Side window', width: 100 }),
      createFeature('radiator', wall(top, 90), room, { width: 80 }),
      createFeature('vent', free(380, 240), room),
      createFeature('outlet', wall(right, 60), room),
      createFeature('switch', wall(left, 125), room),
      createFeature('light', free(240, 200), room),
    ],
    stairs: [],
    acceptedOverlaps: [],
  };
}
