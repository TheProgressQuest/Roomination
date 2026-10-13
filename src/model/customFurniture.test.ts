import { describe, expect, it } from 'vitest';
import { optimize } from '../optimizer/optimize';
import { customShapes, movableIds } from '../optimizer/testRooms';
import { withPoses } from '../optimizer/search';
import { createEditorState, editorReducer } from '../state/editor';
import { parseProject, parseProjectFile, serializeProject } from '../storage/projectFile';
import { findConflicts, furniturePolygon } from './conflicts';
import { DEFAULT_OPTIMIZER } from './furnitureKinds';
import { boundingBox, polygonArea } from './polygon';
import { createEmptyProject, createFurniture, createRectangularRoom, createSampleProject } from './sample';
import { flattenShape, footprintInside, normaliseShape, roomFootprint, shapeTemplate } from './shape';
import type { Furniture, Project } from './types';
import { outlinePolygon } from './walls';

const lDesk = (fields: Partial<Furniture> = {}) => {
  const { shape, width, depth } = normaliseShape(shapeTemplate('lDesk'));
  return createFurniture({ name: 'L-desk', kind: 'desk', x: 200, y: 200, width, depth, height: 75, shape, ...fields });
};

describe('custom furniture in the editor', () => {
  it('adds a drawn piece, keeping its true outline and size', () => {
    const desk = lDesk();
    const state = editorReducer(createEditorState(createEmptyProject(createRectangularRoom(500, 400))), { type: 'furniture/add', furniture: desk });
    const added = state.present.furniture[0];
    expect(added.shape).toBeDefined();
    expect([added.width, added.depth]).toEqual([160, 140]);
    expect(polygonArea(furniturePolygon(added))).toBeCloseTo(160 * 60 + 60 * 80, 6);
  });

  it('refuses an outline that crosses itself, with a reason', () => {
    const bowtie = { points: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }] };
    const state = editorReducer(createEditorState(createEmptyProject()), { type: 'furniture/add', furniture: createFurniture({ x: 100, y: 100, shape: bowtie }) });
    expect(state.present.furniture).toHaveLength(0);
    expect(state.notice?.message).toMatch(/crosses itself/);
  });

  it('stretches the outline when width or depth is typed, updating the footprint', () => {
    let state = editorReducer(createEditorState(createEmptyProject(createRectangularRoom(500, 400))), { type: 'furniture/add', furniture: lDesk() });
    const id = state.present.furniture[0].id;
    state = editorReducer(state, { type: 'furniture/update', id, changes: { width: 200 } });
    const piece = state.present.furniture[0];
    expect(piece.width).toBe(200);
    const box = boundingBox(flattenShape(piece.shape!));
    expect(box.maxX - box.minX).toBeCloseTo(200, 6);
    // Undo restores the original outline in one step.
    state = editorReducer(state, { type: 'history/undo' });
    expect(state.present.furniture[0].width).toBe(160);
  });

  it('replacing the outline keeps the piece where it was on the plan', () => {
    let state = editorReducer(createEditorState(createEmptyProject(createRectangularRoom(500, 400))), { type: 'furniture/add', furniture: lDesk({ x: 250, y: 200 }) });
    const id = state.present.furniture[0].id;
    // An off-centre outline (all corners positive) is re-centred, and the piece moves to compensate.
    const shape = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }] };
    state = editorReducer(state, { type: 'furniture/update', id, changes: { shape } });
    const piece = state.present.furniture[0];
    expect([piece.width, piece.depth]).toEqual([100, 60]);
    expect(boundingBox(furniturePolygon(piece))).toEqual({ minX: 250, minY: 200, maxX: 350, maxY: 260 });
  });
});

describe('collisions with the true footprint', () => {
  it('a chair tucked into an L-desk’s notch does not collide; one on the desk does', () => {
    const desk = lDesk();
    // The L-desk's notch is its front-left: local x −80…20, y −10…70 (front is +y).
    const tucked = createFurniture({ name: 'Chair', x: 200 - 30, y: 200 + 30, width: 50, depth: 50 });
    const onDesk = createFurniture({ name: 'Box', x: 200 + 50, y: 200 + 30, width: 30, depth: 30 });
    const project: Project = { ...createEmptyProject(createRectangularRoom(500, 400)), furniture: [desk, tucked] };
    expect(findConflicts(project)).toEqual([]);
    expect(findConflicts({ ...project, furniture: [desk, onDesk] })).toHaveLength(1);
    // Rotating the desk turns the notch with it.
    const turned = { ...desk, rotation: 180 };
    expect(findConflicts({ ...project, furniture: [turned, tucked] })).toHaveLength(1);
  });

  it('keeps a piece’s clearance space free and explains it', () => {
    const sofa = createFurniture({ name: 'Sofa', x: 200, y: 100, width: 200, depth: 90, clearance: 60 });
    const table = createFurniture({ name: 'Table', x: 200, y: 170, width: 60, depth: 40 });
    const project: Project = { ...createEmptyProject(createRectangularRoom(500, 400)), furniture: [sofa, table] };
    const conflicts = findConflicts(project);
    expect(conflicts).toMatchObject([{ itemId: table.id, otherId: sofa.id, type: 'clearance' }]);
    expect(findConflicts({ ...project, furniture: [{ ...sofa, clearance: undefined }, table] })).toEqual([]);
  });

  it('reports two facing pieces’ clearances separately, so accepting one doesn’t accept the other', () => {
    const a = createFurniture({ name: 'Chair A', x: 200, y: 100, width: 60, depth: 60, clearance: 60 });
    const b = createFurniture({ name: 'Chair B', x: 200, y: 180, width: 60, depth: 60, rotation: 180, clearance: 60 });
    const conflicts = findConflicts({ ...createEmptyProject(createRectangularRoom(500, 400)), furniture: [a, b] });
    expect(conflicts).toHaveLength(2);
    expect(new Set(conflicts.map((c) => c.key)).size).toBe(2);
  });

  it('keeps custom pieces inside irregular rooms by their real outline', () => {
    const project = customShapes();
    for (const item of project.furniture) expect(footprintInside(roomFootprint(item).parts, outlinePolygon(project.room))).toBe(true);
  });
});

describe('saving custom furniture', () => {
  it('round-trips outlines, curves, clearance and appearance exactly', () => {
    const { shape, width, depth } = normaliseShape(shapeTemplate('kidneyTable'));
    const table = createFurniture({ name: 'Kidney', x: 200, y: 150, rotation: 30, width, depth, shape, clearance: 40, appearance: { material: 'wood', finish: 'satin', textures: { top: 'a'.repeat(64) } } });
    const project = { ...createSampleProject(), furniture: [table] };
    const parsed = parseProjectFile(serializeProject(project));
    if (!parsed.ok) throw new Error(parsed.error);
    const back = parsed.project.furniture[0];
    expect(back.shape).toEqual(table.shape);
    expect(back).toMatchObject({ x: 200, y: 150, rotation: 30, width, depth, clearance: 40, appearance: table.appearance });
  });

  it('rejects files with broken outlines, and drops unknown photo references', () => {
    const project = createSampleProject();
    const bad = { ...project, furniture: [{ ...project.furniture[0], shape: { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }] } }] };
    expect(parseProject(bad)).toMatchObject({ ok: false, error: expect.stringMatching(/crosses itself/) });
    const odd = { ...project, furniture: [{ ...project.furniture[0], appearance: { material: 'wood', textures: { top: '../../etc/passwd' }, photos: ['javascript:alert(1)'] } }] };
    const result = parseProject(odd);
    expect(result.ok && result.project.furniture[0].appearance).toEqual({ material: 'wood', finish: 'matte' });
  });

  it('opens version 5 projects unchanged (no shapes, rectangles as before)', () => {
    const v5 = { ...createSampleProject(), schemaVersion: 5 };
    const result = parseProject(v5);
    if (!result.ok) throw new Error(result.error);
    expect(result.project.furniture.map(({ x, y, width, depth }) => ({ x, y, width, depth }))).toEqual(v5.furniture.map(({ x, y, width, depth }) => ({ x, y, width, depth })));
    expect(result.project.furniture.every((f) => f.shape === undefined)).toBe(true);
  });
});

describe('optimizer with custom footprints', () => {
  it('finds layouts where no custom piece overlaps anything or leaves the room', () => {
    const project = customShapes();
    const result = optimize({ project, settings: { ...DEFAULT_OPTIMIZER, effort: 'quick', seed: 3 }, movableIds: movableIds(project) });
    expect(result.suggestions.length).toBeGreaterThan(0);
    for (const suggestion of result.suggestions) {
      const arranged = withPoses(project, new Map(suggestion.positions.map((p) => [p.id, p])));
      const hard = findConflicts(arranged).filter((c) => c.type === 'collision');
      expect(hard).toEqual([]);
      for (const item of arranged.furniture) expect(footprintInside(roomFootprint(item).parts, outlinePolygon(arranged.room))).toBe(true);
    }
  });
});
