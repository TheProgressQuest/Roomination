import { describe, expect, it } from 'vitest';
import { findConflicts } from '../model/conflicts';
import { mountOnWall } from '../model/placement';
import { createEmptyProject, createFurniture } from '../model/sample';
import { createEditorState, editorReducer } from '../state/editor';
import { parseProjectFile, serializeProject } from '../storage/projectFile';
import { fitTemplate } from './fit';
import { CATALOGUE } from './items';

const pick = (id: string) => CATALOGUE.find((c) => c.id === id)!.make();

describe('changing a piece’s model', () => {
  it('keeps its size, position, turn and height above the floor; undo brings the old model back', () => {
    const dresser = createFurniture({ ...pick('dresser'), x: 150, y: 60, rotation: 0, width: 82.4, depth: 47.1, height: 86.2 });
    let state = createEditorState({ ...createEmptyProject(), furniture: [dresser] });
    const t = fitTemplate(pick('vanity-integrated'), dresser);
    state = editorReducer(state, { type: 'furniture/update', id: dresser.id, changes: { name: t.name, kind: t.kind, color: t.color, appearance: t.appearance, components: t.components, shape: t.shape } });
    const after = state.present.furniture[0];
    expect(after).toMatchObject({ name: 'Vanity, integrated basin', kind: 'fixture', x: 150, y: 60, width: 82.4, depth: 47.1, height: 86.2 });
    expect(after.components!.some((c) => c.name === 'Basin')).toBe(true);
    state = editorReducer(state, { type: 'history/undo' });
    expect(state.present.furniture[0].name).toBe(dresser.name);
  });
});

describe('raised and wall-mounted pieces', () => {
  it('mounts a mirror on the nearest wall, facing into the room, and saves its height', () => {
    const project = createEmptyProject(); // 400 × 350
    const m = createFurniture({ ...pick('mirror-wall'), x: 200, y: 40 });
    expect(m.elevation).toBe(110);
    const mounted = { ...m, ...mountOnWall(m, project.room)! };
    expect(mounted).toMatchObject({ x: 200, y: 1.5, rotation: 0 });
    const right = { ...m, ...mountOnWall({ ...m, x: 390, y: 200 }, project.room)! };
    expect(right).toMatchObject({ x: 398.5, y: 200, rotation: 90 });
    const again = parseProjectFile(serializeProject({ ...project, furniture: [mounted] }));
    expect(again.ok && again.project.furniture[0].elevation).toBe(110);
  });

  it('only collides with pieces at the same height', () => {
    const project = createEmptyProject();
    const vanity = createFurniture({ ...pick('vanity-integrated'), x: 200, y: 24 });
    const mirror = createFurniture({ ...pick('mirror-wall'), x: 200, y: 1.5 });
    const lowShelf = createFurniture({ ...pick('mirror-wall'), x: 200, y: 1.5, elevation: 50 });
    expect(findConflicts({ ...project, furniture: [vanity, mirror] })).toEqual([]);
    expect(findConflicts({ ...project, furniture: [vanity, lowShelf] }).length).toBe(1);
  });
});

describe('every catalogue piece can be placed and edited', () => {
  it('adds, moves, resizes and raises each one through the editor', () => {
    const project = { ...createEmptyProject(), room: createEmptyProject().room };
    for (const item of CATALOGUE) {
      const piece = createFurniture({ ...item.make(), x: 200, y: 175 });
      let state = createEditorState({ ...project, furniture: [] });
      state = editorReducer(state, { type: 'furniture/add', furniture: piece });
      expect(state.present.furniture, `${item.name} added`).toHaveLength(1);
      for (const changes of [{ x: 150 }, { width: piece.width + 4 }, { elevation: (piece.elevation ?? 0) + 5 }]) {
        state = editorReducer(state, { type: 'furniture/update', id: piece.id, changes });
        const [k, v] = Object.entries(changes)[0];
        expect(state.present.furniture[0][k as 'x'], `${item.name}: ${k}`).toBe(v);
      }
    }
  });
});
