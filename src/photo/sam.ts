import type { RGBAImage } from './imageOps';

/**
 * The model-independent parts of "Select an area": preparing a photo for MobileSAM (a small
 * Segment Anything) and turning its output back into masks at the photo's size.
 *
 * The image encoder (exported with its own preprocessing) takes the photo resized so its
 * longest side is 1024 px, as height × width × RGB values 0–255; it normalises and pads to
 * 1024 × 1024 itself. The mask decoder is Segment Anything's: points in the resized photo's
 * pixels, labelled 1 (include) or 0 (leave out), followed by one padding point labelled −1
 * (no box). It returns four candidate masks as 256 × 256 logits over the padded square; a pixel
 * is in a mask where the logit is above 0.
 */

export const SAM_SIZE = 1024;
const LOW_RES = 256;

/** The photo's size once its longest side is 1024 px. */
export function resizedSize(width: number, height: number): { width: number; height: number; scale: number } {
  const scale = SAM_SIZE / Math.max(width, height);
  return { width: Math.max(1, Math.floor(width * scale + 0.5)), height: Math.max(1, Math.floor(height * scale + 0.5)), scale };
}

/** The encoder's input: the photo resized (bilinear) to 1024 px on its longest side, height × width × RGB. */
export function encoderInput(image: RGBAImage): { data: Float32Array; width: number; height: number } {
  const { width: w, height: h, data } = image;
  const size = resizedSize(w, h);
  const out = new Float32Array(size.width * size.height * 3);
  for (let y = 0; y < size.height; y++) {
    const sy = Math.min(h - 1, Math.max(0, ((y + 0.5) * h) / size.height - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < size.width; x++) {
      const sx = Math.min(w - 1, Math.max(0, ((x + 0.5) * w) / size.width - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = sx - x0;
      for (let c = 0; c < 3; c++) {
        const a = data[(y0 * w + x0) * 4 + c] * (1 - fx) + data[(y0 * w + x1) * 4 + c] * fx;
        const b = data[(y1 * w + x0) * 4 + c] * (1 - fx) + data[(y1 * w + x1) * 4 + c] * fx;
        out[(y * size.width + x) * 3 + c] = a * (1 - fy) + b * fy;
      }
    }
  }
  return { data: out, width: size.width, height: size.height };
}

/** A tap on the photo: `include` marks the area to select, otherwise an area to leave out. */
export interface PromptPoint {
  x: number;
  y: number;
  include: boolean;
}

/** The decoder's point inputs (with the padding point that means "no box"). */
export function decoderPoints(points: PromptPoint[], width: number, height: number): { coords: Float32Array; labels: Float32Array; count: number } {
  const size = resizedSize(width, height);
  const count = points.length + 1;
  const coords = new Float32Array(count * 2);
  const labels = new Float32Array(count);
  points.forEach((p, i) => {
    coords[i * 2] = (p.x * size.width) / width;
    coords[i * 2 + 1] = (p.y * size.height) / height;
    labels[i] = p.include ? 1 : 0;
  });
  labels[points.length] = -1;
  return { coords, labels, count };
}

export interface Candidate {
  /** 1 inside, 0 outside, at the photo's size. */
  mask: Uint8Array;
  /** The model's own estimate of the mask's quality (0–1). */
  score: number;
  /** Share of the photo it covers (0–1). */
  area: number;
}

/**
 * The decoder's low-resolution masks (each 256 × 256 logits over the padded square) as masks
 * at the photo's size, sampled bilinearly through the same resize and crop. Ordered from the
 * smallest area to the largest, so "smaller" and "larger" step through them; empty masks and
 * near-duplicates (the decoder's single best guess often repeats one of the others) are dropped.
 */
export function candidateMasks(logits: Float32Array, scores: Float32Array, width: number, height: number): Candidate[] {
  const size = resizedSize(width, height);
  const count = Math.min(scores.length, Math.floor(logits.length / (LOW_RES * LOW_RES)));
  // Where each photo column and row falls on the 256 grid.
  const axis = (n: number, resized: number) => {
    const at = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const padded = ((i + 0.5) * resized) / n; // position in the 1024 square
      at[i] = Math.min(LOW_RES - 1, Math.max(0, (padded * LOW_RES) / SAM_SIZE - 0.5));
    }
    return at;
  };
  const xs = axis(width, size.width);
  const ys = axis(height, size.height);
  const all: Candidate[] = [];
  for (let k = 0; k < count; k++) {
    const base = k * LOW_RES * LOW_RES;
    const mask = new Uint8Array(width * height);
    let inside = 0;
    for (let y = 0; y < height; y++) {
      const sy = ys[y];
      const y0 = Math.floor(sy);
      const y1 = Math.min(LOW_RES - 1, y0 + 1);
      const fy = sy - y0;
      for (let x = 0; x < width; x++) {
        const sx = xs[x];
        const x0 = Math.floor(sx);
        const x1 = Math.min(LOW_RES - 1, x0 + 1);
        const fx = sx - x0;
        const top = logits[base + y0 * LOW_RES + x0] * (1 - fx) + logits[base + y0 * LOW_RES + x1] * fx;
        const bottom = logits[base + y1 * LOW_RES + x0] * (1 - fx) + logits[base + y1 * LOW_RES + x1] * fx;
        if (top * (1 - fy) + bottom * fy > 0) {
          mask[y * width + x] = 1;
          inside++;
        }
      }
    }
    if (inside > 0) all.push({ mask, score: scores[k], area: inside / (width * height) });
  }
  // Keep the better-scoring of any two masks that are nearly the same.
  const kept: Candidate[] = [];
  for (const c of [...all].sort((a, b) => b.score - a.score)) if (!kept.some((k) => overlap(k.mask, c.mask) > 0.95)) kept.push(c);
  return kept.sort((a, b) => a.area - b.area);
}

/** Intersection over union of two masks. */
export function overlap(a: Uint8Array, b: Uint8Array): number {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) both++;
    if (a[i] || b[i]) either++;
  }
  return either ? both / either : 0;
}

/** The candidate to show first: the model's best-scoring one. */
export function bestCandidate(candidates: Candidate[]): number {
  let best = 0;
  candidates.forEach((c, i) => {
    if (c.score > candidates[best].score) best = i;
  });
  return best;
}
