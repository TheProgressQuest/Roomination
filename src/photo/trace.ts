import { shapeProblem } from '../model/shape';
import type { ShapeVertex } from '../model/types';
import { traceMask } from './imageOps';

/** Longest side, in pixels, of the copy that is traced (keeps tracing instant). */
const TRACE_SIZE = 400;

/**
 * Turns a background-removed photo's silhouette into a furniture outline, in cm, centred on
 * the photo's centre at `cmPerPx`. Null if the photo has no transparent background to trace
 * or the result isn't a usable outline.
 */
export function traceAlphaOutline(image: HTMLImageElement, cmPerPx: number): ShapeVertex[] | null {
  const scale = Math.min(1, TRACE_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
  const w = Math.max(1, Math.round(image.naturalWidth * scale));
  const h = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const mask = new Uint8Array(w * h);
  let transparent = 0;
  for (let p = 0; p < mask.length; p++) {
    mask[p] = data[p * 4 + 3];
    if (mask[p] < 128) transparent++;
  }
  if (transparent === 0 || transparent === mask.length) return null;
  const outline = traceMask(mask, w, h, 1.2);
  if (!outline) return null;
  const toCm = cmPerPx / scale;
  const points = outline.map((p) => ({ x: Math.round((p.x - w / 2) * toCm * 10) / 10, y: Math.round((p.y - h / 2) * toCm * 10) / 10 }));
  return shapeProblem({ points }) ? null : points;
}
