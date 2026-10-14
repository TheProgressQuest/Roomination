import { describe, expect, it } from 'vitest';
import { furnitureBounds } from '../model/geometry';
import { conflictKey } from '../model/conflicts';
import { createEmptyProject, createFeature, createFurniture, createRectangularRoom, createStaircase } from '../model/sample';
import { featureFrame } from '../model/features';
import { roomBounds, wallSegments } from '../model/walls';
import type { Project } from '../model/types';
import { canRedo, canUndo, createEditorState, editorReducer, type EditorAction, type EditorState } from './editor';

function setup(): { state: EditorState; id: string } {
  const project: Project = createEmptyProject(createRectangularRoom(400, 300));
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
    const box = roomBounds(project.room);
    expect(b.maxX).toBeLessThanOrEqual(box.maxX + 1e-6);
    expect(b.maxY).toBeLessThanOrEqual(box.maxY + 1e-6);
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
    const smaller = run(state, { type: 'room/resize', width: 200, length: 300 });
    expect(roomBounds(smaller.present.room).maxX).toBe(200);
    expectInsideRoom(smaller.present);

    const tooSmall = run(state, { type: 'room/resize', width: 100, length: 300 });
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
  // Walls of the 400×300 test room, clockwise from the top-left corner.
  const ids = (state: EditorState) => state.present.room.outline.map((n) => n.id);
  const onWall = (state: EditorState, index: number, offset: number) => ({ type: 'wall' as const, wallId: ids(state)[index], offset });

  it('adds, edits, and undoes a door', () => {
    const { state } = setup();
    const door = createFeature('door', onWall(state, 0, 100), { height: 250 });
    const added = run(state, { type: 'feature/add', feature: door });
    const wider = run(added, { type: 'feature/update', id: door.id, changes: { width: 100 } });
    expect(wider.present.features[0].width).toBe(100);
    expect(run(wider, { type: 'history/undo' }).present.features[0].width).toBe(80);
    expect(run(wider, { type: 'history/undo' }, { type: 'history/undo' }).present.features).toHaveLength(0);
  });

  it('keeps wall features on their wall and inside its length', () => {
    const { state } = setup();
    const window = createFeature('window', onWall(state, 0, 100), { height: 250 }, { width: 100 });
    const moved = run(state, { type: 'feature/add', feature: window }, { type: 'feature/update', id: window.id, changes: { placement: onWall(state, 0, 9999) } });
    expect(moved.present.features[0].placement).toEqual(onWall(state, 0, 350));
  });

  it('refuses to overlap two openings on one wall', () => {
    const { state } = setup();
    const a = createFeature('window', onWall(state, 0, 100), { height: 250 }, { width: 100 });
    const b = createFeature('door', onWall(state, 0, 300), { height: 250 }, { width: 80 });
    const both = run(state, { type: 'feature/add', feature: a }, { type: 'feature/add', feature: b });
    const clash = run(both, { type: 'feature/update', id: b.id, changes: { placement: onWall(state, 0, 160) } });
    expect(clash.present).toBe(both.present);
    expect(clash.notice?.message).toMatch(/overlap/);
  });

  it('switching a vent to wall-mounted snaps it to a wall', () => {
    const { state } = setup();
    const vent = createFeature('vent', { type: 'free', x: 20, y: 150, rotation: 0 }, { height: 250 });
    const next = run(state, { type: 'feature/add', feature: vent }, { type: 'feature/update', id: vent.id, changes: { ventMount: 'wall' } });
    expect(next.present.features[0].placement).toMatchObject({ type: 'wall', wallId: ids(state)[3], offset: 150 });
  });

  it('shrinking the room keeps features attached and inside', () => {
    const { state } = setup();
    const window = createFeature('window', onWall(state, 0, 340), { height: 250 }, { width: 100 });
    const next = run(state, { type: 'feature/add', feature: window }, { type: 'room/resize', width: 300, length: 300 });
    expect(next.present.features[0].placement).toEqual(onWall(state, 0, 250));
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

describe('articulated walls', () => {
  function withDoorAndWindow() {
    const { state } = setup();
    const [top, right] = state.present.room.outline;
    const door = createFeature('door', { type: 'wall', wallId: top.id, offset: 100 }, { height: 250 }, { width: 80 });
    const window = createFeature('window', { type: 'wall', wallId: right.id, offset: 150 }, { height: 250 }, { width: 100 });
    return { state: run(state, { type: 'feature/add', feature: door }, { type: 'feature/add', feature: window }), door, window, top, right };
  }
  const frameOf = (state: EditorState, id: string) => featureFrame(state.present.features.find((f) => f.id === id)!, state.present.room);

  it('a door moves and turns with its wall when a corner is dragged', () => {
    const { state, door, right } = withDoorAndWindow();
    // Drag the top-right corner down: the top wall now slopes, so the door must slope too.
    const next = run(state, { type: 'walls/moveNode', nodeId: right.id, to: { x: 400, y: 100 } });
    const frame = frameOf(next, door.id);
    const slope = (Math.atan2(100, 400) * 180) / Math.PI;
    expect(frame.angle).toBeCloseTo(slope);
    expect(frame.x).toBeCloseTo((100 / Math.hypot(400, 100)) * 400);
  });

  it('a window stays on its wall when that wall is lengthened', () => {
    const { state, window, right } = withDoorAndWindow();
    const next = run(state, { type: 'walls/setLength', wallId: right.id, length: 400 });
    expect(next.present.features.find((f) => f.id === window.id)!.placement).toMatchObject({ wallId: right.id, offset: 150 });
    expect(frameOf(next, window.id).y).toBeCloseTo(150);
  });

  it('refuses to shorten a wall below a feature on it, explaining why', () => {
    const { state, right } = withDoorAndWindow();
    const next = run(state, { type: 'walls/setLength', wallId: right.id, length: 60 });
    expect(next.present).toBe(state.present);
    expect(next.notice?.message).toMatch(/needs 100 cm of wall/);
  });

  it('refuses walls that would cross, explaining why', () => {
    const { state } = setup();
    const [, , c] = state.present.room.outline;
    // Pull the bottom-right corner above the top wall: the right wall now crosses it.
    const next = run(state, { type: 'walls/moveNode', nodeId: c.id, to: { x: 200, y: -100 } });
    expect(next.present).toBe(state.present);
    expect(next.notice?.message).toMatch(/cross/);
  });

  it('splitting a wall keeps every feature exactly where it was', () => {
    const { state, door, top } = withDoorAndWindow();
    const before = frameOf(state, door.id);
    const next = run(state, { type: 'walls/split', wallId: top.id, distance: 50, newId: 'mid' });
    expect(next.present.features.find((f) => f.id === door.id)!.placement).toMatchObject({ wallId: 'mid', offset: 50 });
    expect(frameOf(next, door.id)).toEqual(before);
    // …but not through the door itself.
    expect(run(state, { type: 'walls/split', wallId: top.id, distance: 100, newId: 'x' }).notice?.message).toMatch(/runs through/);
  });

  it('merging walls re-attaches features to the merged wall', () => {
    const { state, door, top } = withDoorAndWindow();
    const split = run(state, { type: 'walls/split', wallId: top.id, distance: 50, newId: 'mid' });
    const merged = run(split, { type: 'walls/merge', wallId: top.id });
    expect(merged.present.features.find((f) => f.id === door.id)!.placement).toMatchObject({ wallId: top.id });
    expect(frameOf(merged, door.id).x).toBeCloseTo(100);
  });

  it('redrawing the room as an L moves furniture out of the missing corner and keeps features', () => {
    const { state, id } = setup(); // table 120×80 at the centre (200,150)
    const lShape = [[0, 0], [400, 0], [400, 150], [200, 150], [200, 300], [0, 300]].map(([x, y], i) => ({ id: `L${i}`, x, y, thickness: 12 }));
    const moved = run(state, { type: 'furniture/update', id, changes: { x: 320, y: 240 } });
    const next = run(moved, { type: 'walls/replaceOutline', nodes: lShape });
    expect(next.notice).toBeNull();
    const table = next.present.furniture[0];
    const b = furnitureBounds(table);
    expect(b.maxY <= 150 + 1e-6 || b.maxX <= 200 + 1e-6).toBe(true);
  });

  it('interior walls: added, then a door placed in them', () => {
    const { state } = setup();
    const partition = { id: 'p', nodes: [{ id: 'p1', x: 200, y: 0, thickness: 10 }, { id: 'p2', x: 200, y: 300, thickness: 10 }] };
    const withWall = run(state, { type: 'walls/addPartition', partition });
    expect(wallSegments(withWall.present.room).map((w) => w.id)).toContain('p1');
    const door = createFeature('door', { type: 'wall', wallId: 'p1', offset: 250 }, { height: 250 }, { width: 80 });
    expect(run(withWall, { type: 'feature/add', feature: door }).present.features).toHaveLength(1);
    // Deleting the wall the door sits in is refused (nothing is deleted silently).
    const withDoor = run(withWall, { type: 'feature/add', feature: door });
    expect(run(withDoor, { type: 'walls/delete', wallId: 'p1', newPartitionId: 'q' }).notice?.message).toMatch(/Move or delete it first/);
  });

  it('wall edits undo and redo as single steps', () => {
    const { state, right } = withDoorAndWindow();
    const moved = run(state, { type: 'walls/moveNode', nodeId: right.id, to: { x: 450, y: 0 } });
    expect(run(moved, { type: 'history/undo' }).present).toBe(state.present);
    expect(run(moved, { type: 'history/undo' }, { type: 'history/redo' }).present).toBe(moved.present);
  });
});

describe('stairs in the editor', () => {
  it('adds, edits, rotates and deletes a staircase, undoably', () => {
    const { state } = setup();
    const stair = createStaircase('L', { x: 200, y: 150 }); // 265 × 265: fits at any right angle
    const added = run(state, { type: 'stairs/add', stair });
    expect(added.present.stairs).toHaveLength(1);
    const rotated = run(added, { type: 'stairs/update', id: stair.id, changes: { rotation: 90 } });
    expect(rotated.present.stairs[0].rotation).toBe(90);
    const deleted = run(rotated, { type: 'stairs/delete', id: stair.id });
    expect(deleted.present.stairs).toHaveLength(0);
    expect(run(deleted, { type: 'history/undo' }).present.stairs[0].rotation).toBe(90);
  });

  it('keeps stairs inside the room and refuses ones that cannot fit', () => {
    const { state } = setup();
    const stair = createStaircase('straight', { x: 380, y: 150 }); // 350 cm long: pokes out of the right wall
    const added = run(state, { type: 'stairs/add', stair });
    expect(added.present.stairs[0].x).toBeLessThanOrEqual(400 - 175 + 1e-6);
    const huge = run(added, { type: 'stairs/update', id: stair.id, changes: { sections: stair.sections.map((s) => ({ ...s, length: 900 })) } });
    expect(huge.notice?.message).toMatch(/wouldn’t fit/);
  });

  it('furniture placed on the stairs raises the usual overlap prompt', () => {
    const { state, id } = setup();
    const stair = createStaircase('straight', { x: 200, y: 60 });
    const next = run(state, { type: 'stairs/add', stair }, { type: 'furniture/update', id, changes: { y: 60 } });
    expect(next.prompt?.conflicts[0]).toMatchObject({ otherKind: 'stairs' });
  });
});

describe('code review regressions', () => {
  it('confirming a value without changing it adds no undo step and keeps redo', () => {
    const { state, id } = setup();
    const moved = run(state, { type: 'furniture/update', id, changes: { x: 100 } }, { type: 'history/undo' });
    expect(canRedo(moved)).toBe(true);
    const same = run(moved, { type: 'room/resize', width: 400, length: 300 });
    expect(same.past).toBe(moved.past);
    expect(canRedo(same)).toBe(true);
    const [corner] = state.present.room.outline;
    expect(canRedo(run(moved, { type: 'walls/moveNode', nodeId: corner.id, to: { x: corner.x, y: corner.y } }))).toBe(true);
  });

  it('deleting an outer wall removes that wall, and refuses while a feature is on it', () => {
    const { state } = setup();
    const [top, right] = state.present.room.outline;
    const split = run(state, { type: 'walls/split', wallId: top.id, distance: 200, newId: 'mid' });
    const deleted = run(split, { type: 'walls/delete', wallId: 'mid', newPartitionId: 'x' });
    expect(wallSegments(deleted.present.room).map((w) => w.id)).not.toContain('mid');
    const door = createFeature('door', { type: 'wall', wallId: right.id, offset: 150 }, { height: 250 }, { width: 80 });
    const withDoor = run(state, { type: 'feature/add', feature: door });
    // Deleting the TOP wall must not complain about the door on the RIGHT wall.
    const pentagonish = run(withDoor, { type: 'walls/split', wallId: top.id, distance: 200, newId: 'm' }, { type: 'walls/moveNode', nodeId: 'm', to: { x: 200, y: -50 } });
    expect(run(pentagonish, { type: 'walls/delete', wallId: 'm', newPartitionId: 'x' }).notice).toBeNull();
    expect(run(withDoor, { type: 'walls/delete', wallId: right.id, newPartitionId: 'x' }).notice?.message).toMatch(/Front door|Door/);
  });

  it('a radiator deeper than the room is refused', () => {
    const { state } = setup();
    const radiator = createFeature('radiator', { type: 'wall', wallId: state.present.room.outline[0].id, offset: 200 }, { height: 250 }, { depth: 400 });
    expect(run(state, { type: 'feature/add', feature: radiator }).notice?.message).toMatch(/too big/);
  });

  it('a wall-only feature with no wall long enough is refused rather than left floating', () => {
    const { state } = setup();
    const vent = createFeature('vent', { type: 'free', x: 200, y: 150, rotation: 0 }, { height: 250 }, { width: 500, depth: 12 });
    const added = run(state, { type: 'feature/add', feature: { ...vent, width: 50 } });
    const next = run(added, { type: 'feature/update', id: vent.id, changes: { width: 500, ventMount: 'wall' } });
    expect(next.present).toBe(added.present);
  });
});

describe('locking, relationships and layouts (Phase 3A)', () => {
  function twoPieces() {
    const { state, id } = setup(); // table 120×80 at (200,150)
    const chair = createFurniture({ name: 'Chair', kind: 'chair', x: 60, y: 60, width: 50, depth: 50, color: '#123456', texture: 'striped' });
    return { state: run(state, { type: 'furniture/add', furniture: chair }), tableId: id, chairId: chair.id };
  }

  it('locked pieces refuse to move or turn, but other edits still work', () => {
    const { state, tableId } = twoPieces();
    const locked = run(state, { type: 'furniture/lock', ids: [tableId], locked: true });
    expect(run(locked, { type: 'furniture/update', id: tableId, changes: { x: 100 } }).notice?.message).toMatch(/locked/);
    expect(run(locked, { type: 'furniture/update', id: tableId, changes: { rotation: 90 } }).notice?.message).toMatch(/locked/);
    expect(run(locked, { type: 'furniture/update', id: tableId, changes: { name: 'Big table' } }).present.furniture[0].name).toBe('Big table');
    const unlocked = run(locked, { type: 'furniture/lock', ids: [tableId], locked: false }, { type: 'furniture/update', id: tableId, changes: { x: 100 } });
    expect(unlocked.present.furniture[0].x).toBe(100);
  });

  it('locks several pieces at once, as one undo step', () => {
    const { state, tableId, chairId } = twoPieces();
    const locked = run(state, { type: 'furniture/lock', ids: [tableId, chairId], locked: true });
    expect(locked.present.furniture.every((f) => f.locked)).toBe(true);
    expect(run(locked, { type: 'history/undo' }).present.furniture.some((f) => f.locked)).toBe(false);
  });

  it('a wall change that would push a locked piece is refused', () => {
    const { state, tableId } = twoPieces();
    const locked = run(state, { type: 'furniture/update', id: tableId, changes: { x: 330 } }, { type: 'furniture/lock', ids: [tableId], locked: true });
    expect(run(locked, { type: 'room/resize', width: 300, length: 300 }).notice?.message).toMatch(/locked and would have to move/);
  });

  it('adds and removes relationships; deleting a piece removes its relationships', () => {
    const { state, tableId, chairId } = twoPieces();
    const rel = { id: 'r1', type: 'inFrontOf' as const, a: tableId, b: chairId };
    const added = run(state, { type: 'relationship/add', relationship: rel });
    expect(added.present.relationships).toEqual([rel]);
    expect(run(added, { type: 'relationship/add', relationship: { ...rel, id: 'r2', b: tableId } }).notice?.message).toMatch(/two different pieces/);
    expect(run(added, { type: 'relationship/remove', id: 'r1' }).present.relationships).toEqual([]);
    expect(run(added, { type: 'furniture/delete', id: chairId }).present.relationships).toEqual([]);
  });

  it('applying a layout changes only positions and rotations, in one undo step', () => {
    const { state, tableId, chairId } = twoPieces();
    const before = state.present.furniture.find((f) => f.id === chairId)!;
    const applied = run(state, { type: 'layout/apply', positions: [{ id: chairId, x: 300, y: 250, rotation: 90 }, { id: tableId, x: 150, y: 100, rotation: 0 }] });
    const after = applied.present.furniture.find((f) => f.id === chairId)!;
    expect(after).toEqual({ ...before, x: 300, y: 250, rotation: 90 });
    expect(applied.past).toHaveLength(state.past.length + 1);
    expect(run(applied, { type: 'history/undo' }).present).toBe(state.present);
  });

  it('refuses to apply a layout that would move a locked piece', () => {
    const { state, chairId } = twoPieces();
    const locked = run(state, { type: 'furniture/lock', ids: [chairId], locked: true });
    expect(run(locked, { type: 'layout/apply', positions: [{ id: chairId, x: 300, y: 250, rotation: 0 }] }).notice?.message).toMatch(/locked/);
  });

  it('saves and deletes layout alternatives', () => {
    const { state, chairId } = twoPieces();
    const layout = { id: 'L1', name: 'Layout B', createdAt: 1, positions: [{ id: chairId, x: 100, y: 100, rotation: 0 }] };
    const saved = run(state, { type: 'layouts/save', layout });
    expect(saved.present.savedLayouts).toEqual([layout]);
    expect(run(saved, { type: 'layouts/delete', id: 'L1' }).present.savedLayouts).toEqual([]);
  });

  it('optimizer settings are remembered but never become undo steps', () => {
    const { state, tableId } = twoPieces();
    const moved = run(state, { type: 'furniture/update', id: tableId, changes: { x: 100 } });
    const tuned = run(moved, { type: 'optimizer/settings', changes: { functionWeight: 0.8, mode: 'functional' } });
    expect(tuned.past).toBe(moved.past);
    const undone = run(tuned, { type: 'history/undo' });
    expect(undone.present.furniture[0].x).toBe(200);
    expect(undone.present.optimizer.mode).toBe('functional'); // the setting survives undo
  });
});

describe('Phase 3A review regressions', () => {
  it('a layout that leaves a locked piece exactly in place can still be applied', () => {
    const { state, id } = setup();
    const table = state.present.furniture[0];
    const locked = run(state, { type: 'furniture/lock', ids: [id], locked: true });
    const applied = run(locked, { type: 'layout/apply', positions: [{ id, x: table.x, y: table.y, rotation: table.rotation }] });
    expect(applied.notice).toBeNull();
  });

  it('explains when a locked piece would need to shift because of a size change', () => {
    const { state, id } = setup();
    const atWall = run(state, { type: 'furniture/update', id, changes: { x: 340 } }, { type: 'furniture/lock', ids: [id], locked: true });
    expect(run(atWall, { type: 'furniture/update', id, changes: { width: 200 } }).notice?.message).toMatch(/that size would need it to shift/);
  });
});

describe('Feng Shui settings', () => {
  it('are remembered without becoming undo steps, and keep only sensible values', () => {
    const room = createRectangularRoom(400, 300);
    const door = createFeature('door', { type: 'wall', wallId: room.outline[2].id, offset: 200 }, room);
    const window = createFeature('window', { type: 'wall', wallId: room.outline[0].id, offset: 200 }, room);
    const state = createEditorState({ ...createEmptyProject(room), features: [door, window] });
    const on = run(state, { type: 'fengShui/settings', changes: { enabled: true, northBearing: 450, entranceId: door.id } });
    expect(on.present.fengShui).toMatchObject({ enabled: true, method: 'entrance', northBearing: 90, entranceId: door.id });
    expect(canUndo(on)).toBe(false);
    // A window can't be the entrance.
    expect(run(on, { type: 'fengShui/settings', changes: { entranceId: window.id } }).present.fengShui?.entranceId).toBeNull();
    // Custom weights are kept between 0 and 100.
    const tuned = run(on, { type: 'optimizer/settings', changes: { weights: { functional: 150, aesthetic: -5, fengShui: 20 } } });
    expect(tuned.present.optimizer.weights).toEqual({ functional: 100, aesthetic: 0, fengShui: 20 });
  });
});
