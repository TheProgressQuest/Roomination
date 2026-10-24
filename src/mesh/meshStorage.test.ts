import 'fake-indexeddb/auto';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { resized } from '../components/ObjectEditor';
import { createEmptyProject, createFurniture, createRectangularRoom } from '../model/sample';
import type { MeshModel, Project } from '../model/types';
import { existingAssetIds, getAsset, putAsset, sha256Hex, sniffAssetType, unusedAssets } from '../storage/assets';
import { db } from '../storage/db';
import { saveToLibrary, toTemplate, listLibraryRecords } from '../storage/library';
import { furnitureAssetIds, parseProjectFile, serializeProject } from '../storage/projectFile';
import { exportProjectFile, importProjectFile } from '../storage/projectPackage';
import { syntheticGlb, syntheticGltfFiles } from './synthetic';

const decodes = async () => true;
const glbBlob = (glb = syntheticGlb()) => new Blob([new Uint8Array(glb)], { type: 'model/gltf-binary' });

async function radioProject(): Promise<{ project: Project; mesh: MeshModel }> {
  const assetId = await putAsset(glbBlob(), { width: 0, height: 0 });
  const mesh: MeshModel = { assetId, triangles: 12, turn: { x: 90, y: 30, z: 0 }, natural: { width: 30, depth: 19, height: 35 }, source: 'radio.glb' };
  const radio = createFurniture({ id: 'radio', name: 'Radio', x: 100, y: 50, width: 30, depth: 19, height: 35, category: 'decoration', mesh });
  return { project: { ...createEmptyProject(createRectangularRoom(300, 300)), furniture: [radio] }, mesh };
}

describe('storing imported models', () => {
  it('keeps GLB models next to photos, and refuses other files', async () => {
    expect(sniffAssetType(syntheticGlb())).toBe('model/gltf-binary');
    expect(sniffAssetType(syntheticGltfFiles().gltf)).toBeNull();
    const id = await putAsset(glbBlob(), { width: 0, height: 0 });
    expect((await getAsset(id))?.type).toBe('model/gltf-binary');
    await expect(putAsset(new Blob([new Uint8Array(syntheticGltfFiles().gltf)]), { width: 0, height: 0 })).rejects.toThrow(/GLB/);
  });

  it('saves a piece’s model with the project, and drops a damaged one', async () => {
    const { project, mesh } = await radioProject();
    const result = parseProjectFile(serializeProject(project));
    if (!result.ok) throw new Error(result.error);
    expect(result.project.furniture[0].mesh).toEqual(mesh);
    // The measurements stay the piece's own.
    expect(result.project.furniture[0]).toMatchObject({ width: 30, depth: 19, height: 35 });
    const damaged = { ...project, furniture: [{ ...project.furniture[0], mesh: { ...mesh, assetId: 'not-a-hash' } }] };
    const again = parseProjectFile(serializeProject(damaged));
    if (!again.ok) throw new Error(again.error);
    expect(again.project.furniture[0].mesh).toBeUndefined();
  });

  it('counts the model as in use (never cleaned up), including from My Library', async () => {
    await db.projects.clear();
    await db.library.clear();
    const { project, mesh } = await radioProject();
    expect(furnitureAssetIds(project.furniture[0])).toContain(mesh.assetId);
    await saveToLibrary(toTemplate(project.furniture[0]));
    expect((await listLibraryRecords())[0].template.mesh).toEqual(mesh);
    expect((await unusedAssets()).map((a) => a.id)).not.toContain(mesh.assetId);
  });
});

describe('exporting and importing projects with models', () => {
  it('packs the model into the ZIP and restores it on another device', async () => {
    const { project, mesh } = await radioProject();
    const file = await exportProjectFile(project);
    const names = Object.keys(unzipSync(new Uint8Array(await file.blob.arrayBuffer())));
    expect(names).toContain(`assets/${mesh.assetId}.glb`);
    await db.assets.clear();
    const result = await importProjectFile(file.blob, decodes);
    if (!result.ok) throw new Error(result.error);
    expect(result.warnings).toEqual([]);
    expect(result.project.furniture[0].mesh).toEqual(mesh);
    expect(await existingAssetIds([mesh.assetId])).toEqual(new Set([mesh.assetId]));
  });

  it('refuses a model in a package that refers outside itself; the piece keeps its ordinary look', async () => {
    const { project } = await radioProject();
    // A GLB whose texture points at a web address.
    const glb = syntheticGlb();
    const text = new TextDecoder().decode(glb);
    const evil = strToU8(text.replace('"images":[{"bufferView":4,"mimeType":"image/png"}]', '"images":[{"uri":"https://tracker.example/p.png"}]'.padEnd('"images":[{"bufferView":4,"mimeType":"image/png"}]'.length)));
    expect(new TextDecoder().decode(evil)).toContain('tracker.example');
    const id = await sha256Hex(evil.buffer as ArrayBuffer);
    const json = serializeProject({ ...project, furniture: [{ ...project.furniture[0], mesh: { ...project.furniture[0].mesh!, assetId: id } }] });
    await db.assets.clear();
    const result = await importProjectFile(new Blob([zipSync({ 'project.json': strToU8(json), [`assets/${id}.glb`]: evil })]), decodes);
    if (!result.ok) throw new Error(result.error);
    expect(result.warnings.join(' ')).toMatch(/skipped/);
    expect(result.project.furniture[0].mesh).toBeUndefined();
    expect(await existingAssetIds([id])).toEqual(new Set());
  });
});

describe('resizing a piece with a model', () => {
  const mesh: MeshModel = { assetId: 'a'.repeat(64), triangles: 12, turn: { x: 0, y: 0, z: 0 }, natural: { width: 30, depth: 20, height: 40 } };
  it('keeps its proportions by default', () => {
    expect(resized({ width: 30, depth: 20, height: 40, mesh }, 'height', 20)).toEqual({ width: 15, depth: 10, height: 20 });
  });
  it('changes one dimension when proportions are unlocked, or there is no model', () => {
    expect(resized({ width: 30, depth: 20, height: 40, mesh: { ...mesh, lockAspect: false } }, 'height', 20)).toEqual({ height: 20 });
    expect(resized({ width: 30, depth: 20, height: 40 }, 'width', 50)).toEqual({ width: 50 });
  });
});
