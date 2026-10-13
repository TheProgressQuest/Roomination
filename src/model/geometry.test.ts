import { describe, expect, it } from 'vitest';
import { clampCenterToRoom, fitsInRoom, furnitureBounds, normalizeRotation, rotatedHalfExtents } from './geometry';

const room = { width: 400, length: 300, height: 250 };
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
    const { halfX } = rotatedHalfExtents(100, 100, 45);
    expect(halfX).toBeCloseTo(Math.SQRT2 * 50);
  });
});

describe('clampCenterToRoom', () => {
  it('leaves a piece that is already inside alone', () => {
    expect(clampCenterToRoom(sofa, room)).toEqual(sofa);
  });

  it('pushes a piece back inside each wall', () => {
    const clamped = clampCenterToRoom({ ...sofa, x: -50, y: 999 }, room)!;
    const bounds = furnitureBounds(clamped);
    expect(bounds.minX).toBeCloseTo(0);
    expect(bounds.maxY).toBeCloseTo(room.length);
  });

  it('uses the rotated footprint, not the raw width', () => {
    // Rotated 90°, the sofa is only 90 cm wide on the floor, so it can sit 45 cm from the wall.
    const clamped = clampCenterToRoom({ ...sofa, x: 0, rotation: 90 }, room)!;
    expect(clamped.x).toBeCloseTo(45);
    expect(clamped.y).toBeCloseTo(150);
  });

  it('refuses pieces that are too big', () => {
    expect(clampCenterToRoom({ ...sofa, width: 401 }, room)).toBeNull();
    // 350 wide fits flat, but not rotated 90° in a 300 cm long room.
    expect(fitsInRoom({ width: 350, depth: 50, rotation: 0 }, room)).toBe(true);
    expect(fitsInRoom({ width: 350, depth: 50, rotation: 90 }, room)).toBe(false);
  });

  it('accepts an exact fit despite floating-point noise', () => {
    const clamped = clampCenterToRoom({ x: 10, y: 10, width: 300, depth: 400, rotation: 90 }, room)!;
    expect(clamped.x).toBeCloseTo(200);
    expect(clamped.y).toBeCloseTo(150);
  });
});
