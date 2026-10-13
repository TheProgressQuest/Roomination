import 'fake-indexeddb/auto';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import type { Project } from '../model/types';
import { existingAssetIds, putAsset, sha256Hex } from './assets';
import { db } from './db';
import { exportProjectFile, importProjectFile } from './projectPackage';
import { serializeProject } from './projectFile';

const pngBytes = (seed: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed, 9, 9, 9]);
const decodes = async () => true;

async function withPhoto(seed = 1): Promise<{ project: Project; id: string }> {
  const id = await putAsset(new Blob([pngBytes(seed)], { type: 'image/png' }), { width: 4, height: 4 });
  const project = createSampleProject();
  project.furniture[0] = { ...project.furniture[0], appearance: { material: 'fabric', finish: 'matte', textures: { front: id }, photos: [id] } };
  return { project, id };
}

describe('exporting projects with photos', () => {
  it('exports projects without photos as plain JSON, as before', async () => {
    const file = await exportProjectFile(createSampleProject());
    expect(file.filename).toMatch(/\.roomination\.json$/);
    expect(JSON.parse(await file.blob.text()).project.name).toBe('Sample living room');
  });

  it('packs photos into a ZIP and restores them on import, references intact', async () => {
    const { project, id } = await withPhoto(1);
    const file = await exportProjectFile(project);
    expect(file.filename).toMatch(/\.roomination\.zip$/);
    const names = Object.keys(unzipSync(new Uint8Array(await file.blob.arrayBuffer())));
    expect(names.sort()).toEqual([`assets/${id}.png`, 'project.json']);
    // A fresh device: the photo isn't stored until the import brings it.
    await db.assets.clear();
    const result = await importProjectFile(file.blob, decodes);
    if (!result.ok) throw new Error(result.error);
    expect(result.warnings).toEqual([]);
    expect(result.project.furniture[0].appearance).toEqual(project.furniture[0].appearance);
    expect(await existingAssetIds([id])).toEqual(new Set([id]));
  });

  it('never exports a reference to a photo it doesn’t contain', async () => {
    const { project } = await withPhoto(2);
    project.furniture[1] = { ...project.furniture[1], appearance: { material: 'wood', finish: 'matte', textures: { top: 'c'.repeat(64) } } };
    const file = await exportProjectFile(project);
    expect(file.missing).toBe(1);
    const json = JSON.parse(new TextDecoder().decode(unzipSync(new Uint8Array(await file.blob.arrayBuffer()))['project.json']));
    expect(json.project.furniture[1].appearance).toEqual({ material: 'wood', finish: 'matte' });
  });
});

describe('importing untrusted files', () => {
  const zip = (files: Record<string, Uint8Array>) => new Blob([zipSync(files)]);

  it('ignores unexpected entries and refuses non-images such as SVG', async () => {
    const { project } = await withPhoto(3);
    await db.assets.clear();
    const svg = strToU8('<svg onload="alert(1)"/>');
    const fakeId = await sha256Hex(svg.buffer as ArrayBuffer);
    project.furniture[0] = { ...project.furniture[0], appearance: { material: 'fabric', finish: 'matte', textures: { top: fakeId } } };
    const result = await importProjectFile(
      zip({ 'project.json': strToU8(serializeProject(project)), [`assets/${fakeId}.png`]: svg, 'evil.js': strToU8('alert(1)'), '../escape.json': strToU8('{}') }),
      decodes,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.project.furniture[0].appearance?.textures).toBeUndefined();
    expect(result.warnings.join(' ')).toMatch(/skipped/);
    expect(await existingAssetIds([fakeId])).toEqual(new Set());
  });

  it('stores a photo under its real hash even if the file was renamed', async () => {
    const { project, id } = await withPhoto(4);
    await db.assets.clear();
    const wrongName = 'd'.repeat(64);
    project.furniture[0] = { ...project.furniture[0], appearance: { material: 'fabric', finish: 'matte', textures: { front: wrongName } } };
    const result = await importProjectFile(zip({ 'project.json': strToU8(serializeProject(project)), [`assets/${wrongName}.png`]: pngBytes(4) }), decodes);
    if (!result.ok) throw new Error(result.error);
    expect(result.project.furniture[0].appearance?.textures?.front).toBe(id);
  });

  it('refuses images that don’t decode, and damaged or empty ZIPs', async () => {
    const { project, id } = await withPhoto(5);
    await db.assets.clear();
    const result = await importProjectFile(zip({ 'project.json': strToU8(serializeProject(project)), [`assets/${id}.png`]: pngBytes(5) }), async () => false);
    if (!result.ok) throw new Error(result.error);
    expect(result.project.furniture[0].appearance?.photos).toBeUndefined();
    expect(await importProjectFile(zip({ 'readme.txt': strToU8('hi') }), decodes)).toMatchObject({ ok: false, error: expect.stringMatching(/doesn’t contain/) });
    expect(await importProjectFile(new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])]), decodes)).toMatchObject({ ok: false, error: expect.stringMatching(/damaged/) });
  });

  it('drops references to photos a JSON file can’t bring with it', async () => {
    const { project } = await withPhoto(6);
    await db.assets.clear();
    const result = await importProjectFile(new Blob([serializeProject(project)]), decodes);
    if (!result.ok) throw new Error(result.error);
    expect(result.project.furniture[0].appearance).toEqual({ material: 'fabric', finish: 'matte' });
  });
});
