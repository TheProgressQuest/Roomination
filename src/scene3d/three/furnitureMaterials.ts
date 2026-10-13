import { CanvasTexture, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { seededRandom } from '../../model/random';
import type { MaterialKind, SurfaceFinish } from '../../model/types';

/**
 * Furniture materials, generated locally on a canvas (no texture downloads). Each detail
 * texture is a pale greyscale pattern that the piece's own colour tints, so a "wood"
 * sofa leg or a "fabric" cushion keeps the colour the person chose.
 */

interface MaterialPreset {
  roughness: number;
  metalness: number;
  /** Pattern drawn on the detail texture, or null for a plain surface. */
  pattern: ((ctx: CanvasRenderingContext2D, size: number) => void) | null;
  /** Real-world size of one texture tile, in metres. */
  tile: number;
  opacity?: number;
}

const TILE_PX = 256;

const PRESETS: Record<MaterialKind, MaterialPreset> = {
  fabric: { roughness: 0.95, metalness: 0, tile: 0.08, pattern: weave },
  leather: { roughness: 0.55, metalness: 0, tile: 0.25, pattern: grain },
  wood: { roughness: 0.6, metalness: 0, tile: 0.6, pattern: woodGrain },
  metal: { roughness: 0.35, metalness: 0.85, tile: 0.4, pattern: brushed },
  glass: { roughness: 0.08, metalness: 0, tile: 1, pattern: null, opacity: 0.45 },
  plastic: { roughness: 0.4, metalness: 0, tile: 1, pattern: null },
  custom: { roughness: 0.8, metalness: 0, tile: 1, pattern: null },
};

/** Finish shifts the roughness: matte is duller, gloss is shinier. */
const FINISH_ROUGHNESS: Record<SurfaceFinish, number> = { matte: 0.15, satin: 0, gloss: -0.3 };

export const DEFAULT_ROUGHNESS = 0.8;

/** Creates and caches materials and detail textures; dispose() frees them all. */
export class FurnitureMaterials {
  private readonly textures = new Map<MaterialKind, Texture>();
  private readonly materials = new Map<string, MeshStandardMaterial>();

  /**
   * A shared material for a kind and finish. `tinted` materials are white (each instance or
   * mesh supplies its colour); otherwise the given colour is used.
   */
  get(kind: MaterialKind | null, finish: SurfaceFinish, color = '#ffffff'): MeshStandardMaterial {
    const key = `${kind ?? 'default'}|${finish}|${color}`;
    const hit = this.materials.get(key);
    if (hit) return hit;
    const material = this.create(kind, finish, color);
    this.materials.set(key, material);
    return material;
  }

  /** A material owned by the caller (e.g. one holding a photo); not cached here. */
  create(kind: MaterialKind | null, finish: SurfaceFinish, color = '#ffffff'): MeshStandardMaterial {
    if (!kind) return new MeshStandardMaterial({ color, roughness: DEFAULT_ROUGHNESS });
    const preset = PRESETS[kind];
    const material = new MeshStandardMaterial({
      color,
      roughness: Math.min(1, Math.max(0.02, preset.roughness + FINISH_ROUGHNESS[finish])),
      metalness: preset.metalness,
      map: preset.pattern ? this.texture(kind) : null,
    });
    if (preset.opacity !== undefined) {
      material.transparent = true;
      material.opacity = preset.opacity;
      material.depthWrite = false;
    }
    return material;
  }

  /** How many times a material's tile repeats across a surface `metres` long. */
  repeatsFor(kind: MaterialKind | null, metres: number): number {
    return kind ? Math.max(1, metres / PRESETS[kind].tile) : 1;
  }

  private texture(kind: MaterialKind): Texture {
    const hit = this.textures.get(kind);
    if (hit) return hit;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TILE_PX;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
    PRESETS[kind].pattern?.(ctx, TILE_PX);
    const texture = new CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.colorSpace = SRGBColorSpace;
    this.textures.set(kind, texture);
    return texture;
  }

  dispose() {
    for (const material of this.materials.values()) material.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    this.materials.clear();
    this.textures.clear();
  }
}

// ---------------------------------------------------------------------------
// Patterns (deterministic, so a material always looks the same)
// ---------------------------------------------------------------------------

function weave(ctx: CanvasRenderingContext2D, size: number) {
  const step = size / 32;
  for (let i = 0; i < 32; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(0,0,0,0.07)' : 'rgba(0,0,0,0.03)';
    ctx.fillRect(i * step, 0, step / 2, size);
    ctx.fillRect(0, i * step, size, step / 2);
  }
}

function grain(ctx: CanvasRenderingContext2D, size: number) {
  const random = seededRandom(7);
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + random() * 0.06})`;
    ctx.beginPath();
    ctx.arc(random() * size, random() * size, 0.6 + random() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function woodGrain(ctx: CanvasRenderingContext2D, size: number) {
  const random = seededRandom(3);
  for (let i = 0; i < 26; i++) {
    const y = random() * size;
    ctx.strokeStyle = `rgba(60,30,0,${0.06 + random() * 0.12})`;
    ctx.lineWidth = 1 + random() * 3;
    ctx.beginPath();
    for (let x = 0; x <= size; x += 8) ctx.lineTo(x, y + Math.sin((x / size) * Math.PI * 2 + i) * 4);
    ctx.stroke();
  }
}

function brushed(ctx: CanvasRenderingContext2D, size: number) {
  const random = seededRandom(5);
  for (let y = 0; y < size; y++) {
    ctx.fillStyle = `rgba(0,0,0,${random() * 0.08})`;
    ctx.fillRect(0, y, size, 1);
  }
}
