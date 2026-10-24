import { describe, expect, it } from 'vitest';
import { encodeSilhouette } from './photoModel';
import { createFurniture } from './sample';
import { availableLooks, shownLook, withShownLook } from './shownLook';
import { parseProjectFile, serializeProject } from '../storage/projectFile';
import { createEmptyProject, createRectangularRoom } from './sample';
import type { Furniture, MeshModel, PhotoModel } from './types';

const view = { assetId: 'a'.repeat(64), silhouette: encodeSilhouette(4, 4, () => true), color: '#806040' };
const rebuild: PhotoModel = { front: view };
const scan: MeshModel = { assetId: 'b'.repeat(64), triangles: 12, turn: { x: 0, y: 0, z: 0 }, natural: { width: 30, depth: 19, height: 35 } };
const piece = (extra: Partial<Furniture> = {}) => createFurniture({ x: 100, y: 100, width: 30, depth: 19, height: 35, ...extra });

describe('Shown in 3D', () => {
  it('offers only the looks a piece has', () => {
    expect(availableLooks(piece())).toEqual({ standard: true, rebuild: false, scan: false });
    expect(availableLooks(piece({ photoModel: rebuild, mesh: scan }))).toEqual({ standard: true, rebuild: true, scan: true });
    // A choice it doesn't have changes nothing.
    expect(withShownLook(piece(), 'scan')).toEqual({});
  });

  it('reads the same as the renderer: a shown scan first, then a rebuild, else the standard model', () => {
    expect(shownLook(piece())).toBe('standard');
    expect(shownLook(piece({ photoModel: rebuild }))).toBe('rebuild');
    expect(shownLook(piece({ photoModel: rebuild, mesh: scan }))).toBe('scan');
    expect(shownLook(piece({ photoModel: rebuild, mesh: { ...scan, off: true } }))).toBe('rebuild');
    expect(shownLook(piece({ photoModel: { ...rebuild, off: true }, mesh: { ...scan, off: true } }))).toBe('standard');
  });

  it('switches without removing anything, and round-trips through a saved project', () => {
    let item = piece({ photoModel: rebuild, mesh: scan });
    for (const look of ['standard', 'rebuild', 'scan', 'standard'] as const) {
      item = { ...item, ...withShownLook(item, look) };
      expect(shownLook(item)).toBe(look);
      // Both looks are still there.
      expect(item.photoModel?.front).toEqual(view);
      expect(item.mesh?.assetId).toBe(scan.assetId);
      const saved = parseProjectFile(serializeProject({ ...createEmptyProject(createRectangularRoom(300, 300)), furniture: [item] }));
      if (!saved.ok) throw new Error(saved.error);
      expect(shownLook(saved.project.furniture[0])).toBe(look);
    }
  });

  it('reads projects saved with the older switches the same way', () => {
    // "Show the 3D model" off and "Show the rebuilt look" on: the rebuild shows.
    expect(shownLook(piece({ photoModel: rebuild, mesh: { ...scan, off: true } }))).toBe('rebuild');
    // Both switches off: the standard model.
    expect(shownLook(piece({ photoModel: { ...rebuild, off: true }, mesh: { ...scan, off: true } }))).toBe('standard');
  });
});
