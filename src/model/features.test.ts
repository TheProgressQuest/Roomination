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
import { createFeature, createRectangularRoom } from './sample';

// Outline walls run clockwise: [0] top (→), [1] right (↓), [2] bottom (←), [3] left (↑).
const room = createRectangularRoom(400, 300);
const [top, right, bottom, left] = room.outline.map((n) => n.id);
const onWall = (wallId: string, offset: number) => ({ type: 'wall' as const, wallId, offset });

describe('wall frames', () => {
  it('local +y always points into the room', () => {
    const cases: [string, { x: number; y: number }][] = [
      [top, { x: 100, y: 10 }],
      [right, { x: 390, y: 100 }],
      [bottom, { x: 300, y: 290 }], // bottom runs right→left: 100 cm from its start is x = 300
      [left, { x: 10, y: 200 }], // left runs bottom→top: 100 cm from its start is y = 200
    ];
    for (const [wallId, expected] of cases) {
      const door = createFeature('door', onWall(wallId, 100), room);
      const p = toRoom(featureFrame(door, room), { x: 0, y: 10 });
      expect(p.x).toBeCloseTo(expected.x);
      expect(p.y).toBeCloseTo(expected.y);
    }
  });

  it('a door on an angled wall swings perpendicular to that wall', () => {
    const slanted = { ...room, outline: [room.outline[0], { ...room.outline[1], x: 400 }, { ...room.outline[2], x: 500 }, room.outline[3]] };
    const door = createFeature('door', onWall(right, 100), slanted, { width: 80 });
    const frame = featureFrame(door, slanted);
    const wallAngle = (Math.atan2(300, 100) * 180) / Math.PI;
    expect(frame.angle).toBeCloseTo(wallAngle);
  });
});

describe('doors', () => {
  it('an inward door swings into the room, an outward one does not', () => {
    const inward = createFeature('door', onWall(top, 200), room, { width: 80, swing: 'in' });
    const box = boundingBox(featureZones(inward, room)[0].polygon);
    expect(box.minY).toBeCloseTo(0);
    expect(box.maxY).toBeCloseTo(80);
    const outward = { ...inward, swing: 'out' as const };
    expect(boundingBox(featureZones(outward, room)[0].polygon).maxY).toBeCloseTo(50);
  });

  it('hinge side decides which half of the opening the swing covers', () => {
    const left = createFeature('door', onWall(top, 200), room, { width: 80, hinge: 'left' });
    const rightHinged = { ...left, hinge: 'right' as const };
    expect(boundingBox(featureZones(left, room)[0].polygon).minX).toBeCloseTo(160);
    expect(boundingBox(featureZones(rightHinged, room)[0].polygon).maxX).toBeCloseTo(240);
  });

  it('double doors have two half-width leaves; sliding doors have none', () => {
    expect(doorLeaves({ width: 160, doorType: 'double', swing: 'in', hinge: 'left' }).map((l) => l.radius)).toEqual([80, 80]);
    expect(doorLeaves({ width: 160, doorType: 'sliding', swing: 'in', hinge: 'left' })).toEqual([]);
  });
});

describe('placement rules', () => {
  it('snaps a point to the nearest wall, keeping the feature on it', () => {
    expect(snapToWall({ x: 395, y: 150 }, room, 80)).toEqual(onWall(right, 150));
    expect(snapToWall({ x: 10, y: 5 }, room, 80)).toEqual(onWall(top, 40));
  });

  it('only snaps to walls long enough for the feature', () => {
    const narrow = createRectangularRoom(100, 400);
    const snapped = snapToWall({ x: 50, y: 2 }, narrow, 150)!; // nearest is the 100 cm top wall
    expect([narrow.outline[1].id, narrow.outline[3].id]).toContain(snapped.wallId);
  });

  it('clamps wall features along their wall and refuses ones longer than it', () => {
    const window = createFeature('window', onWall(right, 290), room, { width: 100 });
    expect(clampFeatureToRoom(window, room)!.placement).toEqual(onWall(right, 250));
    expect(clampFeatureToRoom({ ...window, width: 301 }, room)).toBeNull();
  });

  it('detects overlapping doors and windows on the same wall only', () => {
    const a = createFeature('window', onWall(top, 100), room, { width: 100 });
    const b = createFeature('door', onWall(top, 180), room, { width: 80 });
    const c = createFeature('door', onWall(bottom, 100), room, { width: 80 });
    const touching = createFeature('door', onWall(top, 190), room, { width: 80 });
    expect(findOverlappingOpening(b, [a])?.id).toBe(a.id);
    expect(findOverlappingOpening(c, [a])).toBeNull();
    expect(findOverlappingOpening(touching, [a])).toBeNull();
    expect(findOverlappingOpening(b, [createFeature('outlet', onWall(top, 100), room)])).toBeNull();
  });

  it('finds a free spot for a new opening, starting with the preferred wall', () => {
    const existing = [createFeature('door', onWall(top, 200), room, { width: 80 })];
    const spot = findFreeWallSpot(existing, room, 80, 0)!;
    expect(spot.wallId).toBe(top);
    expect(Math.abs(spot.offset - 200)).toBeGreaterThanOrEqual(80);
    expect(findFreeWallSpot([], room, 80, 2)!.wallId).toBe(bottom);
  });

  it('converts a vent between wall and floor mounting', () => {
    const vent = createFeature('vent', onWall(left, 100), room, { ventMount: 'wall' });
    const onFloor = convertPlacement(vent, 'free', room);
    expect(onFloor.placement.type).toBe('free');
    expect(convertPlacement(onFloor, 'wall', room).placement).toMatchObject({ wallId: left, offset: 100 });
  });

  it('keeps free features inside a concave room', () => {
    const l = { ...room, outline: [
      { id: 'a', x: 0, y: 0, thickness: 12 }, { id: 'b', x: 400, y: 0, thickness: 12 }, { id: 'c', x: 400, y: 150, thickness: 12 },
      { id: 'd', x: 200, y: 150, thickness: 12 }, { id: 'e', x: 200, y: 300, thickness: 12 }, { id: 'f', x: 0, y: 300, thickness: 12 },
    ] };
    const column = createFeature('column', { type: 'free', x: 300, y: 250, rotation: 0 }, l);
    const placed = clampFeatureToRoom(column, l)!;
    const p = placed.placement as { x: number; y: number };
    expect(p.y <= 150 - 20 + 1e-6 || p.x <= 200 - 20 + 1e-6).toBe(true);
  });
});
