import { FURNITURE_KIND_LABELS } from '../model/furnitureKinds';
import { createEmptyProject, createFeature, createFurniture, createRectangularRoom, createSampleProject, createStaircase, FURNITURE_COLORS } from '../model/sample';
import type { FurnitureAppearance, FurnitureKind, Project, Room, WallNode } from '../model/types';
import { customShapes, lShapedStudio, multipleDoors } from '../optimizer/testRooms';
import { normaliseShape, shapeTemplate } from '../model/shape';

/**
 * Rooms for checking the 3D view (unit, browser and performance tests only). Each one
 * exercises a different part of the geometry adapter.
 */

const nodes = (points: number[][], thickness = 12): WallNode[] => points.map(([x, y], i) => ({ id: `w${i}-${x}-${y}`, x, y, thickness }));
const roomFrom = (outline: WallNode[], height = 250): Room => ({ ...createRectangularRoom(10, 10, height), outline });
const onWall = (room: Room, index: number, offset: number) => ({ type: 'wall' as const, wallId: room.outline[index].id, offset });

/** 1. The sample rectangle. */
export const rectangle = (): Project => createSampleProject();

/** 2. An L-shaped studio. */
export const lShaped = (): Project => lShapedStudio();

/** 3. A U-shaped room (a courtyard notch in the top wall). */
export function uShaped(): Project {
  const room = roomFrom(nodes([[0, 0], [200, 0], [200, 220], [420, 220], [420, 0], [620, 0], [620, 460], [0, 460]]));
  return {
    ...createEmptyProject(room, 'U-shaped room'),
    furniture: [
      createFurniture({ name: 'Sofa', kind: 'sofa', x: 310, y: 380, width: 220, depth: 90, height: 85, rotation: 180 }),
      createFurniture({ name: 'Desk', kind: 'desk', x: 100, y: 120, width: 120, depth: 60, height: 75, rotation: 90 }),
      createFurniture({ name: 'Bed', kind: 'bed', x: 520, y: 180, width: 140, depth: 200, height: 50 }),
    ],
    features: [createFeature('door', onWall(room, 7, 200), room), createFeature('window', onWall(room, 2, 110), room, { width: 160 })],
  };
}

/** 4. Angled walls: a pentagon with a long diagonal wall, and a window on it. */
export function angledWalls(): Project {
  const room = roomFrom(nodes([[0, 0], [500, 0], [500, 260], [260, 440], [0, 440]], 15), 270);
  return {
    ...createEmptyProject(room, 'Angled walls'),
    furniture: [
      createFurniture({ name: 'Armchair', kind: 'armchair', x: 380, y: 290, width: 85, depth: 85, height: 90, rotation: 143 }),
      createFurniture({ name: 'Table', kind: 'table', x: 180, y: 180, width: 120, depth: 80, height: 75, rotation: 20 }),
    ],
    features: [
      createFeature('window', onWall(room, 2, 150), room, { width: 120 }),
      createFeature('door', onWall(room, 2, 260), room, { width: 80, doorType: 'hinged', hinge: 'right' }),
    ],
  };
}

/** 5. Interior walls (partitions), one with a doorway. */
export function partitions(): Project {
  const room: Room = {
    ...createRectangularRoom(600, 450),
    partitions: [
      { id: 'part-a', nodes: [{ id: 'pa0', x: 300, y: 0, thickness: 10 }, { id: 'pa1', x: 300, y: 300, thickness: 10 }] },
      { id: 'part-b', nodes: [{ id: 'pb0', x: 0, y: 260, thickness: 10 }, { id: 'pb1', x: 150, y: 260, thickness: 10 }, { id: 'pb2', x: 150, y: 330, thickness: 10 }] },
    ],
  };
  return {
    ...createEmptyProject(room, 'Partitions'),
    furniture: [createFurniture({ name: 'Bed', kind: 'bed', x: 450, y: 140, width: 160, depth: 200, height: 50 }), createFurniture({ name: 'Desk', kind: 'desk', x: 150, y: 60, width: 120, depth: 60, height: 75 })],
    features: [createFeature('door', { type: 'wall', wallId: 'pa0', offset: 200 }, room, { name: 'Inner door', width: 80 }), createFeature('door', onWall(room, 2, 300), room)],
  };
}

/** 6. Several doors of every type. */
export function manyDoors(): Project {
  const base = multipleDoors();
  const room = base.room;
  return {
    ...base,
    name: 'Many doors',
    features: [
      ...base.features,
      createFeature('door', onWall(room, 0, 120), room, { name: 'Double door', width: 140, doorType: 'double' }),
      createFeature('door', onWall(room, 0, 350), room, { name: 'Sliding door', width: 120, doorType: 'sliding' }),
      createFeature('door', onWall(room, 1, 80), room, { name: 'Outward door', swing: 'out', hinge: 'right' }),
    ],
  };
}

/** 7. Windows at different sizes and heights. */
export function windows(): Project {
  const room = createRectangularRoom(560, 400, 280);
  return {
    ...createEmptyProject(room, 'Windows'),
    furniture: [createFurniture({ name: 'Bench', kind: 'custom', x: 280, y: 330, width: 160, depth: 40, height: 45 })],
    features: [
      createFeature('window', onWall(room, 0, 120), room, { name: 'Low window', width: 100, height: 140, elevation: 30 }),
      createFeature('window', onWall(room, 0, 300), room, { name: 'High window', width: 140, height: 60, elevation: 190 }),
      createFeature('window', onWall(room, 0, 470), room, { name: 'Tall window', width: 80, height: 230, elevation: 10 }),
      createFeature('window', onWall(room, 1, 200), room, { name: 'Standard window', width: 160 }),
      createFeature('door', onWall(room, 2, 280), room),
    ],
  };
}

/** 8. Straight, L-shaped (rotated) and U-shaped stairs, one going down. */
export function stairs(): Project {
  const room = createRectangularRoom(900, 700, 260);
  return {
    ...createEmptyProject(room, 'Stairs'),
    stairs: [
      createStaircase('straight', { x: 230, y: 90 }, { name: 'Straight up', rise: 260 }),
      createStaircase('L', { x: 700, y: 210 }, { name: 'L-shaped up', rotation: 90, rise: 260 }),
      createStaircase('U', { x: 300, y: 450 }, { name: 'U-shaped down', direction: 'down', rise: 240 }),
    ],
    features: [createFeature('door', onWall(room, 2, 700), room)],
  };
}

/** 9. One piece of every kind, plus a rug. */
export function furnitureTypes(): Project {
  const room = createRectangularRoom(800, 600);
  const kinds = Object.keys(FURNITURE_KIND_LABELS) as FurnitureKind[];
  const sizes: Partial<Record<FurnitureKind, [number, number, number]>> = {
    bed: [160, 200, 50],
    sofa: [210, 90, 85],
    diningTable: [160, 90, 75],
    bookshelf: [100, 35, 190],
    storage: [120, 60, 200],
    television: [160, 45, 60],
    chair: [45, 45, 90],
  };
  const furniture = kinds.map((kind, i) => {
    const [width, depth, height] = sizes[kind] ?? [80, 50, 75];
    return createFurniture({
      name: FURNITURE_KIND_LABELS[kind],
      kind,
      x: 120 + (i % 5) * 140,
      y: 110 + Math.floor(i / 5) * 190,
      width: Math.min(width, 120),
      depth: Math.min(depth, 150),
      height,
      rotation: (i * 45) % 360,
      color: FURNITURE_COLORS[i % FURNITURE_COLORS.length].value,
    });
  });
  const rug = createFurniture({ name: 'Rug', category: 'floorCovering', kind: 'decor', x: 400, y: 520, width: 200, depth: 120, height: 1, texture: 'striped' });
  return { ...createEmptyProject(room, 'Furniture types'), furniture: [rug, ...furniture] };
}

/** 10. A custom floor: angled tiles in an irregular room with a ceiling vent and a round column. */
export function customFloor(): Project {
  const room: Room = { ...roomFrom(nodes([[0, 0], [520, 0], [520, 380], [300, 380], [300, 480], [0, 480]])), floor: { preset: 'tile', color: '#d9d2c5', scale: 1.5, angle: 45, intensity: 0.7 }, wallColor: '#c9dbe3' };
  return {
    ...createEmptyProject(room, 'Custom floor'),
    furniture: [createFurniture({ name: 'Dining table', kind: 'diningTable', x: 260, y: 190, width: 160, depth: 90, height: 75 })],
    features: [
      createFeature('column', { type: 'free', x: 120, y: 360, rotation: 0 }, room, { shape: 'round', width: 35, depth: 35 }),
      createFeature('vent', { type: 'free', x: 400, y: 100, rotation: 0 }, room, { ventMount: 'ceiling' }),
      createFeature('light', { type: 'free', x: 260, y: 190, rotation: 0 }, room, { lightType: 'chandelier', width: 60, height: 50 }),
      createFeature('door', onWall(room, 4, 150), room),
    ],
  };
}

/** 11. Drawn furniture: an L-desk, a curved sofa, a kidney table and an angled loveseat, with materials. */
export function customFurniture(): Project {
  const base = customShapes();
  const materials: FurnitureAppearance['material'][] = ['wood', 'fabric', 'leather', 'metal'];
  return {
    ...base,
    name: 'Custom furniture',
    furniture: [
      ...base.furniture.map((f, i) => ({ ...f, appearance: { material: materials[i % materials.length], finish: 'satin' as const } })),
      (() => {
        const { shape, width, depth } = normaliseShape(shapeTemplate('curvedSofa'));
        return createFurniture({ name: 'Curved sofa', kind: 'sofa', x: 470, y: 230, width, depth, height: 80, rotation: 180, shape, color: '#9bb7d4' });
      })(),
    ],
  };
}

/** The 3D rooms tested in the browser (an 11th, "optimized layout", is made by running the optimizer). */
export const ROOMS_3D = { rectangle, lShaped, uShaped, angledWalls, partitions, manyDoors, windows, stairs, furnitureTypes, customFloor, customFurniture };

/**
 * A deliberately heavy project for performance checks: 40 walls (a zig-zag top wall),
 * 150 pieces of furniture, several doors and windows, and several staircases.
 */
export function stressProject(): Project {
  const points: number[][] = [];
  for (let i = 0; i <= 37; i++) points.push([(i * 1400) / 37, i % 2 === 0 ? 0 : 30]);
  points.push([1400, 1000], [0, 1000]);
  const room = roomFrom(nodes(points), 260);
  const kinds = Object.keys(FURNITURE_KIND_LABELS) as FurnitureKind[];
  const furniture = Array.from({ length: 150 }, (_, i) =>
    createFurniture({
      name: `Piece ${i + 1}`,
      kind: kinds[i % kinds.length],
      x: 90 + (i % 15) * 82,
      y: 140 + Math.floor(i / 15) * 60,
      width: 60,
      depth: 40,
      height: 40 + (i % 5) * 30,
      rotation: (i * 15) % 360,
      color: FURNITURE_COLORS[i % FURNITURE_COLORS.length].value,
    }),
  );
  const bottom = room.outline.length - 2;
  const right = room.outline.length - 3;
  return {
    ...createEmptyProject(room, 'Stress test'),
    furniture,
    features: [
      ...[200, 500, 800, 1100].map((offset) => createFeature('door', onWall(room, bottom, offset), room)),
      ...[200, 500, 800].map((offset) => createFeature('window', onWall(room, right, offset), room)),
      ...[200, 600].map((offset) => createFeature('window', onWall(room, room.outline.length - 1, offset), room)),
    ],
    stairs: [
      createStaircase('straight', { x: 1150, y: 870 }),
      createStaircase('L', { x: 200, y: 860 }),
      createStaircase('U', { x: 700, y: 860 }, { direction: 'down' }),
    ],
  };
}
