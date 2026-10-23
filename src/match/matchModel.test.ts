import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/sample';
import { createEditorState, editorReducer } from '../state/editor';
import { parseProjectFile, projectAssetIds, serializeProject } from '../storage/projectFile';
import { withAssets } from '../storage/projectPackage';
import { buildRoomModel } from '../scene3d/model';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

describe('Match My Room data', () => {
  it('sets wall colours and textures for all walls or one, undoably', () => {
    const project = createEmptyProject();
    const wall = project.room.outline[1].id;
    let state = createEditorState(project);
    state = editorReducer(state, { type: 'room/setWallLook', wallId: null, color: '#8ea393', texture: { assetId: A, widthCm: 60, heightCm: 60 } });
    state = editorReducer(state, { type: 'room/setWallLook', wallId: wall, color: '#ffffff' });
    const room = state.present.room;
    expect(room.wallColor).toBe('#8ea393');
    expect(room.wallTexture?.assetId).toBe(A);
    expect(room.wallFinishes).toEqual({ [wall]: { color: '#ffffff' } });
    // In 3D: that wall has its own colour; the others the room's colour and texture.
    const walls = buildRoomModel(state.present).walls;
    expect(walls.find((w) => w.wallId === wall)).toMatchObject({ color: '#ffffff', texture: { assetId: A } });
    expect(walls.find((w) => w.wallId !== wall)).toMatchObject({ color: '#8ea393', texture: { assetId: A } });
    // Removing this wall's own look, then undoing it.
    state = editorReducer(state, { type: 'room/setWallLook', wallId: wall, color: null, texture: null });
    expect(state.present.room.wallFinishes).toBeUndefined();
    state = editorReducer(state, { type: 'history/undo' });
    expect(state.present.room.wallFinishes?.[wall]?.color).toBe('#ffffff');
  });

  it('saves photo textures and reference photos, and counts them as the project’s photos', () => {
    const base = createEmptyProject();
    const project = {
      ...base,
      room: { ...base.room, floor: { ...base.room.floor, photo: { assetId: A, widthCm: 60, heightCm: 60, roughness: 0.4 } }, wallFinishes: { [base.room.outline[0].id]: { texture: { assetId: B, widthCm: 30, heightCm: 30 } } } },
      referencePhotos: [{ assetId: C, name: 'bathroom.jpg', addedAt: 1 }],
    };
    const again = parseProjectFile(serializeProject(project));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.project.room.floor.photo).toEqual({ assetId: A, widthCm: 60, heightCm: 60, roughness: 0.4 });
    expect(again.project.referencePhotos).toEqual([{ assetId: C, name: 'bathroom.jpg', addedAt: 1 }]);
    expect(projectAssetIds(again.project).sort()).toEqual([A, B, C]);
    // Exported without one of the photos: its references are dropped, nothing else changes.
    const without = withAssets(again.project, (id) => (id === B ? null : id));
    expect(without.room.wallFinishes).toBeUndefined();
    expect(without.room.floor.photo?.assetId).toBe(A);
    expect(without.referencePhotos).toHaveLength(1);
  });

  it('drops damaged textures without losing the project', () => {
    const base = createEmptyProject();
    const bad = { ...base, room: { ...base.room, wallTexture: { assetId: 'not-a-hash', widthCm: 60, heightCm: 60 }, floor: { ...base.room.floor, photo: { assetId: A, widthCm: -1, heightCm: 60 } } } };
    const again = parseProjectFile(serializeProject(bad as never));
    expect(again.ok).toBe(true);
    expect(again.ok && again.project.room.wallTexture).toBeUndefined();
    expect(again.ok && again.project.room.floor.photo).toBeUndefined();
  });
});
