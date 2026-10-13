import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
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
    expect(result.project.schemaVersion).toBe(2);
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
