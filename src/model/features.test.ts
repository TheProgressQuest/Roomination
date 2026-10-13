import { describe, expect, it } from 'vitest';
import {
  clampFeatureToRoom,
  convertPlacement,
  doorLeaves,
  featureFrame,
  featureZones,
  findFreeWallSpot,
  findOverlappingOpening,
  snapToWall,
  toRoom,
} from './features';
import { boundingBox } from './polygon';
import { createFeature } from './sample';
import type { Wall } from './types';

const room = { width: 400, length: 300, height: 250 };
const onWall = (wall: Wall, offset: number) => ({ type: 'wall' as const, wall, offset });

describe('wall frames', () => {
  it('local +y always points into the room', () => {
    const cases: [Wall, { x: number; y: number }][] = [
      ['top', { x: 100, y: 10 }],
      ['right', { x: 390, y: 100 }],
      ['bottom', { x: 100, y: 290 }],
      ['left', { x: 10, y: 100 }],
    ];
    for (const [wall, expected] of cases) {
      const door = createFeature('door', onWall(wall, 100), room);
      const p = toRoom(featureFrame(door, room), { x: 0, y: 10 });
      expect(p.x).toBeCloseTo(expected.x);
      expect(p.y).toBeCloseTo(expected.y);
    }
  });
});

describe('doors', () => {
  it('an inward door swings into the room, an outward one does not', () => {
    const inward = createFeature('door', onWall('top', 200), room, { width: 80, swing: 'in' });
    const box = boundingBox(featureZones(inward, room)[0].polygon);
    expect(box.minY).toBeCloseTo(0);
    expect(box.maxY).toBeCloseTo(80); // swing radius = door width

    // Outward: no swing inside the room, only the walkway (clearance depth 50).
    const outward = { ...inward, swing: 'out' as const };
    const walkway = boundingBox(featureZones(outward, room)[0].polygon);
    expect(walkway.maxY).toBeCloseTo(50);
  });

  it('hinge side decides which half of the opening the swing covers', () => {
    // Top wall, facing it from inside: viewer's left is −x.
    const left = createFeature('door', onWall('top', 200), room, { width: 80, hinge: 'left' });
    const right = { ...left, hinge: 'right' as const };
    const leftBox = boundingBox(featureZones(left, room)[0].polygon);
    const rightBox = boundingBox(featureZones(right, room)[0].polygon);
    expect(leftBox.minX).toBeCloseTo(160); // hinge at 160, leaf swings over 160..240
    expect(rightBox.maxX).toBeCloseTo(240);
  });

  it('double doors have two half-width leaves; sliding doors have none', () => {
    expect(doorLeaves({ width: 160, doorType: 'double', swing: 'in', hinge: 'left' }).map((l) => l.radius)).toEqual([80, 80]);
    expect(doorLeaves({ width: 160, doorType: 'sliding', swing: 'in', hinge: 'left' })).toEqual([]);
  });
});

describe('placement rules', () => {
  it('snaps a point to the nearest wall, keeping the feature on it', () => {
    expect(snapToWall({ x: 395, y: 150 }, room, 80)).toEqual({ type: 'wall', wall: 'right', offset: 150 });
    expect(snapToWall({ x: 10, y: 5 }, room, 80)).toEqual({ type: 'wall', wall: 'top', offset: 40 });
  });

  it('clamps wall features along their wall and refuses ones longer than it', () => {
    const window = createFeature('window', onWall('left', 290), room, { width: 100 });
    const clamped = clampFeatureToRoom(window, room)!;
    expect(clamped.placement).toEqual(onWall('left', 250));
    expect(clampFeatureToRoom({ ...window, width: 301 }, room)).toBeNull();
  });

  it('detects overlapping doors and windows on the same wall only', () => {
    const a = createFeature('window', onWall('top', 100), room, { width: 100 });
    const b = createFeature('door', onWall('top', 180), room, { width: 80 });
    const c = createFeature('door', onWall('bottom', 100), room, { width: 80 });
    const touching = createFeature('door', onWall('top', 190), room, { width: 80 });
    expect(findOverlappingOpening(b, [a])?.id).toBe(a.id);
    expect(findOverlappingOpening(c, [a])).toBeNull();
    expect(findOverlappingOpening(touching, [a])).toBeNull();
    // Outlets aren't openings and never block doors.
    const outlet = createFeature('outlet', onWall('top', 100), room);
    expect(findOverlappingOpening(b, [outlet])).toBeNull();
  });

  it('finds a free spot for a new opening', () => {
    const existing = [createFeature('door', onWall('top', 200), room, { width: 80 })];
    const spot = findFreeWallSpot(existing, room, 80, 'top')!;
    expect(spot.wall).toBe('top');
    expect(Math.abs(spot.offset - 200)).toBeGreaterThanOrEqual(80);
  });

  it('converts a vent between wall and floor mounting', () => {
    const vent = createFeature('vent', onWall('left', 100), room, { ventMount: 'wall' });
    const onFloor = convertPlacement(vent, 'free', room);
    expect(onFloor.placement.type).toBe('free');
    const backOnWall = convertPlacement(onFloor, 'wall', room);
    expect(backOnWall.placement).toMatchObject({ wall: 'left', offset: 100 });
  });
});
