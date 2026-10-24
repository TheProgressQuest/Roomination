import type { RGBAImage } from './imageOps';

/**
 * One colour for a selected area of a photo (a sofa's upholstery, a wall, a floor), robust to
 * what a photo adds that isn't the material's colour:
 *   - edges: pixels within a few pixels of the selection's border are left out (they mix with
 *     what's next to it);
 *   - highlights and deep shadows: the brightest 8% and darkest 12% (by lightness) are left out,
 *     and anything near pure white or black;
 *   - outliers: a cushion of another colour, a throw, a picture on a wall: pixels far from the
 *     area's typical colour (more than 2.5 robust spreads, in CIELAB) are left out.
 * The result is the median of what remains, in CIELAB (so it's a colour actually present, not
 * a muddy average), and the share of the area it rests on.
 */

export interface AreaColour {
  hex: string;
  /** Pixels the colour was taken from. */
  used: number;
  /** Share of the selected area those are (0–1). */
  share: number;
  /** Typical difference (ΔE, CIELAB) between the used pixels and the result: small = uniform. */
  spread: number;
}

const MAX_SAMPLES = 60_000;
const MIN_PIXELS = 40;

export function representativeColour(image: RGBAImage, mask: Uint8Array): AreaColour | null {
  const { width, height, data } = image;
  const total = countInside(mask);
  if (total < MIN_PIXELS) return null;
  // Leave out the border: about 1% of the photo's size, at least 2 px.
  const inner = erode(mask, width, height, Math.max(2, Math.round(Math.max(width, height) / 100)));
  const core = countInside(inner) >= MIN_PIXELS ? inner : mask;
  const step = Math.max(1, Math.floor(Math.sqrt(countInside(core) / MAX_SAMPLES)));
  const lab: number[][] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = y * width + x;
      if (!core[i]) continue;
      lab.push(rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]));
    }
  }
  if (lab.length < MIN_PIXELS) return null;

  // Highlights and shadows.
  const lightness = lab.map((c) => c[0]).sort((a, b) => a - b);
  const low = Math.max(4, quantile(lightness, 0.12));
  const high = Math.min(97, quantile(lightness, 0.92));
  let kept = lab.filter((c) => c[0] >= low && c[0] <= high);
  if (kept.length < MIN_PIXELS) kept = lab;

  // Outliers, around the median colour.
  const centre = medianLab(kept);
  const distances = kept.map((c) => deltaE(c, centre));
  const mad = quantile([...distances].sort((a, b) => a - b), 0.5) || 1;
  const limit = Math.max(6, 2.5 * 1.4826 * mad);
  const inliers = kept.filter((_, i) => distances[i] <= limit);
  const used = inliers.length >= MIN_PIXELS ? inliers : kept;
  const result = medianLab(used);
  const spread = quantile(used.map((c) => deltaE(c, result)).sort((a, b) => a - b), 0.5);
  return { hex: labToHex(result), used: used.length, share: used.length / lab.length, spread: Math.round(spread * 10) / 10 };
}

function countInside(mask: Uint8Array): number {
  let n = 0;
  for (const v of mask) if (v) n++;
  return n;
}

/** Shrinks the mask by `r` pixels (a pixel stays if the four pixels `r` away are inside too). */
function erode(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = r; y < height - r; y++) {
    for (let x = r; x < width - r; x++) {
      const i = y * width + x;
      if (mask[i] && mask[i - r] && mask[i + r] && mask[i - r * width] && mask[i + r * width]) out[i] = 1;
    }
  }
  return out;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[at];
}

function medianLab(colours: number[][]): number[] {
  return [0, 1, 2].map((k) => quantile(colours.map((c) => c[k]).sort((a, b) => a - b), 0.5));
}

/** CIE76 colour difference. */
export function deltaE(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// sRGB (D65) ⇄ CIELAB ---------------------------------------------------------------

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};
const WHITE = [0.95047, 1, 1.08883];
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);
const fInv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

export function rgbToLab(r: number, g: number, b: number): number[] {
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / WHITE[0];
  const y = (0.2126729 * R + 0.7151522 * G + 0.072175 * B) / WHITE[1];
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / WHITE[2];
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function labToHex([L, a, b]: number[]): string {
  const fy = (L + 16) / 116;
  const x = fInv(fy + a / 500) * WHITE[0];
  const y = fInv(fy) * WHITE[1];
  const z = fInv(fy - b / 200) * WHITE[2];
  const R = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const G = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const B = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return `#${[R, G, B].map((c) => fromLinear(c).toString(16).padStart(2, '0')).join('')}`;
}

export function hexToLab(hex: string): number[] {
  const n = Number.parseInt(hex.slice(1), 16);
  return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255);
}
