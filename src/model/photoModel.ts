import type { PhotoModel, Silhouette } from './types';

/**
 * Reconstruct (rebuild from photos): an object's shape from its outlines in a few photos, and
 * its look from those photos projected back onto it.
 *
 * Each view (front, side, top) is a perspective-corrected patch of a photo with the object's
 * outline traced in it. A point belongs to the object if every view sees it inside its outline
 * (the "visual hull", the classic shape-from-silhouette technique). The hull is sampled on a
 * grid inside the piece's measured box and turned into a smooth surface, so the result always
 * has the measured width, depth and height. Concave details a silhouette can't see (the dip of a
 * bowl, a recessed dial) stay filled; photos still show them on the surface.
 *
 * Everything here is plain arithmetic: a few milliseconds, on any device, with nothing to
 * download.
 */

/** Silhouettes are at most this many cells across. */
export const MAX_SILHOUETTE_CELLS = 128;
/** Grid cells along the object's longest side. */
export const HULL_CELLS = 40;

/** A point on a patch, 0–1 across and down. */
export interface Point2 {
  x: number;
  y: number;
}

export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

// ---------------------------------------------------------------------------
// Outlines
// ---------------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array | null {
  try {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function encodeSilhouette(cols: number, rows: number, inside: (col: number, row: number) => boolean): Silhouette {
  const bytes = new Uint8Array(Math.ceil((cols * rows) / 8));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (inside(c, r)) bytes[(r * cols + c) >> 3] |= 1 << ((r * cols + c) & 7);
  return { cols, rows, bits: toBase64(bytes) };
}

/** The cells (1 = object), or null if the outline is damaged. */
export function decodeSilhouette(s: Silhouette): Uint8Array | null {
  if (!Number.isInteger(s.cols) || !Number.isInteger(s.rows) || s.cols < 1 || s.rows < 1 || s.cols > MAX_SILHOUETTE_CELLS || s.rows > MAX_SILHOUETTE_CELLS) return null;
  const bytes = fromBase64(s.bits);
  if (!bytes || bytes.length !== Math.ceil((s.cols * s.rows) / 8)) return null;
  const cells = new Uint8Array(s.cols * s.rows);
  for (let i = 0; i < cells.length; i++) cells[i] = (bytes[i >> 3] >> (i & 7)) & 1;
  return cells;
}

/**
 * The object's pixels in a patch (1 = object). The background is whatever joins a tapped point
 * (`seeds`, 0–1 across and down the patch; the whole border if omitted) through pixels within
 * `tolerance` of that point's own colour, like a photo editor's magic wand. Comparing with the
 * tapped colour (not pixel to pixel) keeps it from creeping through gradual changes such as
 * wood grain; shaded background takes another tap. With `tolerance` 0 or no seeds, nothing is
 * removed (the object fills the patch).
 */
export function traceOutline(image: PixelImage, tolerance: number, seeds?: Point2[]): Uint8Array {
  const { width: w, height: h, data } = image;
  const mask = new Uint8Array(w * h).fill(1);
  if (tolerance <= 0 || seeds?.length === 0) return mask;
  // The slider's 0–60 spans roughly "identical" to "clearly different" colours (RGB distance).
  const reach = (tolerance * 2) ** 2;
  const seed = new Int32Array(w * h).fill(-1);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const push = (i: number, from: number) => {
    mask[i] = 0;
    seed[i] = from;
    queue[tail++] = i;
  };
  if (seeds) {
    for (const s of seeds) {
      const i = Math.min(h - 1, Math.max(0, Math.floor(s.y * h))) * w + Math.min(w - 1, Math.max(0, Math.floor(s.x * w)));
      if (mask[i]) push(i, i);
    }
  } else {
    for (let x = 0; x < w; x++) {
      push(x, x);
      if (h > 1) push((h - 1) * w + x, (h - 1) * w + x);
    }
    for (let y = 1; y < h - 1; y++) {
      push(y * w, y * w);
      if (w > 1) push(y * w + w - 1, y * w + w - 1);
    }
  }
  const dist = (a: number, b: number) => {
    const dr = data[a * 4] - data[b * 4];
    const dg = data[a * 4 + 1] - data[b * 4 + 1];
    const db = data[a * 4 + 2] - data[b * 4 + 2];
    return dr * dr + dg * dg + db * db;
  };
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const y = (i - x) / w;
    for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (n < 0 || !mask[n]) continue;
      if (dist(seed[i], n) <= reach) push(n, seed[i]);
    }
  }
  return mask;
}

/** The smallest rectangle around the object's pixels, or null if there are none. */
export function outlineBounds(mask: Uint8Array, width: number, height: number): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (mask[y * width + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** An outline at grid size: a cell is inside if most of its pixels are. */
export function silhouetteFromMask(mask: Uint8Array, width: number, height: number, maxCells = 96): Silhouette {
  const scale = Math.min(1, maxCells / Math.max(width, height));
  const cols = Math.max(1, Math.round(width * scale));
  const rows = Math.max(1, Math.round(height * scale));
  return encodeSilhouette(cols, rows, (c, r) => {
    const xa = Math.floor((c * width) / cols);
    const xb = Math.max(xa + 1, Math.floor(((c + 1) * width) / cols));
    const ya = Math.floor((r * height) / rows);
    const yb = Math.max(ya + 1, Math.floor(((r + 1) * height) / rows));
    let inside = 0;
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) inside += mask[y * width + x];
    return inside * 2 >= (xb - xa) * (yb - ya);
  });
}

// ---------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------

/** Which photo a surface shows. */
export const enum Slot {
  Front = 0,
  Side = 1,
  Top = 2,
  /** Back, bottom and anything no photo shows: the object's average colour. */
  Plain = 3,
}

export interface HullMesh {
  /** cm, in the piece's frame: x right, y up from its base, z towards its front. */
  positions: Float32Array;
  normals: Float32Array;
  /** Where each vertex falls in its surface's photo. */
  uvs: Float32Array;
  index: Uint32Array;
  /** Index ranges by slot, in slot order. */
  groups: { start: number; count: number; slot: Slot }[];
}

type Size = { width: number; depth: number; height: number };

/**
 * A sampler for one view: how much (u, v) (0–1, v from the top) is inside the outline, blended
 * smoothly between neighbouring cells, so a curved edge is found between cells instead of on
 * their steps. Above 0.5 is inside.
 */
function sampler(s: Silhouette | undefined): ((u: number, v: number) => number) | null {
  if (!s) return null;
  const cells = decodeSilhouette(s);
  if (!cells) return null;
  // Softened with a small blur first, so the outline's cell steps round into curves.
  const raw = (c: number, r: number) => cells[Math.max(0, Math.min(s.rows - 1, r)) * s.cols + Math.max(0, Math.min(s.cols - 1, c))];
  const soft = new Float32Array(cells.length);
  for (let r = 0; r < s.rows; r++)
    for (let c = 0; c < s.cols; c++) {
      let sum = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) sum += raw(c + dc, r + dr) * (2 - Math.abs(dc)) * (2 - Math.abs(dr));
      soft[r * s.cols + c] = sum / 16;
    }
  const cell = (c: number, r: number) => soft[Math.max(0, Math.min(s.rows - 1, r)) * s.cols + Math.max(0, Math.min(s.cols - 1, c))];
  return (u, v) => {
    const x = u * s.cols - 0.5;
    const y = v * s.rows - 0.5;
    const c = Math.floor(x);
    const r = Math.floor(y);
    const fx = x - c;
    const fy = y - r;
    const top = cell(c, r) * (1 - fx) + cell(c + 1, r) * fx;
    const bottom = cell(c, r + 1) * (1 - fx) + cell(c + 1, r + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

/**
 * The surface of the object rebuilt from its outlines, at its measured size. Null if no view
 * has a usable outline. Smooth surface from a grid (surface nets), one light smoothing pass.
 */
export function photoModelMesh(model: PhotoModel, size: Size, cells = HULL_CELLS): HullMesh | null {
  const front = sampler(model.front?.silhouette);
  const side = sampler(model.side?.silhouette);
  const top = sampler(model.top?.silhouette);
  if (!front && !side && !top) return null;
  // Every outline fills its photo: the object is simply its box (12 triangles, not thousands).
  if ([model.front, model.side, model.top].every((v) => !v || decodeSilhouette(v.silhouette)!.every((c) => c === 1))) return boxMesh({ front: !!front, side: !!side, top: !!top }, size);
  const { width: w, depth: d, height: h } = size;
  const longest = Math.max(w, d, h);
  const n0 = Math.max(2, Math.round((cells * w) / longest));
  const n1 = Math.max(2, Math.round((cells * h) / longest));
  const n2 = Math.max(2, Math.round((cells * d) / longest));

  // How inside each grid sample is (x across, y up, z towards the front): the least any view
  // says, since a point must be inside every outline.
  const occ = new Float32Array(n0 * n1 * n2);
  for (let k = 0; k < n2; k++)
    for (let j = 0; j < n1; j++)
      for (let i = 0; i < n0; i++) {
        const u = (i + 0.5) / n0;
        const up = (j + 0.5) / n1;
        const z = (k + 0.5) / n2; // 0 at the back, 1 at the front
        occ[(k * n1 + j) * n0 + i] = Math.min(front ? front(u, 1 - up) : 1, side ? side(1 - z, 1 - up) : 1, top ? top(u, z) : 1);
      }
  const value = (i: number, j: number, k: number) => (i < 0 || j < 0 || k < 0 || i >= n0 || j >= n1 || k >= n2 ? 0 : occ[(k * n1 + j) * n0 + i]);
  const at = (i: number, j: number, k: number) => (value(i, j, k) > 0.5 ? 1 : 0);

  // A vertex in every grid cell the surface passes through (cell c spans samples c-1 and c).
  const c0 = n0 + 1;
  const c1 = n1 + 1;
  const cellVertex = new Int32Array(c0 * c1 * (n2 + 1)).fill(-1);
  const pos: number[] = [];
  const sx = w / n0;
  const sy = h / n1;
  const sz = d / n2;
  for (let ck = 0; ck <= n2; ck++)
    for (let cj = 0; cj <= n1; cj++)
      for (let ci = 0; ci <= n0; ci++) {
        // Corners of the cell, and where along each edge inside meets outside (the 0.5 level).
        let ax = 0;
        let ay = 0;
        let az = 0;
        let n = 0;
        const corner = (b: number) => value(ci - 1 + (b & 1), cj - 1 + ((b >> 1) & 1), ck - 1 + ((b >> 2) & 1));
        for (const [a, b] of EDGES) {
          const va = corner(a);
          const vb = corner(b);
          if (va > 0.5 === vb > 0.5) continue;
          const t = Math.max(0, Math.min(1, (0.5 - va) / (vb - va)));
          ax += (a & 1) + ((b & 1) - (a & 1)) * t;
          ay += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          az += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          n++;
        }
        if (!n) continue;
        cellVertex[(ck * c1 + cj) * c0 + ci] = pos.length / 3;
        // Sample s sits at (s + 0.5) cells; a cell's corner b=0 is sample c-1.
        pos.push(-w / 2 + (ci - 0.5 + ax / n) * sx, (cj - 0.5 + ay / n) * sy, -d / 2 + (ck - 0.5 + az / n) * sz);
      }

  // A quad across every grid edge where inside meets outside, facing out.
  const quads: number[] = [];
  const v = (ci: number, cj: number, ck: number) => cellVertex[(ck * c1 + cj) * c0 + ci];
  const quad = (a: number, b: number, c: number, e: number, outward: boolean) => (outward ? quads.push(a, b, c, e) : quads.push(e, c, b, a));
  for (let k = 0; k < n2; k++)
    for (let j = 0; j < n1; j++)
      for (let i = -1; i < n0; i++) {
        const a = at(i, j, k);
        if (a !== at(i + 1, j, k)) quad(v(i + 1, j, k), v(i + 1, j + 1, k), v(i + 1, j + 1, k + 1), v(i + 1, j, k + 1), a === 1);
      }
  for (let k = 0; k < n2; k++)
    for (let j = -1; j < n1; j++)
      for (let i = 0; i < n0; i++) {
        const a = at(i, j, k);
        if (a !== at(i, j + 1, k)) quad(v(i, j + 1, k), v(i, j + 1, k + 1), v(i + 1, j + 1, k + 1), v(i + 1, j + 1, k), a === 1);
      }
  for (let k = -1; k < n2; k++)
    for (let j = 0; j < n1; j++)
      for (let i = 0; i < n0; i++) {
        const a = at(i, j, k);
        if (a !== at(i, j, k + 1)) quad(v(i, j, k + 1), v(i + 1, j, k + 1), v(i + 1, j + 1, k + 1), v(i, j + 1, k + 1), a === 1);
      }
  if (quads.length === 0) return null;

  const positions = smooth(new Float32Array(pos), quads);
  const triangles: number[] = [];
  for (let q = 0; q < quads.length; q += 4) triangles.push(quads[q], quads[q + 1], quads[q + 2], quads[q], quads[q + 2], quads[q + 3]);
  const normals = vertexNormals(positions, triangles);
  return splitBySlot(positions, normals, triangles, { front: !!front, side: !!side, top: !!top }, size);
}

/** The 12 edges of a cell, as pairs of corners (bit 0 = x, bit 1 = y, bit 2 = z). */
const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/** Moves each vertex halfway towards its neighbours' average, softening the grid's steps. */
function smooth(positions: Float32Array, quads: number[]): Float32Array {
  const count = positions.length / 3;
  const sum = new Float32Array(positions.length);
  const n = new Uint16Array(count);
  for (let q = 0; q < quads.length; q += 4)
    for (let e = 0; e < 4; e++) {
      const a = quads[q + e];
      const b = quads[q + ((e + 1) % 4)];
      for (let c = 0; c < 3; c++) {
        sum[a * 3 + c] += positions[b * 3 + c];
        sum[b * 3 + c] += positions[a * 3 + c];
      }
      n[a]++;
      n[b]++;
    }
  const out = new Float32Array(positions.length);
  for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = n[i] ? positions[i * 3 + c] * 0.5 + (sum[i * 3 + c] / n[i]) * 0.5 : positions[i * 3 + c];
  return out;
}

function vertexNormals(positions: Float32Array, triangles: number[]): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const [nx, ny, nz] = faceNormal(positions, a, b, c);
    for (const i of [a, b, c]) {
      normals[i * 3] += nx;
      normals[i * 3 + 1] += ny;
      normals[i * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l;
    normals[i + 1] /= l;
    normals[i + 2] /= l;
  }
  return normals;
}

/** Unnormalised (area-weighted) normal of triangle a, b, c. */
function faceNormal(p: Float32Array, a: number, b: number, c: number): [number, number, number] {
  const ux = p[b * 3] - p[a * 3];
  const uy = p[b * 3 + 1] - p[a * 3 + 1];
  const uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3];
  const vy = p[c * 3 + 1] - p[a * 3 + 1];
  const vz = p[c * 3 + 2] - p[a * 3 + 2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/**
 * Which photo each triangle shows (the view it faces most directly), with each photo projected
 * straight onto it. A vertex shared by two surfaces is copied, one for each photo.
 */
function splitBySlot(positions: Float32Array, normals: Float32Array, triangles: number[], has: { front: boolean; side: boolean; top: boolean }, { width: w, depth: d, height: h }: Size): HullMesh {
  const bySlot: number[][] = [[], [], [], []];
  for (let t = 0; t < triangles.length; t += 3) {
    const [nx, ny, nz] = faceNormal(positions, triangles[t], triangles[t + 1], triangles[t + 2]);
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    let slot = Slot.Plain;
    // A photo goes only on surfaces that clearly face its view; in-between curves (a rounded
    // top seen from the side) take the plain colour rather than a smeared photo.
    const length = Math.hypot(nx, ny, nz) || 1;
    if (az >= ax && az >= ay) slot = nz > 0 && has.front ? Slot.Front : Slot.Plain;
    else if (ax >= ay) slot = has.side && ax / length > 0.8 ? Slot.Side : Slot.Plain;
    else slot = ny > 0 && has.top ? Slot.Top : Slot.Plain;
    bySlot[slot].push(triangles[t], triangles[t + 1], triangles[t + 2]);
  }
  const outPos: number[] = [];
  const outNormal: number[] = [];
  const outUv: number[] = [];
  const index: number[] = [];
  const groups: HullMesh['groups'] = [];
  bySlot.forEach((tris, slot) => {
    if (!tris.length) return;
    const start = index.length;
    const copy = new Map<number, number>();
    for (const i of tris) {
      let j = copy.get(i);
      if (j === undefined) {
        j = outPos.length / 3;
        copy.set(i, j);
        const [x, y, z] = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
        outPos.push(x, y, z);
        outNormal.push(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
        // Texture v runs up the image (v = 1 is the image's top row).
        if (slot === Slot.Front) outUv.push((x + w / 2) / w, y / h);
        else if (slot === Slot.Side) outUv.push((d / 2 - z) / d, y / h);
        else if (slot === Slot.Top) outUv.push((x + w / 2) / w, 1 - (z + d / 2) / d);
        else outUv.push(0, 0);
      }
      index.push(j);
    }
    groups.push({ start, count: index.length - start, slot: slot as Slot });
  });
  return { positions: new Float32Array(outPos), normals: new Float32Array(outNormal), uvs: new Float32Array(outUv), index: new Uint32Array(index), groups };
}

/** The measured box, each face showing the photo of the view it faces (or the plain colour). */
function boxMesh(has: { front: boolean; side: boolean; top: boolean }, size: Size): HullMesh {
  const { width: w, depth: d, height: h } = size;
  const x0 = -w / 2;
  const x1 = w / 2;
  const z0 = -d / 2;
  const z1 = d / 2;
  // Each face: four corners (counter-clockwise from outside) and its outward normal.
  const faces: { corners: number[][]; normal: number[] }[] = [
    { corners: [[x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1]], normal: [0, 0, 1] },
    { corners: [[x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0]], normal: [0, 0, -1] },
    { corners: [[x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1]], normal: [1, 0, 0] },
    { corners: [[x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0]], normal: [-1, 0, 0] },
    { corners: [[x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0]], normal: [0, 1, 0] },
    { corners: [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], normal: [0, -1, 0] },
  ];
  const positions: number[] = [];
  const triangles: number[] = [];
  for (const f of faces) {
    const base = positions.length / 3;
    for (const c of f.corners) positions.push(...c);
    triangles.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const normals: number[] = faces.flatMap((f) => [...f.normal, ...f.normal, ...f.normal, ...f.normal]);
  return splitBySlot(new Float32Array(positions), new Float32Array(normals), triangles, has, size);
}

/** True if the model has at least one view whose outline can be read. */
export function hasPhotoModel(model: PhotoModel | undefined): model is PhotoModel {
  return !!model && [model.front, model.side, model.top].some((v) => v && decodeSilhouette(v.silhouette));
}

/**
 * A photo patch made ready to be one view of an object: mirrored if it shows the left side
 * (views use the right side), the background around the tapped points trimmed (`seeds` are on
 * the mirrored patch), cropped to the object so its outline spans the measured size, and its
 * outline and average colour worked out. Null if nothing of the object is left.
 */
export function prepareView(patch: PixelImage, tolerance: number, mirror = false, seeds: Point2[] = [], symmetric = false): { image: PixelImage; silhouette: Silhouette; color: string } | null {
  const source = mirror ? mirrorImage(patch) : patch;
  const traced = smoothMask(traceOutline(source, tolerance, seeds), source.width, source.height);
  const mask = symmetric ? symmetricMask(traced, source.width, source.height) : traced;
  const box = outlineBounds(mask, source.width, source.height);
  if (!box) return null;
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  const data = new Uint8ClampedArray(width * height * 4);
  const cropMask = new Uint8Array(width * height);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const from = (y + box.y0) * source.width + x + box.x0;
      data.set(source.data.subarray(from * 4, from * 4 + 4), (y * width + x) * 4);
      cropMask[y * width + x] = mask[from];
      if (mask[from]) {
        r += source.data[from * 4];
        g += source.data[from * 4 + 1];
        b += source.data[from * 4 + 2];
        n++;
      }
    }
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
  padBackground(data, cropMask, width, height, [r / n, g / n, b / n]);
  return { image: { width, height, data }, silhouette: silhouetteFromMask(cropMask, width, height), color: `#${hex(r)}${hex(g)}${hex(b)}` };
}

/**
 * Smooths a traced outline (a blur, then back to in or out): photo noise and highlights leave
 * a ragged edge that would otherwise become ridges along the object.
 */
export function smoothMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const r = Math.max(1, Math.round(Math.min(width, height) * 0.012));
  const blur = (src: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let d = -r; d <= r; d++) {
          const xx = horizontal ? Math.max(0, Math.min(width - 1, x + d)) : x;
          const yy = horizontal ? y : Math.max(0, Math.min(height - 1, y + d));
          sum += src[yy * width + xx];
        }
        out[y * width + x] = sum / (2 * r + 1);
      }
    return out;
  };
  const soft = blur(blur(Float32Array.from(mask), true), false);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = soft[i] >= 0.5 ? 1 : 0;
  return out;
}

/**
 * For symmetrical objects: a pixel is the object only if its mirror image across the middle is
 * too. This removes background a photo couldn't separate on one side (in a three-quarter view,
 * the object's own side hides the wall behind one shoulder).
 */
export function symmetricMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + x] = mask[y * width + x] & mask[y * width + width - 1 - x];
  return out;
}

/**
 * Paints trimmed background with the object's own edge colours, spreading outwards (texture
 * padding), so the surface's edges never pick up the wall behind the object.
 */
function padBackground(data: Uint8ClampedArray, mask: Uint8Array, width: number, height: number, average: number[]) {
  const filled = Uint8Array.from(mask);
  for (let pass = 0; pass < 12; pass++) {
    const next = Uint8Array.from(filled);
    let changed = false;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (filled[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) {
          if (j < 0 || !filled[j]) continue;
          r += data[j * 4];
          g += data[j * 4 + 1];
          b += data[j * 4 + 2];
          n++;
        }
        if (!n) continue;
        data[i * 4] = r / n;
        data[i * 4 + 1] = g / n;
        data[i * 4 + 2] = b / n;
        next[i] = 1;
        changed = true;
      }
    filled.set(next);
    if (!changed) break;
  }
  for (let i = 0; i < filled.length; i++) if (!filled[i]) data.set([average[0], average[1], average[2]], i * 4);
}

export function mirrorImage(image: PixelImage): PixelImage {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out.set(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), (y * width + (width - 1 - x)) * 4);
  return { width, height, data: out };
}
