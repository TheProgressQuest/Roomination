import { describe, expect, it } from 'vitest';
import { DEFAULT_SNAP, snapPoint, type SnapSettings } from './snapping';

const off: SnapSettings = { endpoints: false, walls: false, grid: false, gridSize: 10, alignment: false, angles: false, angleStep: 15 };
const corners = [
  { x: 0, y: 0 },
  { x: 400, y: 0 },
  { x: 400, y: 300 },
];

describe('snapPoint', () => {
  it('returns the raw point when snapping is off', () => {
    expect(snapPoint({ x: 123.4, y: 56.7 }, { corners, segments: [] }, off, 10)).toMatchObject({ point: { x: 123.4, y: 56.7 }, kind: 'none' });
  });

  it('snaps onto an existing corner within tolerance', () => {
    expect(snapPoint({ x: 396, y: 4 }, { corners, segments: [] }, { ...off, endpoints: true }, 10)).toMatchObject({ point: { x: 400, y: 0 }, kind: 'endpoint' });
    expect(snapPoint({ x: 380, y: 20 }, { corners, segments: [] }, { ...off, endpoints: true }, 10).kind).toBe('none');
  });

  it('snaps onto an existing wall', () => {
    const r = snapPoint({ x: 200, y: 6 }, { corners: [], segments: [{ start: corners[0], end: corners[1] }] }, { ...off, walls: true }, 10);
    expect(r).toMatchObject({ point: { x: 200, y: 0 }, kind: 'wall' });
  });

  it('snaps to the grid', () => {
    expect(snapPoint({ x: 123.4, y: 56.7 }, { corners: [], segments: [] }, { ...off, grid: true }, 5).point).toEqual({ x: 120, y: 60 });
  });

  it('aligns horizontally/vertically with other corners and draws a guide', () => {
    const r = snapPoint({ x: 397, y: 150 }, { corners, segments: [] }, { ...off, alignment: true }, 10);
    expect(r.point).toEqual({ x: 400, y: 150 });
    expect(r.kind).toBe('alignment');
    expect(r.guides[0]).toMatchObject({ to: { x: 400, y: 150 } });
  });

  it('snaps the angle from the previous point (90° steps make square corners)', () => {
    const r = snapPoint({ x: 6, y: 205 }, { corners: [], segments: [], previous: { x: 0, y: 0 } }, { ...off, angles: true, angleStep: 90 }, 10);
    expect(r.kind).toBe('angle');
    expect(r.point.x).toBeCloseTo(0);
    expect(r.point.y).toBeCloseTo(Math.hypot(6, 205), 0);
  });

  it('angle snapping also rounds the wall length to the grid', () => {
    const r = snapPoint({ x: 141, y: 143 }, { corners: [], segments: [], previous: { x: 0, y: 0 } }, { ...off, angles: true, angleStep: 45, grid: true, gridSize: 10 }, 10);
    expect(r.kind).toBe('angle');
    expect(Math.hypot(r.point.x, r.point.y)).toBeCloseTo(200);
  });

  it('corners win over everything else', () => {
    const r = snapPoint({ x: 398, y: 3 }, { corners, segments: [{ start: corners[0], end: corners[1] }], previous: { x: 0, y: 300 } }, DEFAULT_SNAP, 10);
    expect(r.kind).toBe('endpoint');
  });
});
