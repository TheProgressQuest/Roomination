import { describe, expect, it } from 'vitest';
import { baguaMap, upDirection } from './bagua';
import { pointInPolygon } from './polygon';
import { createEmptyProject, createFeature, createRectangularRoom } from './sample';
import type { Project } from './types';

/** A 600 × 400 room (walls clockwise: 0 top, 1 right, 2 bottom, 3 left) with a door. */
function room(doorWall: number, fengShui: Partial<NonNullable<Project['fengShui']>> = {}): Project {
  const r = createRectangularRoom(600, 400);
  const door = createFeature('door', { type: 'wall', wallId: r.outline[doorWall].id, offset: doorWall % 2 === 0 ? 300 : 200 }, r, { name: 'Door' });
  return { ...createEmptyProject(r, 'Bagua'), features: [door], fengShui: { enabled: true, method: 'entrance', showBagua: true, northBearing: null, entranceId: null, ...fengShui } };
}

const find = (map: ReturnType<typeof baguaMap>, id: string, at: { x: number; y: number }) => {
  if (typeof map === 'string') throw new Error(map);
  const area = map.areas.find((a) => a.id === id)!;
  return pointInPolygon(at, area.polygon);
};

describe('entrance Bagua', () => {
  it('puts Career at the entrance and Fame at the far wall, Knowledge to the left on entering', () => {
    // Door in the bottom wall: walking in, you face up; your left is the room's left.
    const map = baguaMap(room(2));
    expect(find(map, 'career', { x: 300, y: 350 })).toBe(true);
    expect(find(map, 'fame', { x: 300, y: 50 })).toBe(true);
    expect(find(map, 'knowledge', { x: 50, y: 350 })).toBe(true);
    expect(find(map, 'helpers', { x: 550, y: 350 })).toBe(true);
    expect(find(map, 'wealth', { x: 50, y: 50 })).toBe(true);
    expect(find(map, 'love', { x: 550, y: 50 })).toBe(true);
    expect(find(map, 'centre', { x: 300, y: 200 })).toBe(true);
  });

  it('turns with the entrance wall', () => {
    // Door in the left wall: walking in you face right; your left is the top.
    const map = baguaMap(room(3));
    expect(find(map, 'career', { x: 50, y: 200 })).toBe(true);
    expect(find(map, 'fame', { x: 550, y: 200 })).toBe(true);
    expect(find(map, 'knowledge', { x: 50, y: 50 })).toBe(true);
    expect(find(map, 'love', { x: 550, y: 350 })).toBe(true);
  });

  it('needs a door', () => {
    expect(baguaMap({ ...room(2), features: [] })).toMatch(/Add a door/);
  });
});

describe('compass Bagua', () => {
  it('needs the north bearing to be typed in, never guessed', () => {
    expect(baguaMap(room(2, { method: 'compass' }))).toMatch(/never guesses/);
  });

  it('places directions from the bearing', () => {
    // Plan "up" is north: north is the top of the room.
    const north = baguaMap(room(2, { method: 'compass', northBearing: 0 }));
    expect(find(north, 'career', { x: 300, y: 20 })).toBe(true);
    expect(find(north, 'family', { x: 580, y: 200 })).toBe(true);
    expect(find(north, 'centre', { x: 300, y: 200 })).toBe(true);
    // Plan "up" faces east (bearing 90): north is to the left of the plan.
    const east = baguaMap(room(2, { method: 'compass', northBearing: 90 }));
    expect(find(east, 'career', { x: 20, y: 200 })).toBe(true);
    expect(find(east, 'family', { x: 300, y: 20 })).toBe(true);
    expect(upDirection(90)).toBe('E');
  });

  it('explains every area as a traditional association', () => {
    const map = baguaMap(room(2, { method: 'compass', northBearing: 0 }));
    if (typeof map === 'string') throw new Error(map);
    expect(map.areas).toHaveLength(9);
    for (const a of map.areas) expect(a.explanation).toMatch(/Traditionally|traditionally/);
    expect(map.areas.map((a) => a.explanation).join(' ')).not.toMatch(/guarantee|will bring|luck/i);
  });
});
