import { describe, expect, it } from 'vitest';
import { extrudedGeometry } from '../scene3d/three/furnitureLayer';
import { circleShape } from '../optimizer/scenarios';
import { parseBuilderNodes, parseProjectFile, serializeProject } from '../storage/projectFile';
import { findConflicts } from './conflicts';
import { boundingBox, polygonArea, type Polygon } from './polygon';
import { createEmptyProject, createFurniture, createRectangularRoom } from './sample';
import { footprintArea, localFootprint, normaliseShape, roomFootprint, shapeProblem } from './shape';
import type { FurnitureShape } from './types';

/** An axis-aligned rectangle from its top-left corner. */
const rectPolygon = (x: number, y: number, w: number, h: number): Polygon => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/** A 200 × 200 square ring bench with a 100 × 100 hole in the middle. */
const ring: FurnitureShape = {
  points: rectPolygon(-100, -100, 200, 200),
  holes: [rectPolygon(-50, -50, 100, 100)],
};

const twoTables: FurnitureShape = {
  points: rectPolygon(-150, -40, 100, 80),
  islands: [{ points: rectPolygon(50, -40, 100, 80) }],
};

describe('shapes with holes and separate parts', () => {
  it('counts only the solid area', () => {
    const print = localFootprint({ width: 200, depth: 200, shape: normaliseShape(ring).shape });
    expect(footprintArea(print)).toBeCloseTo(200 * 200 - 100 * 100, 6);
    expect(print.rings).toHaveLength(1);
    expect(print.rings[0].holes).toHaveLength(1);
  });

  it('lets something stand inside the hole without colliding', () => {
    const room = createRectangularRoom(500, 500);
    const bench = createFurniture({ name: 'Ring bench', x: 250, y: 250, ...normaliseShape(ring), height: 45 });
    const stool = createFurniture({ name: 'Stool', x: 250, y: 250, width: 40, depth: 40, height: 45 });
    const project = { ...createEmptyProject(room, 'Hole'), furniture: [bench, stool] };
    expect(findConflicts(project).filter((c) => c.type === 'collision')).toEqual([]);
    const touching = { ...project, furniture: [bench, { ...stool, x: 250 + 60 }] };
    expect(findConflicts(touching).some((c) => c.type === 'collision')).toBe(true);
  });

  it('treats separate parts as one piece with empty space between them', () => {
    const tables = createFurniture({ name: 'Tables', x: 250, y: 250, ...normaliseShape(twoTables), height: 75 });
    const print = roomFootprint(tables);
    expect(print.rings).toHaveLength(2);
    expect(footprintArea(print)).toBeCloseTo(2 * 100 * 80, 6);
    const chair = createFurniture({ name: 'Chair', x: 250, y: 250, width: 40, depth: 40, height: 90 });
    const project = { ...createEmptyProject(createRectangularRoom(500, 500), 'Gap'), furniture: [tables, chair] };
    expect(findConflicts(project).filter((c) => c.type === 'collision')).toEqual([]);
  });

  it('rejects holes outside their outline and overlapping holes', () => {
    expect(shapeProblem({ ...ring, holes: [rectPolygon(80, -20, 60, 40)] })).toMatch(/inside its outline/);
    expect(shapeProblem({ ...ring, holes: [rectPolygon(-50, -50, 60, 60), rectPolygon(-20, -20, 60, 60)] })).toMatch(/overlap/);
    expect(shapeProblem({ ...twoTables, islands: [{ points: rectPolygon(-100, -20, 100, 40) }] })).toMatch(/overlap/);
  });

  it('keeps holes, parts and the builder recipe through saving and loading', () => {
    const source = [{ id: 'a', type: 'subtract' as const, children: [
      { id: 'b', type: 'shape' as const, kind: 'square' as const, x: 0, y: 0, rotation: 0, width: 200, depth: 200 },
      { id: 'c', type: 'shape' as const, kind: 'square' as const, x: 0, y: 0, rotation: 0, width: 100, depth: 100 },
    ] }];
    const normal = normaliseShape({ ...ring, source });
    const bench = createFurniture({ name: 'Ring bench', x: 250, y: 250, ...normal, height: 45 });
    const tables = createFurniture({ name: 'Tables', x: 250, y: 100, ...normaliseShape(twoTables), height: 75 });
    const project = { ...createEmptyProject(createRectangularRoom(500, 500), 'Saved'), furniture: [bench, tables] };
    const result = parseProjectFile(serializeProject(project));
    if (!result.ok) throw new Error(result.error);
    expect(result.project.furniture[0].shape).toEqual(bench.shape);
    expect(result.project.furniture[1].shape).toEqual(tables.shape);
  });

  it('drops a damaged builder recipe but keeps the outline', () => {
    expect(parseBuilderNodes([{ id: 'x', type: 'shape', kind: 'blob', x: 0, y: 0, rotation: 0, width: 10, depth: 10 }])).toBeUndefined();
    expect(parseBuilderNodes([{ id: 'x', type: 'union', children: [{ id: 'y', type: 'shape', kind: 'circle', x: 0, y: 0, rotation: 0, width: Infinity, depth: 10 }] }])).toBeUndefined();
    let deep: unknown = { id: 'leaf', type: 'shape', kind: 'square', x: 0, y: 0, rotation: 0, width: 10, depth: 10 };
    for (let i = 0; i < 20; i++) deep = { id: `g${i}`, type: 'group', children: [deep] };
    expect(parseBuilderNodes([deep])).toBeUndefined();
    // Too many corners across all the drawn parts.
    const big = Array.from({ length: 1500 }, (_, i) => ({ x: Math.cos(i), y: Math.sin(i) }));
    const part = (id: string) => ({ id, type: 'shape', kind: 'outline', x: 0, y: 0, rotation: 0, width: 10, depth: 10, points: big });
    expect(parseBuilderNodes([part('a')])).toHaveLength(1);
    expect(parseBuilderNodes([part('a'), part('b')])).toBeUndefined();
    const bench = createFurniture({ name: 'Ring bench', x: 250, y: 250, ...normaliseShape(ring), height: 45 });
    const saved = JSON.parse(serializeProject({ ...createEmptyProject(createRectangularRoom(500, 500), 'Bad recipe'), furniture: [bench] }));
    saved.project.furniture[0].shape.source = [{ id: 'x', type: 'nonsense' }];
    const result = parseProjectFile(JSON.stringify(saved));
    if (!result.ok) throw new Error(result.error);
    expect(result.project.furniture[0].shape?.holes).toHaveLength(1);
    expect(result.project.furniture[0].shape?.source).toBeUndefined();
  });

  it('extrudes holes as open space in 3D, with walls inside the hole', () => {
    const { rings } = localFootprint({ width: 200, depth: 200, shape: normaliseShape(ring).shape });
    const geometry = extrudedGeometry(rings, 45, {}, 1);
    const pos = geometry.getAttribute('position');
    // Top area: sum of the upward triangles' areas (metres²).
    let top = 0;
    for (let i = 0; i < pos.count; i += 3) {
      const ys = [pos.getY(i), pos.getY(i + 1), pos.getY(i + 2)];
      if (ys.every((y) => Math.abs(y - 0.45) < 1e-6)) {
        const [ax, az, bx, bz, cx, cz] = [pos.getX(i), pos.getZ(i), pos.getX(i + 1), pos.getZ(i + 1), pos.getX(i + 2), pos.getZ(i + 2)];
        top += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
      }
    }
    expect(top).toBeCloseTo(4 - 1, 4);
    // No geometry at all inside the hole's floor area apart from its walls.
    for (let i = 0; i < pos.count; i++) {
      const inside = Math.abs(pos.getX(i)) < 0.49 && Math.abs(pos.getZ(i)) < 0.49;
      expect(inside).toBe(false);
    }
    // Hole walls face into the hole (towards the centre).
    const normals = geometry.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(Math.abs(pos.getX(i)) - 0.5) < 1e-6 && Math.abs(pos.getZ(i)) < 0.5 - 1e-6) expect(Math.sign(normals.getX(i))).toBe(-Math.sign(pos.getX(i)));
    }
  });

  it('keeps a circle round (within the 0.5 cm curve tolerance)', () => {
    const outline = localFootprint({ width: 60, depth: 60, shape: normaliseShape(circleShape(30)).shape }).outline;
    expect(outline.length).toBeGreaterThanOrEqual(16);
    // Edge midpoints too: the sagitta stays under the tolerance.
    outline.forEach((p, i) => {
      const q = outline[(i + 1) % outline.length];
      expect(30 - Math.hypot((p.x + q.x) / 2, (p.y + q.y) / 2)).toBeLessThan(0.5);
    });
    for (const p of outline) expect(Math.abs(Math.hypot(p.x, p.y) - 30)).toBeLessThan(0.5);
    const box = boundingBox(outline);
    expect(box.maxX - box.minX).toBeCloseTo(60, 0);
    // Within 2% of a true circle's area (the flattened outline sits just inside the curve).
    expect(Math.abs(polygonArea(outline) / (Math.PI * 900) - 1)).toBeLessThan(0.02);
  });
});
