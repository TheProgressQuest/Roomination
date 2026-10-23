import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../catalogue/items';
import { createEmptyProject, createFeature, createFurniture } from '../model/sample';
import { kelvinToHex } from '../render/lightColour';
import { createEditorState, editorReducer } from '../state/editor';
import { parseProjectFile, serializeProject } from '../storage/projectFile';
import { buildFurniture, buildRoomModel, buildSceneModel } from './model';

const pick = (id: string) => CATALOGUE.find((c) => c.id === id)!.make();

describe('lights', () => {
  it('converts colour temperature to warm, neutral and cool colours', () => {
    const [warm, day] = [kelvinToHex(2700), kelvinToHex(6500)].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
    expect(warm[0]).toBeGreaterThan(warm[2] + 60);
    expect(Math.abs(day[0] - day[2])).toBeLessThan(25);
  });

  it('a fitting’s light comes from its glowing shades, at their height; off gives none', () => {
    const bar = createFurniture({ ...pick('vanity-light-3'), x: 100, y: 5 });
    expect(bar.light).toMatchObject({ on: true, lumens: 1200 });
    const [scene] = buildFurniture([bar]);
    expect(scene.light!.z).toBeGreaterThan(195);
    expect(scene.light!.z).toBeLessThan(195 + bar.height);
    expect(scene.parts.filter((p) => p.glow)).toHaveLength(3);
    const [off] = buildFurniture([{ ...bar, light: { ...bar.light!, on: false } }]);
    expect(off.light).toBeUndefined();
    expect(off.parts.some((p) => p.glow)).toBe(false);
  });

  it('ceiling lights are light sources too; lights save with the piece', () => {
    const project = createEmptyProject();
    const light = createFeature('light', { type: 'free', x: 200, y: 175, rotation: 0 }, project.room);
    expect(buildRoomModel({ ...project, features: [light] }).lights).toHaveLength(1);
    const lamp = createFurniture({ ...pick('table-lamp'), x: 50, y: 50 });
    const again = parseProjectFile(serializeProject({ ...project, furniture: [{ ...lamp, light: { on: false, lumens: 300, kelvin: 4000, direction: 'down' } }] }));
    expect(again.ok && again.project.furniture[0].light).toEqual({ on: false, lumens: 300, kelvin: 4000, direction: 'down' });
  });
});

describe('doors and trim', () => {
  const room = () => {
    const project = createEmptyProject();
    const door = createFeature('door', { type: 'wall', wallId: project.room.outline[2].id, offset: 100 }, project.room, { width: 80 });
    return { ...project, features: [door] };
  };

  it('shows a door at its open angle without changing its size, hinge or file', () => {
    const p = room();
    const leaf = (angle?: number) => buildSceneModel({ ...p, features: [{ ...p.features[0], openAngle: angle }] }).walls[2].openings.find((o) => o.material === 'door')!.block;
    const turn = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
    expect(turn(leaf(undefined).rotation, leaf(0).rotation)).toBeCloseTo(27, 0);
    expect(turn(leaf(90).rotation, leaf(0).rotation)).toBeCloseTo(90, 0);
    const again = parseProjectFile(serializeProject({ ...p, features: [{ ...p.features[0], openAngle: 90 }] }));
    expect(again.ok && again.project.features[0]).toMatchObject({ openAngle: 90, width: 80, hinge: 'left' });
    // Older files (no angle) still load, shown ajar.
    expect(parseProjectFile(serializeProject(p)).ok).toBe(true);
  });

  it('adds baseboards (broken at the door), casing and crown, undoably', () => {
    let state = createEditorState(room());
    state = editorReducer(state, { type: 'room/setTrim', trim: { baseboard: { height: 10, depth: 1.5 }, casing: { width: 8, depth: 1.5 }, crown: { height: 8, depth: 6 }, color: '#ffffff' } });
    const walls = buildRoomModel(state.present).walls;
    const doorWall = walls[2];
    // Baseboard in two pieces either side of the door, casing (2 sides + head), crown.
    expect(doorWall.trim).toHaveLength(2 + 3 + 1);
    expect(walls[0].trim).toHaveLength(2);
    const again = parseProjectFile(serializeProject(state.present));
    expect(again.ok && again.project.room.trim?.casing).toEqual({ width: 8, depth: 1.5 });
    state = editorReducer(state, { type: 'history/undo' });
    expect(state.present.room.trim).toBeUndefined();
  });
});
