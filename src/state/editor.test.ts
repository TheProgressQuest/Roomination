import { describe, expect, it } from 'vitest';
import { furnitureBounds } from '../model/geometry';
import { conflictKey } from '../model/conflicts';
import { DEFAULT_FLOOR, createEmptyProject, createFeature, createFurniture } from '../model/sample';
import type { Project } from '../model/types';
import { canRedo, canUndo, createEditorState, editorReducer, type EditorAction, type EditorState } from './editor';

function setup(): { state: EditorState; id: string } {
  const project: Project = createEmptyProject({ width: 400, length: 300, height: 250, floor: DEFAULT_FLOOR });
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
    expect(run(state, { type: 'furniture/update', id, changes: { height: 0 } }).present).toBe(state.present);
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

describe('room features', () => {
  const onWall = (wall: 'top' | 'left', offset: number) => ({ type: 'wall' as const, wall, offset });

  it('adds, edits, and undoes a door', () => {
    const { state } = setup();
    const door = createFeature('door', onWall('top', 100), { height: 250 });
    const added = run(state, { type: 'feature/add', feature: door });
    const wider = run(added, { type: 'feature/update', id: door.id, changes: { width: 100 } });
    expect(wider.present.features[0].width).toBe(100);
    expect(run(wider, { type: 'history/undo' }).present.features[0].width).toBe(80);
    expect(run(wider, { type: 'history/undo' }, { type: 'history/undo' }).present.features).toHaveLength(0);
  });

  it('keeps wall features on their wall and inside its length', () => {
    const { state } = setup();
    const window = createFeature('window', onWall('top', 100), { height: 250 }, { width: 100 });
    const moved = run(state, { type: 'feature/add', feature: window }, { type: 'feature/update', id: window.id, changes: { placement: onWall('top', 9999) } });
    expect(moved.present.features[0].placement).toEqual(onWall('top', 350));
  });

  it('refuses to overlap two openings on one wall', () => {
    const { state } = setup();
    const a = createFeature('window', onWall('top', 100), { height: 250 }, { width: 100 });
    const b = createFeature('door', onWall('top', 300), { height: 250 }, { width: 80 });
    const both = run(state, { type: 'feature/add', feature: a }, { type: 'feature/add', feature: b });
    const clash = run(both, { type: 'feature/update', id: b.id, changes: { placement: onWall('top', 160) } });
    expect(clash.present).toBe(both.present);
    expect(clash.notice?.message).toMatch(/overlap/);
  });

  it('switching a vent to wall-mounted snaps it to a wall', () => {
    const { state } = setup();
    const vent = createFeature('vent', { type: 'free', x: 20, y: 150, rotation: 0 }, { height: 250 });
    const next = run(state, { type: 'feature/add', feature: vent }, { type: 'feature/update', id: vent.id, changes: { ventMount: 'wall' } });
    expect(next.present.features[0].placement).toMatchObject({ type: 'wall', wall: 'left', offset: 150 });
  });

  it('shrinking the room keeps features attached and inside', () => {
    const { state } = setup();
    const window = createFeature('window', onWall('top', 340), { height: 250 }, { width: 100 });
    const next = run(state, { type: 'feature/add', feature: window }, { type: 'room/resize', room: { width: 300 } });
    expect(next.present.features[0].placement).toEqual(onWall('top', 250));
  });
});

describe('overlap prompts and overrides', () => {
  function withShelf() {
    const { state, id } = setup(); // table 120×80 at (200,150)
    const shelf = createFurniture({ name: 'Shelf', x: 60, y: 60, width: 80, depth: 35 });
    return { state: run(state, { type: 'furniture/add', furniture: shelf }), tableId: id, shelfId: shelf.id };
  }

  it('raises one prompt when a change creates a new overlap', () => {
    const { state, shelfId } = withShelf();
    expect(state.prompt).toBeNull();
    const overlapping = run(state, { type: 'furniture/update', id: shelfId, changes: { x: 180, y: 150 } });
    expect(overlapping.prompt?.conflicts).toHaveLength(1);
    // Moving again while still overlapping the same piece doesn't nag again.
    const nudged = run(overlapping, { type: 'furniture/update', id: shelfId, changes: { x: 185 } });
    expect(nudged.prompt).toBeNull();
  });

  it('"Move it back" reverts the change', () => {
    const { state, shelfId } = withShelf();
    const overlapping = run(state, { type: 'furniture/update', id: shelfId, changes: { x: 180, y: 150 } });
    const reverted = run(overlapping, { type: 'conflict/revert' });
    expect(reverted.present).toBe(state.present);
    expect(reverted.prompt).toBeNull();
  });

  it('accepting stores a pair-specific override that is undoable', () => {
    const { state, shelfId, tableId } = withShelf();
    const overlapping = run(state, { type: 'furniture/update', id: shelfId, changes: { x: 180, y: 150 } });
    const accepted = run(overlapping, { type: 'overlap/accept', keys: overlapping.prompt!.conflicts.map((c) => c.key) });
    expect(accepted.present.acceptedOverlaps).toEqual([conflictKey(shelfId, tableId, 'collision')]);
    expect(accepted.prompt).toBeNull();
    expect(run(accepted, { type: 'history/undo' }).present.acceptedOverlaps).toEqual([]);
  });

  it('a new overlap with a different piece still prompts after accepting one', () => {
    const { state, shelfId } = withShelf();
    const lamp = createFurniture({ name: 'Lamp', x: 350, y: 250, width: 30, depth: 30 });
    let next = run(state, { type: 'furniture/add', furniture: lamp }, { type: 'furniture/update', id: shelfId, changes: { x: 180, y: 150 } });
    next = run(next, { type: 'overlap/accept', keys: next.prompt!.conflicts.map((c) => c.key) });
    next = run(next, { type: 'furniture/update', id: lamp.id, changes: { x: 180, y: 150 } });
    expect(next.prompt?.conflicts.length).toBeGreaterThan(0);
  });

  it('forgets an override once the pieces no longer overlap', () => {
    const { state, shelfId } = withShelf();
    let next = run(state, { type: 'furniture/update', id: shelfId, changes: { x: 180, y: 150 } });
    next = run(next, { type: 'overlap/accept', keys: next.prompt!.conflicts.map((c) => c.key) });
    next = run(next, { type: 'furniture/update', id: shelfId, changes: { x: 60, y: 60 } });
    expect(next.present.acceptedOverlaps).toEqual([]);
    // …so overlapping again asks again.
    next = run(next, { type: 'furniture/update', id: shelfId, changes: { x: 180, y: 150 } });
    expect(next.prompt).not.toBeNull();
  });

  it('deleting a piece removes its overrides', () => {
    const { state, shelfId } = withShelf();
    let next = run(state, { type: 'furniture/update', id: shelfId, changes: { x: 180, y: 150 } });
    next = run(next, { type: 'overlap/accept', keys: next.prompt!.conflicts.map((c) => c.key) });
    next = run(next, { type: 'furniture/delete', id: shelfId });
    expect(next.present.acceptedOverlaps).toEqual([]);
  });
});

describe('merged edits', () => {
  it('turns a burst of colour-picker changes into one undo step', () => {
    const { state, id } = setup();
    const next = run(
      state,
      { type: 'furniture/update', id, changes: { color: '#111111' }, mergeKey: `color:${id}` },
      { type: 'furniture/update', id, changes: { color: '#222222' }, mergeKey: `color:${id}` },
      { type: 'furniture/update', id, changes: { color: '#333333' }, mergeKey: `color:${id}` },
    );
    expect(next.present.furniture[0].color).toBe('#333333');
    expect(run(next, { type: 'history/undo' }).present.furniture[0].color).toBe(state.present.furniture[0].color);
  });

  it('a different edit in between starts a new undo step', () => {
    const { state, id } = setup();
    const next = run(
      state,
      { type: 'furniture/update', id, changes: { color: '#111111' }, mergeKey: 'c' },
      { type: 'furniture/update', id, changes: { x: 100 } },
      { type: 'furniture/update', id, changes: { color: '#222222' }, mergeKey: 'c' },
    );
    expect(run(next, { type: 'history/undo' }).present.furniture[0].color).toBe('#111111');
  });
});
