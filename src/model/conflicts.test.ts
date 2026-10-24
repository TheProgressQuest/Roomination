import { describe, expect, it } from 'vitest';
import { conflictKey, describeConflict, findConflicts } from './conflicts';
import { stairPolygons } from './stairs';
import { createEmptyProject, createFeature, createFurniture, createRectangularRoom, createSampleProject, createStaircase } from './sample';
import type { Furniture, Project, RoomFeature } from './types';

const baseRoom = createRectangularRoom(400, 300);
const [topWall, , , leftWall] = baseRoom.outline.map((n) => n.id);

function project(furniture: Furniture[], features: RoomFeature[] = [], acceptedOverlaps: string[] = []): Project {
  return { ...createEmptyProject(baseRoom), furniture, features, acceptedOverlaps };
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
    const door = createFeature('door', { type: 'wall', wallId: topWall, offset: 200 }, room, { width: 80 });
    const chair = createFurniture({ x: 180, y: 40, width: 40, depth: 40 });
    const p = project([chair], [door]);
    expect(describeConflict(findConflicts(p)[0], p)).toMatch(/swing path/);
    const outward = { ...door, swing: 'out' as const, clearance: 20 };
    const farChair = { ...chair, y: 60 }; // beyond the 20 cm walkway
    expect(findConflicts(project([farChair], [outward]))).toEqual([]);
  });

  it('only tall furniture blocks a light switch', () => {
    const sw = createFeature('switch', { type: 'wall', wallId: leftWall, offset: 150 }, room); // 110 cm up
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

describe('stairs and interior walls', () => {
  it('flags furniture blocking a staircase, summing coverage across sections', () => {
    const stair = createStaircase('L', { x: 200, y: 150 });
    // Centre the desk on the first flight (the middle of an L's bounding box is empty floor).
    const [firstFlight] = stairPolygons(stair);
    const centre = { x: firstFlight.reduce((s, p) => s + p.x, 0) / 4, y: firstFlight.reduce((s, p) => s + p.y, 0) / 4 };
    const desk = createFurniture({ name: 'Desk', ...centre, width: 60, depth: 60 });
    const p = { ...project([desk]), stairs: [stair] };
    const [conflict] = findConflicts(p);
    expect(conflict).toMatchObject({ otherKind: 'stairs', type: 'obstruction', otherId: stair.id });
    expect(describeConflict(conflict, p)).toMatch(/Desk blocks Stairs \(about \d+% of the stair footprint\)/);
  });

  it('a stair override is pair-specific like any other', () => {
    const stair = createStaircase('straight', { x: 200, y: 150 });
    const desk = createFurniture({ x: 200, y: 150, width: 60, depth: 60 });
    const key = conflictKey(desk.id, stair.id, 'obstruction');
    const [conflict] = findConflicts({ ...project([desk], [], [key]), stairs: [stair] });
    expect(conflict.accepted).toBe(true);
  });

  it('treats interior walls as solid, except where a door opens', () => {
    const room = { ...baseRoom, partitions: [{ id: 'p1', nodes: [{ id: 'w1', x: 200, y: 0, thickness: 10 }, { id: 'w2', x: 200, y: 300, thickness: 10 }] }] };
    const chair = createFurniture({ name: 'Chair', x: 200, y: 60, width: 40, depth: 40 });
    const base = { ...project([chair]), room };
    expect(findConflicts(base)[0]).toMatchObject({ otherKind: 'wall', type: 'collision' });
    expect(describeConflict(findConflicts(base)[0], base)).toBe('Chair overlaps an interior wall.');
    // A door in the partition at the chair's spot removes that piece of solid wall.
    const door = createFeature('door', { type: 'wall', wallId: 'w1', offset: 60 }, room, { width: 90, swing: 'out', clearance: 0 });
    expect(findConflicts({ ...base, features: [door] })).toEqual([]);
  });
});

describe('checking one moving obstacle', () => {
  it('only reports conflicts with that obstacle', () => {
    const stair = createStaircase('straight', { x: 200, y: 150 });
    const a = createFurniture({ x: 100, y: 150, width: 60, depth: 60 });
    const b = createFurniture({ x: 120, y: 150, width: 60, depth: 60 }); // overlaps a and the stair
    const p = { ...project([a, b]), stairs: [stair] };
    const only = findConflicts(p, undefined, stair.id);
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((c) => c.otherId === stair.id)).toBe(true);
  });
});

describe('chairs tucked under a table or desk', () => {
  // A dining table at sitting height, and an armless chair half under its near edge, facing it.
  const table = createFurniture({ name: 'Table', kind: 'diningTable', x: 200, y: 150, width: 140, depth: 90, height: 75 });
  const chair = (fields: Partial<Furniture> = {}) => createFurniture({ name: 'Chair', kind: 'chair', x: 200, y: 205, width: 45, depth: 50, height: 90, rotation: 180, ...fields });

  it('a chair pushed in, facing the table, is not an overlap', () => {
    expect(findConflicts(project([table, chair()]))).toEqual([]);
    // From any side: the chair at the table's left end, facing right.
    expect(findConflicts(project([table, chair({ x: 140, y: 150, rotation: 270 })]))).toEqual([]);
  });

  it('still an overlap when it isn’t really tucked in', () => {
    const collides = (...pieces: Furniture[]) => findConflicts(project(pieces)).some((c) => c.type === 'collision');
    expect(collides(table, chair({ rotation: 0 }))).toBe(true); // turned away
    expect(collides(table, chair({ y: 170 }))).toBe(true); // entirely underneath
    expect(collides(table, chair({ kind: 'armchair' }))).toBe(true); // arms don't slide under
    expect(collides({ ...table, kind: 'coffeeTable', height: 42 }, chair())).toBe(true); // too low
    expect(collides({ ...table, elevation: 30 }, chair())).toBe(true);
  });

  it('keeps every other check on the chair: doors, walls and other furniture', () => {
    const door = createFeature('door', { type: 'wall', wallId: leftWall, offset: 150 }, room, { width: 90 });
    const nearDoor = { ...table, x: 110 };
    const tucked = chair({ x: 40, y: 150, rotation: 270 });
    const conflicts = findConflicts(project([nearDoor, tucked], [door]));
    expect(conflicts.some((c) => c.otherId === door.id && c.itemId === tucked.id)).toBe(true);
    expect(conflicts.some((c) => c.type === 'collision' && c.otherId === nearDoor.id)).toBe(false);
    const shelf = createFurniture({ name: 'Shelf', kind: 'bookshelf', x: 200, y: 240, width: 80, depth: 35, height: 180 });
    expect(findConflicts(project([table, chair(), shelf])).some((c) => c.type === 'collision' && [c.itemId, c.otherId].includes(shelf.id))).toBe(true);
  });
});
