import { describe, expect, it } from 'vitest';
import { syntheticRoomPhoto } from '../../e2e/syntheticPhoto';
import { AREA_MODEL } from './areaSelectModel';
import { ModelFetchError, obtainModelFile, sha256 } from './modelFetch';
import { deltaE, hexToLab, representativeColour } from './representativeColour';
import { bestCandidate, candidateMasks, decoderPoints, encoderInput, resizedSize } from './sam';

/** SYNTHETIC images only. The model itself is exercised in the browser tests and the benchmark. */

describe('preparing a photo for the model', () => {
  it('resizes the longest side to 1024 and scales taps with it', () => {
    expect(resizedSize(1600, 1200)).toMatchObject({ width: 1024, height: 768 });
    expect(resizedSize(900, 1200)).toMatchObject({ width: 768, height: 1024 });
    const input = encoderInput({ width: 4, height: 2, data: new Uint8ClampedArray(4 * 2 * 4).fill(200) });
    expect(input).toMatchObject({ width: 1024, height: 512 });
    expect(input.data[0]).toBeCloseTo(200);
    const { coords, labels, count } = decoderPoints([{ x: 800, y: 600, include: true }, { x: 100, y: 50, include: false }], 1600, 1200);
    expect(count).toBe(3);
    expect([...coords]).toEqual([512, 384, 64, 32, 0, 0]);
    // A trailing padding point labelled −1 means "no box".
    expect([...labels]).toEqual([1, 0, -1]);
  });
});

describe('turning the model’s masks into areas of the photo', () => {
  /** Low-resolution logits: positive inside a rectangle (in 256-grid cells), negative elsewhere. */
  const logits = (rects: [number, number, number, number][]) => {
    const out = new Float32Array(rects.length * 256 * 256).fill(-5);
    rects.forEach(([x0, y0, x1, y1], k) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out[k * 65536 + y * 256 + x] = 5;
    });
    return out;
  };

  it('maps the padded square back onto the photo, smallest area first', () => {
    // A 1600 × 1200 photo fills 256 × 192 cells of the grid; the rest is padding.
    const masks = logits([[0, 0, 128, 192], [0, 0, 64, 96], [0, 0, 256, 192]]);
    const c = candidateMasks(masks, new Float32Array([0.9, 0.95, 0.5]), 160, 120);
    expect(c.map((m) => Math.round(m.area * 1000) / 10)).toEqual([12.5, 50, 100]);
    expect(c[0].mask[0]).toBe(1); // top left, inside
    expect(c[0].mask[119 * 160 + 159]).toBe(0); // bottom right, outside
    expect(bestCandidate(c)).toBe(0); // the 0.95-scored one
  });

  it('drops empty masks and near-duplicates', () => {
    const c = candidateMasks(logits([[0, 0, 128, 192], [0, 0, 128, 192], [0, 0, 0, 0]]), new Float32Array([0.6, 0.8, 0.9]), 160, 120);
    expect(c).toHaveLength(1);
    expect(c[0].score).toBeCloseTo(0.8);
  });
});

describe('measuring the colour of an area', () => {
  const photo = syntheticRoomPhoto();
  const error = (hex: string, truth: string) => deltaE(hexToLab(hex), hexToLab(truth));

  it('finds each surface’s colour, ignoring shine, shadow, a throw and the edges', () => {
    for (const k of ['sofa', 'wall', 'floor'] as const) {
      const result = representativeColour(photo, photo.masks[k])!;
      expect(error(result.hex, photo.colours[k]), k).toBeLessThan(3);
      expect(result.share).toBeGreaterThan(0.5);
    }
  });

  it('is not pulled towards a different colour inside the area', () => {
    // Half the area red: the median picks one material, not a muddy mix.
    const width = 100;
    const height = 50;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set(i % width < 40 ? [200, 30, 30, 255] : [60, 90, 160, 255], i * 4);
    const result = representativeColour({ width, height, data }, new Uint8Array(width * height).fill(1))!;
    expect(error(result.hex, '#3c5aa0')).toBeLessThan(2);
  });

  it('gives nothing for a tiny area', () => {
    expect(representativeColour(photo, new Uint8Array(photo.width * photo.height))).toBeNull();
  });
});

describe('downloading the model', () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const file = async () => ({ path: 'm.onnx', url: 'https://site/m.onnx', bytes: bytes.length, sha256: await sha256(bytes) });
  const respond = (body: Uint8Array) => async () => new Response(new Blob([body as Uint8Array<ArrayBuffer>]));
  const memoryCache = () => {
    const store = new Map<string, Response>();
    return { store, match: async (u: RequestInfo | URL) => store.get(String(u))?.clone(), put: async (u: RequestInfo | URL, r: Response) => void store.set(String(u), r), delete: async (u: RequestInfo | URL) => store.delete(String(u)) };
  };

  it('downloads, checks, reports progress and keeps the file', async () => {
    const cache = memoryCache();
    const progress: number[] = [];
    const first = await obtainModelFile(await file(), respond(bytes), cache as unknown as Cache, (n) => progress.push(n));
    expect(first.fromCache).toBe(false);
    expect([...first.bytes]).toEqual([...bytes]);
    expect(progress.at(-1)).toBe(8);
    const again = await obtainModelFile(await file(), () => Promise.reject(new Error('offline')), cache as unknown as Cache, () => {});
    expect(again.fromCache).toBe(true); // works offline once kept
  });

  it('refuses a file that isn’t the expected one, and never keeps it', async () => {
    const cache = memoryCache();
    const wrong = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]);
    await expect(obtainModelFile(await file(), respond(wrong), cache as unknown as Cache, () => {})).rejects.toMatchObject({ kind: 'integrity' });
    await expect(obtainModelFile(await file(), respond(new Uint8Array(20)), cache as unknown as Cache, () => {})).rejects.toBeInstanceOf(ModelFetchError);
    expect(cache.store.size).toBe(0);
  });

  it('replaces a damaged cached copy', async () => {
    const cache = memoryCache();
    const f = await file();
    cache.store.set(f.url, new Response(new Blob([new Uint8Array(8)])));
    const result = await obtainModelFile(f, respond(bytes), cache as unknown as Cache, () => {});
    expect(result.fromCache).toBe(false);
    expect([...result.bytes]).toEqual([...bytes]);
  });

  it('explains a failed download', async () => {
    await expect(obtainModelFile(await file(), () => Promise.reject(new TypeError('Failed to fetch')), null, () => {})).rejects.toMatchObject({ kind: 'download' });
    await expect(obtainModelFile(await file(), async () => new Response('missing', { status: 404 }), null, () => {})).rejects.toMatchObject({ kind: 'download', message: expect.stringMatching(/404/) });
  });

  it('the published files match the sizes and sums the app checks', async () => {
    // Node's file API (app sources don't carry Node's types; the tests run in Node).
    const fsModule = 'node:fs/promises';
    const { readFile } = (await import(/* @vite-ignore */ fsModule)) as { readFile: (path: string) => Promise<Uint8Array> };
    for (const f of Object.values(AREA_MODEL)) {
      const data = new Uint8Array(await readFile(`public/${f.path}`));
      expect(data.length).toBe(f.bytes);
      expect(await sha256(data)).toBe(f.sha256);
    }
  });
});
