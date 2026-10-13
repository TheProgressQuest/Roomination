import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import { loadCurrentProject, parseProject, saveCurrentProject } from './projectStore';

describe('projectStore', () => {
  it('round-trips a project through IndexedDB', async () => {
    const project = createSampleProject();
    await saveCurrentProject(project);
    expect(await loadCurrentProject()).toEqual(project);
  });

  it('rejects malformed data instead of trusting it', () => {
    const valid = createSampleProject();
    expect(parseProject(valid)).toEqual(valid);
    expect(parseProject(null)).toBeNull();
    expect(parseProject({ ...valid, schemaVersion: 2 })).toBeNull();
    expect(parseProject({ ...valid, room: { ...valid.room, width: -1 } })).toBeNull();
    expect(parseProject({ ...valid, furniture: [{ ...valid.furniture[0], width: 'big' }] })).toBeNull();
  });
});
