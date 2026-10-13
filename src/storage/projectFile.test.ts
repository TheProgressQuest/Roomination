import { describe, expect, it } from 'vitest';
import { featureFrame } from '../model/features';
import { DEFAULT_WALL_COLOR, createSampleProject, createStaircase } from '../model/sample';
import { parseProject, parseProjectFile, serializeProject } from './projectFile';

/** Exactly what Phase 1 wrote to IndexedDB. */
const phase1Save = {
  schemaVersion: 1,
  name: 'Old room',
  units: 'metric',
  room: { width: 400, length: 300, height: 250 },
  furniture: [{ id: 'a', name: 'Sofa', x: 200, y: 150, width: 200, depth: 90, height: 85, rotation: 0, color: '#e9a178' }],
};

describe('parseProject', () => {
  it('migrates Phase 1 saves', () => {
    const result = parseProject(phase1Save);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.schemaVersion).toBe(5);
    expect(result.project.furniture[0]).toMatchObject({ kind: 'sofa', locked: false, preferences: [] });
    expect(result.project.relationships).toEqual([]);
    expect(result.project.furniture[0]).toMatchObject({ name: 'Sofa', category: 'furniture', texture: 'plain' });
    expect(result.project.features).toEqual([]);
    expect(result.project.room.floor.preset).toBe('plain');
  });

  it('round-trips an exported project', () => {
    const project = createSampleProject();
    const result = parseProjectFile(serializeProject(project));
    expect(result).toEqual({ ok: true, project });
  });

  it.each([
    ['not JSON', '{oops'],
    ['an array', '[]'],
    ['null', 'null'],
    ['a number', '42'],
    ['missing room', JSON.stringify({ ...phase1Save, room: undefined })],
    ['negative width', JSON.stringify({ ...phase1Save, room: { width: -4, length: 3, height: 2 } })],
    ['furniture not a list', JSON.stringify({ ...phase1Save, furniture: 'lots' })],
    ['bad furniture size', JSON.stringify({ ...phase1Save, furniture: [{ ...phase1Save.furniture[0], width: 'big' }] })],
    ['furniture bigger than the room', JSON.stringify({ ...phase1Save, furniture: [{ ...phase1Save.furniture[0], width: 9000 }] })],
    ['unknown feature type', JSON.stringify({ ...phase1Save, schemaVersion: 2, features: [{ kind: 'trapdoor' }] })],
  ])('rejects %s with a message instead of crashing', (_label, text) => {
    const result = parseProjectFile(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(5);
  });

  it('rejects files from a newer version politely', () => {
    const result = parseProject({ ...phase1Save, schemaVersion: 99 });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/newer version/) });
  });

  it('repairs small problems instead of rejecting', () => {
    const result = parseProject({
      ...phase1Save,
      furniture: [
        { ...phase1Save.furniture[0], x: 9999, color: 'url(javascript:alert(1))' },
        { ...phase1Save.furniture[0] }, // duplicate id
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [first, second] = result.project.furniture;
    expect(first.x).toBe(300); // pulled back inside the room
    expect(first.color).toMatch(/^#/); // unsafe colour replaced
    expect(second.id).not.toBe(first.id);
  });

  it('rejects doors that overlap on the same wall', () => {
    const door = { kind: 'door', name: 'Door', placement: { type: 'wall', wall: 'top', offset: 100 }, width: 80, depth: 0, height: 200, elevation: 0, clearance: 50 };
    const result = parseProject({ ...phase1Save, schemaVersion: 2, features: [door, { ...door, placement: { ...door.placement, offset: 120 } }] });
    expect(result.ok).toBe(false);
  });
});

describe('schema migration and round-trips', () => {
  it('converts Phase 2 named-wall placements to wall ids at the same positions', () => {
    const phase2 = {
      ...phase1Save,
      schemaVersion: 2,
      features: [
        { kind: 'door', name: 'Door', placement: { type: 'wall', wall: 'left', offset: 320 }, width: 80, depth: 0, height: 200, elevation: 0, clearance: 50 },
        { kind: 'window', name: 'Window', placement: { type: 'wall', wall: 'bottom', offset: 100 }, width: 80, depth: 0, height: 100, elevation: 90, clearance: 0 },
      ],
    };
    const result = parseProject(phase2);
    if (!result.ok) throw new Error(result.error);
    const [door, window] = result.project.features;
    // Room is 400 × 300: left wall runs upwards from (0,300), so y = 320 would be off the wall
    // — it is clamped onto the 300 cm wall, and the bottom wall runs right-to-left.
    expect(door.placement).toMatchObject({ wallId: 'wall-left' });
    expect(featureFrame(window, result.project.room)).toMatchObject({ x: 100, y: 300, angle: 180 });
  });

  it('round-trips articulated walls, interior walls and stairs', () => {
    const project = createSampleProject();
    project.room.outline[1] = { ...project.room.outline[1], x: 520 };
    project.room.partitions = [{ id: 'p', nodes: [{ id: 'p1', x: 100, y: 100, thickness: 10 }, { id: 'p2', x: 100, y: 200, thickness: 10 }] }];
    project.stairs = [createStaircase('U', { x: 300, y: 150 })];
    const result = parseProjectFile(serializeProject(project));
    if (!result.ok) throw new Error(result.error);
    expect(result.project.room).toEqual(project.room);
    expect(result.project.stairs).toEqual(project.stairs);
  });

  it('rejects files whose walls cross or reference missing walls', () => {
    const project = createSampleProject();
    const bowTie = { ...project, room: { ...project.room, outline: [project.room.outline[0], project.room.outline[2], project.room.outline[1], project.room.outline[3]] } };
    expect(parseProjectFile(serializeProject(bowTie))).toMatchObject({ ok: false, error: expect.stringMatching(/cross/) });
    const orphan = { ...project, features: [{ ...project.features[0], placement: { type: 'wall', wallId: 'nope', offset: 10 } }] };
    expect(parseProjectFile(serializeProject(orphan as never))).toMatchObject({ ok: false, error: expect.stringMatching(/doesn’t exist/) });
  });
});

describe('older saves', () => {
  it('still loads a tiny 60 × 60 cm Phase 1 room', () => {
    expect(parseProject({ ...phase1Save, room: { width: 60, length: 60, height: 250 }, furniture: [] }).ok).toBe(true);
  });

  it('never lets an item reuse a legacy wall id', () => {
    const result = parseProject({ ...phase1Save, furniture: [{ ...phase1Save.furniture[0], id: 'wall-top' }] });
    if (!result.ok) throw new Error(result.error);
    expect(result.project.furniture[0].id).not.toBe('wall-top');
  });

  it('refuses a door wider than every wall instead of leaving it floating', () => {
    const door = { kind: 'door', name: 'Barn door', placement: { type: 'free', x: 100, y: 100, rotation: 0 }, width: 900, depth: 0, height: 200, elevation: 0, clearance: 0 };
    expect(parseProject({ ...phase1Save, schemaVersion: 2, features: [door] })).toMatchObject({ ok: false, error: expect.stringMatching(/long enough/) });
  });
});

describe('saved layouts in files', () => {
  it('gives duplicate layout ids fresh ones', () => {
    const project = createSampleProject();
    const positions = [{ id: project.furniture[1].id, x: 100, y: 100, rotation: 0 }];
    const file = serializeProject({ ...project, savedLayouts: [{ id: 'same', name: 'A', createdAt: 1, positions }, { id: 'same', name: 'B', createdAt: 2, positions }] });
    const result = parseProjectFile(file);
    if (!result.ok) throw new Error(result.error);
    expect(new Set(result.project.savedLayouts.map((l) => l.id)).size).toBe(2);
  });
});

describe('3D fields (schema 5)', () => {
  it('gives version 4 rooms the default wall colour without changing any dimension', () => {
    const project = createSampleProject();
    const { wallColor: _omitted, ...v4Room } = project.room;
    const result = parseProject({ ...project, schemaVersion: 4, room: v4Room });
    if (!result.ok) throw new Error(result.error);
    expect(result.project.room.wallColor).toBe(DEFAULT_WALL_COLOR);
    expect(result.project.room.outline).toEqual(project.room.outline);
    expect(result.project.room.height).toBe(project.room.height);
  });

  it('defaults a missing ceiling height to 240 cm', () => {
    const project = createSampleProject();
    const { height: _omitted, ...room } = project.room;
    const result = parseProject({ ...project, room });
    if (!result.ok) throw new Error(result.error);
    expect(result.project.room.height).toBe(240);
  });

  it('keeps a chosen wall colour and replaces an unsafe one', () => {
    const project = createSampleProject();
    const kept = parseProjectFile(serializeProject({ ...project, room: { ...project.room, wallColor: '#336699' } }));
    const unsafe = parseProject({ ...project, room: { ...project.room, wallColor: 'url(javascript:x)' } });
    expect(kept.ok && kept.project.room.wallColor).toBe('#336699');
    expect(unsafe.ok && unsafe.project.room.wallColor).toBe(DEFAULT_WALL_COLOR);
    // Only #rrggbb works in the colour picker and the 3D view.
    const translucent = parseProject({ ...project, room: { ...project.room, wallColor: '#336699cc' } });
    expect(translucent.ok && translucent.project.room.wallColor).toBe(DEFAULT_WALL_COLOR);
  });
});
