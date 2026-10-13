import { isSolid } from '../model/conflicts';
import { normalizeRotation } from '../model/geometry';
import { functionWeightFor, PREFERENCE_LABELS, RELATIONSHIP_LABELS } from '../model/furnitureKinds';
import { seededRandom } from '../model/random';
import type { OptimizerSettings, Project } from '../model/types';
import { explain, warningsFor } from './explain';
import { anneal, construct, fitsHard, hasMoved, objectiveFor, withPoses, type Arrangement, type SearchBudget } from './search';
import { createContext, measure, score, type LayoutContext, type Scores } from './scoring';

/**
 * The layout optimizer: runs several searches with different emphases, then picks up to
 * three suggestions that are genuinely different from each other, and explains each one
 * by comparing measurements with the current layout.
 *
 * Deterministic: the same project, settings and seed give the same suggestions (the
 * search uses a seeded random generator and fixed step counts, never the clock).
 */

/** Bump when the algorithm changes in a way that changes results for the same seed. */
export const ALGORITHM_VERSION = 1;

export interface OptimizeInput {
  project: Project;
  settings: OptimizerSettings;
  /** Pieces the optimizer may move. Locked pieces are never included. */
  movableIds: string[];
}

export interface Suggestion {
  id: string;
  title: string;
  /** What this suggestion was optimised for, e.g. "More functional". */
  emphasis: string;
  functionWeight: number;
  positions: { id: string; x: number; y: number; rotation: number }[];
  /** Scored with the user's weighting, so suggestions can be compared fairly. */
  scores: Scores;
  improvements: string[];
  tradeoffs: string[];
  warnings: string[];
  movedCount: number;
}

export interface OptimizeResult {
  status: 'ok' | 'nothingToMove' | 'infeasible' | 'cancelled';
  /** Explanation when there are fewer than three suggestions, or none. */
  message: string | null;
  baseline: { scores: Scores; warnings: string[]; valid: boolean };
  suggestions: Suggestion[];
  /** Preferences or relationships no suggestion could fully meet. */
  unmet: string[];
  seed: number;
  algorithmVersion: number;
}

const BUDGETS: Record<OptimizerSettings['effort'], SearchBudget & { restarts: number }> = {
  quick: { interiorSamples: 10, steps: 500, restarts: 1 },
  standard: { interiorSamples: 16, steps: 1500, restarts: 2 },
  thorough: { interiorSamples: 24, steps: 3500, restarts: 3 },
};

interface Profile {
  emphasis: string;
  functionWeight: number;
}

/** The user's own emphasis first, then contrasting ones. */
function profiles(settings: OptimizerSettings): Profile[] {
  const own = functionWeightFor(settings);
  const ownLabel = settings.mode === 'functional' ? 'Most functional' : settings.mode === 'aesthetic' ? 'Most aesthetic' : `Your balance (${Math.round(own * 100)}% function)`;
  const all: Profile[] = [
    { emphasis: ownLabel, functionWeight: own },
    { emphasis: 'Most functional', functionWeight: 0.9 },
    { emphasis: 'Balanced', functionWeight: 0.6 },
    { emphasis: 'Most aesthetic', functionWeight: 0.2 },
  ];
  // Drop contrasting profiles that duplicate the user's own.
  return all.filter((p, i) => i === 0 || Math.abs(p.functionWeight - own) > 0.05).slice(0, 3);
}

export type ProgressCallback = (done: number, total: number) => void;

export function optimize(input: OptimizeInput, onProgress: ProgressCallback = () => {}, shouldStop: () => boolean = () => false): OptimizeResult {
  const { project, settings } = input;
  const movableIds = new Set(input.movableIds.filter((id) => project.furniture.some((f) => f.id === id && !f.locked)));
  const context = createContext(project, movableIds, settings);
  const userWeight = functionWeightFor(settings);
  const evaluate = (p: Project) => {
    const metrics = measure(p, context);
    return { metrics, scores: score(p, metrics, context, userWeight) };
  };
  const base = evaluate(project);
  const movable = project.furniture.filter((f) => movableIds.has(f.id));
  // The current layout can only be a starting point if every movable piece already meets the hard rules.
  const baselineValid = movable.every((f) => fitsHard(project, f, context));
  const baseline = { scores: base.scores, warnings: warningsFor({ project, ...base }), valid: baselineValid };
  const result = (status: OptimizeResult['status'], message: string | null, suggestions: Suggestion[] = [], unmet: string[] = []): OptimizeResult => ({
    status,
    message,
    baseline,
    suggestions,
    unmet,
    seed: settings.seed,
    algorithmVersion: ALGORITHM_VERSION,
  });

  if (movable.length === 0) {
    return result('nothingToMove', 'Every piece is locked or left out, so there is nothing to rearrange. Unlock or select some pieces first.');
  }

  const budget = BUDGETS[settings.effort];
  const runs = profiles(settings);
  const total = runs.length * budget.restarts * (budget.steps + movable.length * 10);
  let done = 0;
  const tick = (amount: number) => {
    done += amount;
    onProgress(Math.min(done, total), total);
  };

  interface Candidate {
    profile: Profile;
    poses: Arrangement;
    objective: number;
  }
  const candidates: Candidate[] = [];
  const unplacedCounts = new Map<string, number>();

  for (const [profileIndex, profile] of runs.entries()) {
    const objective = objectiveFor(context, profile.functionWeight);
    for (let restart = 0; restart < budget.restarts; restart++) {
      if (shouldStop()) return result('cancelled', 'Optimization was cancelled. Your layout hasn’t changed.');
      const random = seededRandom(mixSeed(settings.seed, profileIndex, restart));
      // The first run of each profile starts from the user's own layout (when it's valid):
      // that guarantees a suggestion is never worse than what they have for that emphasis.
      const start =
        restart === 0 && baselineValid
          ? { poses: new Map(movable.map((f) => [f.id, { x: f.x, y: f.y, rotation: f.rotation }])), unplaced: [] as string[] }
          : construct(project, movable, context, objective, random, budget);
      tick(movable.length * 10);
      if (start.unplaced.length > 0) {
        for (const id of start.unplaced) unplacedCounts.set(id, (unplacedCounts.get(id) ?? 0) + 1);
        tick(budget.steps);
        continue;
      }
      // The annealer pauses every so often, so progress is reported and cancellation noticed.
      const run = anneal(project, start.poses, movable, context, objective, random, budget);
      let reported = 0;
      for (let next = run.next(); ; next = run.next()) {
        if (shouldStop()) return result('cancelled', 'Optimization was cancelled. Your layout hasn’t changed.');
        if (next.done) {
          tick(budget.steps - reported);
          candidates.push({ profile, poses: next.value.poses, objective: next.value.objective });
          break;
        }
        tick(next.value - reported);
        reported = next.value;
      }
    }
  }

  if (candidates.length === 0) {
    return result('infeasible', infeasibleMessage(project, movable, unplacedCounts, context));
  }

  // Pick distinct suggestions: each profile's best first, then anything else distinct enough.
  const chosen: Candidate[] = [];
  const byProfile = runs.map((p) => candidates.filter((c) => c.profile === p).sort((a, b) => b.objective - a.objective));
  for (const list of byProfile) {
    const pick = list.find((c) => chosen.every((d) => isDistinct(c.poses, d.poses, context)));
    if (pick) chosen.push(pick);
  }
  for (const c of [...candidates].sort((a, b) => b.objective - a.objective)) {
    if (chosen.length >= 3) break;
    if (!chosen.includes(c) && chosen.every((d) => isDistinct(c.poses, d.poses, context))) chosen.push(c);
  }

  const lockedIds = project.furniture.filter((f) => f.locked).map((f) => f.id);
  const suggestions = chosen.map((c, i): Suggestion => {
    // Positions are kept exact (not rounded): what's scored is exactly what's shown and applied.
    const arranged = withPoses(project, c.poses);
    const evaluated = evaluate(arranged);
    const explanation = explain({ project, ...base }, { project: arranged, ...evaluated }, lockedIds, settings.walkwayWidth);
    return {
      id: `${settings.seed}-${i}`,
      title: `Layout ${String.fromCharCode(65 + i)}`,
      emphasis: c.profile.emphasis,
      functionWeight: c.profile.functionWeight,
      positions: [...c.poses].map(([id, pose]) => ({ id, x: pose.x, y: pose.y, rotation: normalizeRotation(pose.rotation) })),
      scores: evaluated.scores,
      ...explanation,
      movedCount: movable.filter((f) => hasMoved(f, c.poses.get(f.id)!)).length,
    };
  });

  const messages: string[] = [];
  if (!baselineValid) messages.push('Your current layout breaks a hard rule (an overlap, a blocked doorway or something on the stairs), so suggestions were built from scratch.');
  if (suggestions.length < 3) {
    messages.push(
      `Found ${suggestions.length} clearly different layout${suggestions.length === 1 ? '' : 's'}. The room’s shape, locked pieces and walkway space leave few genuinely different arrangements.`,
    );
  }
  if (suggestions.every((s) => s.movedCount === 0)) messages.push('Your current layout already scored best for these settings.');

  return result('ok', messages.join(' ') || null, suggestions, unmetPreferences(project, suggestions, context));
}

/**
 * Two layouts count as different if pieces moved on average at least 30 cm (or 8% of the
 * room's size), or if at least a third of the pieces face a different way.
 */
export function isDistinct(a: Arrangement, b: Arrangement, context: LayoutContext): boolean {
  const ids = [...a.keys()];
  if (ids.length === 0) return false;
  let moved = 0;
  let turned = 0;
  for (const id of ids) {
    const p = a.get(id)!;
    const q = b.get(id)!;
    moved += Math.hypot(p.x - q.x, p.y - q.y);
    const turn = Math.abs(((p.rotation - q.rotation) % 360 + 360) % 360);
    if (Math.min(turn, 360 - turn) > 10) turned++;
  }
  return moved / ids.length >= Math.max(30, context.roomRadius * 0.08) || turned / ids.length >= 1 / 3;
}

/** A distinct, reproducible seed for each run. */
function mixSeed(seed: number, profile: number, restart: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 2654435761) + profile * 7919 + restart * 104729) >>> 0;
}

function infeasibleMessage(project: Project, movable: Project['furniture'], unplaced: Map<string, number>, context: LayoutContext): string {
  const names = [...unplaced.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => project.furniture.find((f) => f.id === id)?.name).filter(Boolean);
  const footprint = movable.filter(isSolid).reduce((s, f) => s + f.width * f.depth, 0) / 10_000;
  let open = 0;
  for (const v of context.grid.fixed) open += v ? 0 : 1;
  const openM2 = (open * context.grid.cell ** 2) / 10_000;
  return (
    `No arrangement was found that keeps every piece inside the room, clear of doorways and stairs, and not overlapping. ` +
    `Hardest to fit: ${names.slice(0, 3).join(', ') || 'several pieces'}. ` +
    `The movable pieces cover ${footprint.toFixed(1)} m² of the ${openM2.toFixed(1)} m² of open floor` +
    `${footprint > openM2 * 0.55 ? ', which leaves very little room to walk' : ''}. ` +
    `Try removing or shrinking a piece, unlocking pieces, or lowering the walkway width.`
  );
}

/** Preferences and relationships that none of the suggestions could fully meet. */
function unmetPreferences(project: Project, suggestions: Suggestion[], context: LayoutContext): string[] {
  if (suggestions.length === 0) return [];
  const results = suggestions.map((s) => measure(withPoses(project, new Map(s.positions.map((p) => [p.id, p]))), context));
  const name = (id: string) => project.furniture.find((f) => f.id === id)?.name ?? 'A piece';
  const unmet: string[] = [];
  for (const [key] of results[0].preferences) {
    const values = results.map((m) => m.preferences.get(key)?.value);
    if (values.some((v) => v === null || v === undefined)) continue;
    if (Math.max(...(values as number[])) < 0.5) {
      const [id, preference] = key.split(':') as [string, keyof typeof PREFERENCE_LABELS];
      unmet.push(`${name(id)}: “${PREFERENCE_LABELS[preference].toLowerCase()}”`);
    }
  }
  for (const r of project.relationships) {
    if (Math.max(...results.map((m) => m.relationships.get(r.id) ?? 0)) < 0.5) unmet.push(RELATIONSHIP_LABELS[r.type](name(r.a), name(r.b)));
  }
  return unmet;
}
