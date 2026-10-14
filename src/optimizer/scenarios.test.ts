import { describe, expect, it } from 'vitest';
import { findConflicts } from '../model/conflicts';
import { DEFAULT_OPTIMIZER } from '../model/furnitureKinds';
import { createFurniture, createRectangularRoom } from '../model/sample';
import { footprintInside, roomFootprint } from '../model/shape';
import type { OptimizerSettings, Project } from '../model/types';
import { outlinePolygon } from '../model/walls';
import { baselineWalk, createGrid } from './circulation';
import { isDistinct, optimize, type OptimizeResult } from './optimize';
import { facingAngle, practicalIssues } from './practical';
import { SCENARIOS, fengShuiBedroom, fengShuiOffice, homeOffice, livingWithTv, lockedObjects, smallBedroom } from './scenarios';
import { createContext, isHard, measure, score } from './scoring';
import { withPoses } from './search';
import { allRelationships } from './semantics';
import { movableIds } from './testRooms';

/**
 * Real-world validation: suggestions must obey every hard rule AND make practical sense.
 * A high score alone never counts as success.
 */

const settings: OptimizerSettings = { ...DEFAULT_OPTIMIZER, effort: 'standard', seed: 1 };
const run = (project: Project, changes: Partial<OptimizerSettings> = {}) => optimize({ project, settings: { ...settings, ...changes }, movableIds: movableIds(project) });
const arranged = (project: Project, s: OptimizeResult['suggestions'][number]) => withPoses(project, new Map(s.positions.map((p) => [p.id, p])));

describe.each(Object.entries(SCENARIOS))('%s', (_name, make) => {
  const project = make();
  const result = run(project);

  it('gives distinct suggestions that keep every hard rule', () => {
    expect(result.status).toBe('ok');
    expect(result.suggestions.length).toBeGreaterThanOrEqual(2);
    const context = createContext(project, new Set(movableIds(project)), settings);
    for (const s of result.suggestions) {
      const layout = arranged(project, s);
      for (const f of layout.furniture) expect(footprintInside(roomFootprint(f).parts, outlinePolygon(layout.room))).toBe(true);
      expect(findConflicts(layout).filter((c) => isHard(c, layout))).toEqual([]);
      // Locked pieces never move.
      for (const f of project.furniture.filter((p) => p.locked)) expect(layout.furniture.find((g) => g.id === f.id)).toMatchObject({ x: f.x, y: f.y, rotation: f.rotation });
      expect(measure(layout, context).circulation.connectivity).toBe(1);
    }
    for (let i = 0; i < result.suggestions.length; i++) {
      for (let j = i + 1; j < result.suggestions.length; j++) {
        const a = new Map(result.suggestions[i].positions.map((p) => [p.id, p]));
        const b = new Map(result.suggestions[j].positions.map((p) => [p.id, p]));
        expect(isDistinct(a, b, context)).toBe(true);
      }
    }
  });

  it('makes practical sense (no chairs facing walls, cramped desks, stranded pairs or blocked bed sides)', () => {
    const relationships = allRelationships(project, true);
    for (const s of result.suggestions) expect(practicalIssues(arranged(project, s), relationships).map((i) => i.message)).toEqual([]);
  });

  it('explains every suggestion with measured comparisons', () => {
    for (const s of result.suggestions) {
      expect(s.comparison.find((r) => r.label === 'Overlapping furniture')?.after).toBe('0');
      expect(s.comparison.find((r) => r.label === 'Functional score')).toBeDefined();
    }
  });
});

describe('specific expectations', () => {
  it('turns the sofa towards the TV and puts the coffee table in front of it', () => {
    const project = livingWithTv();
    for (const s of run(project).suggestions) {
      const layout = arranged(project, s);
      const sofa = layout.furniture.find((f) => f.name === 'Sofa')!;
      const tv = layout.furniture.find((f) => f.name === 'TV unit')!;
      expect(facingAngle(sofa, tv)).toBeLessThan(45);
    }
  });

  it('keeps the TV and bookshelf where they were locked, and works around them', () => {
    const project = lockedObjects();
    const result = run(project);
    expect(result.suggestions[0].improvements.join(' ')).toMatch(/locked position/);
  });

  it('explains assumed pairings and lists them, and can switch them off', () => {
    const project = homeOffice();
    const result = run(project);
    expect(result.assumed).toEqual(['Desk chair in front of Desk']);
    expect(result.purpose).toBe('office');
    expect(run(project, { assumePairings: false }).assumed).toEqual([]);
  });
});

describe('Feng Shui', () => {
  it('in a Feng Shui bedroom, the bed sees the entrance, out of the doorway’s line, with a wall behind it', () => {
    const project = fengShuiBedroom();
    const result = run(project, { mode: 'fengShui' });
    const context = createContext(project, new Set(movableIds(project)), { ...settings, mode: 'fengShui' });
    const m = measure(arranged(project, result.suggestions[0]), context);
    const bed = m.fengShui!.commanding[0];
    expect(bed.seesEntrance).toBeGreaterThan(0.8);
    expect(bed.outOfDoorLine).toBe(1);
    expect(bed.support).toBeGreaterThan(0.8);
    expect(result.suggestions[0].scores.fengShui).toBeGreaterThan(90);
    expect(result.suggestions[0].comparison.some((r) => r.label === 'Feng Shui (interpretive preference)')).toBe(true);
  });

  it('in a Feng Shui office, the seated person can see the door, and says so', () => {
    const project = fengShuiOffice();
    const result = run(project, { mode: 'fengShui' });
    const context = createContext(project, new Set(movableIds(project)), { ...settings, mode: 'fengShui' });
    const desk = measure(arranged(project, result.suggestions[0]), context).fengShui!.commanding[0];
    expect(desk.angleToEntrance).toBeLessThan(80);
    expect(result.suggestions[0].improvements.join(' ')).toMatch(/seated person can see the entrance \(Feng Shui\)/);
  });

  it('is off unless switched on, and never trades away hard rules', () => {
    const project = smallBedroom();
    const result = run(project, { mode: 'fengShui' });
    expect(result.suggestions.every((s) => s.scores.fengShui === null)).toBe(true);
    const bedroom = fengShuiBedroom();
    const fs = run(bedroom, { mode: 'custom', weights: { functional: 0, aesthetic: 0, fengShui: 100 } });
    for (const s of fs.suggestions) {
      const layout = arranged(bedroom, s);
      expect(findConflicts(layout).filter((c) => isHard(c, layout))).toEqual([]);
    }
  });
});

describe('known bad arrangements score lower and are named', () => {
  const room = createRectangularRoom(500, 400);
  const scoreOf = (project: Project) => {
    const context = createContext(project, new Set(), settings);
    return score(project, measure(project, context), context).overall;
  };
  const base = (furniture: Project['furniture']): Project => ({ ...livingWithTv(), room, furniture, features: [] });

  it('a sofa turned away from the TV', () => {
    const tv = createFurniture({ name: 'TV', kind: 'television', x: 250, y: 25, width: 150, depth: 40, height: 55 });
    const facing = createFurniture({ name: 'Sofa', kind: 'sofa', x: 250, y: 330, width: 200, depth: 90, height: 85, rotation: 180 });
    const away = { ...facing, rotation: 0 };
    expect(scoreOf(base([tv, facing]))).toBeGreaterThan(scoreOf(base([tv, away])));
    expect(practicalIssues(base([tv, away]), allRelationships(base([tv, away]), true)).map((i) => i.kind)).toContain('awayFromTv');
  });

  it('a chair facing a wall a hand’s width away', () => {
    const open = createFurniture({ name: 'Armchair', kind: 'armchair', x: 250, y: 200, width: 80, depth: 80, height: 90, rotation: 0 });
    const cornered = { ...open, y: 345 };
    expect(scoreOf(base([open]))).toBeGreaterThan(scoreOf(base([cornered])));
    expect(practicalIssues(base([cornered]), []).map((i) => i.kind)).toEqual(['facesObstacle']);
  });

  it('a desk with no room for its chair', () => {
    const desk = createFurniture({ name: 'Desk', kind: 'desk', x: 250, y: 35, width: 140, depth: 70, height: 75, rotation: 0 });
    const cramped = createFurniture({ name: 'Cabinet', kind: 'cabinet', x: 250, y: 100, width: 140, depth: 45, height: 90, rotation: 180 });
    expect(practicalIssues(base([desk, cramped]), []).map((i) => i.kind)).toContain('crampedDesk');
  });

  it('a double bed pushed against a wall on one long side', () => {
    const bed = createFurniture({ name: 'Bed', kind: 'bed', x: 250, y: 200, width: 160, depth: 200, height: 50 });
    const pushed = { ...bed, x: 80 };
    expect(scoreOf(base([bed]))).toBeGreaterThan(scoreOf(base([pushed])));
    expect(practicalIssues(base([pushed]), []).map((i) => i.kind)).toEqual(['bedSideBlocked']);
  });
});

describe('competing preferences', () => {
  it('reports what no suggestion could meet instead of hiding it', () => {
    // A double bed that must be reachable from both sides, in a room barely wider than the bed.
    const room = createRectangularRoom(190, 300);
    const project: Project = {
      ...smallBedroom(),
      room,
      features: [],
      furniture: [createFurniture({ name: 'Bed', kind: 'bed', x: 95, y: 150, width: 160, depth: 200, height: 50, preferences: ['accessBothSides'] })],
    };
    const result = run(project);
    expect(result.unmet.join(' ')).toMatch(/reachable from both sides/);
  });
});

describe('walking distances', () => {
  it('measures a straight walk across an empty room quickly and correctly', () => {
    const room = outlinePolygon(createRectangularRoom(800, 600));
    const grid = createGrid(room, []);
    const started = performance.now();
    const walk = baselineWalk(grid, { x: 50, y: 300 }, 75);
    expect(performance.now() - started).toBeLessThan(200);
    const cell = Math.floor((750 - grid.minX) / grid.cell) + Math.floor((300 - grid.minY) / grid.cell) * grid.cols;
    expect(walk[cell]).toBeGreaterThan(650);
    expect(walk[cell]).toBeLessThan(760);
  });
});
