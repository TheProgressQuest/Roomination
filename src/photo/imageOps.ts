import type { Point } from '../model/types';

/**
 * Pixel operations for the photo tools. Pure functions on plain arrays (no DOM), so they
 * run in a Web Worker and in unit tests alike. Images are RGBA, row by row; masks hold one
 * value per pixel, 0 (background) to 255 (keep).
 */

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const colourDistance = (d: Uint8ClampedArray, i: number, r: number, g: number, b: number) => Math.hypot(d[i] - r, d[i + 1] - g, d[i + 2] - b);

/**
 * Background removal by colour: spreads in from the photo's edges through pixels similar to
 * their neighbours and to the typical edge colour. Works well for furniture photographed in
 * front of a plain wall or floor. `tolerance` is 0–100. Returns a mask (255 = keep).
 */
export function maskByEdgeColour(image: RGBAImage, tolerance: number): Uint8Array {
  const { width: w, height: h, data } = image;
  const n = w * h;
  // Typical edge colour (median of each channel along the border).
  const border: number[][] = [[], [], []];
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    border[0].push(data[i]);
    border[1].push(data[i + 1]);
    border[2].push(data[i + 2]);
  };
  for (let x = 0; x < w; x++) {
    sample(x, 0);
    sample(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    sample(0, y);
    sample(w - 1, y);
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const [br, bg, bb] = border.map(median);
  const global = 20 + tolerance * 2.2;
  const local = 4 + tolerance * 0.45;

  const mask = new Uint8Array(n).fill(255);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const seed = (p: number) => {
    if (mask[p] === 0) return;
    if (colourDistance(data, p * 4, br, bg, bb) > global) return;
    mask[p] = 0;
    queue[tail++] = p;
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p - x) / w;
    const i = p * 4;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q < 0 || mask[q] === 0) continue;
      const j = q * 4;
      if (colourDistance(data, j, data[i], data[i + 1], data[i + 2]) > local) continue;
      if (colourDistance(data, j, br, bg, bb) > global) continue;
      mask[q] = 0;
      queue[tail++] = q;
    }
  }
  return mask;
}

/** Grows (radius > 0) or shrinks (radius < 0) the kept area by `|radius|` pixels. */
export function growMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius === 0) return mask.slice();
  const keep = radius > 0;
  const r = Math.abs(Math.round(radius));
  // Separable square structuring element: horizontal pass, then vertical.
  const pass = (src: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let value = keep ? 0 : 255;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const v = src[yy * width + xx];
          value = keep ? Math.max(value, v) : Math.min(value, v);
        }
        out[y * width + x] = value;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

/** Softens the mask's edge (box blur of the given radius), for less jagged cut-outs. */
export function softenMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return mask.slice();
  const blur = (src: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let count = 0;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          sum += src[yy * width + xx];
          count++;
        }
        out[y * width + x] = Math.round(sum / count);
      }
    }
    return out;
  };
  return blur(blur(mask, true), false);
}

/** The photo with its alpha channel replaced by the mask. */
export function applyMask(image: RGBAImage, mask: Uint8Array): RGBAImage {
  const data = new Uint8ClampedArray(image.data);
  for (let p = 0; p < mask.length; p++) data[p * 4 + 3] = Math.min(image.data[p * 4 + 3], mask[p]);
  return { width: image.width, height: image.height, data };
}

// ---------------------------------------------------------------------------
// Perspective correction
// ---------------------------------------------------------------------------

/**
 * The 3×3 homography (row-major, h33 = 1) taking the unit-square corners (0,0) (1,0) (1,1)
 * (0,1) to the four given points, solved directly (Heckbert's square-to-quad formula).
 */
export function squareToQuad([p0, p1, p2, p3]: [Point, Point, Point, Point]): number[] {
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = den === 0 ? 0 : (sx * dy2 - dx2 * sy) / den;
  const h = den === 0 ? 0 : (dx1 * sy - sx * dy1) / den;
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
}

/**
 * "Straightens" a photo: the four corners the person marked (top-left, top-right,
 * bottom-right, bottom-left) become a flat rectangle `outWidth` × `outHeight`.
 * Each output pixel looks up its source with the homography (bilinear sampling).
 */
export function warpPerspective(image: RGBAImage, corners: [Point, Point, Point, Point], outWidth: number, outHeight: number): RGBAImage {
  const H = squareToQuad(corners);
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  const { width: w, height: h, data } = image;
  for (let y = 0; y < outHeight; y++) {
    const v = (y + 0.5) / outHeight;
    for (let x = 0; x < outWidth; x++) {
      const u = (x + 0.5) / outWidth;
      const den = H[6] * u + H[7] * v + H[8];
      const sx = (H[0] * u + H[1] * v + H[2]) / den - 0.5;
      const sy = (H[3] * u + H[4] * v + H[5]) / den - 0.5;
      const o = (y * outWidth + x) * 4;
      if (sx < -0.5 || sy < -0.5 || sx > w - 0.5 || sy > h - 0.5) continue;
      const x0 = Math.max(0, Math.min(w - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(h - 1, Math.floor(sy)));
      const x1 = Math.min(w - 1, x0 + 1);
      const y1 = Math.min(h - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const fy = Math.max(0, Math.min(1, sy - y0));
      for (let c = 0; c < 4; c++) {
        const a = data[(y0 * w + x0) * 4 + c] * (1 - fx) + data[(y0 * w + x1) * 4 + c] * fx;
        const b = data[(y1 * w + x0) * 4 + c] * (1 - fx) + data[(y1 * w + x1) * 4 + c] * fx;
        out[o + c] = a * (1 - fy) + b * fy;
      }
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}

// ---------------------------------------------------------------------------
// Tracing a silhouette
// ---------------------------------------------------------------------------

/**
 * The outer outline of the largest kept region in a mask, as a clockwise (on screen)
 * polygon through pixel corners, simplified to within `tolerance` pixels. Null if there
 * is nothing to trace.
 */
export function traceMask(mask: Uint8Array, width: number, height: number, tolerance = 1.5): Point[] | null {
  const inside = largestRegion(mask, width, height);
  if (!inside) return null;
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && inside[y * width + x] === 1;
  // Directed boundary edges with the region on their right (clockwise on screen), keyed by start corner.
  const edges = new Map<number, number[]>();
  const key = (x: number, y: number) => y * (width + 1) + x;
  const addEdge = (ax: number, ay: number, bx: number, by: number) => {
    const k = key(ax, ay);
    const list = edges.get(k) ?? [];
    list.push(key(bx, by));
    edges.set(k, list);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!filled(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!filled(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!filled(x - 1, y)) addEdge(x, y + 1, x, y);
    }
  }
  // Follow loops; where two loops touch at a corner, keep turning right so each loop stays simple.
  const corner = (k: number): Point => ({ x: k % (width + 1), y: Math.floor(k / (width + 1)) });
  let best: Point[] = [];
  for (const startKey of [...edges.keys()]) {
    while ((edges.get(startKey)?.length ?? 0) > 0) {
      const loop: Point[] = [corner(startKey)];
      let current = startKey;
      let direction: Point | null = null;
      for (let guard = 0; guard < 4 * width * height + 8; guard++) {
        const options = edges.get(current);
        if (!options || options.length === 0) break;
        let pick = 0;
        if (options.length > 1 && direction) {
          const c = corner(current);
          const turn = (k: number) => {
            const d = { x: corner(k).x - c.x, y: corner(k).y - c.y };
            return direction!.x * d.y - direction!.y * d.x; // > 0: right turn on screen
          };
          pick = options.reduce((bestIndex, k, i) => (turn(k) > turn(options[bestIndex]) ? i : bestIndex), 0);
        }
        const nextKey = options.splice(pick, 1)[0];
        const a = corner(current);
        const b = corner(nextKey);
        direction = { x: b.x - a.x, y: b.y - a.y };
        current = nextKey;
        if (current === startKey) break;
        loop.push(b);
      }
      if (loop.length > best.length) best = loop;
    }
  }
  if (best.length < 3) return null;
  const simplified = simplifyClosed(best, tolerance);
  return simplified.length >= 3 ? simplified : null;
}

/** Keeps only the largest 4-connected region of kept pixels (1 = inside), or null if none. */
function largestRegion(mask: Uint8Array, width: number, height: number): Uint8Array | null {
  const label = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  let bestLabel = -1;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] < 128 || label[start] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = next;
    while (head < tail) {
      const p = queue[head++];
      const x = p % width;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (q < 0 || q >= mask.length || mask[q] < 128 || label[q] !== -1) continue;
        label[q] = next;
        queue[tail++] = q;
      }
    }
    if (tail > bestSize) {
      bestSize = tail;
      bestLabel = next;
    }
    next++;
  }
  if (bestLabel < 0) return null;
  const inside = new Uint8Array(mask.length);
  for (let p = 0; p < mask.length; p++) if (label[p] === bestLabel) inside[p] = 1;
  return inside;
}

/** Douglas–Peucker simplification of a closed outline. */
export function simplifyClosed(points: Point[], tolerance: number): Point[] {
  if (points.length <= 3) return points;
  // Split at the two points farthest apart, simplify both halves, and join them.
  let far = 0;
  let farDistance = -1;
  for (let i = 0; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y);
    if (d > farDistance) {
      far = i;
      farDistance = d;
    }
  }
  const first = simplifyOpen(points.slice(0, far + 1), tolerance);
  const second = simplifyOpen([...points.slice(far), points[0]], tolerance);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

function simplifyOpen(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;
  const a = points[0];
  const b = points[points.length - 1];
  let index = -1;
  let max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i], a, b);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= tolerance) return [a, b];
  return [...simplifyOpen(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplifyOpen(points.slice(index), tolerance)];
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
