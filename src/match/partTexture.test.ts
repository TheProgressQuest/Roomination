import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../catalogue/items';
import { createEmptyProject, createFurniture } from '../model/sample';
import { componentParts } from '../render/furnitureParts';
import { buildFurniture } from '../scene3d/model';
import { parseProjectFile, projectAssetIds, serializeProject } from '../storage/projectFile';
import { withAssets } from '../storage/projectPackage';

const A = 'a'.repeat(64);

describe('photo textures on single parts', () => {
  const vanity = () => createFurniture({ ...CATALOGUE.find((c) => c.id === 'vanity-drop-in')!.make(), x: 50, y: 30 });

  it('textures the worktop only; the vanity keeps every detailed part', () => {
    const piece = vanity();
    const textured = { ...piece, components: piece.components!.map((c) => (c.name === 'Worktop' ? { ...c, texture: { assetId: A, widthCm: 20, heightCm: 8, roughness: 0.4 } } : c)) };
    const parts = componentParts(textured.components!);
    expect(parts.filter((p) => p.photo)).toHaveLength(1);
    expect(parts.length).toBe(componentParts(piece.components!).length);
    // Not turned into a plain extruded block (that happens only for whole-piece photo textures).
    const [scene] = buildFurniture([textured]);
    expect(scene.extruded).toBeUndefined();
    expect(scene.parts.some((p) => p.photo?.assetId === A)).toBe(true);
  });

  it('saves, counts and remaps part textures; a missing photo just removes that texture', () => {
    const piece = vanity();
    const textured = { ...piece, components: piece.components!.map((c) => (c.name === 'Worktop' ? { ...c, texture: { assetId: A, widthCm: 20, heightCm: 8 } } : c)) };
    const project = { ...createEmptyProject(), furniture: [textured] };
    const again = parseProjectFile(serializeProject(project));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.project.furniture[0].components!.find((c) => c.name === 'Worktop')!.texture).toEqual({ assetId: A, widthCm: 20, heightCm: 8 });
    expect(projectAssetIds(again.project)).toEqual([A]);
    const dropped = withAssets(again.project, () => null);
    expect(dropped.furniture[0].components!.some((c) => c.texture)).toBe(false);
    expect(dropped.furniture[0].components!.length).toBe(piece.components!.length);
  });
});
