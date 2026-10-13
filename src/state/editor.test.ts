import { describe, expect, it } from 'vitest';
import { furnitureBounds } from '../model/geometry';
import { createEmptyProject, createFurniture } from '../model/sample';
import type { Project } from '../model/types';
import { canRedo, canUndo, createEditorState, editorReducer, type EditorAction, type EditorState } from './editor';

function setup(): { state: EditorState; id: string } {
  const project: Project = createEmptyProject({ width: 400, length: 300, height: 250 });
  const table = createFurniture({ name: 'Table', x: 200, y: 150, width: 120, depth: 80 });
  const state = editorReducer(createEditorState(project), { type: 'furniture/add', furniture: table });
  return { state, id: table.id };
}

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

function expectInsideRoom(project: Project) {
  for (const item of project.furniture) {
    const b = furnitureBounds(item);
    expect(b.minX).toBeGreaterThanOrEqual(-1e-6);
    expect(b.minY).toBeGreaterThanOrEqual(-1e-6);
    expect(b.maxX).toBeLessThanOrEqual(project.room.width + 1e-6);
    expect(b.maxY).toBeLessThanOrEqual(project.room.length + 1e-6);
  }
}

describe('editorReducer', () => {
  it('clamps moves so furniture stays inside the room', () => {
    const { state, id } = setup();
    const next = run(state, { type: 'furniture/update', id, changes: { x: 1000, y: -1000 } });
    const table = next.present.furniture[0];
    expect(table.x).toBe(340);
    expect(table.y).toBe(40);
    expectInsideRoom(next.present);
  });

  it('keeps the piece inside after rotating near a wall', () => {
    const { state, id } = setup();
    // Against the right wall, then rotate: the footprint changes, so the centre must move.
    const next = run(
      state,
      { type: 'furniture/update', id, changes: { x: 1000 } },
      { type: 'furniture/update', id, changes: { rotation: 45 } },
    );
    expect(next.present.furniture[0].rotation).toBe(45);
    expectInsideRoom(next.present);
  });

  it('keeps the piece inside after growing near a wall', () => {
    const { state, id } = setup();
    const next = run(
      state,
      { type: 'furniture/update', id, changes: { x: 1000 } },
      { type: 'furniture/update', id, changes: { width: 300 } },
    );
    expect(next.present.furniture[0].width).toBe(300);
    expectInsideRoom(next.present);
  });

  it('normalises rotation', () => {
    const { state, id } = setup();
    const next = run(state, { type: 'furniture/update', id, changes: { rotation: -90 } });
    expect(next.present.furniture[0].rotation).toBe(270);
  });

  it('rejects changes that cannot fit, with an explanation, and keeps history clean', () => {
    const { state, id } = setup();
    const next = run(state, { type: 'furniture/update', id, changes: { width: 500 } });
    expect(next.present).toBe(state.present);
    expect(next.past).toBe(state.past);
    expect(next.notice?.message).toMatch(/wouldn't fit/);
  });

  it('rejects invalid sizes', () => {
    const { state, id } = setup();
    expect(run(state, { type: 'furniture/update', id, changes: { width: 0 } }).present).toBe(state.present);
    expect(run(state, { type: 'furniture/update', id, changes: { depth: Number.NaN } }).present).toBe(state.present);
  });

  it('shrinking the room nudges furniture inwards, but refuses if something cannot fit', () => {
    const { state } = setup();
    const smaller = run(state, { type: 'room/resize', room: { width: 200 } });
    expect(smaller.present.room.width).toBe(200);
    expectInsideRoom(smaller.present);

    const tooSmall = run(state, { type: 'room/resize', room: { width: 100 } });
    expect(tooSmall.present).toBe(state.present);
    expect(tooSmall.notice?.message).toMatch(/Table/);
  });

  it('deletes furniture', () => {
    const { state, id } = setup();
    expect(run(state, { type: 'furniture/delete', id }).present.furniture).toHaveLength(0);
  });

  it('undoes and redoes in order', () => {
    const { state, id } = setup();
    const moved = run(state, { type: 'furniture/update', id, changes: { x: 100 } });
    const undone = run(moved, { type: 'history/undo' });
    expect(undone.present.furniture[0].x).toBe(200);
    expect(canRedo(undone)).toBe(true);

    const redone = run(undone, { type: 'history/redo' });
    expect(redone.present.furniture[0].x).toBe(100);

    const undoAdd = run(undone, { type: 'history/undo' });
    expect(undoAdd.present.furniture).toHaveLength(0);
    expect(canUndo(undoAdd)).toBe(false);
  });

  it('a new edit clears the redo stack', () => {
    const { state, id } = setup();
    const next = run(
      state,
      { type: 'furniture/update', id, changes: { x: 100 } },
      { type: 'history/undo' },
      { type: 'furniture/update', id, changes: { y: 100 } },
    );
    expect(canRedo(next)).toBe(false);
  });

  it('does not record no-op edits in history', () => {
    const { state, id } = setup();
    const next = run(state, { type: 'furniture/update', id, changes: { x: 200 } });
    expect(next).toBe(state);
  });
});
