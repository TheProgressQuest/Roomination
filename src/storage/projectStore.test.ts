import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import { deleteProject, listProjects, loadProject, saveProject, uniqueProjectName } from './projectStore';

describe('projectStore', () => {
  it('round-trips a project through IndexedDB', async () => {
    const project = createSampleProject();
    await saveProject('one', project);
    expect(await loadProject('one')).toEqual(project);
  });

  it('keeps several projects and lists them', async () => {
    await saveProject('a', { ...createSampleProject(), name: 'Layout A' });
    await saveProject('b', { ...createSampleProject(), name: 'Layout B' });
    const names = (await listProjects()).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['Layout A', 'Layout B']));
    await deleteProject('a');
    expect((await listProjects()).map((p) => p.name)).not.toContain('Layout A');
  });

  it('loads a Phase 1 save stored under the old "current" id', async () => {
    const phase1 = {
      schemaVersion: 1,
      name: 'Old room',
      units: 'metric',
      room: { width: 400, length: 300, height: 250 },
      furniture: [],
    };
    // Write the raw old shape directly, as Phase 1 did.
    await saveProject('current', phase1 as never);
    const loaded = await loadProject('current');
    expect(loaded?.name).toBe('Old room');
    expect(loaded?.schemaVersion).toBe(5);
  });

  it('lists unreadable records instead of hiding them', async () => {
    await saveProject('broken', { nonsense: true } as never);
    const broken = (await listProjects()).find((p) => p.id === 'broken');
    expect(broken?.readable).toBe(false);
  });

  it('picks non-clashing names', () => {
    expect(uniqueProjectName('Studio', ['Studio', 'Studio (2)'])).toBe('Studio (3)');
    expect(uniqueProjectName('Den', ['Studio'])).toBe('Den');
  });
});
