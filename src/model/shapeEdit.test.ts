import { describe, expect, it } from 'vitest';
import { polygonArea } from './polygon';
import { flattenShape, shapeProblem, shapeTemplate } from './shape';
import { cornerAngle, deleteVertex, edgeLength, insertVertex, moveVertex, resizeShape, setCornerAngle, setEdgeLength, shapeSize, toggleCurve } from './shapeEdit';
import type { ShapeVertex } from './types';

const square: ShapeVertex[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];
const area = (points: ShapeVertex[]) => polygonArea(flattenShape({ points }));

describe('editing outlines', () => {
  it('adds a corner in the middle of an edge and removes it again', () => {
    const more = insertVertex(square, 0);
    expect(more).toHaveLength(5);
    expect(more[1]).toEqual({ x: 50, y: 0 });
    expect(deleteVertex(more, 1)).toEqual(square);
    // A shape keeps at least three corners.
    expect(deleteVertex(deleteVertex(more, 1).slice(0, 3), 0)).toHaveLength(3);
  });

  it('splits a curved edge without changing the curve', () => {
    const curved = toggleCurve(square, 0);
    const split = insertVertex(curved, 0, 0.4);
    expect(split).toHaveLength(5);
    expect(area(split)).toBeCloseTo(area(curved), 0);
    expect(shapeProblem({ points: split })).toBeNull();
  });

  it('moves a corner together with the curve handles attached to it', () => {
    const curved = toggleCurve(toggleCurve(square, 0), 3);
    const moved = moveVertex(curved, 0, { x: 10, y: 5 });
    expect(moved[0]).toMatchObject({ x: 10, y: 5, c1: { x: curved[0].c1!.x + 10, y: curved[0].c1!.y + 5 } });
    expect(moved[3].c2).toEqual({ x: curved[3].c2!.x + 10, y: curved[3].c2!.y + 5 });
  });

  it('sets an exact edge length by moving the edge’s end corner', () => {
    const longer = setEdgeLength(square, 0, 150);
    expect(edgeLength(longer, 0)).toBeCloseTo(150, 6);
    expect(longer[1]).toEqual({ x: 150, y: 0 });
    expect(longer[0]).toEqual(square[0]);
  });

  it('measures and sets inside corner angles, including inward notches', () => {
    expect(cornerAngle(square, 1)).toBeCloseTo(90, 6);
    const desk = shapeTemplate('lDesk').points;
    // Corner 4 is the inner corner of the L: 270° inside.
    expect(cornerAngle(desk, 4)).toBeCloseTo(270, 6);
    const angled = setCornerAngle(square, 1, 120);
    // Corners are stored to 0.01 cm, so angles are exact to about a thousandth of a degree.
    expect(cornerAngle(angled, 1)).toBeCloseTo(120, 2);
    expect(edgeLength(angled, 1)).toBeCloseTo(100, 1);
  });

  it('curves an edge outwards and straightens it again', () => {
    const curved = toggleCurve(square, 2);
    expect(area(curved)).toBeGreaterThan(area(square));
    expect(toggleCurve(curved, 2)).toEqual(square);
  });

  it('resizes to exact overall dimensions', () => {
    const resized = resizeShape(shapeTemplate('kidneyTable').points, 140, 70);
    const size = shapeSize(resized);
    expect(size.width).toBeCloseTo(140, 1);
    expect(size.depth).toBeCloseTo(70, 1);
  });
});
