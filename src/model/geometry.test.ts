import { describe, expect, it } from 'vitest';
import { furnitureBounds, normalizeRotation, rotatedHalfExtents } from './geometry';
import { clampFurnitureToRoom } from './placement';
import type { WallNode } from './types';

let nextId = 0;
const makeId = () => `n${nextId++}`;
const outlineOf = (...points: [number, number][]): { outline: WallNode[] } => ({
  outline: points.map(([x, y]) => ({ id: makeId(), x, y, thickness: 12 })),
});

const rectangle = outlineOf([0, 0], [400, 0], [400, 300], [0, 300]);
/** An L-shaped room: a 400×300 rectangle with the bottom-right 200×150 corner missing. */
const lShape = outlineOf([0, 0], [400, 0], [400, 150], [200, 150], [200, 300], [0, 300]);
const sofa = { x: 200, y: 150, width: 200, depth: 90, rotation: 0 };

describe('normalizeRotation', () => {
  it('wraps angles into [0, 360)', () => {
    expect(normalizeRotation(370)).toBe(10);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(360)).toBe(0);
    expect(Object.is(normalizeRotation(-0), 0)).toBe(true);
  });
});

describe('rotatedHalfExtents', () => {
  it('swaps width and depth at 90°', () => {
    const { halfX, halfY } = rotatedHalfExtents(200, 90, 90);
    expect(halfX).toBeCloseTo(45);
    expect(halfY).toBeCloseTo(100);
  });

  it('grows the footprint at 45°', () => {
    expect(rotatedHalfExtents(100, 100, 45).halfX).toBeCloseTo(Math.SQRT2 * 50);
  });
});

describe('clampFurnitureToRoom — rectangular rooms (Phase 1 behaviour)', () => {
  it('leaves a piece that is already inside alone', () => {
    expect(clampFurnitureToRoom(sofa, rectangle)).toEqual(sofa);
  });

  it('pushes a piece back inside each wall by the minimum distance', () => {
    const clamped = clampFurnitureToRoom({ ...sofa, x: -50, y: 999 }, rectangle)!;
    const bounds = furnitureBounds(clamped);
    expect(bounds.minX).toBeCloseTo(0);
    expect(bounds.maxY).toBeCloseTo(300);
  });

  it('uses the rotated footprint, not the raw width', () => {
    const clamped = clampFurnitureToRoom({ ...sofa, x: 0, rotation: 90 }, rectangle)!;
    expect(clamped.x).toBeCloseTo(45);
    expect(clamped.y).toBeCloseTo(150);
  });

  it('refuses pieces that are too big', () => {
    expect(clampFurnitureToRoom({ ...sofa, width: 401 }, rectangle)).toBeNull();
    expect(clampFurnitureToRoom({ ...sofa, width: 350, depth: 50, rotation: 90 }, rectangle)).toBeNull();
  });

  it('accepts an exact fit despite floating-point noise', () => {
    const clamped = clampFurnitureToRoom({ x: 10, y: 10, width: 300, depth: 400, rotation: 90 }, rectangle)!;
    expect(clamped.x).toBeCloseTo(200);
    expect(clamped.y).toBeCloseTo(150);
  });
});

describe('clampFurnitureToRoom — concave rooms', () => {
  it('accepts a piece fully inside either leg of an L', () => {
    const table = { x: 100, y: 250, width: 80, depth: 60, rotation: 0 };
    expect(clampFurnitureToRoom(table, lShape)).toEqual(table);
  });

  it('rejects positions in the missing corner, even though they are inside the bounding box', () => {
    const table = { x: 300, y: 250, width: 80, depth: 60, rotation: 0 };
    const placed = clampFurnitureToRoom(table, lShape)!;
    expect(placed).not.toEqual(table);
    // Moved to the nearest spot that really is inside the L.
    const b = furnitureBounds(placed);
    const inTopLeg = b.maxY <= 150 + 1e-6;
    const inLeftLeg = b.maxX <= 200 + 1e-6;
    expect(inTopLeg || inLeftLeg).toBe(true);
    // Nearest valid spot: straight up into the top leg (130 cm); the left leg would be 140 cm.
    expect(Math.hypot(placed.x - 300, placed.y - 250)).toBeCloseTo(130, 0);
  });

  it('a piece straddling the inner corner is pushed clear of it', () => {
    // Centred right on the reflex corner (200,150): corners poke into the missing area.
    const placed = clampFurnitureToRoom({ x: 210, y: 160, width: 60, depth: 60, rotation: 0 }, lShape)!;
    const b = furnitureBounds(placed);
    expect(b.maxY <= 150 + 1e-6 || b.maxX <= 200 + 1e-6).toBe(true);
  });

  it('slides along a wall while dragging instead of jumping', () => {
    // Dragging right along the top leg, past the room's right wall.
    const placed = clampFurnitureToRoom({ x: 500, y: 60, width: 80, depth: 60, rotation: 0 }, lShape, { x: 300, y: 60 })!;
    expect(placed.x).toBeCloseTo(360);
    expect(placed.y).toBeCloseTo(60);
  });

  it('handles rotated furniture against an angled wall', () => {
    // A room with a slanted right wall.
    const slanted = outlineOf([0, 0], [300, 0], [400, 300], [0, 300]);
    const placed = clampFurnitureToRoom({ x: 380, y: 280, width: 60, depth: 40, rotation: 30 }, slanted)!;
    expect(placed).not.toBeNull();
    expect(placed.x).toBeLessThan(380);
  });
});

describe('placing staircases in concave rooms', () => {
  it('finds the narrow strip where an L-shaped stair fits in one leg of an L-shaped room', async () => {
    const { clampStairToRoom } = await import('./placement');
    const { createStaircase } = await import('./sample');
    const room = outlineOf([0, 0], [500, 0], [500, 200], [300, 200], [300, 400], [0, 400]);
    const stair = createStaircase('L', { x: 250, y: 200 }); // 265 × 265 footprint
    const placed = clampStairToRoom(stair, room);
    expect(placed).not.toBeNull();
  });
});
