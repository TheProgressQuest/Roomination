import { describe, expect, it } from 'vitest';
import { FURNITURE_KIND_LABELS } from '../model/furnitureKinds';
import { boundingBox, pointInPolygon, polygonArea, rectPolygon, type Polygon } from '../model/polygon';
import { createEmptyProject, createFeature, createFurniture, createRectangularRoom, createSampleProject, createStaircase } from '../model/sample';
import { stairPolygons } from '../model/stairs';
import type { FurnitureKind, Point, Project, Room, WallNode } from '../model/types';
import { furnitureParts } from './furnitureParts';
import { localFootprint, normaliseShape, shapeTemplate } from '../model/shape';
import { parseProjectFile, serializeProject } from '../storage/projectFile';
import { buildSceneModel, rectilinearOutlines, toScene, wallSolidAt, type Block } from './model';
import { ROOMS_3D, stressProject } from './testRooms';

const near = (a: number, b: number, tolerance = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tolerance);

/** The four plan corners of a block. */
function corners(b: Block): Polygon {
  return rectPolygon(b.x, b.y, b.width, b.depth, b.rotation);
}

function lRoom(): Room {
  const outline: WallNode[] = [
    [0, 0],
    [600, 0],
    [600, 280],
    [340, 280],
    [340, 480],
    [0, 480],
  ].map(([x, y], i) => ({ id: `n${i}`, x, y, thickness: 15 }));
  return { ...createRectangularRoom(10, 10, 255), outline };
}

describe('coordinates', () => {
  it('converts centimetres to metres with height as the up axis', () => {
    expect(toScene({ x: 250, y: 400 }, 120)).toEqual({ x: 2.5, y: 1.2, z: 4 });
    expect(toScene({ x: 0, y: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('floor', () => {
  it('follows the room outline exactly, including concave L-shapes', () => {
    const room = lRoom();
    const scene = buildSceneModel(createEmptyProject(room));
    expect(scene.floor).toEqual(room.outline.map(({ x, y }) => ({ x, y })));
    expect(polygonArea(scene.floor)).toBe(600 * 280 + 340 * 200);
    expect(scene.floorHoles).toEqual([]);
  });
});

describe('walls', () => {
  it('extrudes every wall to the ceiling height with its real thickness', () => {
    const room = lRoom();
    const scene = buildSceneModel(createEmptyProject(room));
    expect(scene.walls).toHaveLength(6);
    for (const wall of scene.walls) {
      expect(wall.outer).toBe(true);
      expect(wall.height).toBe(255);
      expect(wall.holes).toEqual([]);
    }
    // The top wall (600 cm long, 15 cm thick) sits outside the room: y from −15 to 0.
    const top = boundingBox(scene.walls[0].footprint);
    expect(top.minY).toBeCloseTo(-15);
    expect(top.maxY).toBeCloseTo(0);
    expect(scene.walls[0].outward).toEqual({ x: 0, y: -1 });
  });

  it('keeps 2D dimensions when only the ceiling height changes', () => {
    const project = createSampleProject();
    const low = buildSceneModel(project);
    const high = buildSceneModel({ ...project, room: { ...project.room, height: 320 } });
    expect(high.floor).toEqual(low.floor);
    expect(high.walls.map((w) => w.footprint)).toEqual(low.walls.map((w) => w.footprint));
    expect(high.walls[0].height).toBe(320);
  });

  it('centres interior walls on their line', () => {
    const room: Room = { ...createRectangularRoom(500, 400), partitions: [{ id: 'p', nodes: [{ id: 'p0', x: 250, y: 0, thickness: 10 }, { id: 'p1', x: 250, y: 250, thickness: 10 }] }] };
    const wall = buildSceneModel(createEmptyProject(room)).walls.find((w) => w.wallId === 'p0')!;
    expect(wall.outer).toBe(false);
    const box = boundingBox(wall.footprint);
    expect(box.minX).toBeCloseTo(245);
    expect(box.maxX).toBeCloseTo(255);
  });
});

describe('doors and windows', () => {
  function withOpenings(): Project {
    const room = createRectangularRoom(500, 400, 250);
    const door = createFeature('door', { type: 'wall', wallId: room.outline[2].id, offset: 250 }, room, { name: 'Door', width: 90, height: 210 });
    const window = createFeature('window', { type: 'wall', wallId: room.outline[0].id, offset: 200 }, room, { width: 140, height: 110, elevation: 95 });
    return { ...createEmptyProject(room), features: [door, window] };
  }

  /** True if any solid wall part covers plan point `p` at height `z`. */
  function solidAt(project: Project, p: Point, z: number): boolean {
    return buildSceneModel(project).walls.some((w) => wallSolidAt(w, p, z));
  }

  it('leaves a real hole in the wall where a door is, with wall above it', () => {
    const project = withOpenings();
    // Bottom wall runs right→left at y = 400; the door is centred at x = 250, 90 cm wide.
    expect(solidAt(project, { x: 250, y: 405 }, 100)).toBe(false);
    expect(solidAt(project, { x: 210, y: 405 }, 200)).toBe(false);
    expect(solidAt(project, { x: 250, y: 405 }, 230)).toBe(true);
    expect(solidAt(project, { x: 190, y: 405 }, 100)).toBe(true);
  });

  it('leaves a window opening between its sill and its top', () => {
    const project = withOpenings();
    expect(solidAt(project, { x: 200, y: -5 }, 50)).toBe(true);
    expect(solidAt(project, { x: 200, y: -5 }, 150)).toBe(false);
    expect(solidAt(project, { x: 200, y: -5 }, 220)).toBe(true);
    const window = buildSceneModel(project).walls[0].openings;
    const glass = window.find((o) => o.material === 'glass')!.block;
    expect(glass.z).toBeGreaterThanOrEqual(95);
    expect(glass.z + glass.height).toBeLessThanOrEqual(205);
  });

  it('turns openings with angled walls', () => {
    const outline: WallNode[] = [
      { id: 'a', x: 0, y: 0, thickness: 12 },
      { id: 'b', x: 400, y: 0, thickness: 12 },
      { id: 'c', x: 400, y: 300, thickness: 12 },
      { id: 'd', x: 100, y: 400, thickness: 12 },
      { id: 'e', x: 0, y: 300, thickness: 12 },
    ];
    const room: Room = { ...createRectangularRoom(10, 10), outline };
    const window = createFeature('window', { type: 'wall', wallId: 'c', offset: 150 }, room);
    const scene = buildSceneModel({ ...createEmptyProject(room), features: [window] });
    const angle = (Math.atan2(100, -300) * 180) / Math.PI;
    const glass = scene.walls[2].openings.find((o) => o.material === 'glass')!.block;
    near(glass.rotation, angle);
    // The glass sits in the wall's plane, centred on the window.
    const centre = { x: 400 - 300 * (150 / Math.hypot(300, 100)), y: 300 + 100 * (150 / Math.hypot(300, 100)) };
    const outward = scene.walls[2].outward;
    near(glass.x, centre.x + outward.x * 6, 1e-6);
    near(glass.y, centre.y + outward.y * 6, 1e-6);
  });

  it('shows hinged doors ajar on the swing side, and moves them with the door', () => {
    const project = withOpenings();
    const leaf = () => buildSceneModel(project).walls[2].openings.find((o) => o.material === 'door')!.block;
    // Inward swing: the leaf reaches into the room (y < 400 on the bottom wall).
    expect(leaf().y).toBeLessThan(400);
    project.features[0] = { ...project.features[0], swing: 'out' };
    expect(leaf().y).toBeGreaterThan(400);
    const before = leaf().x;
    project.features[0] = { ...project.features[0], placement: { type: 'wall', wallId: project.room.outline[2].id, offset: 150 } };
    near(leaf().x - before, 100);
  });

  it('builds two leaves for double doors and two panels for sliding doors', () => {
    const project = withOpenings();
    for (const doorType of ['double', 'sliding'] as const) {
      project.features[0] = { ...project.features[0], doorType };
      expect(buildSceneModel(project).walls[2].openings.filter((o) => o.material === 'door')).toHaveLength(2);
    }
  });

  it('falls back to sensible heights for openings without one', () => {
    const project = withOpenings();
    project.features[1] = { ...project.features[1], height: 0 };
    const glass = buildSceneModel(project).walls[0].openings.find((o) => o.material === 'glass')!.block;
    expect(glass.height).toBeGreaterThan(0);
  });
});

describe('furniture', () => {
  const kinds = Object.keys(FURNITURE_KIND_LABELS) as FurnitureKind[];

  it.each(kinds)('keeps every %s part inside the real width × depth × height', (kind) => {
    for (const [width, depth, height] of [
      [200, 90, 85],
      [45, 45, 90],
      [160, 200, 50],
      [5, 5, 5],
    ]) {
      const parts = furnitureParts({ kind, category: 'furniture', width, depth, height });
      expect(parts.length).toBeGreaterThan(0);
      for (const p of parts) {
        expect(p.x - p.width / 2).toBeGreaterThanOrEqual(-width / 2 - 1e-9);
        expect(p.x + p.width / 2).toBeLessThanOrEqual(width / 2 + 1e-9);
        expect(p.y - p.depth / 2).toBeGreaterThanOrEqual(-depth / 2 - 1e-9);
        expect(p.y + p.depth / 2).toBeLessThanOrEqual(depth / 2 + 1e-9);
        expect(p.z).toBeGreaterThanOrEqual(0);
        expect(p.z + p.height).toBeLessThanOrEqual(height + 1e-9);
        expect(Math.min(p.width, p.depth, p.height)).toBeGreaterThan(0);
      }
      // Something reaches the full height.
      near(Math.max(...parts.map((p) => p.z + p.height)), height, 1e-9);
    }
  });

  it('keeps rotated pieces inside their plan footprint, with their colour and name', () => {
    for (const rotation of [0, 30, 90, 135, 270]) {
      const sofa = createFurniture({ name: 'Sofa', kind: 'sofa', x: 200, y: 150, width: 210, depth: 90, height: 85, rotation, color: '#336699' });
      const scene = buildSceneModel({ ...createEmptyProject(createRectangularRoom(500, 400)), furniture: [sofa] });
      const footprint = rectPolygon(200, 150, 210 + 0.01, 90 + 0.01, rotation);
      const [item] = scene.furniture;
      expect(item).toMatchObject({ id: sofa.id, name: 'Sofa', rotation });
      for (const part of item.parts) {
        expect(part.rotation).toBe(rotation);
        for (const corner of corners(part)) expect(pointInPolygon(corner, footprint)).toBe(true);
      }
      expect(item.parts.some((p) => p.color === '#336699')).toBe(true);
    }
  });

  it('puts a sofa’s back on the side away from its front', () => {
    const sofa = createFurniture({ kind: 'sofa', x: 0, y: 0, width: 200, depth: 90, height: 85, rotation: 0 });
    const back = furnitureParts(sofa).find((p) => p.width === 200)!;
    expect(back.y).toBeLessThan(0);
  });

  it('extrudes drawn furniture from exactly the outline used for collisions', () => {
    const { shape, width, depth } = normaliseShape(shapeTemplate('lDesk'));
    const desk = createFurniture({ x: 200, y: 150, rotation: 30, width, depth, height: 75, shape, color: '#123456', appearance: { material: 'wood', finish: 'gloss' } });
    const [piece] = buildSceneModel({ ...createEmptyProject(createRectangularRoom(500, 400)), furniture: [desk] }).furniture;
    expect(piece.parts).toEqual([]);
    expect(piece.extruded).toEqual({ rings: localFootprint(desk).rings, height: 75, color: '#123456' });
    expect(piece).toMatchObject({ x: 200, y: 150, rotation: 30, material: 'wood', finish: 'gloss' });
  });

  it('extrudes a photo-textured rectangle so the photo has real surfaces', () => {
    const cabinet = createFurniture({ x: 100, y: 100, width: 80, depth: 40, appearance: { material: 'wood', finish: 'matte', textures: { front: 'a'.repeat(64) } } });
    const [piece] = buildSceneModel({ ...createEmptyProject(), furniture: [cabinet] }).furniture;
    expect(piece.extruded?.rings).toEqual(localFootprint(cabinet).rings);
    expect(piece.textures.front).toBe('a'.repeat(64));
  });

  it('draws rugs as flat slabs', () => {
    const parts = furnitureParts({ kind: 'custom', category: 'floorCovering', width: 200, depth: 140, height: 2 });
    expect(parts).toEqual([{ x: 0, y: 0, z: 0, width: 200, depth: 140, height: 1.5 }]);
  });
});

describe('stairs', () => {
  const room = () => createRectangularRoom(800, 600);

  it('builds one step per tread, rising evenly to the full rise', () => {
    const stair = createStaircase('straight', { x: 400, y: 300 }, { rise: 280 });
    const [built] = buildSceneModel({ ...createEmptyProject(room()), stairs: [stair] }).stairs;
    expect(built.steps).toHaveLength(14);
    expect(built.landings).toHaveLength(0);
    built.steps.forEach((step, i) => near(step.height, (280 / 14) * (i + 1)));
    // Every step stays inside the staircase's plan footprint.
    const footprint = stairPolygons(stair)[0];
    const grown = boundingBox(footprint);
    for (const step of built.steps) {
      for (const c of corners(step)) {
        expect(c.x).toBeGreaterThan(grown.minX - 1e-6);
        expect(c.x).toBeLessThan(grown.maxX + 1e-6);
      }
    }
  });

  it('places L and U landings at the height reached so far, following rotation', () => {
    for (const shape of ['L', 'U'] as const) {
      const stair = createStaircase(shape, { x: 400, y: 300 }, { rise: 280, rotation: 90 });
      const [built] = buildSceneModel({ ...createEmptyProject(room()), stairs: [stair] }).stairs;
      expect(built.steps).toHaveLength(14);
      expect(built.landings).toHaveLength(shape === 'L' ? 1 : 2);
      for (const landing of built.landings) near(landing.height, 140);
      const footprints = stairPolygons(stair);
      for (const step of [...built.steps, ...built.landings]) {
        expect(footprints.some((f) => pointInPolygon({ x: step.x, y: step.y }, f))).toBe(true);
      }
    }
  });

  it('cuts the floor for stairs going down, without a second floor', () => {
    const stair = createStaircase('L', { x: 400, y: 300 }, { direction: 'down', rise: 260 });
    const scene = buildSceneModel({ ...createEmptyProject(room()), stairs: [stair] });
    expect(scene.floorHoles).toHaveLength(1);
    expect(scene.floorHoles[0].depth).toBe(260);
    const holeArea = polygonArea(scene.floorHoles[0].points);
    const footprintArea = stairPolygons(stair).reduce((sum, p) => sum + polygonArea(p), 0);
    expect(holeArea).toBeLessThan(footprintArea);
    expect(holeArea).toBeGreaterThan(footprintArea * 0.97);
    for (const step of scene.stairs[0].steps) {
      expect(step.z).toBe(-260);
      expect(step.z + step.height).toBeLessThanOrEqual(0);
    }
  });

  it('gives each stairwell its own depth', () => {
    const shallow = createStaircase('straight', { x: 300, y: 150 }, { direction: 'down', rise: 100 });
    const deep = createStaircase('straight', { x: 300, y: 400 }, { direction: 'down', rise: 300 });
    const scene = buildSceneModel({ ...createEmptyProject(room()), stairs: [shallow, deep] });
    expect(scene.floorHoles.map((h) => h.depth)).toEqual([100, 300]);
  });

  it('merges rectangles into one outline', () => {
    const square = (x: number, y: number, s: number): Polygon => [
      { x, y },
      { x: x + s, y },
      { x: x + s, y: y + s },
      { x, y: y + s },
    ];
    const [outline] = rectilinearOutlines([square(0, 0, 10), square(10, 0, 10), square(10, 10, 10)]);
    expect(outline).toHaveLength(6);
    expect(polygonArea(outline)).toBe(300);
  });
});

describe('selection and sync', () => {
  it('carries the same ids as the project, and changes when the project does', () => {
    const project = createSampleProject();
    const scene = buildSceneModel(project);
    expect(scene.furniture.map((f) => f.id)).toEqual(project.furniture.map((f) => f.id));
    const moved = { ...project, furniture: project.furniture.map((f, i) => (i === 0 ? { ...f, x: f.x + 25 } : f)) };
    near(buildSceneModel(moved).furniture[0].x - scene.furniture[0].x, 25);
  });

  it('uses the room’s wall colour and frames everything including wall thickness', () => {
    const project = createSampleProject();
    const scene = buildSceneModel({ ...project, room: { ...project.room, wallColor: '#abcdef' } });
    expect(scene.wallColor).toBe('#abcdef');
    expect(scene.bounds.minX).toBeLessThan(0);
    expect(scene.bounds.maxX).toBeGreaterThan(480);
  });
});

describe('3D test rooms', () => {
  const all = { ...ROOMS_3D, stressProject };

  it.each(Object.entries(all))('%s is a valid project that survives saving and builds a scene', (_name, make) => {
    const project = make();
    const parsed = parseProjectFile(serializeProject(project));
    if (!parsed.ok) throw new Error(parsed.error);
    // Nothing had to be moved or repaired to load it.
    expect(parsed.project.furniture.map((f) => [f.x, f.y])).toEqual(project.furniture.map((f) => [f.x, f.y]));
    expect(parsed.project.features.map((f) => f.placement)).toEqual(project.features.map((f) => f.placement));
    expect(parsed.project.stairs.map((s) => [s.x, s.y])).toEqual(project.stairs.map((s) => [s.x, s.y]));
    const scene = buildSceneModel(project);
    expect(scene.walls).toHaveLength(project.room.outline.length + project.room.partitions.reduce((n, p) => n + p.nodes.length - 1, 0));
  });

  it('builds the stress project (40 walls, 150 pieces) quickly', () => {
    const project = stressProject();
    expect(project.room.outline).toHaveLength(40);
    expect(project.furniture).toHaveLength(150);
    const started = performance.now();
    const scene = buildSceneModel(project);
    const elapsed = performance.now() - started;
    expect(scene.furniture.reduce((n, f) => n + f.parts.length, 0)).toBeGreaterThan(150);
    expect(elapsed).toBeLessThan(250);
  });
});
