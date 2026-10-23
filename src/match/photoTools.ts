import type { Point } from '../model/types';
import { warpPerspective, type RGBAImage } from '../photo/imageOps';

/**
 * Match My Room's photo tools: pure functions on RGBA images (no DOM), run entirely on this
 * device. Nothing here recognises objects or calibrates cameras; the person points at what
 * they mean and these tools measure it.
 */

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

/** The average colour in a small square around a point (so one noisy pixel doesn't decide it). */
export function sampleColour(image: RGBAImage, x: number, y: number, radius = 3): string {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
      const i = (py * image.width + px) * 4;
      if (image.data[i + 3] < 128) continue;
      r += image.data[i];
      g += image.data[i + 1];
      b += image.data[i + 2];
      n++;
    }
  }
  return n ? hex(r / n, g / n, b / n) : '#808080';
}

/**
 * A handful of representative colours (k-means on a sample of pixels), most common first.
 * Deterministic: the same photo always gives the same palette.
 */
export function suggestPalette(image: RGBAImage, count = 6): string[] {
  const { width, height, data } = image;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4000)));
  const pixels: [number, number, number][] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] >= 128) pixels.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  if (pixels.length === 0) return [];
  const k = Math.min(count, pixels.length);
  // Start from evenly spaced pixels in brightness order (deterministic, well spread).
  const byLight = [...pixels].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let centres = Array.from({ length: k }, (_, i) => [...byLight[Math.floor(((i + 0.5) * byLight.length) / k)]] as [number, number, number]);
  let sizes = new Array(k).fill(0);
  for (let iteration = 0; iteration < 12; iteration++) {
    const sums = centres.map(() => [0, 0, 0]);
    sizes = new Array(k).fill(0);
    for (const p of pixels) {
      let best = 0;
      let bestD = Infinity;
      centres.forEach((c, j) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      });
      sums[best][0] += p[0];
      sums[best][1] += p[1];
      sums[best][2] += p[2];
      sizes[best]++;
    }
    centres = centres.map((c, j) => (sizes[j] ? [sums[j][0] / sizes[j], sums[j][1] / sizes[j], sums[j][2] / sizes[j]] : c));
  }
  const unique = new Map<string, number>();
  centres.forEach((c, j) => {
    const h = hex(c[0], c[1], c[2]);
    unique.set(h, (unique.get(h) ?? 0) + sizes[j]);
  });
  return [...unique.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([h]) => h);
}

/** Lighter (> 1) or darker (< 1): photos of rooms are usually darker than the real surfaces. */
export function adjustBrightness(image: RGBAImage, factor: number): RGBAImage {
  const data = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = image.data[i] * factor;
    data[i + 1] = image.data[i + 1] * factor;
    data[i + 2] = image.data[i + 2] * factor;
    data[i + 3] = image.data[i + 3];
  }
  return { width: image.width, height: image.height, data };
}

/**
 * Hides the seams where a tile repeats: each edge band fades into the opposite edge, so the
 * left edge continues the right one and the top continues the bottom. `band` is 0–0.5 of the size.
 */
export function softenSeams(image: RGBAImage, band = 0.12): RGBAImage {
  const { width: w, height: h } = image;
  const data = new Uint8ClampedArray(image.data);
  const bx = Math.max(1, Math.round(w * band));
  const by = Math.max(1, Math.round(h * band));
  const blend = (i: number, j: number, t: number) => {
    for (let c = 0; c < 3; c++) data[i + c] = data[i + c] * t + image.data[j + c] * (1 - t);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < bx; x++) {
      // Near the left edge, mix in the pixels just inside the right edge (and vice versa).
      const t = 0.5 + (0.5 * x) / bx;
      blend((y * w + x) * 4, (y * w + (w - bx + x)) * 4, t);
    }
  }
  const pass = new Uint8ClampedArray(data);
  for (let y = 0; y < by; y++) {
    const t = 0.5 + (0.5 * y) / by;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const j = ((h - by + y) * w + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = pass[i + c] * t + pass[j + c] * (1 - t);
    }
  }
  return { width: w, height: h, data };
}

export interface TextureCut {
  /** Corners on the photo, in its pixels: top-left, top-right, bottom-right, bottom-left. */
  corners: [Point, Point, Point, Point];
  /** The real size of the marked area, cm (the person measures or estimates it). */
  widthCm: number;
  heightCm: number;
  brightness: number;
  seamless: boolean;
}

/**
 * Straightens the marked area of a (roughly flat) surface into a rectangle with the marked
 * area's real proportions. The correction is only as good as the corners placed: it can't know
 * the true angle from one photo, and curved or bumpy surfaces won't flatten.
 */
export function cutTexture(image: RGBAImage, cut: TextureCut, maxSide = 512): RGBAImage {
  const aspect = cut.widthCm / cut.heightCm;
  const width = Math.max(16, Math.round(aspect >= 1 ? maxSide : maxSide * aspect));
  const height = Math.max(16, Math.round(aspect >= 1 ? maxSide / aspect : maxSide));
  let out = warpPerspective(image, cut.corners, width, height);
  if (cut.brightness !== 1) out = adjustBrightness(out, cut.brightness);
  if (cut.seamless) out = softenSeams(out);
  return out;
}
