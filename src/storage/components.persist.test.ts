import { describe, expect, it } from 'vitest';
import { buildPreset } from '../builder/furniturePresets';
import { placeComponents } from '../model/components';
import { createFurniture, createSampleProject } from '../model/sample';
import { pieceToRoom } from '../model/shape';
import type { Furniture, FurnitureComponent } from '../model/types';
import { createEditorState, editorReducer } from '../state/editor';
import { parseComponents, parseFurnitureTemplate, parseProjectFile, serializeProject } from './projectFile';

/** Saving, loading and editing component-built furniture. */

const loveseat = (): Furniture => {
  const built = buildPreset('angledLoveseat');
  return createFurniture({ ...built, category: 'furniture', appearance: { material: built.material, finish: 'matte' }, x: 240, y: 200 });
};

/** Where each component is in the room (so tests can check nothing moved). */
const inRoom = (f: Furniture) => placeComponents(f.components ?? []).map((p) => {
  const q = pieceToRoom(f, { x: p.x, y: p.y });
  return { x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10, z: p.z };
});

describe('saving and loading components', () => {
  it('round-trips every component exactly through a project file', () => {
    const project = { ...createSampleProject(), furniture: [loveseat()] };
    const result = parseProjectFile(serializeProject(project));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.furniture[0].components).toEqual(project.furniture[0].components);
  });

  it('keeps components in the furniture library', () => {
    const { id: _i, x: _x, y: _y, rotation: _r, locked: _l, preferences: _p, ...template } = loveseat();
    expect(parseFurnitureTemplate(JSON.parse(JSON.stringify(template)))?.components).toEqual(template.components);
  });

  it('drops damaged components instead of rejecting the project', () => {
    const good: FurnitureComponent = { id: 'a', name: 'Seat', type: 'cushion', shape: 'box', x: 0, y: 0, z: 30, width: 50, depth: 50, height: 12, rotation: 0 };
    const parsed = parseComponents([
      good,
      { ...good, id: 'a' }, // duplicate id
      { ...good, id: 'b', width: -5 },
      { ...good, id: 'c', type: 'rocket' },
      { ...good, id: 'd', x: Number.NaN },
      { ...good, id: 'e', width: 1e9 },
      'nonsense',
      { ...good, id: 'f', parentId: 'missing', color: 'url(javascript:alert(1))', tilt: 400, roughness: 7, pattern: 'leopard', material: 'unobtainium' },
    ]);
    expect(parsed!.map((c) => c.id)).toEqual(['a', 'f']);
    // Unsafe or out-of-range details are dropped; the component itself is kept.
    expect(parsed![1]).toEqual({ ...good, id: 'f' });
  });

  it('bounds the number of components and outline corners', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `c${i}`, name: 'x', type: 'detail', shape: 'polygon', x: 0, y: 0, z: 0, width: 1, depth: 1, height: 1, rotation: 0, outline: Array.from({ length: 50 }, (_, k) => ({ x: Math.cos(k), y: Math.sin(k) })) }));
    const parsed = parseComponents(many)!;
    expect(parsed.length).toBe(120);
    expect(parsed.reduce((n, c) => n + (c.outline?.length ?? 0), 0)).toBeLessThanOrEqual(2000);
  });

  it('loads projects from before components existed unchanged', () => {
    const project = createSampleProject();
    const result = parseProjectFile(serializeProject(project));
    expect(result.ok && result.project.furniture.every((f) => f.components === undefined)).toBe(true);
  });

  it('keeps components in place when a file’s outline has to be re-centred', () => {
    const f = loveseat();
    const before = inRoom(f);
    // An outline saved off-centre (e.g. by another tool): every point moved by +10, +5.
    const shifted = { ...f, shape: { points: f.shape!.points.map((p) => ({ x: p.x + 10, y: p.y + 5 })) }, components: f.components!.map((c) => (c.parentId ? c : { ...c, x: c.x + 10, y: c.y + 5 })) };
    const project = { ...createSampleProject(), furniture: [{ ...shifted, x: f.x - 10, y: f.y - 5 }] };
    const result = parseProjectFile(serializeProject(project));
    if (!result.ok) throw new Error(result.error);
    expect(inRoom(result.project.furniture[0])).toEqual(before);
  });
});

describe('editing component furniture', () => {
  const start = () => {
    const f = loveseat();
    const project = { ...createSampleProject(), furniture: [f] };
    return { f, state: createEditorState(project) };
  };

  it('stretches components with the piece when its size is typed in, as one undo step', () => {
    const { f, state } = start();
    const next = editorReducer(state, { type: 'furniture/update', id: f.id, changes: { width: f.width * 1.25, height: f.height * 0.8 } });
    const g = next.present.furniture[0];
    const seat = (x: Furniture) => x.components!.find((c) => c.name === 'Seat cushion')!;
    expect(seat(g).width).toBeCloseTo(seat(f).width * 1.25, 1);
    expect(seat(g).z).toBeCloseTo(seat(f).z * 0.8, 1);
    const undone = editorReducer(next, { type: 'history/undo' });
    expect(undone.present.furniture[0].components).toEqual(f.components);
  });

  it('applies new components from the builder unchanged (no extra stretching)', () => {
    const { f, state } = start();
    const components = f.components!.map((c) => (c.name === 'Seat cushion' ? { ...c, z: 33 } : c));
    const next = editorReducer(state, { type: 'furniture/update', id: f.id, changes: { components, height: 70 } });
    expect(next.present.furniture[0].components).toEqual(components);
  });

  it('collisions still use the footprint, not the components', () => {
    const { f, state } = start();
    // A component pushed far outside the footprint doesn't make the piece collide with the wall.
    const components = [...f.components!, { id: 'far', name: 'Far', type: 'detail', shape: 'box', x: 300, y: 0, z: 0, width: 10, depth: 10, height: 10, rotation: 0 } as FurnitureComponent];
    const next = editorReducer(state, { type: 'furniture/update', id: f.id, changes: { components } });
    expect(next.present.furniture[0]).toMatchObject({ x: f.x, y: f.y, width: f.width, depth: f.depth });
  });
});
