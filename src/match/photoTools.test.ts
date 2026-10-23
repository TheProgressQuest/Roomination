import { describe, expect, it } from 'vitest';
import { adjustBrightness, correctColour, correctImage, cutTexture, sampleColour, softenSeams, suggestPalette, whiteBalanceFrom } from './photoTools';

/** A synthetic photo: left half one colour, right half another, with optional noise. */
function twoTone(w: number, h: number, left: number[], right: number[], noise = 0) {
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * noise;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = x < w / 2 ? left : right;
      const i = (y * w + x) * 4;
      data[i] = c[0] + rand();
      data[i + 1] = c[1] + rand();
      data[i + 2] = c[2] + rand();
      data[i + 3] = 255;
    }
  return { width: w, height: h, data };
}

describe('Match My Room photo tools', () => {
  it('samples the average colour around a point', () => {
    const img = twoTone(100, 60, [200, 190, 170], [40, 42, 48], 20);
    const hex = sampleColour(img, 20, 30, 4);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect(Math.abs(r - 200) + Math.abs(g - 190) + Math.abs(b - 170)).toBeLessThan(15);
  });

  it('suggests the main colours, most common first, the same every time', () => {
    const img = twoTone(120, 80, [235, 230, 220], [30, 32, 36], 10);
    const a = suggestPalette(img, 4);
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(suggestPalette(img, 4)).toEqual(a);
    const light = a.find((h) => parseInt(h.slice(1, 3), 16) > 200);
    const dark = a.find((h) => parseInt(h.slice(1, 3), 16) < 60);
    expect(light && dark).toBeTruthy();
  });

  it('cuts a texture with the marked area’s real proportions and brightens it', () => {
    const img = twoTone(200, 100, [100, 100, 100], [100, 100, 100]);
    const out = cutTexture(img, { corners: [{ x: 10, y: 10 }, { x: 190, y: 10 }, { x: 190, y: 90 }, { x: 10, y: 90 }], widthCm: 60, heightCm: 30, brightness: 1.3, seamless: false }, 256);
    expect([out.width, out.height]).toEqual([256, 128]);
    expect(out.data[0]).toBe(130);
  });

  it('softens seams so opposite edges match', () => {
    const img = twoTone(40, 40, [0, 0, 0], [255, 255, 255]);
    const soft = softenSeams(img, 0.2);
    const left = soft.data[(20 * 40 + 0) * 4];
    const right = soft.data[(20 * 40 + 39) * 4];
    expect(Math.abs(left - right)).toBeLessThan(140);
    expect(adjustBrightness(img, 2).data[(0 + 39) * 4]).toBe(255);
  });
});


describe('white balance', () => {
  it('turns a warm-cast white into neutral grey at the same brightness', () => {
    const warm = '#e0d2bc'; // a white wall under warm light
    const c = whiteBalanceFrom(warm);
    const fixed = correctColour(warm, c);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(fixed.slice(i, i + 2), 16));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(2);
    // A wall sampled elsewhere in the same photo loses the same cast.
    const wall = correctColour('#cfc3ae', c);
    const [wr, , wb] = [1, 3, 5].map((i) => parseInt(wall.slice(i, i + 2), 16));
    expect(Math.abs(wr - wb)).toBeLessThan(6);
  });

  it('applies exposure, and never changes the original image', () => {
    const img = { width: 1, height: 1, data: new Uint8ClampedArray([100, 100, 100, 255]) };
    const out = correctImage(img, { r: 1, g: 1, b: 1, exposure: 1.5 });
    expect(out.data[0]).toBe(150);
    expect(img.data[0]).toBe(100);
    expect(correctImage(img, { r: 1, g: 1, b: 1, exposure: 1 })).toBe(img);
  });
});
