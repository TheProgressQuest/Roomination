import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../catalogue/items';
import { createEditorState, editorReducer } from '../state/editor';
import { parseProjectFile, serializeProject } from '../storage/projectFile';
import { findConflicts } from './conflicts';
import { carryResting, preferredSurface, restingOn, surfacesOf } from './resting';
import { createEmptyProject, createFurniture, createRectangularRoom } from './sample';
import type { Furniture, Project } from './types';

const room = createRectangularRoom(400, 300);
const project = (furniture: Furniture[]): Project => ({ ...createEmptyProject(room), furniture });
const fromCatalogue = (id: string, fields: Partial<Furniture> & Pick<Furniture, 'x' | 'y'>) => createFurniture({ ...CATALOGUE.find((i) => i.id === id)!.make(), ...fields });

describe('surfaces', () => {
  it('a plain piece offers its own top', () => {
    const table = createFurniture({ x: 100, y: 100, width: 120, depth: 60, height: 75 });
    expect(surfacesOf(table)).toEqual([expect.objectContaining({ name: 'Top', height: 75 })]);
  });

  it('a vanity offers its worktop, and new things land there', () => {
    const vanity = fromCatalogue('vanity-drop-in', { x: 200, y: 50 });
    const top = preferredSurface(vanity);
    expect(top.name).toMatch(/worktop/i);
    // The worktop, not the tap that rises above it.
    expect(top.height).toBe(81);
    expect(vanity.height).toBeGreaterThan(81);
  });

  it('a two-tier organiser offers both shelves, highest first', () => {
    const rack = fromCatalogue('organiser-2', { x: 100, y: 100, elevation: 85 });
    const shelves = surfacesOf(rack).filter((s) => s.name.startsWith('Shelf'));
    expect(shelves).toHaveLength(2);
    expect(shelves[0].height).toBeGreaterThan(shelves[1].height);
    expect(shelves[1].height).toBeGreaterThan(85);
  });
});

describe('carryResting', () => {
  const vanity = createFurniture({ id: 'vanity', x: 200, y: 50, width: 100, depth: 50, height: 85 });
  const tray = createFurniture({ id: 'tray', x: 210, y: 50, width: 30, depth: 18, height: 3, elevation: 85, restsOn: 'vanity' });
  const bottle = createFurniture({ id: 'bottle', x: 215, y: 52, width: 7, depth: 7, height: 19, elevation: 86, restsOn: 'tray' });
  const before = project([vanity, tray, bottle]);
  const edit = (changes: Partial<Furniture>) => carryResting(before, { ...before, furniture: before.furniture.map((f) => (f.id === 'vanity' ? { ...f, ...changes } : f)) });
  const get = (p: Project, id: string) => p.furniture.find((f) => f.id === id)!;

  it('moves everything on a piece with it, including things on things', () => {
    const { project: after } = edit({ x: 250, y: 80 });
    expect(get(after, 'tray')).toMatchObject({ x: 260, y: 80, elevation: 85 });
    expect(get(after, 'bottle')).toMatchObject({ x: 265, y: 82, elevation: 86 });
  });

  it('turns things around the piece’s centre', () => {
    const { project: after } = edit({ rotation: 90 });
    // 10 cm to the right of the centre becomes 10 cm below it (plan y grows downwards).
    expect(get(after, 'tray')).toMatchObject({ x: 200, y: 60, rotation: 90 });
    expect(get(after, 'bottle')).toMatchObject({ x: 198, y: 65, rotation: 90 });
  });

  it('rises with a taller worktop', () => {
    const { project: after } = edit({ height: 90 });
    expect(get(after, 'tray').elevation).toBe(90);
    expect(get(after, 'bottle').elevation).toBe(91);
  });

  it('moving a tray on its own leaves the vanity, and carries what is in the tray', () => {
    const moved = { ...before, furniture: before.furniture.map((f) => (f.id === 'tray' ? { ...f, x: 230 } : f)) };
    const { project: after } = carryResting(before, moved);
    expect(get(after, 'vanity').x).toBe(200);
    expect(get(after, 'tray').x).toBe(230);
    expect(get(after, 'bottle').x).toBe(235);
  });

  it('removes what rested on a deleted piece', () => {
    const { project: after, removed } = carryResting(before, { ...before, furniture: before.furniture.filter((f) => f.id !== 'vanity') });
    expect(after.furniture).toEqual([]);
    expect(removed).toBe(2);
    expect(restingOn(before.furniture, 'vanity')).toEqual(['tray', 'bottle']);
  });

  it('in the editor, deleting a vanity takes its things with it and undo brings them back', () => {
    let state = createEditorState(before);
    state = editorReducer(state, { type: 'furniture/delete', id: 'vanity' });
    expect(state.present.furniture).toEqual([]);
    expect(state.notice?.message).toMatch(/Also removed 2/);
    state = editorReducer(state, { type: 'history/undo' });
    expect(state.present.furniture.map((f) => f.id)).toEqual(['vanity', 'tray', 'bottle']);
  });

  it('resting items are not counted as overlapping their support', () => {
    expect(findConflicts(before)).toEqual([]);
  });
});

describe('saving', () => {
  it('keeps restsOn and drops broken or circular links', () => {
    const a = createFurniture({ id: 'a', x: 100, y: 100, restsOn: 'b' });
    const b = createFurniture({ id: 'b', x: 100, y: 100, restsOn: 'a' });
    const c = createFurniture({ id: 'c', x: 100, y: 100, restsOn: 'missing' });
    const shelf = createFurniture({ id: 'shelf', x: 300, y: 100 });
    const d = createFurniture({ id: 'd', x: 300, y: 100, elevation: 80, restsOn: 'shelf' });
    const result = parseProjectFile((serializeProject(project([a, b, c, shelf, d]))));
    if (!result.ok) throw new Error(result.error);
    const byId = new Map(result.project.furniture.map((f) => [f.id, f]));
    expect(byId.get('d')!.restsOn).toBe('shelf');
    // A loop is broken (one of the pair goes back to the floor); the other may stay on it.
    expect([byId.get('a')!.restsOn, byId.get('b')!.restsOn].filter(Boolean)).toHaveLength(1);
    expect(byId.get('c')!.restsOn).toBeUndefined();
  });
});
