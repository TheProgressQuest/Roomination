import { describe, expect, it } from 'vitest';
import { boundingBox, overlapArea } from './polygon';
import { createStaircase } from './sample';
import { describeStairShape, layoutStair, stairPolygons, stairPreset, stairProblems, totalSteps } from './stairs';
import type { StairSection } from './types';

let n = 0;
const makeId = () => `s${n++}`;

describe('stair layout', () => {
  it('straight: one flight, footprint = run × width', () => {
    const layout = layoutStair(stairPreset('straight', 90, makeId));
    expect(layout.width).toBeCloseTo(14 * 25);
    expect(layout.depth).toBeCloseTo(90);
    expect(describeStairShape(stairPreset('straight', 90, makeId))).toBe('Straight');
  });

  it('L-shaped: the second flight turns 90° off the landing', () => {
    const sections = stairPreset('L', 90, makeId, 'right');
    const layout = layoutStair(sections);
    const [first, , last] = layout.sections;
    expect(first.heading).toEqual({ x: 1, y: 0 });
    expect(last.heading.x).toBeCloseTo(0);
    expect(last.heading.y).toBeCloseTo(1); // right turn on screen = downwards
    // Footprint: 7×25 + 90 along, 90 + 7×25 across.
    expect(layout.width).toBeCloseTo(175 + 90);
    expect(layout.depth).toBeCloseTo(90 + 175);
    expect(describeStairShape(sections)).toBe('L-shaped');
  });

  it('turning left mirrors the L', () => {
    const last = layoutStair(stairPreset('L', 90, makeId, 'left')).sections[2];
    expect(last.heading.y).toBeCloseTo(-1);
  });

  it('U-shaped: two turning landings bring the stair back alongside itself', () => {
    const sections = stairPreset('U', 90, makeId);
    const layout = layoutStair(sections);
    const first = layout.sections[0];
    const last = layout.sections[3];
    expect(last.heading.x).toBeCloseTo(-1);
    // The two flights sit side by side without overlapping.
    expect(overlapArea(first.corners, last.corners)).toBeCloseTo(0);
    expect(layout.depth).toBeCloseTo(180);
    expect(describeStairShape(sections)).toBe('U-shaped');
    expect(stairProblems({ sections })).toEqual([]);
  });

  it('sections stay connected: each starts where the previous one exits', () => {
    const sections = stairPreset('U', 100, makeId);
    const laid = layoutStair(sections).sections;
    for (let i = 1; i < laid.length; i++) {
      expect(laid[i].entry.x).toBeCloseTo(laid[i - 1].exit.x);
      expect(laid[i].entry.y).toBeCloseTo(laid[i - 1].exit.y);
    }
  });

  it('custom multi-section stairs lay out any sequence', () => {
    const sections: StairSection[] = [
      { id: '1', kind: 'flight', length: 100, width: 80, steps: 4, turn: 'straight' },
      { id: '2', kind: 'landing', length: 80, width: 80, steps: 0, turn: 'left' },
      { id: '3', kind: 'flight', length: 75, width: 80, steps: 3, turn: 'straight' },
      { id: '4', kind: 'landing', length: 80, width: 80, steps: 0, turn: 'left' },
      { id: '5', kind: 'flight', length: 50, width: 80, steps: 2, turn: 'straight' },
    ];
    expect(describeStairShape(sections)).toBe('Custom');
    expect(totalSteps({ sections })).toBe(9);
    expect(layoutStair(sections).sections).toHaveLength(5);
    expect(stairProblems({ sections })).toEqual([]);
  });

  it('reports an impossible spiral that overlaps itself, rather than failing', () => {
    const turnRight = (id: string): StairSection => ({ id, kind: 'landing', length: 90, width: 90, steps: 0, turn: 'right' });
    const flight = (id: string): StairSection => ({ id, kind: 'flight', length: 100, width: 90, steps: 4, turn: 'straight' });
    const spiral = [flight('a'), turnRight('b'), flight('c'), turnRight('d'), flight('e'), turnRight('f'), flight('g'), turnRight('h'), flight('i')];
    expect(stairProblems({ sections: spiral })[0]).toMatch(/overlap/);
  });

  it('places and rotates the footprint around its centre', () => {
    const stair = createStaircase('straight', { x: 200, y: 150 });
    const box = boundingBox(stairPolygons(stair).flat());
    expect((box.minX + box.maxX) / 2).toBeCloseTo(200);
    const turned = boundingBox(stairPolygons({ ...stair, rotation: 90 }).flat());
    expect(turned.maxY - turned.minY).toBeCloseTo(350);
    expect((turned.minY + turned.maxY) / 2).toBeCloseTo(150);
  });
});
