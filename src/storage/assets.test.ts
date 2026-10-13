import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createFurniture, createSampleProject } from '../model/sample';
import { deleteAssets, existingAssetIds, putAsset, sniffImageType, StorageFullError, unusedAssets } from './assets';
import { db } from './db';
import { deleteLibraryItem, duplicateLibraryItem, furnitureOrigin, listLibraryRecords, saveToLibrary, toTemplate } from './library';
import { saveProject } from './projectStore';

/** A tiny valid-looking PNG (signature + padding); enough for storage, which never decodes. */
const png = (seed: number) => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed, 1, 2, 3])], { type: 'image/png' });
const size = { width: 10, height: 10 };

describe('photo storage', () => {
  it('recognises PNG, JPEG and WebP by their bytes, and nothing else', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(new TextEncoder().encode('<svg onload="alert(1)">'))).toBeNull();
  });

  it('stores identical photos once, under the hash of their bytes', async () => {
    const a = await putAsset(png(1), size);
    const b = await putAsset(png(1), size);
    const c = await putAsset(png(2), size);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(c).not.toBe(a);
    expect(await existingAssetIds([a, c, 'f'.repeat(64)])).toEqual(new Set([a, c]));
  });

  it('refuses anything that isn’t an image', async () => {
    await expect(putAsset(new Blob(['<svg/>'], { type: 'image/svg+xml' }), size)).rejects.toThrow(/PNG, JPEG and WebP/);
  });

  it('explains when browser storage is full', async () => {
    const spy = vi.spyOn(db.assets, 'put').mockRejectedValueOnce(Object.assign(new Error('full'), { name: 'QuotaExceededError' }));
    await expect(putAsset(png(9), size)).rejects.toBeInstanceOf(StorageFullError);
    spy.mockRestore();
  });

  it('only offers to remove photos nothing uses, and keeps them all if a project is unreadable', async () => {
    await db.projects.clear();
    await db.library.clear();
    await db.assets.clear();
    const used = await putAsset(png(3), size);
    const inLibrary = await putAsset(png(4), size);
    const unused = await putAsset(png(5), size);
    const project = createSampleProject();
    project.furniture[0] = { ...project.furniture[0], appearance: { material: 'fabric', finish: 'matte', textures: { top: used } } };
    await saveProject('p', project);
    await saveToLibrary(toTemplate(createFurniture({ x: 0, y: 0, appearance: { material: 'wood', finish: 'matte', photos: [inLibrary] } })));
    expect((await unusedAssets()).map((a) => a.id)).toEqual([unused]);
    await db.projects.put({ id: 'broken', savedAt: 1, project: { nonsense: true } });
    expect(await unusedAssets()).toEqual([]);
    await deleteAssets([unused]);
    expect(await existingAssetIds([used, unused])).toEqual(new Set([used]));
  });
});

describe('furniture library', () => {
  it('saves, lists, duplicates and deletes reusable pieces', async () => {
    await db.library.clear();
    const piece = createFurniture({ name: 'My loveseat', x: 10, y: 20, kind: 'sofa', width: 150, depth: 80 });
    const saved = await saveToLibrary(toTemplate(piece));
    expect(saved.template).not.toHaveProperty('x');
    const copy = await duplicateLibraryItem(saved, ['My loveseat']);
    expect(copy.template.name).toBe('My loveseat copy');
    expect((await listLibraryRecords()).map((i) => i.template.name).sort()).toEqual(['My loveseat', 'My loveseat copy']);
    await deleteLibraryItem(saved.id);
    expect((await listLibraryRecords()).map((i) => i.id)).toEqual([copy.id]);
  });

  it('skips damaged records instead of failing or deleting them', async () => {
    await db.library.put({ id: 'bad', savedAt: Date.now(), item: { width: -5 } });
    expect((await listLibraryRecords()).some((i) => i.id === 'bad')).toBe(false);
    expect(await db.library.get('bad')).toBeDefined();
  });

  it('tells standard, custom and photo-assisted pieces apart', () => {
    expect(furnitureOrigin({})).toBe('standard');
    expect(furnitureOrigin({ shape: { points: [] } })).toBe('custom');
    expect(furnitureOrigin({ shape: { points: [] }, appearance: { material: 'wood', finish: 'matte', photos: ['a'] } })).toBe('photo');
  });
});
