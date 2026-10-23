import { describe, expect, it } from 'vitest';
import { createFeature, createEmptyProject } from '../model/sample';
import { createEditorState, editorReducer } from '../state/editor';
import { parseProjectFile, serializeProject } from '../storage/projectFile';
import { doorwayPose, fovFromFocalLength } from './CameraMatch';

describe('camera matching', () => {
  it('turns an iPhone lens into a field of view for the photo’s shape', () => {
    // 24 mm equivalent, a 4:3 landscape photo: about 57° vertically; portrait is taller.
    expect(fovFromFocalLength(24, 4 / 3)).toBeCloseTo(56.8, 1);
    expect(fovFromFocalLength(24, 3 / 4)).toBeGreaterThan(fovFromFocalLength(24, 4 / 3));
    expect(fovFromFocalLength(13, 4 / 3)).toBeCloseTo(89.9, 1); // the 0.5× ultra wide
  });

  it('starts just inside the door, looking into the room', () => {
    const base = createEmptyProject(); // 400 × 350, walls clockwise from the top
    const bottom = base.room.outline[2];
    const door = createFeature('door', { type: 'wall', wallId: bottom.id, offset: 100 }, base.room);
    const pose = doorwayPose({ ...base, features: [door] }, 57)!;
    expect(pose).toMatchObject({ x: 300, y: 320, height: 150, yaw: 0, pitch: -10 });
  });

  it('saves views with the project, undoably', () => {
    const view = { id: 'v1', name: 'From the door', pose: { x: 50, y: 200, height: 150, yaw: 40, pitch: -14, roll: 0, fov: 56.8 }, photoAssetId: 'a'.repeat(64) };
    let state = createEditorState(createEmptyProject());
    state = editorReducer(state, { type: 'views/set', views: [view] });
    const again = parseProjectFile(serializeProject(state.present));
    expect(again.ok && again.project.cameraViews).toEqual([view]);
    state = editorReducer(state, { type: 'history/undo' });
    expect(state.present.cameraViews).toBeUndefined();
    const broken = parseProjectFile(serializeProject({ ...state.present, cameraViews: [{ ...view, pose: { ...view.pose, pitch: 200 } }] }));
    expect(broken.ok && broken.project.cameraViews).toBeUndefined();
  });
});
