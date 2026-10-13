import { describe, expect, it } from 'vitest';
import { boundingBox, polygonArea } from './polygon';
import { createFeature, createRectangularRoom } from './sample';
import { wallBodies } from './wallGeometry';

describe('wallBodies', () => {
  const room = createRectangularRoom(400, 300);

  it('draws outer walls outside the room with mitered corners', () => {
    const bodies = wallBodies(room, []);
    expect(bodies).toHaveLength(4);
    const box = boundingBox(bodies.flatMap((b) => b.polygon));
    // 12 cm walls all round: the outer edge is 12 cm beyond the inner face on every side.
    expect(box).toEqual({ minX: -12, minY: -12, maxX: 412, maxY: 312 });
    // The top wall's body is a trapezoid 12 cm deep, from -12 to 412 on its outer face.
    expect(polygonArea(bodies[0].polygon)).toBeCloseTo(((400 + 424) / 2) * 12);
  });

  it('leaves a real gap where a door is', () => {
    const door = createFeature('door', { type: 'wall', wallId: room.outline[0].id, offset: 200 }, room, { width: 80 });
    const top = wallBodies(room, [door]).filter((b) => b.wallId === room.outline[0].id);
    expect(top).toHaveLength(2);
    const xs = top.map((b) => boundingBox(b.polygon));
    expect(xs[0].maxX).toBeCloseTo(160);
    expect(xs[1].minX).toBeCloseTo(240);
  });

  it('centres interior walls on their line', () => {
    const withPartition = { ...room, partitions: [{ id: 'p', nodes: [{ id: 'a', x: 200, y: 0, thickness: 10 }, { id: 'b', x: 200, y: 300, thickness: 10 }] }] };
    const body = wallBodies(withPartition, []).find((b) => b.wallId === 'a')!;
    expect(boundingBox(body.polygon)).toMatchObject({ minX: 195, maxX: 205 });
  });
});

describe('wallBodies edge cases', () => {
  it('straight-continuing walls of different thickness each end square at their own thickness', () => {
    const room = createRectangularRoom(400, 300);
    const outline = [room.outline[0], { id: 'mid', x: 200, y: 0, thickness: 30 }, ...room.outline.slice(1)];
    const bodies = wallBodies({ ...room, outline }, []);
    const first = boundingBox(bodies.find((b) => b.wallId === room.outline[0].id)!.polygon);
    const second = boundingBox(bodies.find((b) => b.wallId === 'mid')!.polygon);
    expect(first.minY).toBeCloseTo(-12);
    expect(second.minY).toBeCloseTo(-30);
    expect(first.maxX).toBeCloseTo(200);
  });
});
