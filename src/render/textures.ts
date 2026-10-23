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

/** The resolution new tiles are drawn at: PX_PER_CM normally, higher while exporting images. */
let resolution = PX_PER_CM;

/** Sets the tile resolution (pixels per cm). Exports raise it so floors stay crisp at 4K. */
export function setTextureResolution(pxPerCm: number) {
  resolution = pxPerCm;
}

/** Frees tiles drawn at other resolutions than the current one (e.g. after an export). */
export function forgetOtherResolutions() {
  for (const key of [...cache.keys()]) if (!key.endsWith(`@${resolution}`)) cache.delete(key);
}

/** How much to scale a tile's pattern to draw it at `screenPxPerCm`. */
export function patternScale(tile: TextureTile, screenPxPerCm: number): number {
  return (screenPxPerCm * tile.widthCm) / tile.image.width;
}

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

function cached(baseKey: string, make: () => TextureTile): TextureTile {
  const key = `${baseKey}@${resolution}`;
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
  image.width = Math.max(1, Math.round(widthCm * resolution));
  image.height = Math.max(1, Math.round(heightCm * resolution));
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

/**
 * Parallel engineered-wood planks: long, wide boards with gentle tonal variation, fine
 * grain, a soft sheen along each board and faint seams (like a well-laid oak floor).
 */
function planks(color: string, scale: number, intensity: number, seed: number): TextureTile {
  const plankWidth = 18 * scale;
  const rows = 8;
  const length = 360 * scale;
  const height = plankWidth * rows;
  const random = seededRandom(seed);
  return draw(length, height, (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, length, height);
    for (let row = 0; row < rows; row++) {
      const y = row * plankWidth;
      // Board lengths of 90–200 cm (scaled), starting at a random point so seams stagger.
      let x = random() * length;
      const end = x + length;
      while (x < end) {
        const boardLength = Math.min((90 + random() * 110) * scale, end - x);
        const tone = shade(color, (random() - 0.5) * 0.11 * (0.5 + intensity));
        const grainRandom = seededRandom(Math.floor(x * 1000) + row * 7919 + seed);
        const grains = Array.from({ length: 7 }, () => ({ at: 0.1 + grainRandom() * 0.8, wobble: (grainRandom() - 0.5) * 1.6, dark: grainRandom() > 0.35 }));
        const sheenAt = 0.25 + grainRandom() * 0.5;
        wrapped(length, height, (dx, dy) => {
          const x0 = x + dx;
          const y0 = y + dy;
          ctx.fillStyle = tone;
          ctx.fillRect(x0, y0, boardLength, plankWidth);
          // A soft lighter streak along the board (figure in the wood).
          const sheen = ctx.createLinearGradient(0, y0, 0, y0 + plankWidth);
          sheen.addColorStop(0, 'rgba(255,255,255,0)');
          sheen.addColorStop(sheenAt, `rgba(255,255,255,${0.05 + 0.06 * intensity})`);
          sheen.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = sheen;
          ctx.fillRect(x0, y0, boardLength, plankWidth);
          // Fine grain: long, faint strokes along the board.
          ctx.lineWidth = 0.18 * scale;
          for (const g of grains) {
            ctx.strokeStyle = g.dark ? shade(color, -0.22) : shade(color, 0.12);
            ctx.globalAlpha = (g.dark ? 0.1 : 0.08) + 0.22 * intensity;
            const gy = y0 + plankWidth * g.at;
            ctx.beginPath();
            ctx.moveTo(x0 + 1, gy);
            ctx.bezierCurveTo(x0 + boardLength * 0.33, gy + g.wobble, x0 + boardLength * 0.66, gy - g.wobble, x0 + boardLength - 1, gy + g.wobble * 0.3);
            ctx.stroke();
          }
          ctx.globalAlpha = 0.55;
          // A faint seam at the end of each board.
          ctx.fillStyle = shade(color, -0.2);
          ctx.fillRect(x0 + boardLength - 0.25 * scale, y0, 0.25 * scale, plankWidth);
          ctx.globalAlpha = 1;
        });
        x += boardLength;
      }
      // Long joint between rows: thin and only slightly darker.
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = shade(color, -0.18);
      ctx.fillRect(0, y, length, 0.25 * scale);
      ctx.globalAlpha = 1;
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
        // Faint glaze variation inside each tile, and a soft highlight from the upper left.
        for (let k = 0; k < 3; k++) {
          const cx = i * size + random() * size;
          const cy = j * size + random() * size;
          const r = size * (0.2 + random() * 0.3);
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, `rgba(255,255,255,${0.04 + 0.05 * intensity})`);
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.save();
          ctx.beginPath();
          ctx.rect(i * size, j * size, size, size);
          ctx.clip();
          ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
          ctx.restore();
        }
      }
    }
    // Fine stone mottle (slate, porcelain), barely there on pale tiles.
    for (let k = 0; k < 700; k++) {
      ctx.fillStyle = random() < 0.5 ? `rgba(255,255,255,${0.02 + 0.03 * intensity})` : `rgba(0,0,0,${0.03 + 0.04 * intensity})`;
      const r = 0.3 + random() * 1.4;
      ctx.fillRect(random() * size * 2, random() * size * 2, r, r);
    }
    // Grout contrasts with the tile: pale grout between dark tiles, darker grout between pale ones.
    ctx.fillStyle = luminance(color) < 0.3 ? mix(color, '#9a9893', 0.55 + 0.25 * intensity) : shade(color, -0.15 - 0.25 * intensity);
    // Grout centred on the tile edges; the halves at 0 and 2·size meet when repeated.
    for (const p of [0, size, size * 2]) {
      ctx.fillRect(p - grout / 2, 0, grout, size * 2);
      ctx.fillRect(0, p - grout / 2, size * 2, grout);
    }
  });
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
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
