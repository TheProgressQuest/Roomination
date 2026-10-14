import type { Furniture } from '../model/types';
import { localFootprint } from '../model/shape';
import { bodySurface, furnitureParts, visualOf, type FurniturePart } from './furnitureParts';
import { SURFACES, TILE_PX, surfaceTile, type SurfaceKind } from './materials';
import { shade } from './palette';

/**
 * Top-down illustrations for the presentation plan, painted from the same parts the 3D
 * view builds (render/furnitureParts) with the same materials (render/materials). Plain
 * Canvas 2D: no WebGL needed.
 *
 * Lighting matches the 3D view: soft light from the upper left. Each piece is painted once
 * into an off-screen canvas at the plan's current scale and reused until it changes.
 */

export interface Illustration {
  canvas: HTMLCanvasElement;
  /** Where the piece's centre is inside the canvas, in CSS pixels. */
  originX: number;
  originY: number;
  /** Canvas size in CSS pixels (the bitmap is this × pixel ratio). */
  width: number;
  height: number;
}

type Item = Pick<Furniture, 'id' | 'name' | 'kind' | 'category' | 'width' | 'depth' | 'height' | 'color' | 'appearance' | 'shape'>;

const cache = new Map<string, Illustration>();
const CACHE_LIMIT = 400;

/** Pixels of margin around a piece (for rounded strokes and anti-aliasing). */
const MARGIN = 2;

/**
 * The illustration of a piece at `pxPerCm`, or null if it can't be drawn here (no canvas).
 * Photo-topped pieces aren't illustrated: their real photo is shown instead.
 */
export function illustrationOf(item: Item, pxPerCm: number, pixelRatio: number): Illustration | null {
  if (typeof document === 'undefined') return null;
  const key = `${item.id}|${item.name}|${item.kind}|${item.category}|${item.width}|${item.depth}|${item.height}|${item.color}|${item.appearance?.material ?? ''}|${item.appearance?.finish ?? ''}|${item.shape ? JSON.stringify(item.shape) : ''}|${pxPerCm.toFixed(3)}|${pixelRatio}`;
  const hit = cache.get(key);
  if (hit) {
    // Refresh its place in the least-recently-used order.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const width = item.width * pxPerCm + MARGIN * 2;
  const height = item.depth * pxPerCm + MARGIN * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * pixelRatio));
  canvas.height = Math.max(1, Math.ceil(height * pixelRatio));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(pixelRatio, pixelRatio);
  ctx.translate(width / 2, height / 2);
  ctx.scale(pxPerCm, pxPerCm);
  if (item.shape) paintOutline(ctx, item, pxPerCm);
  else paintParts(ctx, item, pxPerCm);
  const illustration = { canvas, originX: width / 2, originY: height / 2, width, height };
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, illustration);
  return illustration;
}

/** Forgets every cached illustration (e.g. after the theme changes). */
export function clearIllustrations() {
  cache.clear();
}

/**
 * A material tile pre-shrunk to the size it's drawn at (`px` canvas pixels per tile), with
 * high-quality smoothing. Patterns aren't mip-mapped, so drawing a big tile tiny would alias
 * into a coarse checker.
 */
const scaledTiles = new Map<string, HTMLCanvasElement | null>();
function scaledTile(surface: SurfaceKind, px: number): HTMLCanvasElement | null {
  const size = Math.max(4, Math.min(TILE_PX, Math.round(px)));
  const key = `${surface}|${size}`;
  if (scaledTiles.has(key)) return scaledTiles.get(key)!;
  const tile = surfaceTile(surface);
  let result: HTMLCanvasElement | null = null;
  if (tile) {
    // Halve repeatedly (a manual mip chain), then a final smooth step to the exact size.
    let source: HTMLCanvasElement = tile;
    while (source.width / 2 >= size) {
      const half = document.createElement('canvas');
      half.width = half.height = source.width / 2;
      const c = half.getContext('2d')!;
      c.imageSmoothingQuality = 'high';
      c.drawImage(source, 0, 0, half.width, half.height);
      source = half;
    }
    result = document.createElement('canvas');
    result.width = result.height = size;
    const c = result.getContext('2d')!;
    c.imageSmoothingQuality = 'high';
    c.drawImage(source, 0, 0, size, size);
  }
  scaledTiles.set(key, result);
  return result;
}

/** A pattern of a surface's texture at real-world scale, for a context drawing in cm. */
function surfacePattern(ctx: CanvasRenderingContext2D, surface: SurfaceKind, turn = 0): CanvasPattern | null {
  const tileCm = SURFACES[surface].tileCm;
  // Device pixels per cm right now (the context is scaled to cm, and may be turned).
  const t = ctx.getTransform();
  const devicePx = tileCm * Math.hypot(t.a, t.b);
  const tile = scaledTile(surface, devicePx);
  if (!tile) return null;
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return null;
  const scale = tileCm / tile.width;
  pattern.setTransform(new DOMMatrix().rotate(turn).scale(scale, scale));
  return pattern;
}

// ---------------------------------------------------------------------------
// Painting (in local cm: x across, y towards the front, origin at the centre)
// ---------------------------------------------------------------------------

function paintParts(ctx: CanvasRenderingContext2D, item: Item, pxPerCm: number) {
  const body = bodySurface(item);
  const parts = furnitureParts(item)
    // Lower parts first; the floor-level outline of tall pieces disappears under their tops.
    .map((p, i) => ({ p, i, top: p.z + p.height }))
    .sort((a, b) => a.top - b.top || a.i - b.i)
    .map(({ p }) => p);
  const visual = visualOf(item);
  for (const part of parts) {
    // Legs and bases are hidden from above under anything wider; skip the clutter.
    if ((part.role === 'leg' || part.role === 'base') && visual !== 'officeChair' && visual !== 'lamp') continue;
    const surface: SurfaceKind = part.surface === 'body' ? body : part.surface;
    const color = part.color ?? (part.shade ? shade(item.color, part.shade) : item.color);
    paintPart(ctx, part, surface, color, pxPerCm);
  }
}

function paintPart(ctx: CanvasRenderingContext2D, part: FurniturePart, surface: SurfaceKind, color: string, pxPerCm: number) {
  ctx.save();
  ctx.translate(part.x, part.y);
  if (part.yaw) ctx.rotate((part.yaw * Math.PI) / 180);
  const tilt = ((part.tilt ?? 0) * Math.PI) / 180;
  const w = part.width;
  // Seen from above, a tilted leaf looks shorter.
  const d = part.shape === 'leaf' ? part.depth * Math.cos(tilt) : part.depth;
  const path = new Path2D();
  switch (part.shape) {
    case 'rounded':
      path.roundRect(-w / 2, -d / 2, w, d, Math.min(part.radius ?? 0, w / 2, d / 2));
      break;
    case 'cylinder':
    case 'cone':
    case 'ellipsoid':
      path.ellipse(0, 0, w / 2, d / 2, 0, 0, Math.PI * 2);
      break;
    case 'leaf':
      // A pointed blade: two arcs meeting at the tips.
      path.moveTo(0, -d / 2);
      path.bezierCurveTo(w * 0.62, -d * 0.25, w * 0.5, d * 0.25, 0, d / 2);
      path.bezierCurveTo(-w * 0.5, d * 0.25, -w * 0.62, -d * 0.25, 0, -d / 2);
      path.closePath();
      break;
  }

  // Base colour, then the material's texture multiplied over it at real-world scale.
  ctx.fillStyle = color;
  ctx.fill(path);
  {
    // Grain runs along the longer side, as in 3D.
    const turn = d > w && (surface === 'wood' || surface === 'metal' || surface === 'brass') ? 90 : 0;
    const pattern = surfacePattern(ctx, surface, turn);
    if (pattern) {
      ctx.save();
      ctx.clip(path);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = pattern;
      ctx.fillRect(-w / 2, -d / 2, w, d);
      ctx.restore();
    }
  }

  // Light from the upper left: a soft highlight there, a little shade towards the lower right.
  ctx.save();
  ctx.clip(path);
  const soft = isSoft(part, surface);
  const g = ctx.createLinearGradient(-w / 2, -d / 2, w / 2, d / 2);
  g.addColorStop(0, `rgba(255,255,255,${soft ? 0.22 : 0.12})`);
  g.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.addColorStop(1, `rgba(0,0,0,${soft ? 0.12 : 0.07})`);
  ctx.fillStyle = g;
  ctx.fillRect(-w / 2, -d / 2, w, d);
  if (soft && part.shape !== 'leaf') {
    // Upholstery and pillows: rounded, padded edges.
    const r = Math.max(w, d) / 2;
    const puff = ctx.createRadialGradient(-w * 0.12, -d * 0.15, Math.min(w, d) * 0.1, 0, 0, r);
    puff.addColorStop(0, 'rgba(255,255,255,0.12)');
    puff.addColorStop(0.7, 'rgba(255,255,255,0)');
    puff.addColorStop(1, 'rgba(0,0,0,0.1)');
    ctx.fillStyle = puff;
    ctx.fillRect(-w / 2, -d / 2, w, d);
  }
  ctx.restore();

  detail(ctx, part, w, d, color, pxPerCm);

  // A fine, soft outline gives each part definition (darker than its own colour, never black).
  ctx.strokeStyle = surface === 'lampshade' ? 'rgba(160,120,60,0.45)' : shade(color, -0.35);
  ctx.globalAlpha = part.role === 'leaf' ? 0.55 : 0.6;
  ctx.lineWidth = Math.max(0.6, 0.9 / pxPerCm);
  ctx.stroke(path);
  ctx.restore();
}

function isSoft(part: FurniturePart, surface: SurfaceKind): boolean {
  return ['fabric', 'linen', 'leather', 'lampshade'].includes(surface) || ['cushion', 'pillow', 'mattress', 'duvet', 'throw'].includes(part.role);
}

/** Role-specific details: duvet folds, seams, leaf midribs, lamp glow, a screen's sheen. */
function detail(ctx: CanvasRenderingContext2D, part: FurniturePart, w: number, d: number, color: string, pxPerCm: number) {
  const line = Math.max(0.5, 0.8 / pxPerCm);
  ctx.save();
  switch (part.role) {
    case 'duvet': {
      // Soft folds across the bedding.
      ctx.strokeStyle = 'rgba(120,105,90,0.16)';
      ctx.lineWidth = line * 1.6;
      for (const t of [0.2, 0.42, 0.66]) {
        ctx.beginPath();
        ctx.moveTo(-w / 2 + 2, -d / 2 + d * t);
        ctx.bezierCurveTo(-w / 6, -d / 2 + d * (t + 0.05), w / 6, -d / 2 + d * (t - 0.04), w / 2 - 2, -d / 2 + d * (t + 0.02));
        ctx.stroke();
      }
      break;
    }
    case 'cushion':
    case 'pillow': {
      // Piping: a seam just inside the edge.
      ctx.strokeStyle = shade(color, -0.22);
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = line;
      const inset = Math.min(2.5, w * 0.08, d * 0.08);
      ctx.beginPath();
      ctx.roundRect(-w / 2 + inset, -d / 2 + inset, w - inset * 2, d - inset * 2, Math.min(part.radius ?? 3, w / 2, d / 2));
      ctx.stroke();
      break;
    }
    case 'throw': {
      // A woven band: fine stripes across the throw.
      ctx.strokeStyle = shade(color, -0.15);
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = line;
      for (const t of [0.15, 0.85]) {
        ctx.beginPath();
        ctx.moveTo(-w / 2 + 1, -d / 2 + d * t);
        ctx.lineTo(w / 2 - 1, -d / 2 + d * t);
        ctx.stroke();
      }
      break;
    }
    case 'leaf': {
      ctx.strokeStyle = shade(color, 0.25);
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = line;
      ctx.beginPath();
      ctx.moveTo(0, -d / 2 + d * 0.06);
      ctx.lineTo(0, d / 2 - d * 0.04);
      ctx.stroke();
      break;
    }
    case 'shade': {
      // A lit lampshade glows softly.
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, d) / 2);
      glow.addColorStop(0, 'rgba(255,236,190,0.95)');
      glow.addColorStop(0.55, 'rgba(255,224,160,0.55)');
      glow.addColorStop(1, 'rgba(255,214,140,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, d / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'screen': {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(-w / 2, -d / 2, w, Math.min(d, 1));
      break;
    }
    case 'top': {
      // Tabletops: a slightly brighter bevel along the upper-left edges.
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = line * 1.5;
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 1, d / 2 - 1);
      ctx.lineTo(-w / 2 + 1, -d / 2 + 1);
      ctx.lineTo(w / 2 - 1, -d / 2 + 1);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/**
 * Drawn (custom) outlines can't safely be given invented cushions or legs, so they get a
 * refined material rendering of their true shape: textured, softly lit, with the front edge
 * shown and holes left open.
 */
function paintOutline(ctx: CanvasRenderingContext2D, item: Item, pxPerCm: number) {
  const { rings } = localFootprint(item);
  const path = new Path2D();
  for (const ring of rings) {
    for (const loop of [ring.outer, ...ring.holes]) {
      loop.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
      path.closePath();
    }
  }
  const surface = bodySurface(item);
  const w = item.width;
  const d = item.depth;
  ctx.fillStyle = item.color;
  ctx.fill(path, 'evenodd');
  ctx.save();
  ctx.clip(path, 'evenodd');
  {
    const pattern = surfacePattern(ctx, surface);
    if (pattern) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = pattern;
      ctx.fillRect(-w / 2, -d / 2, w, d);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  const g = ctx.createLinearGradient(-w / 2, -d / 2, w / 2, d / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.1)');
  ctx.fillStyle = g;
  ctx.fillRect(-w / 2, -d / 2, w, d);
  // An inner seam follows the outline, like upholstery piping or a tabletop's edge.
  ctx.strokeStyle = shade(item.color, -0.2);
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = Math.max(2.5, 4 / pxPerCm) * 1;
  ctx.stroke(path);
  ctx.restore();
  ctx.strokeStyle = shade(item.color, -0.38);
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = Math.max(0.6, 1 / pxPerCm);
  ctx.stroke(path);
}
