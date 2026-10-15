import { describe, expect, it } from 'vitest';
import { componentExtent, placeComponents } from '../model/components';
import { createFurniture } from '../model/sample';
import { componentParts, furnitureParts } from '../render/furnitureParts';
import { parseFurnitureTemplate } from '../storage/projectFile';
import { CATALOGUE, CATEGORY_LABELS, searchCatalogue, type CatalogueCategory } from './items';

describe('furniture catalogue', () => {
  it('is large, with unique ids and names, and covers every category', () => {
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(130);
    expect(new Set(CATALOGUE.map((i) => i.id)).size).toBe(CATALOGUE.length);
    expect(new Set(CATALOGUE.map((i) => i.name)).size).toBe(CATALOGUE.length);
    for (const category of Object.keys(CATEGORY_LABELS) as CatalogueCategory[]) {
      expect(CATALOGUE.filter((i) => i.category === category).length, category).toBeGreaterThanOrEqual(4);
    }
  });

  for (const item of CATALOGUE) {
    it(`${item.category} · ${item.name}: builds, fits its footprint, saves and renders`, () => {
      const t = item.make();
      expect(t.name).toBe(item.name);
      expect(t.width).toBeGreaterThan(0);
      expect(t.depth).toBeGreaterThan(0);
      expect(t.height).toBeGreaterThan(0);
      // Stays a valid saved template (nothing dropped on the way through the file format).
      const round = parseFurnitureTemplate(JSON.parse(JSON.stringify(t)));
      expect(round).not.toBeNull();
      expect(round!.components ?? []).toEqual(t.components ?? []);
      if (t.components?.length) {
        const ext = componentExtent(t);
        expect(ext.overflow, 'every component inside the footprint and above the floor').toEqual([]);
        expect(ext.top).toBeLessThanOrEqual(t.height + 0.05);
        expect(componentParts(t.components).length).toBe(placeComponents(t.components).length);
        for (const c of t.components) expect(c.rotation).toBeLessThan(360);
      } else {
        expect(furnitureParts({ ...t, id: item.id }).length).toBeGreaterThan(0);
      }
    });
  }

  it('finds items by name, category and extra words', () => {
    expect(searchCatalogue('toilet').map((i) => i.id)).toContain('toilet');
    expect(searchCatalogue('wc').length).toBeGreaterThanOrEqual(2);
    expect(searchCatalogue('jacuzzi').map((i) => i.id)).toEqual(['hot-tub', 'hot-tub-round']);
    expect(searchCatalogue('sofa', 'outdoor').every((i) => i.category === 'outdoor')).toBe(true);
    expect(searchCatalogue('', 'kitchen').length).toBeGreaterThanOrEqual(10);
    expect(searchCatalogue('nothing like this exists')).toEqual([]);
  });

  it('places fixtures as fixtures (the optimizer leaves them in place)', () => {
    const fixtures = CATALOGUE.filter((i) => ['kitchen', 'bathroom', 'laundry'].includes(i.category)).map((i) => i.make());
    expect(fixtures.filter((t) => t.kind === 'fixture').length).toBeGreaterThanOrEqual(25);
    const placed = createFurniture({ ...fixtures[0], x: 100, y: 100 });
    expect(placed.kind).toBe('fixture');
  });
});

describe('fixtures and the optimizer', () => {
  it('never moves fixtures, even when they are offered as movable', async () => {
    const { optimize } = await import('../optimizer/optimize');
    const { DEFAULT_OPTIMIZER } = await import('../model/furnitureKinds');
    const { createEmptyProject, createFurniture: make } = await import('../model/sample');
    const project = createEmptyProject();
    const pick = (id: string) => CATALOGUE.find((i) => i.id === id)!.make();
    const toilet = make({ ...pick('toilet'), x: 40, y: 60 });
    const vanity = make({ ...pick('vanity-60'), x: 120, y: 30 });
    const sofa = make({ ...pick('sofa-3'), x: 200, y: 250 });
    const room = { ...project, furniture: [toilet, vanity, sofa] };
    const result = optimize({ project: room, settings: { ...DEFAULT_OPTIMIZER, effort: 'quick', seed: 3 }, movableIds: [toilet.id, vanity.id, sofa.id] });
    for (const s of result.suggestions) {
      for (const fixture of [toilet, vanity]) {
        const p = s.positions.find((q) => q.id === fixture.id);
        if (p) expect({ x: p.x, y: p.y, rotation: p.rotation }).toEqual({ x: fixture.x, y: fixture.y, rotation: fixture.rotation });
      }
    }
  });
});
