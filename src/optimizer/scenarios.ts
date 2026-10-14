import { createEmptyProject, createFeature, createFurniture, createRectangularRoom, createStaircase } from '../model/sample';
import { normaliseShape, shapeTemplate } from '../model/shape';
import type { Furniture, FurnitureShape, Project, Room, WallNode } from '../model/types';

/**
 * Real-world rooms for checking that suggestions make practical sense (tests only).
 * Unlike testRooms.ts, these have NO hand-drawn relationships — like most people's
 * projects — and pieces start in unhelpful spots. Rectangular rooms list their walls
 * clockwise: 0 top, 1 right, 2 bottom, 3 left.
 */

const wall = (room: Room, index: number, offset: number) => ({ type: 'wall' as const, wallId: room.outline[index].id, offset });
const piece = (fields: Partial<Furniture> & Pick<Furniture, 'name' | 'kind' | 'width' | 'depth' | 'height'>, x = 100, y = 100) => createFurniture({ ...fields, x, y });

function project(room: Room, name: string, furniture: Furniture[], features: Project['features'], extra: Partial<Project> = {}): Project {
  return { ...createEmptyProject(room, name), furniture, features, ...extra };
}

/** A circle as four cubic curves (radius r), the usual κ ≈ 0.5523 approximation. */
export function circleShape(r: number): FurnitureShape {
  const k = 0.5523 * r;
  return {
    points: [
      { x: 0, y: -r, c1: { x: k, y: -r }, c2: { x: r, y: -k } },
      { x: r, y: 0, c1: { x: r, y: k }, c2: { x: k, y: r } },
      { x: 0, y: r, c1: { x: -k, y: r }, c2: { x: -r, y: k } },
      { x: -r, y: 0, c1: { x: -r, y: -k }, c2: { x: -k, y: -r } },
    ],
  };
}

export function smallBedroom(): Project {
  const room = createRectangularRoom(330, 380);
  return project(room, 'Small bedroom', [
    piece({ name: 'Double bed', kind: 'bed', width: 140, depth: 200, height: 50 }, 165, 190),
    piece({ name: 'Bedside table L', kind: 'bedsideTable', width: 45, depth: 40, height: 55 }, 40, 340),
    piece({ name: 'Bedside table R', kind: 'bedsideTable', width: 45, depth: 40, height: 55 }, 290, 340),
    piece({ name: 'Wardrobe', kind: 'storage', width: 100, depth: 60, height: 200 }, 165, 60),
  ], [createFeature('door', wall(room, 2, 270), room, { name: 'Door' }), createFeature('window', wall(room, 0, 165), room)]);
}

export function livingWithTv(): Project {
  const room = createRectangularRoom(520, 420);
  return project(room, 'Living room with TV', [
    piece({ name: 'Sofa', kind: 'sofa', width: 220, depth: 95, height: 85, rotation: 90 }, 260, 210),
    piece({ name: 'Armchair', kind: 'armchair', width: 85, depth: 85, height: 90, rotation: 270 }, 120, 320),
    piece({ name: 'Coffee table', kind: 'coffeeTable', width: 110, depth: 60, height: 45 }, 420, 330),
    piece({ name: 'TV unit', kind: 'television', width: 160, depth: 45, height: 60 }, 400, 120),
    piece({ name: 'Bookshelf', kind: 'bookshelf', width: 100, depth: 35, height: 190 }, 120, 120),
  ], [createFeature('door', wall(room, 3, 340), room, { name: 'Door' }), createFeature('window', wall(room, 0, 260), room, { width: 180 })]);
}

export function homeOffice(): Project {
  const room = createRectangularRoom(360, 320);
  return project(room, 'Home office', [
    piece({ name: 'Desk', kind: 'desk', width: 140, depth: 70, height: 75 }, 180, 160),
    piece({ name: 'Desk chair', kind: 'chair', width: 55, depth: 55, height: 100, rotation: 90 }, 70, 260),
    piece({ name: 'Bookshelf', kind: 'bookshelf', width: 90, depth: 35, height: 190 }, 290, 260),
    piece({ name: 'Filing cabinet', kind: 'cabinet', width: 50, depth: 60, height: 100 }, 60, 70),
    piece({ name: 'Reading chair', kind: 'armchair', width: 80, depth: 80, height: 90 }, 290, 80),
  ], [createFeature('door', wall(room, 2, 300), room, { name: 'Door' }), createFeature('window', wall(room, 0, 180), room), createFeature('outlet', wall(room, 1, 200), room)]);
}

export function lStudio(): Project {
  const outline: WallNode[] = [
    [0, 0],
    [620, 0],
    [620, 300],
    [360, 300],
    [360, 500],
    [0, 500],
  ].map(([x, y], i) => ({ id: `ls${i}`, x, y, thickness: 12 }));
  const room: Room = { ...createRectangularRoom(10, 10), outline };
  return project(room, 'L-shaped studio', [
    piece({ name: 'Bed', kind: 'bed', width: 140, depth: 200, height: 50 }, 180, 250),
    piece({ name: 'Sofa', kind: 'sofa', width: 190, depth: 90, height: 85 }, 480, 150),
    piece({ name: 'TV', kind: 'television', width: 140, depth: 40, height: 55 }, 300, 80),
    piece({ name: 'Desk', kind: 'desk', width: 120, depth: 60, height: 75 }, 120, 420),
    piece({ name: 'Desk chair', kind: 'chair', width: 50, depth: 50, height: 95 }, 260, 420),
    piece({ name: 'Wardrobe', kind: 'storage', width: 110, depth: 60, height: 200 }, 520, 260),
  ], [createFeature('door', { type: 'wall', wallId: 'ls3', offset: 100 }, room, { name: 'Front door' }), createFeature('window', { type: 'wall', wallId: 'ls0', offset: 300 }, room, { width: 160 })]);
}

export function roomWithStairs(): Project {
  const room = createRectangularRoom(600, 450);
  return project(
    room,
    'Hall with stairs',
    [
      piece({ name: 'Sofa', kind: 'sofa', width: 200, depth: 90, height: 85 }, 300, 230),
      piece({ name: 'Armchair', kind: 'armchair', width: 80, depth: 80, height: 90 }, 450, 330),
      piece({ name: 'Console', kind: 'cabinet', width: 120, depth: 40, height: 80 }, 150, 330),
    ],
    [createFeature('door', wall(room, 2, 300), room, { name: 'Front door' })],
    { stairs: [createStaircase('straight', { x: 400, y: 60 })] },
  );
}

export function multipleDoors(): Project {
  const room = createRectangularRoom(500, 420);
  return project(room, 'Three doors', [
    piece({ name: 'Sofa', kind: 'sofa', width: 210, depth: 90, height: 85 }, 250, 210),
    piece({ name: 'Armchair', kind: 'armchair', width: 85, depth: 85, height: 90 }, 380, 300),
    piece({ name: 'Bookshelf', kind: 'bookshelf', width: 100, depth: 35, height: 190 }, 380, 120),
    piece({ name: 'Cabinet', kind: 'cabinet', width: 120, depth: 45, height: 90 }, 120, 120),
  ], [
    createFeature('door', wall(room, 3, 210), room, { name: 'West door' }),
    createFeature('door', wall(room, 1, 210), room, { name: 'East door' }),
    createFeature('door', wall(room, 2, 250), room, { name: 'South door' }),
  ]);
}

export function loveseatAndOttoman(): Project {
  const room = createRectangularRoom(480, 400);
  const loveseat = normaliseShape(shapeTemplate('angledLoveseat'));
  const ottoman = normaliseShape(circleShape(30));
  return project(room, 'Loveseat and ottoman', [
    piece({ name: 'Loveseat', kind: 'sofa', ...loveseat, height: 85 }, 240, 200),
    piece({ name: 'Round ottoman', kind: 'coffeeTable', ...ottoman, height: 42 }, 120, 320),
    piece({ name: 'TV unit', kind: 'television', width: 150, depth: 45, height: 55 }, 380, 320),
  ], [createFeature('door', wall(room, 3, 320), room, { name: 'Door' })]);
}

export function lockedObjects(): Project {
  const base = livingWithTv();
  // The TV is locked on the top wall and the bookshelf on the left wall (clear of the door,
  // which is near the top of that wall): everything else must work around them.
  return {
    ...base,
    name: 'Locked TV and bookshelf',
    furniture: base.furniture.map((f) =>
      f.name === 'TV unit' ? { ...f, x: 260, y: 23, rotation: 0, locked: true } : f.name === 'Bookshelf' ? { ...f, x: 18, y: 300, rotation: 270, locked: true } : f,
    ),
  };
}

export function fengShuiBedroom(): Project {
  const base = smallBedroom();
  return { ...base, name: 'Feng Shui bedroom', fengShui: { enabled: true, method: 'entrance', showBagua: false, northBearing: null, entranceId: base.features[0].id } };
}

export function fengShuiOffice(): Project {
  const base = homeOffice();
  return { ...base, name: 'Feng Shui office', fengShui: { enabled: true, method: 'entrance', showBagua: false, northBearing: null, entranceId: base.features[0].id } };
}

export const SCENARIOS = {
  smallBedroom,
  livingWithTv,
  homeOffice,
  lStudio,
  roomWithStairs,
  multipleDoors,
  loveseatAndOttoman,
  lockedObjects,
  fengShuiBedroom,
  fengShuiOffice,
};
