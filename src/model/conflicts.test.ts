import { describe, expect, it } from 'vitest';
import { conflictKey, describeConflict, findConflicts } from './conflicts';
import { createEmptyProject, createFeature, createFurniture, createSampleProject, DEFAULT_FLOOR } from './sample';
import type { Furniture, Project, RoomFeature } from './types';

function project(furniture: Furniture[], features: RoomFeature[] = [], acceptedOverlaps: string[] = []): Project {
  return { ...createEmptyProject({ width: 400, length: 300, height: 250, floor: DEFAULT_FLOOR }), furniture, features, acceptedOverlaps };
}

const room = { height: 250 };

describe('findConflicts', () => {
  it('the sample room starts without conflicts', () => {
    expect(findConflicts(createSampleProject())).toEqual([]);
  });

  it('flags overlapping furniture once per pair', () => {
    const desk = createFurniture({ name: 'Desk', x: 100, y: 100, width: 120, depth: 60 });
    const shelf = createFurniture({ name: 'Bookshelf', x: 180, y: 100, width: 80, depth: 35 });
    const conflicts = findConflicts(project([desk, shelf]));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].type).toBe('collision');
    expect(describeConflict(conflicts[0], project([desk, shelf]))).toBe('Desk overlaps Bookshelf.');
  });

  it('ignores furniture that only touches', () => {
    const a = createFurniture({ x: 100, y: 100, width: 100, depth: 100 });
    const b = createFurniture({ x: 200, y: 100, width: 100, depth: 100 });
    expect(findConflicts(project([a, b]))).toEqual([]);
  });

  it('uses true rotated shapes, not bounding boxes', () => {
    // A 45°-rotated square's bounding box would overlap the other square; the square itself doesn't.
    const diamond = createFurniture({ x: 100, y: 100, width: 100, depth: 100, rotation: 45 });
    const square = createFurniture({ x: 185, y: 185, width: 40, depth: 40 });
    expect(findConflicts(project([diamond, square]))).toEqual([]);
  });

  it('rugs overlap freely', () => {
    const rug = createFurniture({ category: 'floorCovering', x: 200, y: 150, width: 200, depth: 140 });
    const table = createFurniture({ x: 200, y: 150, width: 100, depth: 60 });
    expect(findConflicts(project([rug, table]))).toEqual([]);
  });

  it('reports how much of a floor vent is covered', () => {
    // Vent 30×12 spans x 285..315. The sofa's right edge is at 291, covering 6 of 30 cm → 20%.
    const vent = createFeature('vent', { type: 'free', x: 300, y: 100, rotation: 0 }, room, { name: 'Floor vent', clearance: 0 });
    const sofa = createFurniture({ name: 'Sofa', x: 191, y: 100, width: 200, depth: 90 });
    const p = project([sofa], [vent]);
    const [conflict] = findConflicts(p);
    expect(conflict.type).toBe('obstruction');
    expect(conflict.coverage).toBeCloseTo(0.2);
    expect(describeConflict(conflict, p)).toBe('Sofa covers about 20% of Floor vent.');
  });

  it('warns about a vent clearance zone separately from covering it', () => {
    const vent = createFeature('vent', { type: 'free', x: 100, y: 100, rotation: 0 }, room, { clearance: 30 });
    const chair = createFurniture({ x: 100, y: 140, width: 50, depth: 30 }); // 125..155: clearance, not grille
    const [conflict] = findConflicts(project([chair], [vent]));
    expect(conflict.type).toBe('clearance');
  });

  it('flags furniture in a door swing, but not behind an outward door', () => {
    const door = createFeature('door', { type: 'wall', wall: 'top', offset: 200 }, room, { width: 80 });
    const chair = createFurniture({ x: 180, y: 40, width: 40, depth: 40 });
    const p = project([chair], [door]);
    expect(describeConflict(findConflicts(p)[0], p)).toMatch(/swing path/);
    const outward = { ...door, swing: 'out' as const, clearance: 20 };
    const farChair = { ...chair, y: 60 }; // beyond the 20 cm walkway
    expect(findConflicts(project([farChair], [outward]))).toEqual([]);
  });

  it('only tall furniture blocks a light switch', () => {
    const sw = createFeature('switch', { type: 'wall', wall: 'left', offset: 150 }, room); // 110 cm up
    const desk = createFurniture({ x: 40, y: 150, width: 60, depth: 80, height: 75 });
    const wardrobe = { ...desk, height: 200 };
    expect(findConflicts(project([desk], [sw]))).toEqual([]);
    expect(findConflicts(project([wardrobe], [sw]))[0].type).toBe('clearance');
  });

  it('marks accepted overlaps, per pair only', () => {
    const a = createFurniture({ x: 100, y: 100, width: 100, depth: 100 });
    const b = createFurniture({ x: 150, y: 100, width: 100, depth: 100 });
    const c = createFurniture({ x: 120, y: 150, width: 50, depth: 50 });
    const key = conflictKey(a.id, b.id, 'collision');
    const conflicts = findConflicts(project([a, b, c], [], [key]));
    expect(conflicts.find((x) => x.key === key)?.accepted).toBe(true);
    // Other pairs involving the same pieces are still unaccepted.
    expect(conflicts.filter((x) => x.key !== key).every((x) => !x.accepted)).toBe(true);
  });

  it('can check just one piece (used while dragging)', () => {
    const a = createFurniture({ x: 100, y: 100, width: 100, depth: 100 });
    const b = createFurniture({ x: 150, y: 100, width: 100, depth: 100 });
    const c = createFurniture({ x: 300, y: 250, width: 50, depth: 50 });
    expect(findConflicts(project([a, b, c]), c.id)).toEqual([]);
    expect(findConflicts(project([a, b, c]), a.id)).toHaveLength(1);
  });
});

describe('describeConflict', () => {
  it('names the moved piece first when given a perspective', () => {
    const table = createFurniture({ name: 'Coffee table', x: 100, y: 100, width: 100, depth: 60 });
    const chair = createFurniture({ name: 'Armchair', x: 140, y: 100, width: 80, depth: 80 });
    const p = project([table, chair]);
    const [conflict] = findConflicts(p);
    expect(describeConflict(conflict, p, chair.id)).toBe('Armchair overlaps Coffee table.');
    expect(describeConflict(conflict, p, table.id)).toBe('Coffee table overlaps Armchair.');
  });
});
