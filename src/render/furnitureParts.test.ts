import { describe, expect, it } from 'vitest';
import type { Furniture, FurnitureKind } from '../model/types';
import { bodySurface, furnitureParts, partCorners, visualOf, type Visual } from './furnitureParts';

type Case = { kind: FurnitureKind; name: string; category?: Furniture['category']; visual: Visual; size: [number, number, number] };

const CASES: Case[] = [
  { kind: 'sofa', name: 'Sofa', visual: 'sofa', size: [220, 95, 85] },
  { kind: 'armchair', name: 'Armchair', visual: 'armchair', size: [85, 85, 90] },
  { kind: 'chair', name: 'Dining chair', visual: 'chair', size: [48, 52, 90] },
  { kind: 'chair', name: 'Desk chair', visual: 'officeChair', size: [60, 60, 105] },
  { kind: 'bed', name: 'Double bed', visual: 'bed', size: [160, 205, 55] },
  { kind: 'table', name: 'Table', visual: 'table', size: [120, 80, 75] },
  { kind: 'coffeeTable', name: 'Coffee table', visual: 'coffeeTable', size: [110, 60, 45] },
  { kind: 'diningTable', name: 'Dining table', visual: 'diningTable', size: [180, 90, 76] },
  { kind: 'desk', name: 'Desk', visual: 'desk', size: [140, 70, 75] },
  { kind: 'bookshelf', name: 'Bookshelf', visual: 'bookshelf', size: [100, 35, 190] },
  { kind: 'cabinet', name: 'Sideboard', visual: 'cabinet', size: [160, 45, 80] },
  { kind: 'storage', name: 'Wardrobe', visual: 'wardrobe', size: [150, 60, 210] },
  { kind: 'bedsideTable', name: 'Bedside table', visual: 'bedsideTable', size: [45, 40, 55] },
  { kind: 'television', name: 'TV unit', visual: 'television', size: [160, 45, 110] },
  { kind: 'television', name: 'Wall TV', visual: 'television', size: [140, 10, 80] },
  { kind: 'decor', name: 'Plant', visual: 'plant', size: [45, 45, 120] },
  { kind: 'decor', name: 'Floor lamp', visual: 'lamp', size: [40, 40, 160] },
  { kind: 'decor', name: 'Vase', visual: 'vase', size: [25, 25, 50] },
  { kind: 'custom', name: 'Rug', category: 'floorCovering', visual: 'rug', size: [200, 140, 1] },
  { kind: 'custom', name: 'Box', visual: 'block', size: [80, 50, 75] },
];

const SCALES = [0.2, 0.5, 1, 1.6, 3];

const item = (c: Case, [w, d, h]: [number, number, number], id = 'piece-1') => ({ id, name: c.name, kind: c.kind, category: c.category ?? 'furniture', width: w, depth: d, height: h, color: '#c8b8a0' });

describe('furniture parts', () => {
  it('gives each kind its intended design', () => {
    for (const c of CASES) expect(visualOf(item(c, c.size)), c.name).toBe(c.visual);
  });

  it.each(CASES)('$name stays inside its real size at every scale', (c) => {
    for (const s of SCALES) {
      const size = c.size.map((v, i) => (i === 2 && c.category === 'floorCovering' ? v : Math.max(1, v * s))) as [number, number, number];
      const [w, d, h] = size;
      const parts = furnitureParts(item(c, size));
      expect(parts.length, `${c.name} ×${s}`).toBeGreaterThan(0);
      for (const p of parts) {
        expect(p.width > 0 && p.depth > 0 && p.height > 0).toBe(true);
        if (p.radius !== undefined) expect(p.radius).toBeLessThanOrEqual(Math.min(p.width, p.depth, p.height) / 2 + 1e-9);
        for (const q of partCorners(p)) {
          const where = `${c.name} ×${s} ${p.role} at (${q.x.toFixed(2)}, ${q.y.toFixed(2)}, ${q.z.toFixed(2)}) in ${w}×${d}×${h}`;
          expect(Math.abs(q.x), where).toBeLessThanOrEqual(w / 2 + 0.01);
          expect(Math.abs(q.y), where).toBeLessThanOrEqual(d / 2 + 0.01);
          expect(q.z, where).toBeGreaterThanOrEqual(-0.01);
          expect(q.z, where).toBeLessThanOrEqual(h + 0.01);
        }
      }
    }
  });

  it('reaches the full size, so pieces don\'t look smaller than they are', () => {
    for (const c of CASES.filter((c) => !['plant', 'lamp', 'vase', 'officeChair'].includes(c.visual))) {
      const [w, d, h] = c.size;
      const corners = furnitureParts(item(c, c.size)).flatMap(partCorners);
      expect(Math.max(...corners.map((q) => q.x)) - Math.min(...corners.map((q) => q.x)), c.name).toBeGreaterThan(w * 0.97);
      expect(Math.max(...corners.map((q) => q.y)) - Math.min(...corners.map((q) => q.y)), c.name).toBeGreaterThan(d * 0.95);
      expect(Math.max(...corners.map((q) => q.z)), c.name).toBeGreaterThan(h * 0.97);
    }
  });

  it('builds recognisable components', () => {
    const roles = (c: Case) => new Set(furnitureParts(item(c, c.size)).map((p) => p.role));
    const byName = (n: string) => CASES.find((c) => c.name === n)!;
    expect([...roles(byName('Sofa'))]).toEqual(expect.arrayContaining(['arm', 'back', 'cushion', 'pillow', 'leg']));
    expect([...roles(byName('Double bed'))]).toEqual(expect.arrayContaining(['headboard', 'mattress', 'duvet', 'throw', 'pillow']));
    expect([...roles(byName('Bookshelf'))]).toEqual(expect.arrayContaining(['shelf', 'book']));
    expect([...roles(byName('Wardrobe'))]).toEqual(expect.arrayContaining(['door', 'handle']));
    expect([...roles(byName('Plant'))]).toEqual(expect.arrayContaining(['pot', 'leaf']));
    expect(furnitureParts(item(byName('Plant'), [45, 45, 120])).filter((p) => p.role === 'leaf').length).toBeGreaterThan(10);
    expect(furnitureParts(item(byName('Sofa'), [220, 95, 85])).filter((p) => p.role === 'cushion').length).toBe(6);
  });

  it('is the same every time for the same piece, and differs between pieces', () => {
    const shelf = CASES.find((c) => c.name === 'Bookshelf')!;
    expect(furnitureParts(item(shelf, shelf.size))).toEqual(furnitureParts(item(shelf, shelf.size)));
    expect(furnitureParts(item(shelf, shelf.size, 'a'))).not.toEqual(furnitureParts(item(shelf, shelf.size, 'b')));
  });

  it('uses the person\'s material, or a sensible default for the kind', () => {
    const sofa = item(CASES[0], CASES[0].size);
    expect(bodySurface(sofa)).toBe('fabric');
    expect(bodySurface({ ...sofa, appearance: { material: 'leather', finish: 'satin' } })).toBe('leather');
    expect(bodySurface(item(CASES[5], CASES[5].size))).toBe('wood');
  });
});
