import { describe, expect, it } from 'vitest';
import { polygonArea } from '../model/polygon';
import { faceShapes, type UV } from './wallFaces';

const area = (points: UV[]) => polygonArea(points.map(([x, y]) => ({ x, y })));
/** Solid area of a face: outline minus holes. */
const solid = (shapes: ReturnType<typeof faceShapes>) => shapes.reduce((sum, s) => sum + area(s.contour) - s.holes.reduce((h, hole) => h + area(hole), 0), 0);

describe('wall faces', () => {
  it('is one rectangle with no openings', () => {
    const shapes = faceShapes(0, 400, 250, []);
    expect(shapes).toHaveLength(1);
    expect(solid(shapes)).toBe(400 * 250);
  });

  it('cuts a window as a hole and a door as a notch', () => {
    const shapes = faceShapes(0, 400, 250, [
      { start: 50, end: 130, bottom: 0, top: 205 },
      { start: 200, end: 320, bottom: 90, top: 210 },
    ]);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].holes).toHaveLength(1);
    expect(solid(shapes)).toBe(400 * 250 - 80 * 205 - 120 * 120);
  });

  it('splits the face around a floor-to-ceiling opening', () => {
    const shapes = faceShapes(0, 400, 250, [{ start: 100, end: 200, bottom: 0, top: 250 }]);
    expect(shapes).toHaveLength(2);
    expect(solid(shapes)).toBe(300 * 250);
  });

  it('handles openings flush with the wall end and side by side', () => {
    const shapes = faceShapes(0, 300, 250, [
      { start: 0, end: 80, bottom: 0, top: 205 },
      { start: 80, end: 160, bottom: 0, top: 205 },
      { start: 200, end: 300, bottom: 150, top: 250 },
    ]);
    expect(solid(shapes)).toBe(300 * 250 - 160 * 205 - 100 * 100);
    for (const shape of shapes) {
      // No repeated corners (the triangulator can't handle them).
      shape.contour.forEach((p, i) => expect(p).not.toEqual(shape.contour[(i + 1) % shape.contour.length]));
    }
  });
});
