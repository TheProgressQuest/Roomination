import { createEmptyProject, createFeature, createFurniture, createId, createRectangularRoom, createStaircase } from '../model/sample';
import { normaliseShape, shapeTemplate, type ShapeTemplate } from '../model/shape';
import type { Furniture, Project, Room, WallNode } from '../model/types';

/**
 * Representative rooms for testing the optimizer (used by unit and browser tests only).
 * Furniture starts in deliberately unhelpful spots so there is something to improve.
 */

const wall = (room: Room, index: number, offset: number) => ({ type: 'wall' as const, wallId: room.outline[index].id, offset });

function withRoom(room: Room, name: string, build: (room: Room) => Partial<Project>): Project {
  return { ...createEmptyProject(room, name), ...build(room) };
}

/** 1. A small bedroom: bed, bedside table, wardrobe, desk and chair. */
export function smallBedroom(): Project {
  return withRoom(createRectangularRoom(320, 360), 'Small bedroom', (room) => {
    const bed = createFurniture({ name: 'Bed', kind: 'bed', x: 160, y: 180, width: 160, depth: 200, height: 50, preferences: ['againstWall', 'accessBothSides'] });
    const bedside = createFurniture({ name: 'Bedside table', kind: 'bedsideTable', x: 40, y: 330, width: 45, depth: 40, height: 55 });
    const desk = createFurniture({ name: 'Desk', kind: 'desk', x: 270, y: 60, width: 100, depth: 55, height: 75, preferences: ['nearOutlet', 'facingWall'] });
    const chair = createFurniture({ name: 'Desk chair', kind: 'chair', x: 60, y: 60, width: 50, depth: 50, height: 90 });
    const wardrobe = createFurniture({ name: 'Wardrobe', kind: 'storage', x: 270, y: 300, width: 100, depth: 60, height: 200, preferences: ['againstWall'] });
    return {
      furniture: [bed, bedside, desk, chair, wardrobe],
      features: [
        createFeature('door', wall(room, 2, 260), room, { name: 'Door' }),
        createFeature('window', wall(room, 0, 160), room),
        createFeature('outlet', wall(room, 1, 300), room),
      ],
      relationships: [
        { id: createId(), type: 'inFrontOf', a: desk.id, b: chair.id },
        { id: createId(), type: 'beside', a: bed.id, b: bedside.id },
      ],
    };
  });
}

/** 2. A large living room with a lounge and a dining area, two doors and a floor vent. */
export function largeLivingRoom(): Project {
  return withRoom(createRectangularRoom(720, 520), 'Large living room', (room) => {
    const sofa = createFurniture({ name: 'Sofa', kind: 'sofa', x: 360, y: 260, width: 220, depth: 95, height: 85, preferences: ['facingTelevision'] });
    const coffee = createFurniture({ name: 'Coffee table', kind: 'coffeeTable', x: 120, y: 400, width: 110, depth: 60, height: 45 });
    const tv = createFurniture({ name: 'TV unit', kind: 'television', x: 600, y: 400, width: 160, depth: 45, height: 55, preferences: ['againstWall'] });
    const armchairs = [0, 1].map((i) => createFurniture({ name: `Armchair ${i + 1}`, kind: 'armchair', x: 200 + i * 300, y: 120, width: 85, depth: 85, height: 90 }));
    const table = createFurniture({ name: 'Dining table', kind: 'diningTable', x: 560, y: 150, width: 160, depth: 90, height: 75 });
    const chairs = [0, 1, 2, 3].map((i) => createFurniture({ name: `Dining chair ${i + 1}`, kind: 'chair', x: 80 + i * 60, y: 230, width: 45, depth: 45, height: 90 }));
    const bookshelf = createFurniture({ name: 'Bookshelf', kind: 'bookshelf', x: 360, y: 450, width: 120, depth: 35, height: 190, preferences: ['againstWall'] });
    return {
      furniture: [sofa, coffee, tv, ...armchairs, table, ...chairs, bookshelf],
      features: [
        createFeature('door', wall(room, 3, 100), room, { name: 'Hall door' }),
        createFeature('door', wall(room, 1, 420), room, { name: 'Garden door', width: 90 }),
        createFeature('window', wall(room, 0, 360), room, { width: 200 }),
        createFeature('vent', { type: 'free', x: 360, y: 60, rotation: 0 }, room, { name: 'Floor vent' }),
        createFeature('outlet', wall(room, 2, 200), room),
      ],
      relationships: [
        { id: createId(), type: 'faces', a: sofa.id, b: tv.id },
        { id: createId(), type: 'inFrontOf', a: sofa.id, b: coffee.id },
        ...chairs.map((c) => ({ id: createId(), type: 'near' as const, a: table.id, b: c.id })),
      ],
    };
  });
}

/** 3. An L-shaped studio (the bottom-right corner is missing). */
export function lShapedStudio(): Project {
  const outline: WallNode[] = [
    [0, 0],
    [600, 0],
    [600, 280],
    [340, 280],
    [340, 480],
    [0, 480],
  ].map(([x, y]) => ({ id: createId(), x, y, thickness: 12 }));
  const room: Room = { ...createRectangularRoom(10, 10), outline };
  return withRoom(room, 'L-shaped studio', () => {
    const desk = createFurniture({ name: 'Desk', kind: 'desk', x: 300, y: 140, width: 120, depth: 60, height: 75, preferences: ['nearWindow'] });
    const chair = createFurniture({ name: 'Desk chair', kind: 'chair', x: 300, y: 220, width: 50, depth: 50, height: 90 });
    return {
      furniture: [
        createFurniture({ name: 'Bed', kind: 'bed', x: 170, y: 370, width: 140, depth: 200, height: 50, preferences: ['againstWall', 'accessOneSide'] }),
        createFurniture({ name: 'Sofa', kind: 'sofa', x: 150, y: 120, width: 200, depth: 90, height: 85 }),
        desk,
        chair,
        createFurniture({ name: 'Wardrobe', kind: 'storage', x: 500, y: 200, width: 120, depth: 60, height: 200, preferences: ['againstWall'] }),
        createFurniture({ name: 'Small table', kind: 'table', x: 480, y: 80, width: 80, depth: 80, height: 75 }),
      ],
      features: [
        createFeature('door', { type: 'wall', wallId: outline[3].id, offset: 100 }, room, { name: 'Front door' }),
        createFeature('window', { type: 'wall', wallId: outline[0].id, offset: 300 }, room, { width: 160 }),
      ],
      relationships: [{ id: createId(), type: 'inFrontOf', a: desk.id, b: chair.id }],
    };
  });
}

/** 4. A room with three doors on different walls. */
export function multipleDoors(): Project {
  return withRoom(createRectangularRoom(500, 400), 'Three doors', (room) => ({
    furniture: [
      createFurniture({ name: 'Sofa', kind: 'sofa', x: 250, y: 200, width: 210, depth: 90, height: 85 }),
      createFurniture({ name: 'Cabinet', kind: 'cabinet', x: 120, y: 120, width: 120, depth: 45, height: 90, preferences: ['againstWall'] }),
      createFurniture({ name: 'Armchair', kind: 'armchair', x: 380, y: 300, width: 85, depth: 85, height: 90 }),
      createFurniture({ name: 'Bookshelf', kind: 'bookshelf', x: 380, y: 120, width: 100, depth: 35, height: 190 }),
    ],
    features: [
      createFeature('door', wall(room, 3, 200), room, { name: 'West door' }),
      createFeature('door', wall(room, 1, 200), room, { name: 'East door' }),
      createFeature('door', wall(room, 2, 250), room, { name: 'South door' }),
    ],
  }));
}

/** 5. A room with a staircase. */
export function withStairs(): Project {
  return withRoom(createRectangularRoom(560, 420), 'Hall with stairs', (room) => ({
    furniture: [
      createFurniture({ name: 'Sofa', kind: 'sofa', x: 280, y: 210, width: 200, depth: 90, height: 85 }),
      createFurniture({ name: 'Console', kind: 'cabinet', x: 120, y: 300, width: 120, depth: 40, height: 80, preferences: ['againstWall'] }),
      createFurniture({ name: 'Armchair', kind: 'armchair', x: 400, y: 320, width: 80, depth: 80, height: 90 }),
    ],
    features: [createFeature('door', wall(room, 2, 280), room, { name: 'Front door' })],
    stairs: [createStaircase('straight', { x: 380, y: 60 })],
  }));
}

/** 6. A room where several pieces are locked in place. */
export function withLockedPieces(): Project {
  const project = largeLivingRoom();
  const lock = new Set(['TV unit', 'Bookshelf', 'Dining table']);
  return { ...project, name: 'Locked pieces', furniture: project.furniture.map((f: Furniture) => (lock.has(f.name) ? { ...f, locked: true } : f)) };
}

/** 7. Far too much furniture for a small room. */
export function overcrowded(): Project {
  return withRoom(createRectangularRoom(300, 280), 'Overcrowded', (room) => ({
    furniture: [
      createFurniture({ name: 'King bed', kind: 'bed', x: 150, y: 140, width: 200, depth: 210, height: 50 }),
      ...[0, 1, 2].map((i) => createFurniture({ name: `Wardrobe ${i + 1}`, kind: 'storage', x: 60 + i * 90, y: 60, width: 150, depth: 70, height: 200 })),
      createFurniture({ name: 'Desk', kind: 'desk', x: 150, y: 230, width: 140, depth: 70, height: 75 }),
    ],
    features: [createFeature('door', wall(room, 2, 150), room, { name: 'Door' })],
  }));
}

/** 8. Custom-shaped furniture in an L-shaped room: an L-desk, an angled loveseat and a kidney table. */
export function customShapes(): Project {
  const base = lShapedStudio();
  const shaped = (name: string, kind: Furniture['kind'], template: ShapeTemplate, x: number, y: number, height: number) => {
    const { shape, width, depth } = normaliseShape(shapeTemplate(template));
    return createFurniture({ name, kind, x, y, width, depth, height, shape });
  };
  return {
    ...base,
    name: 'Custom shapes',
    furniture: [
      shaped('L-desk', 'desk', 'lDesk', 450, 120, 75),
      shaped('Loveseat', 'sofa', 'angledLoveseat', 150, 360, 85),
      shaped('Kidney table', 'coffeeTable', 'kidneyTable', 150, 180, 45),
      createFurniture({ name: 'Desk chair', kind: 'chair', x: 300, y: 220, width: 50, depth: 50, height: 90 }),
    ],
    relationships: [],
  };
}

export const TEST_ROOMS = { smallBedroom, largeLivingRoom, lShapedStudio, multipleDoors, withStairs, withLockedPieces, overcrowded };

/** Ids the optimizer may move: everything solid that isn't locked. */
export function movableIds(project: Project): string[] {
  return project.furniture.filter((f) => !f.locked && f.category !== 'floorCovering').map((f) => f.id);
}
