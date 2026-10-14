import { CanvasTexture, Color, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import type { SurfaceFinish } from '../../model/types';
import { SURFACES, roughnessFor, surfaceTile, type SurfaceKind } from '../../render/materials';

/**
 * Three.js versions of the shared surface materials (render/materials). Detail textures
 * are the same pale tiles the 2D presentation plan uses, tinted by each part's colour.
 *
 * Geometry UVs are in metres, and each texture repeats at its real-world tile size, so
 * fabric weave and wood grain are the same scale on every piece.
 */

export type MaterialQuality = 'low' | 'medium' | 'high';

/** Creates and caches materials and detail textures; dispose() frees them all. */
export class FurnitureMaterials {
  private readonly textures = new Map<SurfaceKind, Texture | null>();
  private readonly materials = new Map<string, MeshStandardMaterial>();

  constructor(private quality: MaterialQuality = 'medium') {}

  /** Changes quality (low drops detail textures); existing materials are rebuilt on next use. */
  setQuality(quality: MaterialQuality) {
    if (quality === this.quality) return;
    this.quality = quality;
    this.dispose();
  }

  /**
   * A shared material for a surface and finish. White unless `color` is given: batched
   * meshes supply each part's colour per instance.
   */
  get(kind: SurfaceKind, finish: SurfaceFinish, color = '#ffffff'): MeshStandardMaterial {
    const key = `${kind}|${finish}|${color}`;
    const hit = this.materials.get(key);
    if (hit) return hit;
    const material = this.create(kind, finish, color);
    this.materials.set(key, material);
    return material;
  }

  /** A material owned by the caller (e.g. one holding a photo); not cached here. */
  create(kind: SurfaceKind, finish: SurfaceFinish, color = '#ffffff'): MeshStandardMaterial {
    const preset = SURFACES[kind];
    const material = new MeshStandardMaterial({
      color,
      roughness: roughnessFor(kind, finish),
      metalness: preset.metalness,
      map: this.texture(kind),
    });
    if (preset.opacity !== undefined) {
      material.transparent = true;
      material.opacity = preset.opacity;
      material.depthWrite = false;
    }
    if (preset.emissive) {
      // A lit shade: a soft warm glow, not a light source.
      material.emissive = new Color('#ffdca8');
      material.emissiveIntensity = 0.45;
    }
    return material;
  }

  private texture(kind: SurfaceKind): Texture | null {
    if (this.quality === 'low') return null;
    if (this.textures.has(kind)) return this.textures.get(kind)!;
    const tile = surfaceTile(kind);
    let texture: Texture | null = null;
    if (tile) {
      texture = new CanvasTexture(tile);
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.colorSpace = SRGBColorSpace;
      const perMetre = 100 / SURFACES[kind].tileCm;
      texture.repeat.set(perMetre, perMetre);
      texture.anisotropy = this.quality === 'high' ? 8 : 4;
    }
    this.textures.set(kind, texture);
    return texture;
  }

  dispose() {
    for (const material of this.materials.values()) material.dispose();
    for (const texture of this.textures.values()) texture?.dispose();
    this.materials.clear();
    this.textures.clear();
  }
}
