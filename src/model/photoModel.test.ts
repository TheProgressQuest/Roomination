import { describe, expect, it } from 'vitest';
import { decodeSilhouette, encodeSilhouette, hasPhotoModel, outlineBounds, photoModelMesh, prepareView, silhouetteFromMask, Slot, symmetricMask, traceOutline } from './photoModel';
import type { PhotoModelView } from './types';

const view = (cols: number, rows: number, inside: (c: number, r: number) => boolean): PhotoModelView => ({ assetId: 'a'.repeat(64), silhouette: encodeSilhouette(cols, rows, inside), color: '#886644' });
const full = view(4, 4, () => true);
const size = { width: 40, depth: 20, height: 30 };

function bounds(p: Float32Array) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c], p[i + c]);
      max[c] = Math.max(max[c], p[i + c]);
    }
  return { min, max };
}

describe('outlines', () => {
  it('round-trip through their compact form', () => {
    const s = encodeSilhouette(13, 7, (c, r) => (c + r) % 3 === 0);
    const cells = decodeSilhouette(s)!;
    expect(cells[0]).toBe(1);
    expect(cells[1]).toBe(0);
    expect(cells[3]).toBe(1);
    expect(cells[13 + 2]).toBe(1);
  });

  it('refuse damaged or oversized outlines', () => {
    expect(decodeSilhouette({ cols: 4, rows: 4, bits: 'AAAA' })).toBeNull();
    expect(decodeSilhouette({ cols: 500, rows: 4, bits: '' })).toBeNull();
    expect(decodeSilhouette({ cols: 4, rows: 4, bits: '%%%' })).toBeNull();
  });

  it('trims a plain background around an object, but not the object', () => {
    // A 20 × 20 grey patch with a dark 10 × 10 square in the middle.
    const w = 20;
    const data = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++) {
        const inside = x >= 5 && x < 15 && y >= 5 && y < 15;
        data.set(inside ? [60, 40, 30, 255] : [200, 200, 200, 255], (y * w + x) * 4);
      }
    const mask = traceOutline({ width: w, height: w, data }, 20);
    expect(outlineBounds(mask, w, w)).toEqual({ x0: 5, y0: 5, x1: 15, y1: 15 });
    // Tolerance 0 keeps everything (the object fills the patch).
    expect(outlineBounds(traceOutline({ width: w, height: w, data }, 0), w, w)).toEqual({ x0: 0, y0: 0, x1: 20, y1: 20 });
    const s = silhouetteFromMask(mask, w, w, 10);
    expect(s).toMatchObject({ cols: 10, rows: 10 });
  });
});

describe('trimming by tapping the background', () => {
  // A 40 × 40 patch: a brown arch that touches the left, right and bottom edges, pale wall in
  // the top corners, and a darker "side of the object" hiding the wall at the top right.
  const w = 40;
  const data = new Uint8ClampedArray(w * w * 4);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const arch = y >= 20 || Math.hypot(x + 0.5 - 20, y + 0.5 - 20) <= 20;
      const side = !arch && x >= 30 && y < 12;
      data.set(arch ? [120, 70, 40, 255] : side ? [50, 30, 20, 255] : [235, 232, 225, 255], (y * w + x) * 4);
    }
  const patch = { width: w, height: w, data };

  it('removes only what joins the tapped point, never the object along the edges', () => {
    const mask = traceOutline(patch, 20, [{ x: 0.02, y: 0.02 }]);
    expect(mask[0]).toBe(0); // top-left wall
    expect(mask[39 * w]).toBe(1); // bottom-left: the object, on the patch's edge
    expect(mask[39 * w + 39]).toBe(1);
    expect(mask[w - 1]).toBe(1); // top-right: the hidden corner isn't touched
    expect(traceOutline(patch, 20, [])[0]).toBe(1); // no taps, nothing trimmed
  });

  it('a symmetrical outline also clears the corner the object’s side hid', () => {
    const traced = traceOutline(patch, 20, [{ x: 0.02, y: 0.02 }]);
    const mask = symmetricMask(traced, w, w);
    expect(mask[w - 1]).toBe(0);
    expect(mask[20 * w + 39]).toBe(1);
    const view = prepareView(patch, 20, false, [{ x: 0.02, y: 0.02 }], true)!;
    // Still spans the whole patch (its measured size), and its colour is the arch's.
    expect(view.image.width).toBe(40);
    expect(view.color).toMatch(/^#78462[0-9a-f]$/);
  });
});

describe('rebuilt shape', () => {
  it('is null without a usable view', () => {
    expect(photoModelMesh({}, size)).toBeNull();
    expect(hasPhotoModel({ front: { ...full, silhouette: { cols: 2, rows: 2, bits: '!!' } } })).toBe(false);
  });

  it('fills the measured box exactly when the object fills every photo', () => {
    const mesh = photoModelMesh({ front: full }, size)!;
    const { min, max } = bounds(mesh.positions);
    expect(max[0] - min[0]).toBeCloseTo(40, 0);
    expect(max[1] - min[1]).toBeCloseTo(30, 0);
    expect(max[2] - min[2]).toBeCloseTo(20, 0);
    expect(min[1]).toBeGreaterThanOrEqual(-0.01);
  });

  it('follows a curved outline: an arched top is lower at the corners than the middle', () => {
    // Front outline: a rectangle with a semicircular top half.
    const arch = view(40, 40, (c, r) => r >= 20 || Math.hypot(c + 0.5 - 20, r + 0.5 - 20) <= 20);
    const mesh = photoModelMesh({ front: arch }, { width: 40, depth: 20, height: 40 })!;
    const p = mesh.positions;
    let cornerTop = 0;
    let middleTop = 0;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] < -17) cornerTop = Math.max(cornerTop, p[i + 1]);
      if (Math.abs(p[i]) < 3) middleTop = Math.max(middleTop, p[i + 1]);
    }
    expect(middleTop).toBeGreaterThan(37);
    expect(cornerTop).toBeLessThan(32);
  });

  it('shows each photo on the surfaces facing its view, and a plain colour elsewhere', () => {
    const mesh = photoModelMesh({ front: full, side: full }, size)!;
    const slots = mesh.groups.map((g) => g.slot);
    expect(slots).toContain(Slot.Front);
    expect(slots).toContain(Slot.Side);
    expect(slots).not.toContain(Slot.Top);
    expect(slots).toContain(Slot.Plain);
    // Front-facing surfaces sit at the front (z = +depth/2) and point out of it.
    const front = mesh.groups.find((g) => g.slot === Slot.Front)!;
    const i = mesh.index[front.start];
    expect(mesh.positions[i * 3 + 2]).toBeGreaterThan(9);
    expect(mesh.normals[i * 3 + 2]).toBeGreaterThan(0.5);
    // Texture coordinates stay within the photo.
    for (const uv of mesh.uvs) expect(uv).toBeGreaterThanOrEqual(-0.01), expect(uv).toBeLessThanOrEqual(1.01);
  });

  it('stays light enough for phones', () => {
    const arch = view(64, 64, (c, r) => r >= 32 || Math.hypot(c - 32, r - 32) <= 32);
    const started = performance.now();
    const mesh = photoModelMesh({ front: arch, side: full, top: full }, { width: 35, depth: 25, height: 40 })!;
    const ms = performance.now() - started;
    expect(mesh.index.length / 3).toBeLessThan(40_000);
    expect(ms).toBeLessThan(500);
  });
});

describe('saving a rebuilt object', () => {
  it('keeps its views, drops a damaged one, and counts its photos as in use', async () => {
    const { parseProjectFile, serializeProject, furnitureAssetIds } = await import('../storage/projectFile');
    const { createEmptyProject, createFurniture, createRectangularRoom } = await import('./sample');
    const { withAssets } = await import('../storage/projectPackage');
    const front = view(8, 8, () => true);
    const piece = createFurniture({ id: 'radio', x: 100, y: 100, width: 30, depth: 19, height: 35, photoModel: { front, side: { ...front, assetId: 'b'.repeat(64), silhouette: { cols: 4, rows: 4, bits: 'not base64!' } }, off: true } });
    const project = { ...createEmptyProject(createRectangularRoom(300, 300)), furniture: [piece] };
    const result = parseProjectFile(serializeProject(project));
    if (!result.ok) throw new Error(result.error);
    const saved = result.project.furniture[0];
    expect(saved.photoModel?.front).toEqual(front);
    expect(saved.photoModel?.side).toBeUndefined();
    expect(saved.photoModel?.off).toBe(true);
    // The measurements are untouched by the rebuilt look.
    expect(saved).toMatchObject({ width: 30, depth: 19, height: 35 });
    expect(furnitureAssetIds(saved)).toContain('a'.repeat(64));
    // Exported without its photo, the view (and so the rebuilt look) is dropped, not left broken.
    expect(withAssets(result.project, () => null).furniture[0].photoModel).toBeUndefined();
  });
});

describe('a boxy object', () => {
  it('is drawn as its box: 12 triangles, each face with its own photo', () => {
    const mesh = photoModelMesh({ front: full, top: full }, size)!;
    expect(mesh.index.length / 3).toBe(12);
    const slots = mesh.groups.map((g) => [g.slot, g.count / 3]);
    expect(slots).toEqual([[Slot.Front, 2], [Slot.Top, 2], [Slot.Plain, 8]]);
    const { min, max } = bounds(mesh.positions);
    expect([max[0] - min[0], max[1] - min[1], max[2] - min[2]]).toEqual([40, 30, 20]);
  });
});
