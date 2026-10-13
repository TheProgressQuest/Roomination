import type { FloorPreset, FloorStyle, FurnitureTexture } from '../model/types';
import { seededRandom } from '../model/random';
import { shade } from './palette';

/**
 * Procedural textures, generated locally on an off-screen canvas (no downloads).
 *
 * Each texture is a seamlessly repeating tile drawn in real-world centimetres at
 * PX_PER_CM resolution. The floor plan scales the tile by (screen px per cm ÷
 * PX_PER_CM) and anchors it at the room's corner, so patterns stay locked to the
 * room's coordinates however the view is zoomed or resized.
 */

export const PX_PER_CM = 2;

export interface TextureTile {
  image: HTMLCanvasElement;
  /** Tile size in cm. */
  widthCm: number;
  heightCm: number;
}

/** Default colour for each floor preset; users can change it afterwards. */
export const FLOOR_PRESET_COLORS: Record<FloorPreset, string> = {
  plain: '#fffaf2',
  hardwood: '#b98352',
  lightOak: '#e2c79f',
  darkWalnut: '#6b4a36',
  tile: '#eeeae3',
  concrete: '#bdbab4',
  carpet: '#b3aaa0',
};

export const FLOOR_PRESET_LABELS: Record<FloorPreset, string> = {
  plain: 'Plain',
  hardwood: 'Hardwood',
  lightOak: 'Light oak',
  darkWalnut: 'Dark walnut',
  tile: 'Ceramic tile',
  concrete: 'Concrete',
  carpet: 'Carpet',
};

const cache = new Map<string, TextureTile>();
const CACHE_LIMIT = 40;

function cached(key: string, make: () => TextureTile): TextureTile {
  const hit = cache.get(key);
  if (hit) return hit;
  const tile = make();
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, tile);
  return tile;
}

/** Floor texture for a style, or null for a plain floor. */
export function floorTexture(style: FloorStyle): TextureTile | null {
  if (style.preset === 'plain') return null;
  const preset: Exclude<FloorPreset, 'plain'> = style.preset;
  const key = `floor:${preset}:${style.color}:${style.scale}:${style.intensity}`;
  return cached(key, () => {
    switch (preset) {
      case 'hardwood':
      case 'lightOak':
      case 'darkWalnut':
        return planks(style.color, style.scale, style.intensity, preset === 'darkWalnut' ? 7 : 3);
      case 'tile':
        return tiles(style.color, style.scale, style.intensity);
      case 'concrete':
        return concrete(style.color, style.scale, style.intensity);
      case 'carpet':
        return carpet(style.color, style.scale, style.intensity);
    }
  });
}

/** Rug / mat surface pattern, or null for plain. ('bordered' is drawn as a shape, not a tile.) */
export function rugTexture(texture: FurnitureTexture, color: string): TextureTile | null {
  if (texture === 'plain' || texture === 'bordered') return null;
  const pattern: 'striped' | 'checked' | 'woven' = texture;
  return cached(`rug:${pattern}:${color}`, () => {
    switch (pattern) {
      case 'striped':
        return draw(20, 20, (ctx) => {
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 20, 20);
          ctx.fillStyle = shade(color, -0.18);
          ctx.fillRect(0, 0, 20, 6);
        });
      case 'checked':
        return draw(30, 30, (ctx) => {
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 30, 30);
          ctx.fillStyle = shade(color, -0.14);
          ctx.fillRect(0, 0, 15, 15);
          ctx.fillRect(15, 15, 15, 15);
        });
      case 'woven':
        return draw(8, 8, (ctx) => {
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 8, 8);
          ctx.fillStyle = shade(color, -0.12);
          ctx.fillRect(0, 0, 4, 2);
          ctx.fillRect(4, 4, 4, 2);
          ctx.fillRect(2, 2, 2, 4);
          ctx.fillRect(6, 6, 2, 2);
          ctx.fillRect(6, 0, 2, 2);
        });
    }
  });
}

// ---------------------------------------------------------------------------
// Generators (all coordinates in cm; `draw` handles the pixel scaling)
// ---------------------------------------------------------------------------

function draw(widthCm: number, heightCm: number, paint: (ctx: CanvasRenderingContext2D) => void): TextureTile {
  const image = document.createElement('canvas');
  image.width = Math.max(1, Math.round(widthCm * PX_PER_CM));
  image.height = Math.max(1, Math.round(heightCm * PX_PER_CM));
  const ctx = image.getContext('2d')!;
  ctx.scale(image.width / widthCm, image.height / heightCm);
  paint(ctx);
  return { image, widthCm, heightCm };
}

/**
 * Calls `paint` at the 9 offsets around the tile so anything crossing an edge
 * reappears on the opposite edge — that's what makes the tile repeat seamlessly.
 */
function wrapped(w: number, h: number, paint: (dx: number, dy: number) => void) {
  for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) paint(dx, dy);
}

/** Parallel planks of varying length and tone, with subtle grain. */
function planks(color: string, scale: number, intensity: number, seed: number): TextureTile {
  const plankWidth = 15 * scale;
  const rows = 8;
  const length = 240 * scale;
  const height = plankWidth * rows;
  const random = seededRandom(seed);
  return draw(length, height, (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, length, height);
    for (let row = 0; row < rows; row++) {
      const y = row * plankWidth;
      // Board lengths of 60–150 cm (scaled), starting at a random point so seams stagger.
      let x = random() * length;
      const end = x + length;
      while (x < end) {
        const boardLength = Math.min((60 + random() * 90) * scale, end - x);
        const tone = shade(color, (random() - 0.5) * 0.16 * (0.5 + intensity));
        wrapped(length, height, (dx, dy) => {
          ctx.fillStyle = tone;
          ctx.fillRect(x + dx, y + dy, boardLength, plankWidth);
          // Grain: a few long, faint strokes along the board.
          ctx.strokeStyle = shade(color, -0.25);
          ctx.globalAlpha = 0.12 + 0.35 * intensity;
          ctx.lineWidth = 0.25 * scale;
          const grainRandom = seededRandom(Math.floor(x * 1000) + row);
          for (let g = 0; g < 3; g++) {
            const gy = y + dy + plankWidth * (0.2 + grainRandom() * 0.6);
            ctx.beginPath();
            ctx.moveTo(x + dx + 2, gy);
            ctx.bezierCurveTo(x + dx + boardLength * 0.3, gy + (grainRandom() - 0.5) * 2, x + dx + boardLength * 0.7, gy + (grainRandom() - 0.5) * 2, x + dx + boardLength - 2, gy);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          // Seam at the end of each board.
          ctx.fillStyle = shade(color, -0.35);
          ctx.fillRect(x + dx + boardLength - 0.3 * scale, y + dy, 0.3 * scale, plankWidth);
        });
        x += boardLength;
      }
      // Long joint between rows.
      ctx.fillStyle = shade(color, -0.3);
      ctx.fillRect(0, y, length, 0.3 * scale);
    }
  });
}

/** Square tiles with grout lines; a 2×2 block lets neighbouring tiles vary slightly. */
function tiles(color: string, scale: number, intensity: number): TextureTile {
  const size = 30 * scale;
  const grout = Math.max(0.4, 0.6 * scale);
  const random = seededRandom(11);
  return draw(size * 2, size * 2, (ctx) => {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = shade(color, (random() - 0.5) * 0.06 * (0.5 + intensity));
        ctx.fillRect(i * size, j * size, size, size);
      }
    }
    ctx.fillStyle = shade(color, -0.15 - 0.25 * intensity);
    // Grout centred on the tile edges; the halves at 0 and 2·size meet when repeated.
    for (const p of [0, size, size * 2]) {
      ctx.fillRect(p - grout / 2, 0, grout, size * 2);
      ctx.fillRect(0, p - grout / 2, size * 2, grout);
    }
  });
}

/** Mottled neutral surface with fine speckles. */
function concrete(color: string, scale: number, intensity: number): TextureTile {
  const size = 100 * scale;
  const random = seededRandom(5);
  return draw(size, size, (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 14; i++) {
      const x = random() * size;
      const y = random() * size;
      const r = (10 + random() * 25) * scale;
      const tone = shade(color, (random() - 0.5) * 0.2);
      wrapped(size, size, (dx, dy) => {
        const gradient = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        gradient.addColorStop(0, tone);
        gradient.addColorStop(1, `${tone}00`);
        ctx.globalAlpha = 0.25 + 0.5 * intensity;
        ctx.fillStyle = gradient;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      });
    }
    ctx.globalAlpha = 0.2 + 0.5 * intensity;
    for (let i = 0; i < 600; i++) {
      ctx.fillStyle = random() > 0.5 ? shade(color, -0.3) : shade(color, 0.3);
      ctx.fillRect(random() * size, random() * size, 0.4, 0.4);
    }
    ctx.globalAlpha = 1;
  });
}

/** Soft fabric: dense fibre speckle plus a faint woven diagonal. */
function carpet(color: string, scale: number, intensity: number): TextureTile {
  const size = 20 * scale;
  const random = seededRandom(9);
  return draw(size, size, (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 0.15 + 0.45 * intensity;
    const fibres = Math.round(500 * scale * scale);
    for (let i = 0; i < fibres; i++) {
      ctx.fillStyle = random() > 0.5 ? shade(color, -0.22) : shade(color, 0.18);
      ctx.fillRect(random() * size, random() * size, 0.5, 0.5);
    }
    ctx.globalAlpha = 0.08 + 0.15 * intensity;
    ctx.strokeStyle = shade(color, -0.3);
    ctx.lineWidth = 0.4;
    // Spacing divides the tile exactly so the diagonals line up across tile edges.
    const spacing = size / Math.max(1, Math.round(size / 2));
    for (let d = -size; d < size * 2; d += spacing) {
      ctx.beginPath();
      ctx.moveTo(d, 0);
      ctx.lineTo(d + size, size);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}
