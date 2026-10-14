import { describe, expect, it } from 'vitest';
import { componentParts } from '../render/furnitureParts';
import {
  componentExtent,
  duplicateComponent,
  groupComponents,
  placeComponents,
  removeComponent,
  reorderComponent,
  scaleComponents,
  shiftComponents,
  ungroupComponents,
  withDescendants,
} from './components';
import type { FurnitureComponent } from './types';

const box = (id: string, extra: Partial<FurnitureComponent> = {}): FurnitureComponent => ({
  id,
  name: id,
  type: 'custom',
  shape: 'box',
  x: 0,
  y: 0,
  z: 0,
  width: 10,
  depth: 10,
  height: 10,
  rotation: 0,
  ...extra,
});

describe('placeComponents (nested transforms)', () => {
  it('places a child relative to its parent’s centre, turn and bottom', () => {
    const parent = box('p', { x: 50, y: 20, z: 30, rotation: 90 });
    const child = box('c', { parentId: 'p', x: 10, y: 0, z: 5, rotation: 15 });
    const [p, c] = placeComponents([parent, child]);
    expect(p).toMatchObject({ x: 50, y: 20, z: 30, yaw: 90 });
    // Turned 90° clockwise on screen, the child's +x points down the plan (+y).
    expect(c.x).toBeCloseTo(50);
    expect(c.y).toBeCloseTo(30);
    expect(c.z).toBe(35);
    expect(c.yaw).toBe(105);
  });

  it('nests several levels, and survives a missing parent or a loop', () => {
    const a = box('a', { x: 10 });
    const b = box('b', { parentId: 'a', x: 10 });
    const c = box('c', { parentId: 'b', x: 10 });
    const orphan = box('o', { parentId: 'gone', x: 7 });
    const loop1 = box('l1', { parentId: 'l2', x: 1 });
    const loop2 = box('l2', { parentId: 'l1', x: 1 });
    const placed = placeComponents([a, b, c, orphan, loop1, loop2]);
    expect(placed.map((p) => p.x)).toEqual([10, 20, 30, 7, expect.any(Number), expect.any(Number)]);
  });

  it('skips groups (no geometry) and anything hidden, including inside a hidden group', () => {
    const group = box('g', { type: 'group', hidden: true });
    const inside = box('i', { parentId: 'g' });
    const shown = box('s');
    const hidden = box('h', { hidden: true });
    expect(placeComponents([group, inside, shown, hidden]).map((p) => p.component.id)).toEqual(['s']);
  });
});

describe('componentExtent', () => {
  const piece = { width: 100, depth: 60 };

  it('reports the tallest point, including a backrest leaning back', () => {
    const back = box('b', { y: -25, z: 40, height: 40, depth: 10, tilt: 10 });
    const ext = componentExtent({ ...piece, components: [back] });
    // Tilting raises the front-top corner slightly above 80 cm.
    expect(ext.top).toBeGreaterThan(80);
    expect(ext.top).toBeLessThan(82);
  });

  it('flags components that reach outside the footprint or below the floor, with how far', () => {
    const inside = box('in', { width: 90, depth: 50 });
    const wide = box('wide', { x: 50 });
    const sunk = box('sunk', { z: -3 });
    const ext = componentExtent({ ...piece, components: [inside, wide, sunk] });
    expect(ext.overflow).toEqual([
      { id: 'wide', name: 'wide', outside: 5, below: 0 },
      { id: 'sunk', name: 'sunk', outside: 0, below: 3 },
    ]);
  });

  it('uses a drawn footprint, not just its bounding box', () => {
    const triangle = { width: 100, depth: 100, shape: { points: [{ x: -50, y: -50 }, { x: 50, y: 50 }, { x: -50, y: 50 }] } };
    const inCorner = box('corner', { x: 40, y: -40 });
    expect(componentExtent({ ...triangle, components: [inCorner] }).overflow[0].id).toBe('corner');
  });
});

describe('editing helpers', () => {
  const list = [box('a'), box('b', { parentId: 'a' }), box('c', { parentId: 'b' }), box('d'), box('seat', { shape: 'footprint', cut: ['b', 'd'] })];

  it('finds a component with everything inside it', () => {
    expect(withDescendants(list, 'a').map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('removes a component with its children, and drops them from cut lists', () => {
    const out = removeComponent(list, 'a');
    expect(out.map((c) => c.id)).toEqual(['d', 'seat']);
    expect(out[1].cut).toEqual(['d']);
  });

  it('duplicates a component with its children, under new ids, offset and unlocked', () => {
    const { components, copyId } = duplicateComponent([...list.slice(0, 3).map((c) => ({ ...c, locked: true })), list[3]], 'a');
    expect(components).toHaveLength(7);
    const copy = components.find((c) => c.id === copyId)!;
    expect(copy).toMatchObject({ x: 10, y: 10, name: 'a copy', locked: false });
    const copies = components.slice(3, 6);
    expect(copies[1].parentId).toBe(copyId);
    expect(copies[2].parentId).toBe(copies[1].id);
    expect(new Set(components.map((c) => c.id)).size).toBe(7);
  });

  it('turns a copied edge band into a fixed outline', () => {
    const band = box('band', { shape: 'edge', edges: { from: 0, to: 0, startTrim: 0, endTrim: 0, inset: 0, thickness: 5, miterStart: false, miterEnd: false }, outline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] });
    const { components, copyId } = duplicateComponent([band], 'band');
    const copy = components.find((c) => c.id === copyId)!;
    expect(copy.shape).toBe('polygon');
    expect(copy.edges).toBeUndefined();
  });

  it('reorders within bounds', () => {
    expect(reorderComponent(list, 'd', -1).map((c) => c.id)).toEqual(['a', 'b', 'd', 'c', 'seat']);
    expect(reorderComponent(list, 'a', -1).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'seat']);
  });

  it('groups components without moving them, and ungroups them back', () => {
    const parts = [box('l', { x: -30, y: 5, z: 2 }), box('r', { x: 30, y: 5 })];
    const { components, groupId } = groupComponents(parts, ['l', 'r'], 'Legs');
    const before = placeComponents(parts).map((p) => [p.x, p.y, p.z]);
    expect(placeComponents(components).map((p) => [p.x, p.y, p.z])).toEqual(before);
    // Moving the group moves its members.
    const moved = components.map((c) => (c.id === groupId ? { ...c, x: c.x + 20 } : c));
    expect(placeComponents(moved).map((p) => p.x)).toEqual([-10, 50]);
    // Turning the group and ungrouping keeps every member where it was.
    const turned = components.map((c) => (c.id === groupId ? { ...c, rotation: 90, z: 4 } : c));
    const placedTurned = placeComponents(turned).map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, z: p.z }));
    const flat = ungroupComponents(turned, groupId!);
    expect(flat.some((c) => c.type === 'group')).toBe(false);
    expect(placeComponents(flat).map((p) => ({ x: p.x, y: p.y, z: p.z }))).toEqual(placedTurned);
  });

  it('shifts top-level components only (children move with them)', () => {
    const out = shiftComponents(list, 5, -2);
    expect(out[0]).toMatchObject({ x: 5, y: -2 });
    expect(out[1]).toMatchObject({ x: 0, y: 0 });
  });

  it('scales positions, sizes and outlines with the piece', () => {
    const c = box('a', { x: 10, y: 10, z: 10, width: 20, depth: 10, height: 30, outline: [{ x: -10, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 5 }] });
    const [out] = scaleComponents([c], 2, 1, 0.5);
    expect(out).toMatchObject({ x: 20, y: 10, z: 5, width: 40, depth: 10, height: 15 });
    expect(out.outline).toEqual([{ x: -20, y: -5 }, { x: 20, y: -5 }, { x: 20, y: 5 }]);
  });
});

describe('componentParts', () => {
  it('turns components into shared render parts with their look', () => {
    const parts = componentParts([
      box('base', { type: 'base', radius: 3 }),
      box('leg', { type: 'leg', shape: 'cylinder', taper: 0.7 }),
      box('pillow', { type: 'pillow', shape: 'ellipsoid', material: 'velvet', color: '#a3b094', pattern: 'stripes', seams: 'piped' }),
      box('seat', { type: 'cushion', shape: 'footprint', outline: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 0, y: 5 }], radius: 2, seams: 'stitched' }),
      box('bevel', { type: 'tabletop', edgeStyle: 'bevel', radius: 1 }),
      box('noOutline', { shape: 'polygon' }),
      box('group', { type: 'group' }),
    ]);
    expect(parts.map((p) => p.shape)).toEqual(['rounded', 'cone', 'ellipsoid', 'prism', 'prism', 'rounded']);
    expect(parts[0]).toMatchObject({ role: 'frame', surface: 'body', radius: 3 });
    expect(parts[2]).toMatchObject({ role: 'pillow', surface: 'velvet', color: '#a3b094', pattern: 'stripes', seams: 'piped' });
    expect(parts[3]).toMatchObject({ role: 'cushion', width: 10, depth: 10, radius: 2, seams: 'stitched' });
    expect(parts[4]).toMatchObject({ bevel: 'chamfer', role: 'top' });
  });

  it('never rounds more than a component can take', () => {
    const [part] = componentParts([box('a', { radius: 50, height: 4 })]);
    expect(part.radius).toBe(2);
  });
});
