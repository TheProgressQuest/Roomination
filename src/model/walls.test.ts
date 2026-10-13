import { describe, expect, it } from 'vitest';
import { convexInsidePolygon, findSelfIntersection, pointInPolygon, rectPolygon } from './polygon';
import type { Room, WallNode } from './types';
import {
  asRectangle,
  canMergeWithNext,
  deleteWall,
  findSegment,
  mergeWithNext,
  moveNode,
  normalizeOutline,
  outlineSegments,
  removeNode,
  resizeRectangle,
  roomArea,
  segmentInsidePolygon,
  setWallAngle,
  setWallLength,
  setWallThickness,
  splitWall,
  validateRoom,
} from './walls';

const node = (id: string, x: number, y: number): WallNode => ({ id, x, y, thickness: 12 });
const room = (outline: WallNode[], partitions: Room['partitions'] = []): Room => ({
  outline,
  partitions,
  height: 250,
  floor: { preset: 'plain', color: '#ffffff', scale: 1, angle: 0, intensity: 0.5 },
  wallColor: '#ffffff',
});
const asRoom = (r: Room | string): Room => {
  if (typeof r === 'string') throw new Error(r);
  return r;
};

const rect = room([node('a', 0, 0), node('b', 400, 0), node('c', 400, 300), node('d', 0, 300)]);
const L = room([node('a', 0, 0), node('b', 400, 0), node('c', 400, 150), node('d', 200, 150), node('e', 200, 300), node('f', 0, 300)]);
const U = room([
  node('a', 0, 0), node('b', 100, 0), node('c', 100, 200), node('d', 200, 200),
  node('e', 200, 0), node('f', 300, 0), node('g', 300, 300), node('h', 0, 300),
]);

describe('polygon rooms', () => {
  it('derives one wall per edge, each with its length and direction', () => {
    const walls = outlineSegments(rect);
    expect(walls.map((w) => w.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(walls.map((w) => Math.round(w.length))).toEqual([400, 300, 400, 300]);
    expect(walls.map((w) => Math.round(w.angle))).toEqual([0, 90, 180, -90]);
  });

  it('computes area for concave rooms', () => {
    expect(roomArea(L)).toBe(400 * 300 - 200 * 150);
    expect(roomArea(U)).toBe(300 * 300 - 100 * 200);
  });

  it('point-in-polygon respects the missing corner of an L', () => {
    expect(pointInPolygon({ x: 100, y: 250 }, L.outline)).toBe(true);
    expect(pointInPolygon({ x: 300, y: 250 }, L.outline)).toBe(false);
  });

  it('containment uses the real outline, including the U-shaped notch', () => {
    expect(convexInsidePolygon(rectPolygon(50, 100, 60, 60, 0), U.outline)).toBe(true);
    expect(convexInsidePolygon(rectPolygon(150, 100, 60, 60, 0), U.outline)).toBe(false); // in the notch
    expect(convexInsidePolygon(rectPolygon(150, 250, 250, 60, 0), U.outline)).toBe(true); // along the base
  });

  it('recognises axis-aligned rectangles only', () => {
    expect(asRectangle(rect)).toMatchObject({ width: 400, length: 300 });
    expect(asRectangle(L)).toBeNull();
  });
});

describe('validation', () => {
  it('accepts rectangles, L, U and alcove rooms', () => {
    expect(validateRoom(rect)).toBeNull();
    expect(validateRoom(L)).toBeNull();
    expect(validateRoom(U)).toBeNull();
    const alcove = room([node('a', 0, 0), node('b', 150, 0), node('c', 150, -60), node('d', 250, -60), node('e', 250, 0), node('f', 400, 0), node('g', 400, 300), node('h', 0, 300)]);
    expect(validateRoom(alcove)).toBeNull();
  });

  it('explains crossing walls instead of accepting a bow-tie', () => {
    const bowTie = room([node('a', 0, 0), node('b', 400, 300), node('c', 400, 0), node('d', 0, 300)]);
    expect(findSelfIntersection(bowTie.outline)).not.toBeNull();
    expect(validateRoom(bowTie)).toMatch(/would cross each other/);
  });

  it('rejects an outline folded inside out', () => {
    const folded = room([node('a', 0, 0), node('b', 400, 0), node('c', -100, -100), node('d', 0, 300)]);
    expect(validateRoom(folded)).toMatch(/inside out/);
  });

  it('rejects walls that are too short and rooms that are too small', () => {
    expect(validateRoom(room([node('a', 0, 0), node('b', 5, 0), node('c', 5, 300), node('d', 0, 300)]))).toMatch(/shorter than/);
    expect(validateRoom(room([node('a', 0, 0), node('b', 40, 0), node('c', 40, 40), node('d', 0, 40)]))).toMatch(/too small/);
    // 60 × 60 cm was allowed by older versions, so it must stay valid.
    expect(validateRoom(room([node('a', 0, 0), node('b', 60, 0), node('c', 60, 60), node('d', 0, 60)]))).toBeNull();
  });

  it('interior walls must stay inside the room', () => {
    const inside = { id: 'p', nodes: [node('p1', 50, 50), node('p2', 150, 50)] };
    const crossingNotch = { id: 'p', nodes: [node('p1', 100, 100), node('p2', 300, 250)] };
    expect(validateRoom({ ...L, partitions: [inside] })).toBeNull();
    expect(validateRoom({ ...L, partitions: [crossingNotch] })).toMatch(/inside the room/);
    // A partition that touches the outer wall is fine.
    expect(segmentInsidePolygon({ x: 0, y: 100 }, { x: 150, y: 100 }, L.outline)).toBe(true);
  });
});

describe('editing walls', () => {
  it('moving a corner moves both walls that meet there (they stay connected)', () => {
    const moved = asRoom(moveNode(rect, 'c', { x: 450, y: 350 }));
    const walls = outlineSegments(moved);
    expect(walls[1].end).toEqual({ x: 450, y: 350 }); // right wall ends there
    expect(walls[2].start).toEqual({ x: 450, y: 350 }); // bottom wall starts there
  });

  it('sets an exact wall length along the wall’s current direction', () => {
    const longer = asRoom(setWallLength(rect, 'a', 500));
    expect(findSegment(longer, 'a')!.length).toBeCloseTo(500);
    expect(findSegment(longer, 'a')!.angle).toBeCloseTo(0);
    expect(setWallLength(rect, 'a', 3)).toMatch(/at least/);
  });

  it('sets a wall angle, keeping its length', () => {
    const turned = asRoom(setWallAngle(rect, 'b', 80));
    const wall = findSegment(turned, 'b')!;
    expect(wall.angle).toBeCloseTo(80);
    expect(wall.length).toBeCloseTo(300);
  });

  it('sets thickness per wall', () => {
    expect(findSegment(asRoom(setWallThickness(rect, 'b', 30)), 'b')!.thickness).toBe(30);
    expect(setWallThickness(rect, 'b', 500)).toMatch(/between/);
  });

  it('splits a wall into two connected walls (adds a vertex)', () => {
    const result = splitWall(rect, 'a', 150, 'new');
    if (typeof result === 'string') throw new Error(result);
    const walls = outlineSegments(result.room);
    expect(walls.map((w) => w.id)).toEqual(['a', 'new', 'b', 'c', 'd']);
    expect(walls[0].length).toBe(150);
    expect(walls[1].length).toBe(250);
    expect(splitWall(rect, 'a', 5, 'x')).toMatch(/at least/);
  });

  it('pulling a new vertex out creates an alcove', () => {
    const split = splitWall(rect, 'a', 200, 'mid');
    if (typeof split === 'string') throw new Error(split);
    const alcove = asRoom(moveNode(split.room, 'mid', { x: 200, y: -80 }));
    expect(validateRoom(alcove)).toBeNull();
    expect(roomArea(alcove)).toBeGreaterThan(roomArea(rect));
  });

  it('removes a vertex, joining its two walls', () => {
    const split = splitWall(rect, 'a', 200, 'mid');
    if (typeof split === 'string') throw new Error(split);
    expect(outlineSegments(asRoom(removeNode(split.room, 'mid'))).map((w) => w.id)).toEqual(['a', 'b', 'c', 'd']);
    const triangle = room([node('a', 0, 0), node('b', 400, 0), node('c', 0, 300)]);
    expect(removeNode(triangle, 'b')).toMatch(/at least three/);
  });

  it('merges only straight continuations with matching thickness', () => {
    const split = splitWall(rect, 'a', 200, 'mid');
    if (typeof split === 'string') throw new Error(split);
    expect(canMergeWithNext(split.room, 'a')).toBe(true);
    expect(outlineSegments(asRoom(mergeWithNext(split.room, 'a')))).toHaveLength(4);
    expect(canMergeWithNext(rect, 'a')).toBe(false); // a corner, not a straight continuation
    expect(canMergeWithNext(asRoom(setWallThickness(split.room, 'mid', 20)), 'a')).toBe(false);
  });

  it('deleting an interior wall segment splits its chain; deleting an outer wall joins neighbours', () => {
    const withPartition = { ...rect, partitions: [{ id: 'p', nodes: [node('p1', 50, 50), node('p2', 150, 50), node('p3', 150, 150), node('p4', 250, 150)] }] };
    const deleted = asRoom(deleteWall(withPartition, 'p2', 'p-split'));
    expect(deleted.partitions.map((p) => p.nodes.map((n) => n.id))).toEqual([['p1', 'p2'], ['p3', 'p4']]);
    // Deleting outer wall 'b' removes exactly that wall: 'a' now runs to where 'b' ended.
    const pentagon = room([node('a', 0, 0), node('b', 200, -50), node('c', 400, 0), node('d', 400, 300), node('e', 0, 300)]);
    const four = outlineSegments(asRoom(deleteWall(pentagon, 'b', 'x')));
    expect(four.map((w) => w.id)).toEqual(['a', 'c', 'd', 'e']);
    expect(four[0].end).toEqual({ x: 400, y: 0 });
  });

  it('resizes rectangles by width and length, refusing other shapes', () => {
    expect(asRectangle(asRoom(resizeRectangle(rect, 500, 350)))).toMatchObject({ width: 500, length: 350 });
    expect(resizeRectangle(L, 500, 350)).toMatch(/Only rectangular rooms/);
  });

  it('normalises newly drawn outlines to clockwise, keeping each wall’s thickness', () => {
    const anticlockwise = [node('a', 0, 0), node('b', 0, 300), node('c', 400, 300), node('d', 400, 0)].map((n, i) => ({ ...n, thickness: 10 + i }));
    const fixed = normalizeOutline(anticlockwise);
    expect(fixed.map((n) => n.id)).toEqual(['d', 'c', 'b', 'a']);
    // Wall d→c is the old wall c→d (thickness 12).
    expect(fixed[0].thickness).toBe(12);
  });
});
