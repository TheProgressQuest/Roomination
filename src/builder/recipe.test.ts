import { describe, expect, it } from 'vitest';
import { findConflicts } from '../model/conflicts';
import { createEmptyProject, createFurniture, createRectangularRoom } from '../model/sample';
import { footprintArea, localFootprint } from '../model/shape';
import type { BuilderNode } from '../model/types';
import { buildShape, combine, createPrimitive, duplicateNode, findNode, nodeBounds, recipeFor, rotateNode, scaleNode, separate, translateNode, type ShapeNode } from './recipe';

let next = 0;
const id = () => `n${++next}`;
const rect = (x: number, y: number, width: number, depth: number, rotation = 0): ShapeNode => ({ id: id(), type: 'shape', kind: 'rectangle', x, y, rotation, width, depth });
const areaOf = (nodes: BuilderNode[]) => {
  const r = buildShape(nodes);
  if (!r.shape) throw new Error(r.problem ?? 'no shape');
  return footprintArea(localFootprint({ width: r.width, depth: r.depth, shape: r.shape }));
};

describe('basic shapes', () => {
  it('makes every kind at its stated size', () => {
    for (const kind of ['rectangle', 'square', 'circle', 'ellipse', 'triangle', 'polygon', 'arc'] as const) {
      const r = buildShape([createPrimitive(kind, id())]);
      expect(r.problem, kind).toBeNull();
      expect(r.width, kind).toBeGreaterThan(10);
    }
    expect(buildShape([createPrimitive('rectangle', id())])).toMatchObject({ width: 100, depth: 60 });
    expect(buildShape([createPrimitive('circle', id())])).toMatchObject({ width: 60, depth: 60 });
  });

  it('keeps a lone circle as true curves', () => {
    const r = buildShape([createPrimitive('circle', id())]);
    expect(r.shape!.points).toHaveLength(4);
    expect(r.shape!.points.every((p) => p.c1 && p.c2)).toBe(true);
    expect(areaOf([createPrimitive('circle', id())]) / (Math.PI * 900)).toBeGreaterThan(0.98);
  });

  it('makes a full 360° curved section a ring with a hole', () => {
    const ring: ShapeNode = { ...createPrimitive('arc', id()), width: 200, depth: 50, sweep: 360 };
    const r = buildShape([ring]);
    expect(r.shape!.holes).toHaveLength(1);
    const expected = Math.PI * (100 ** 2 - 50 ** 2);
    expect(Math.abs(areaOf([ring]) / expected - 1)).toBeLessThan(0.02);
  });

  it('turns shapes', () => {
    const r = buildShape([rect(0, 0, 100, 40, 90)]);
    expect(r.width).toBeCloseTo(40, 6);
    expect(r.depth).toBeCloseTo(100, 6);
  });
});

describe('combining', () => {
  it('merges overlapping shapes into one outline (an L)', () => {
    const nodes: BuilderNode[] = [{ id: id(), type: 'union', children: [rect(0, 0, 160, 60), rect(-50, 60, 60, 80)] }];
    const r = buildShape(nodes);
    expect(r.shape!.islands).toBeUndefined();
    expect(r.shape!.points).toHaveLength(6);
    expect(areaOf(nodes)).toBeCloseTo(160 * 60 + 60 * 80 - 60 * 10, 3);
  });

  it('cuts a hole when the cutter is inside, and a notch when it crosses the edge', () => {
    const hole: BuilderNode[] = [{ id: id(), type: 'subtract', children: [rect(0, 0, 200, 200), rect(0, 0, 100, 100)] }];
    const r = buildShape(hole);
    expect(r.shape!.holes).toHaveLength(1);
    expect(areaOf(hole)).toBeCloseTo(30000, 3);
    const notch: BuilderNode[] = [{ id: id(), type: 'subtract', children: [rect(0, 0, 200, 100), rect(100, 0, 60, 40)] }];
    expect(buildShape(notch).shape!.holes).toBeUndefined();
    expect(areaOf(notch)).toBeCloseTo(20000 - 30 * 40, 3);
  });

  it('keeps only the shared area when intersecting', () => {
    const nodes: BuilderNode[] = [{ id: id(), type: 'intersect', children: [rect(0, 0, 100, 100), rect(50, 50, 100, 100)] }];
    expect(areaOf(nodes)).toBeCloseTo(2500, 3);
    const apart: BuilderNode[] = [{ id: id(), type: 'intersect', children: [rect(0, 0, 50, 50), rect(200, 0, 50, 50)] }];
    expect(buildShape(apart).problem).toMatch(/Nothing is left/);
  });

  it('keeps grouped parts separate (with the space between them free)', () => {
    const nodes: BuilderNode[] = [{ id: id(), type: 'group', children: [rect(-100, 0, 100, 80), rect(100, 0, 100, 80)] }];
    const r = buildShape(nodes);
    expect(r.shape!.islands).toHaveLength(1);
    expect(r.width).toBeCloseTo(300, 6);
    const room = createRectangularRoom(500, 500);
    const tables = createFurniture({ name: 'Nesting tables', x: 250, y: 250, ...r.shape && { shape: r.shape, width: r.width, depth: r.depth }, height: 50 });
    const pouf = createFurniture({ name: 'Pouf', x: 250, y: 250, width: 40, depth: 40, height: 40 });
    expect(findConflicts({ ...createEmptyProject(room, 'Group'), furniture: [tables, pouf] }).filter((c) => c.type === 'collision')).toEqual([]);
  });

  it('joins grouped parts that overlap, without losing them from the recipe', () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(80, 0, 100, 100);
    const r = buildShape([{ id: id(), type: 'group', children: [a, b] }]);
    expect(r.shape!.islands).toBeUndefined();
    expect(r.width).toBeCloseTo(180, 6);
    expect(findNode(r.shape!.source!, a.id)).not.toBeNull();
  });

  it('combines siblings in list order, and separates them again', () => {
    const base = rect(0, 0, 200, 200);
    const cutter = rect(0, 0, 50, 50);
    const extra = rect(300, 0, 50, 50);
    const nodes = combine([base, cutter, extra], [base.id, cutter.id], 'subtract', 'cut')!;
    expect(nodes.map((n) => n.id)).toEqual(['cut', extra.id]);
    expect(buildShape(nodes).shape!.holes).toHaveLength(1);
    expect(separate(nodes, 'cut').map((n) => n.id)).toEqual([base.id, cutter.id, extra.id]);
    // Not siblings: refused.
    expect(combine(nodes, [base.id, extra.id], 'union', 'x')).toBeNull();
  });
});

describe('editing', () => {
  it('moves, turns and stretches whole combinations', () => {
    const group: BuilderNode = { id: id(), type: 'group', children: [rect(-50, 0, 40, 40), rect(50, 0, 40, 40)] };
    expect(nodeBounds(translateNode(group, 10, 5))).toEqual({ minX: -60, minY: -15, maxX: 80, maxY: 25 });
    const turned = nodeBounds(rotateNode(group, 90, { x: 0, y: 0 }));
    expect(turned.maxX - turned.minX).toBeCloseTo(40, 6);
    expect(turned.maxY - turned.minY).toBeCloseTo(140, 6);
    const stretched = nodeBounds(scaleNode(group, 2, 1, { x: 0, y: 0 }));
    expect(stretched.maxX - stretched.minX).toBeCloseTo(280, 6);
    expect(stretched.maxY - stretched.minY).toBeCloseTo(40, 6);
  });

  it('keeps circles round when stretched', () => {
    const circle = createPrimitive('circle', id());
    const s = scaleNode(circle, 2, 1, { x: 0, y: 0 }) as ShapeNode;
    expect(s.width).toBe(s.depth);
  });

  it('duplicates with fresh ids', () => {
    const group: BuilderNode = { id: 'g', type: 'group', children: [rect(0, 0, 10, 10)] };
    const copy = duplicateNode(group, id);
    expect(copy.id).not.toBe('g');
    expect(copy.type !== 'shape' && copy.children[0].id).not.toBe(group.children[0].id);
  });

  it('turns an existing drawn outline (with a hole) into an editable recipe', () => {
    const original = buildShape([{ id: id(), type: 'subtract', children: [rect(0, 0, 200, 200), rect(0, 0, 100, 100)] }]).shape!;
    const { source: _source, ...drawn } = original;
    const recipe = recipeFor(drawn, id);
    const rebuilt = buildShape(recipe);
    expect(rebuilt.problem).toBeNull();
    expect(rebuilt.width).toBeCloseTo(200, 3);
    expect(areaOf(recipe)).toBeCloseTo(30000, 3);
  });

  it('builds a curved sofa from a curved section and a merged seat', () => {
    const arc: ShapeNode = { ...createPrimitive('arc', id()), width: 260, depth: 90, sweep: 140 };
    const r = buildShape([arc]);
    expect(r.problem).toBeNull();
    expect(r.shape!.points.some((p) => p.c1)).toBe(true);
    // Symmetric about the middle, with the band's area: (R² − r²) × sweep / 2.
    const box = nodeBounds(arc);
    expect(box.minX + box.maxX).toBeCloseTo(0, 6);
    expect(r.width).toBeCloseTo(2 * 130 * Math.sin((70 * Math.PI) / 180), 1);
    const expected = ((130 ** 2 - 40 ** 2) * (140 * Math.PI)) / 360;
    expect(Math.abs(areaOf([arc]) / expected - 1)).toBeLessThan(0.01);
  });
});
