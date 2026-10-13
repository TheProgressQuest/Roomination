import { describe, expect, it } from 'vitest';
import { furniturePolygon } from '../model/conflicts';
import { DEFAULT_OPTIMIZER, functionWeightFor } from '../model/furnitureKinds';
import { convexInsidePolygon } from '../model/polygon';
import { createFeature, createFurniture } from '../model/sample';
import type { OptimizerSettings, Project } from '../model/types';
import { outlinePolygon } from '../model/walls';
import { analyseCirculation, createGrid } from './circulation';
import { explain } from './explain';
import { isDistinct, optimize, type OptimizeResult } from './optimize';
import { createContext, measure, score } from './scoring';
import { fitsHard, withPoses } from './search';
import { TEST_ROOMS, lShapedStudio, largeLivingRoom, movableIds, multipleDoors, overcrowded, smallBedroom, withLockedPieces, withStairs } from './testRooms';

const quick: OptimizerSettings = { ...DEFAULT_OPTIMIZER, effort: 'quick', seed: 7 };

function run(project: Project, settings: Partial<OptimizerSettings> = {}): OptimizeResult {
  return optimize({ project, settings: { ...quick, ...settings }, movableIds: movableIds(project) });
}

function arranged(project: Project, suggestion: OptimizeResult['suggestions'][number]): Project {
  return withPoses(project, new Map(suggestion.positions.map((p) => [p.id, p])));
}

/** Independently re-checks every hard rule for every moved piece of every suggestion. */
function expectHardRulesHold(project: Project, result: OptimizeResult) {
  const ids = new Set(movableIds(project));
  const context = createContext(project, ids, quick);
  for (const suggestion of result.suggestions) {
    const layout = arranged(project, suggestion);
    for (const item of layout.furniture.filter((f) => ids.has(f.id))) {
      expect(convexInsidePolygon(furniturePolygon(item), outlinePolygon(layout.room)), `${item.name} inside ${suggestion.title}`).toBe(true);
      expect(fitsHard(layout, item, context), `${item.name} hard rules in ${suggestion.title}`).toBe(true);
    }
  }
}

describe('circulation', () => {
  const room = outlinePolygon(smallBedroom().room);

  it('finds the whole floor walkable in an empty room', () => {
    const grid = createGrid(room, []);
    const result = analyseCirculation(grid, [], { doors: [{ x: 160, y: 320 }], stairs: [], uses: [] }, 75);
    expect(result.reachableFloor).toBeGreaterThan(0.95);
    expect(result.pocketShare).toBeLessThan(0.02);
  });

  it('notices a door cut off by a wall-to-wall piece, even though most floor is empty', () => {
    const grid = createGrid(room, []);
    const barrier = furniturePolygon(createFurniture({ x: 160, y: 180, width: 320, depth: 40 }));
    const result = analyseCirculation(grid, [barrier], { doors: [{ x: 160, y: 330 }, { x: 160, y: 30 }], stairs: [], uses: [] }, 75);
    expect(result.connectivity).toBe(0);
    expect(result.unreachableDoors).toBe(1);
    expect(result.pocketShare).toBeGreaterThan(0.3); // the far half is cut off
  });

  it('separates comfortable walkways from squeezes', () => {
    const grid = createGrid(room, []);
    // Two pieces leaving a 55 cm gap: wide enough to squeeze (60% of 75 = 45) but not comfortable.
    const left = furniturePolygon(createFurniture({ x: 66, y: 180, width: 132, depth: 40 }));
    const right = furniturePolygon(createFurniture({ x: 263, y: 180, width: 114, depth: 40 }));
    const result = analyseCirculation(grid, [left, right], { doors: [{ x: 160, y: 330 }], stairs: [], uses: [] }, 75);
    expect(result.narrowShare).toBeGreaterThan(0.2);
    expect(result.pocketShare).toBeLessThan(0.05);
  });
});

describe('scoring', () => {
  it('overall is exactly the documented blend of its parts', () => {
    const project = largeLivingRoom();
    const context = createContext(project, new Set(movableIds(project)), quick);
    const metrics = measure(project, context);
    for (const weight of [0.9, 0.6, 0.2]) {
      const s = score(project, metrics, context, weight);
      const blend = weight * s.functional + (1 - weight) * s.aesthetic;
      expect(s.overall).toBeCloseTo(s.preferences === null ? blend : 0.7 * blend + 0.3 * s.preferences, 6);
    }
  });

  it('each group score is the weighted mean of its components', () => {
    const project = smallBedroom();
    const context = createContext(project, new Set(movableIds(project)), quick);
    const s = score(project, measure(project, context), context, 0.6);
    const functional = s.components.filter((c) => c.group === 'functional');
    const expected = (100 * functional.reduce((sum, c) => sum + c.value * c.weight, 0)) / functional.reduce((sum, c) => sum + c.weight, 0);
    expect(s.functional).toBeCloseTo(expected, 6);
    expect(s.components.every((c) => c.detail.length > 0)).toBe(true);
  });

  it('covering a vent lowers the functional score', () => {
    const project = largeLivingRoom();
    const context = createContext(project, new Set(movableIds(project)), quick);
    const clear = score(project, measure(project, context), context).components.find((c) => c.id === 'clearances')!.value;
    const covered = { ...project, furniture: project.furniture.map((f) => (f.name === 'Armchair 2' ? { ...f, x: 360, y: 90 } : f)) };
    const blocked = score(covered, measure(covered, context), context).components.find((c) => c.id === 'clearances')!.value;
    expect(blocked).toBeLessThan(clear);
  });

  it('mode presets set the function weighting; Balanced uses the slider', () => {
    expect(functionWeightFor({ mode: 'functional', functionWeight: 0.3 })).toBe(0.9);
    expect(functionWeightFor({ mode: 'aesthetic', functionWeight: 0.8 })).toBe(0.2);
    expect(functionWeightFor({ mode: 'balanced', functionWeight: 0.7 })).toBe(0.7);
  });
});

describe('hard constraints (never traded for score)', () => {
  const project = largeLivingRoom();
  const context = createContext(project, new Set(movableIds(project)), quick);
  const sofa = project.furniture.find((f) => f.name === 'Sofa')!;
  const at = (x: number, y: number, rotation = 0) => ({ ...sofa, x, y, rotation });
  const check = (item: typeof sofa) => fitsHard({ ...project, furniture: project.furniture.map((f) => (f.id === sofa.id ? item : f)) }, item, context);

  it('rejects pieces outside the room', () => expect(check(at(20, 260))).toBe(false));
  it('rejects overlapping another piece', () => expect(check(at(560, 150))).toBe(false)); // on the dining table
  it('rejects blocking a door swing', () => expect(check(at(120, 100, 90))).toBe(false)); // in front of the hall door
  it('accepts a clear spot', () => expect(check(at(360, 300))).toBe(true));

  it('rejects standing on stairs or overlapping an interior wall', () => {
    const stairsRoom = withStairs();
    const stairsContext = createContext(stairsRoom, new Set(movableIds(stairsRoom)), quick);
    const piece = stairsRoom.furniture[0];
    const onStairs = { ...piece, x: 380, y: 60 };
    expect(fitsHard({ ...stairsRoom, furniture: [onStairs] }, onStairs, stairsContext)).toBe(false);
    const partitioned = { ...stairsRoom, room: { ...stairsRoom.room, partitions: [{ id: 'p', nodes: [{ id: 'p1', x: 280, y: 150, thickness: 10 }, { id: 'p2', x: 280, y: 300, thickness: 10 }] }] } };
    const crossing = { ...piece, x: 280, y: 220 };
    expect(fitsHard({ ...partitioned, furniture: [crossing] }, crossing, createContext(partitioned, new Set([piece.id]), quick))).toBe(false);
  });

  it('hard rules hold even when aesthetics are weighted almost entirely', () => {
    const room = largeLivingRoom();
    const result = run(room, { mode: 'aesthetic' });
    expect(result.suggestions.length).toBeGreaterThan(0);
    expectHardRulesHold(room, result);
  });
});

describe('optimizing representative rooms', () => {
  it.each([
    ['small bedroom', smallBedroom],
    ['large living room', largeLivingRoom],
    ['L-shaped studio', lShapedStudio],
    ['room with three doors', multipleDoors],
    ['room with stairs', withStairs],
    ['room with locked pieces', withLockedPieces],
  ])('%s: valid, distinct, honestly scored suggestions', (_name, make) => {
    const project = make();
    const result = run(project);
    expect(result.status).toBe('ok');
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
    expectHardRulesHold(project, result);
    // Suggestions are genuinely different from each other.
    const context = createContext(project, new Set(movableIds(project)), quick);
    const poses = result.suggestions.map((s) => new Map(s.positions.map((p) => [p.id, p])));
    for (let i = 0; i < poses.length; i++) for (let j = i + 1; j < poses.length; j++) expect(isDistinct(poses[i], poses[j], context)).toBe(true);
    // Reported scores are exactly what scoring the layout gives (nothing invented).
    for (const s of result.suggestions) {
      const layout = arranged(project, s);
      expect(score(layout, measure(layout, context), context).overall).toBeCloseTo(s.scores.overall, 6);
    }
    // Fewer than three suggestions must come with an explanation.
    if (result.suggestions.length < 3) expect(result.message).toMatch(/clearly different/);
  });

  it('L-shaped studio: nothing ends up in the missing corner', () => {
    const project = lShapedStudio();
    for (const s of run(project).suggestions) {
      for (const item of arranged(project, s).furniture) {
        const poly = furniturePolygon(item);
        expect(poly.every((p) => !(p.x > 341 && p.y > 281))).toBe(true);
      }
    }
  });

  it('room with three doors: the best suggestion keeps every door reachable', () => {
    const [best] = run(multipleDoors()).suggestions;
    expect(best.scores.components.find((c) => c.id === 'connectivity')!.value).toBe(1);
  });

  it('room with stairs: the foot of the stairs stays reachable', () => {
    const [best] = run(withStairs()).suggestions;
    expect(best.scores.components.find((c) => c.id === 'connectivity')!.value).toBe(1);
  });

  it('locked pieces never move', () => {
    const project = withLockedPieces();
    const locked = project.furniture.filter((f) => f.locked);
    const result = run(project);
    for (const s of result.suggestions) {
      expect(s.positions.some((p) => locked.some((l) => l.id === p.id))).toBe(false);
      const layout = arranged(project, s);
      for (const l of locked) expect(layout.furniture.find((f) => f.id === l.id)).toEqual(l);
    }
    expect(result.suggestions[0].improvements.join(' ')).toMatch(/locked position/);
  });

  it('overcrowded room: explains that no valid arrangement exists, without inventing one', () => {
    const result = run(overcrowded());
    expect(result.status).toBe('infeasible');
    expect(result.suggestions).toEqual([]);
    expect(result.message).toMatch(/No arrangement was found/);
    expect(result.message).toMatch(/m² of open floor/);
  });

  it('nothing to move when everything is locked', () => {
    const project = { ...smallBedroom(), furniture: smallBedroom().furniture.map((f) => ({ ...f, locked: true })) };
    expect(optimize({ project, settings: quick, movableIds: project.furniture.map((f) => f.id) }).status).toBe('nothingToMove');
  });
});

describe('reproducibility and cancellation', () => {
  it('the same inputs and seed give identical results', () => {
    // Each fixture call creates new ids, so both runs use the same project.
    const project = smallBedroom();
    const first = run(project);
    const second = run(project);
    expect(first.status).toBe('ok');
    expect(second.suggestions.map((s) => s.positions)).toEqual(first.suggestions.map((s) => s.positions));
  });

  it('a different seed can give different results', () => {
    const project = largeLivingRoom();
    const one = run(project, { seed: 1 }).suggestions.map((s) => s.positions);
    const two = run(project, { seed: 2 }).suggestions.map((s) => s.positions);
    expect(two).not.toEqual(one);
  });

  it('can be cancelled part-way, returning no suggestions', () => {
    let calls = 0;
    const project = largeLivingRoom();
    const result = optimize({ project, settings: { ...quick, effort: 'standard' }, movableIds: movableIds(project) }, () => {}, () => ++calls > 5);
    expect(result.status).toBe('cancelled');
    expect(result.suggestions).toEqual([]);
  });

  it('reports progress up to completion', () => {
    const seen: number[] = [];
    let total = 0;
    const project = smallBedroom();
    optimize({ project, settings: quick, movableIds: movableIds(project) }, (done, t) => {
      seen.push(done);
      total = t;
    });
    expect(seen.at(-1)).toBe(total);
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true);
  });
});

describe('explanations come from measurements', () => {
  it('says the desk moved closer to an outlet only when it measurably did', () => {
    const project = smallBedroom();
    const context = createContext(project, new Set(movableIds(project)), quick);
    const before = { project, metrics: measure(project, context), scores: score(project, measure(project, context), context) };
    const desk = project.furniture.find((f) => f.name === 'Desk')!;
    const nearOutlet = { ...project, furniture: project.furniture.map((f) => (f.id === desk.id ? { ...f, x: 280, y: 300 } : f)) };
    const after = { project: nearOutlet, metrics: measure(nearOutlet, context), scores: score(nearOutlet, measure(nearOutlet, context), context) };
    const told = explain(before, after, [], 75);
    expect(told.improvements.join(' ')).toMatch(/Moved the Desk .* closer to an outlet/);
    const reverse = explain(after, before, [], 75);
    expect(reverse.tradeoffs.join(' ')).toMatch(/Desk is .* farther from an outlet/);
    expect(explain(before, before, [], 75)).toEqual({ improvements: [], tradeoffs: [], warnings: expect.any(Array) });
  });

  it('reports preferences that cannot apply instead of pretending', () => {
    const project = { ...smallBedroom(), features: smallBedroom().features.filter((f) => f.kind !== 'window') };
    project.furniture = project.furniture.map((f) => (f.name === 'Desk' ? { ...f, preferences: ['nearWindow' as const] } : f));
    const result = run(project);
    expect(result.baseline.warnings.join(' ')).toMatch(/no window/);
  });
});

describe('every test room is usable as a fixture', () => {
  it.each(Object.entries(TEST_ROOMS))('%s has furniture and a door', (_name, make) => {
    const project = make();
    expect(project.furniture.length).toBeGreaterThan(0);
    expect(project.features.some((f) => f.kind === 'door')).toBe(true);
  });

  it('features stay valid with the new vent in the living room', () => {
    expect(createFeature('vent', { type: 'free', x: 1, y: 1, rotation: 0 }, { height: 250 }).kind).toBe('vent');
  });
});
