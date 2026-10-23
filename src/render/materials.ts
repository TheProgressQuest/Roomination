import { seededRandom } from '../model/random';
import type { MaterialKind, SurfaceFinish, UpholsteryPattern } from '../model/types';

/**
 * Surface materials shared by the 2D presentation plan and the 3D view, so a wooden table
 * or a linen sofa looks like the same object in both.
 *
 * Each material has physical-ish properties for Three.js and a detail pattern: a pale,
 * seamlessly tiling greyscale texture generated locally on a canvas (no downloads). The
 * pattern is multiplied by the piece's colour, so the person's chosen colour is kept.
 */

/** Every surface a furniture part can have: the person-selectable kinds plus fixed ones (bedding, books, leaves…). */
export type SurfaceKind = MaterialKind | 'linen' | 'paper' | 'foliage' | 'screen' | 'brass' | 'lampshade' | 'soil';

export interface SurfacePreset {
  roughness: number;
  metalness: number;
  /** Real-world size of one texture tile, in cm. */
  tileCm: number;
  pattern: ((ctx: CanvasRenderingContext2D, size: number) => void) | null;
  opacity?: number;
  /** Glows faintly (a lit lampshade). */
  emissive?: boolean;
  /**
   * The pattern's base value (< 1 when its flecks are lighter than the surface): the colour is
   * divided by it, so the surface itself still shows the chosen colour.
   */
  lift?: number;
}

/** Granite's base value (its flecks are lighter and darker than the surface). */
const GRANITE_BASE = 0.7;

/** Texture resolution: enough for 1–2 m of furniture surface without visible pixels. */
export const TILE_PX = 256;

export const SURFACES: Record<SurfaceKind, SurfacePreset> = {
  fabric: { roughness: 0.94, metalness: 0, tileCm: 12, pattern: fabric },
  cotton: { roughness: 0.92, metalness: 0, tileCm: 8, pattern: twill },
  linen: { roughness: 0.96, metalness: 0, tileCm: 18, pattern: linen },
  velvet: { roughness: 0.78, metalness: 0, tileCm: 40, pattern: velvet },
  leather: { roughness: 0.5, metalness: 0, tileCm: 30, pattern: leather },
  wood: { roughness: 0.62, metalness: 0, tileCm: 110, pattern: woodGrain },
  metal: { roughness: 0.32, metalness: 0.85, tileCm: 40, pattern: brushed },
  brass: { roughness: 0.3, metalness: 0.9, tileCm: 40, pattern: brushed },
  glass: { roughness: 0.06, metalness: 0, tileCm: 100, pattern: null, opacity: 0.4 },
  stone: { roughness: 0.28, metalness: 0, tileCm: 90, pattern: marble },
  ceramic: { roughness: 0.35, metalness: 0, tileCm: 30, pattern: glaze },
  plastic: { roughness: 0.42, metalness: 0, tileCm: 100, pattern: null },
  water: { roughness: 0.05, metalness: 0, tileCm: 60, pattern: ripples, opacity: 0.82 },
  // Silvered glass. Without real reflections (a later, measured option) it reads as a bright,
  // polished, slightly blue-grey surface.
  mirror: { roughness: 0.06, metalness: 0.15, tileCm: 100, pattern: null },
  // Speckled stone or laminate worktops: fine light and dark flecks over the chosen colour.
  granite: { roughness: 0.32, metalness: 0, tileCm: 24, pattern: granite, lift: GRANITE_BASE },
  // Thin, see-through fabric (shower curtains, voile): light passes through it.
  sheer: { roughness: 0.9, metalness: 0, tileCm: 10, pattern: twill, opacity: 0.38 },
  custom: { roughness: 0.8, metalness: 0, tileCm: 100, pattern: null },
  paper: { roughness: 0.85, metalness: 0, tileCm: 20, pattern: null },
  foliage: { roughness: 0.65, metalness: 0, tileCm: 15, pattern: leafVeins },
  screen: { roughness: 0.12, metalness: 0.2, tileCm: 100, pattern: null },
  lampshade: { roughness: 0.95, metalness: 0, tileCm: 15, pattern: linen, emissive: true },
  soil: { roughness: 1, metalness: 0, tileCm: 10, pattern: speckle },
};

/** Finish shifts the roughness: matte is duller, gloss is shinier. */
export const FINISH_ROUGHNESS: Record<SurfaceFinish, number> = { matte: 0.12, satin: 0, gloss: -0.3 };

export function roughnessFor(kind: SurfaceKind, finish: SurfaceFinish): number {
  return Math.min(1, Math.max(0.02, SURFACES[kind].roughness + FINISH_ROUGHNESS[finish]));
}

const tiles = new Map<string, HTMLCanvasElement | null>();

/**
 * The detail texture of a surface (a pale tile to multiply with the colour), or null for a
 * plain one. Generated once per session and shared by every piece and both views.
 */
export function surfaceTile(kind: SurfaceKind, weave: UpholsteryPattern = 'plain'): HTMLCanvasElement | null {
  const key = `${kind}|${weave}`;
  if (tiles.has(key)) return tiles.get(key)!;
  const pattern = SURFACES[kind].pattern;
  const overlay = WEAVES[weave];
  let canvas: HTMLCanvasElement | null = null;
  if ((pattern || overlay) && typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = TILE_PX;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, TILE_PX, TILE_PX);
      if (overlay) {
        // A patterned tile spans PATTERN_TILE_CM: the material's own detail repeats inside it.
        const repeats = Math.max(1, Math.round(PATTERN_TILE_CM / SURFACES[kind].tileCm));
        const cell = TILE_PX / repeats;
        if (pattern) {
          const base = surfaceTile(kind);
          if (base) for (let i = 0; i < repeats; i++) for (let j = 0; j < repeats; j++) ctx.drawImage(base, i * cell, j * cell, cell, cell);
        }
        overlay(ctx, TILE_PX);
      } else pattern!(ctx, TILE_PX);
    } else canvas = null;
  }
  tiles.set(key, canvas);
  return canvas;
}

/** Real-world size of one tile of a surface with a woven pattern and a size multiplier, cm. */
export function tileSizeCm(kind: SurfaceKind, weave: UpholsteryPattern = 'plain', scale = 1): number {
  return (WEAVES[weave] ? PATTERN_TILE_CM : SURFACES[kind].tileCm) * (scale > 0 ? scale : 1);
}

/** Patterned upholstery tiles cover this much fabric (stripes and checks repeat inside it). */
export const PATTERN_TILE_CM = 24;

/** Woven or printed upholstery patterns, drawn over the material's own detail. */
const WEAVES: Record<UpholsteryPattern, ((ctx: CanvasRenderingContext2D, size: number) => void) | null> = {
  plain: null,
  stripes: (ctx, size) => {
    // Four soft stripes per 24 cm, each with a fine edge line.
    const band = size / 8;
    for (let i = 0; i < 8; i += 2) {
      ctx.fillStyle = 'rgba(0,0,0,0.09)';
      ctx.fillRect(i * band, 0, band, size);
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(i * band + band * 0.1, 0, Math.max(1, band * 0.04), size);
    }
  },
  check: (ctx, size) => {
    const band = size / 6;
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    for (let i = 0; i < 6; i += 2) {
      ctx.fillRect(i * band, 0, band, size);
      ctx.fillRect(0, i * band, size, band);
    }
  },
  herringbone: (ctx, size) => {
    // Zig-zag twill columns.
    const col = size / 12;
    const step = col;
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = Math.max(1, col * 0.18);
    for (let c = 0; c < 12; c++) {
      const dir = c % 2 ? 1 : -1;
      for (let y = -step; y < size + step; y += step * 0.5) {
        ctx.beginPath();
        ctx.moveTo(c * col, y);
        ctx.lineTo((c + 1) * col, y + dir * step * 0.5);
        ctx.stroke();
      }
    }
  },
  boucle: (ctx, size) => {
    // Small looped bobbles.
    const random = seededRandom(29);
    for (let i = 0; i < 900; i++) {
      const x = random() * size;
      const y = random() * size;
      const r = 1 + random() * 2.2;
      ctx.strokeStyle = `rgba(0,0,0,${0.05 + random() * 0.06})`;
      ctx.lineWidth = 0.8;
      wrapped(size, (dx, dy) => {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.stroke();
      });
    }
  },
};

// ---------------------------------------------------------------------------
// Patterns. Deterministic (seeded), seamless, and subtle: detail, not decoration.
// Each draws wrapped copies at the edges so the tile repeats without seams.
// ---------------------------------------------------------------------------

/** Calls `paint` at the 9 wrapped offsets, so shapes crossing an edge reappear opposite. */
function wrapped(size: number, paint: (dx: number, dy: number) => void) {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) paint(dx, dy);
}

/** The same, for patterns that already span the full width: only the vertical copies. */
function wrappedY(size: number, paint: (dy: number) => void) {
  for (const dy of [-size, 0, size]) paint(dy);
}

/** Upholstery: a fine, slightly irregular weave with soft slubs. */
function fabric(ctx: CanvasRenderingContext2D, size: number) {
  const random = seededRandom(11);
  const step = size / 64;
  for (let i = 0; i < 64; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.025 + random() * 0.035})`;
    ctx.fillRect(i * step, 0, step * 0.55, size);
    ctx.fillStyle = `rgba(0,0,0,${0.02 + random() * 0.03})`;
    ctx.fillRect(0, i * step, size, step * 0.5);
  }
  for (let i = 0; i < 140; i++) {
    const x = random() * size;
    const y = random() * size;
    const len = 4 + random() * 14;
    ctx.fillStyle = `rgba(0,0,0,${0.02 + random() * 0.03})`;
    wrapped(size, (dx, dy) => ctx.fillRect(x + dx, y + dy, len, 1.2));
  }
}

/** Water: faint, soft ripples (baths, hot tubs). */
function ripples(ctx: CanvasRenderingContext2D, size: number) {
  const random = seededRandom(31);
  ctx.lineWidth = size / 160;
  for (let i = 0; i < 26; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = size * (0.04 + random() * 0.12);
    ctx.strokeStyle = `rgba(255,255,255,${0.1 + random() * 0.12})`;
    wrapped(size, (dx, dy) => {
      ctx.beginPath();
      ctx.ellipse(x + dx, y + dy, r, r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
  }
}

/** Cotton: a fine diagonal twill. */
function twill(ctx: CanvasRenderingContext2D, size: number) {
  const random = seededRandom(17);
  const step = size / 48;
  ctx.lineWidth = step * 0.45;
  for (let i = -48; i < 96; i++) {
    ctx.strokeStyle = `rgba(0,0,0,${0.03 + random() * 0.03})`;
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step + size, size);
    ctx.stroke();
  }
}

/** Velvet: a smooth pile with soft, cloudy variations in sheen. */
function velvet(ctx: CanvasRenderingContext2D, size: number) {
  const random = seededRandom(23);
  for (let i = 0; i < 28; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = size * (0.1 + random() * 0.22);
    const dark = random() > 0.5;
    wrapped(size, (dx, dy) => {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      // Very subtle: on dark fabrics stronger clouds read as stains.
      g.addColorStop(0, dark ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.0)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    });
  }
}

/** Bedding and lampshades: a soft, open linen texture. */
function linen(ctx: CanvasRenderingContext2D, size: number) {
  const random = seededRandom(13);
  for (let y = 0; y < size; y += 2) {
    ctx.fillStyle = `rgba(0,0,0,${random() * 0.035})`;
    ctx.fillRect(0, y, size, 1);
  }
  for (let x = 0; x < size; x += 3) {
    ctx.fillStyle = `rgba(0,0,0,${random() * 0.025})`;
    ctx.fillRect(x, 0, 1, size);
  }
}

/** Leather: soft pebbling. */
function leather(ctx: CanvasRenderingContext2D, size: number) {
  const random = seededRandom(7);
  for (let i = 0; i < 1600; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 0.6 + random() * 1.8;
    ctx.fillStyle = `rgba(0,0,0,${0.02 + random() * 0.05})`;
    wrapped(size, (dx, dy) => {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

/** Wood: subtle, long, gently wavering grain with soft colour bands. Kept faint: grain should be felt, not counted. */
function woodGrain(ctx: CanvasRenderingContext2D, size: number) {
  const random = seededRandom(3);
  // Broad, soft colour bands (heartwood variation), running along x.
  for (let i = 0; i < 5; i++) {
    const y = random() * size;
    const band = 18 + random() * 40;
    const g = ctx.createLinearGradient(0, y, 0, y + band);
    const a = 0.025 + random() * 0.03;
    g.addColorStop(0, 'rgba(90,50,10,0)');
    g.addColorStop(0.5, `rgba(90,50,10,${a})`);
    g.addColorStop(1, 'rgba(90,50,10,0)');
    ctx.fillStyle = g;
    wrappedY(size, (dy) => {
      ctx.save();
      ctx.translate(0, dy);
      ctx.fillRect(0, y, size, band);
      ctx.restore();
    });
  }
  // Sparse, fine grain lines.
  for (let i = 0; i < 16; i++) {
    const y = random() * size;
    const amp = 1 + random() * 3;
    const phase = random() * Math.PI * 2;
    ctx.strokeStyle = `rgba(70,35,5,${0.025 + random() * 0.045})`;
    ctx.lineWidth = 0.5 + random() * 1.1;
    wrappedY(size, (dy) => {
      ctx.beginPath();
      for (let x = 0; x <= size; x += 4) ctx.lineTo(x, y + dy + Math.sin((x / size) * Math.PI * 2 + phase) * amp);
      ctx.stroke();
    });
  }
}

/** Metal: fine brushed lines. */
function brushed(ctx: CanvasRenderingContext2D, size: number) {
  const random = seededRandom(5);
  for (let y = 0; y < size; y++) {
    ctx.fillStyle = `rgba(0,0,0,${random() * 0.07})`;
    ctx.fillRect(0, y, size, 1);
  }
}

/** Stone: soft clouding with a few thin, branching veins (marble). */
function marble(ctx: CanvasRenderingContext2D, size: number) {
  const random = seededRandom(17);
  for (let i = 0; i < 30; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = 20 + random() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${0.015 + random() * 0.025})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    wrapped(size, (dx, dy) => {
      ctx.save();
      ctx.translate(dx, dy);
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.restore();
    });
  }
  for (let v = 0; v < 5; v++) {
    let x = random() * size;
    let y = random() * size;
    let angle = random() * Math.PI * 2;
    const points: [number, number][] = [[x, y]];
    for (let s = 0; s < 40; s++) {
      angle += (random() - 0.5) * 0.7;
      x += Math.cos(angle) * 6;
      y += Math.sin(angle) * 6;
      points.push([x, y]);
    }
    ctx.strokeStyle = `rgba(60,60,70,${0.08 + random() * 0.12})`;
    ctx.lineWidth = 0.6 + random() * 1.2;
    wrapped(size, (dx, dy) => {
      ctx.beginPath();
      points.forEach(([px, py], i) => (i ? ctx.lineTo(px + dx, py + dy) : ctx.moveTo(px + dx, py + dy)));
      ctx.stroke();
    });
  }
}

/** Ceramic: a smooth glaze with faint speckles. */
function glaze(ctx: CanvasRenderingContext2D, size: number) {
  const random = seededRandom(19);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + random() * 0.05})`;
    ctx.fillRect(random() * size, random() * size, 1.2, 1.2);
  }
}

/** Leaves: a soft lengthwise vein texture. */
function leafVeins(ctx: CanvasRenderingContext2D, size: number) {
  const random = seededRandom(23);
  for (let i = 0; i < 18; i++) {
    const x = random() * size;
    ctx.fillStyle = `rgba(0,0,0,${0.03 + random() * 0.05})`;
    for (const dx of [-size, 0, size]) ctx.fillRect(x + dx, 0, 1.5, size);
  }
}

/** Soil and gravel: dense speckle. */
/** Granite or speckled laminate: a mid base with dense fine flecks, dark and light (a few bright). */
function granite(ctx: CanvasRenderingContext2D, size: number) {
  const random = seededRandom(41);
  const base = Math.round(255 * GRANITE_BASE);
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    const t = random();
    const v = t < 0.55 ? 40 + random() * 90 : t < 0.93 ? 215 + random() * 40 : 255;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    const r = 0.6 + random() * (t > 0.93 ? 1.6 : 1.1);
    ctx.fillRect(random() * size, random() * size, r, r);
  }
}

function speckle(ctx: CanvasRenderingContext2D, size: number) {
  const random = seededRandom(29);
  for (let i = 0; i < 2400; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.05 + random() * 0.15})`;
    ctx.fillRect(random() * size, random() * size, 1.5, 1.5);
  }
}
