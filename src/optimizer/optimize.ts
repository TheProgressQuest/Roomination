import { isSolid } from '../model/conflicts';
import { normalizeRotation } from '../model/geometry';
import { PREFERENCE_LABELS, RELATIONSHIP_LABELS, weightsFor } from '../model/furnitureKinds';
import { seededRandom } from '../model/random';
import type { OptimizerSettings, OptimizerWeights, Project, RoomPurpose } from '../model/types';
import { compare, explain, warningsFor, type ComparisonRow } from './explain';
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
export const ALGORITHM_VERSION = 2;

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
  /** The weighting this suggestion was searched with. */
  weights: OptimizerWeights;
  positions: { id: string; x: number; y: number; rotation: number }[];
  /** Scored with the user's weighting, so suggestions can be compared fairly. */
  scores: Scores;
  improvements: string[];
  tradeoffs: string[];
  warnings: string[];
  /** Current layout vs this suggestion, measured. */
  comparison: ComparisonRow[];
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
  /** Pairings assumed from the furniture (shown, and can be switched off). */
  assumed: string[];
  /** What the room was treated as (chosen, or guessed). */
  purpose: RoomPurpose;
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
  weights: OptimizerWeights;
}

const percent = (w: OptimizerWeights) => `${Math.round(w.functional * 100)}% function, ${Math.round(w.aesthetic * 100)}% appearance${w.fengShui > 0 ? `, ${Math.round(w.fengShui * 100)}% Feng Shui` : ''}`;

/** The person's own emphasis first, then contrasting ones (Feng Shui only when it's switched on). */
function profiles(settings: OptimizerSettings, fengShui: boolean): Profile[] {
  const own = weightsFor(settings, fengShui);
  const labels: Record<OptimizerSettings['mode'], string> = {
    functional: 'Most functional',
    aesthetic: 'Most aesthetic',
    fengShui: 'Feng Shui / Harmony',
    balanced: `Your balance (${percent(own)})`,
    custom: `Your mix (${percent(own)})`,
  };
  const all: Profile[] = [
    { emphasis: labels[settings.mode], weights: own },
    ...(fengShui ? [{ emphasis: 'Feng Shui / Harmony', weights: weightsFor({ ...settings, mode: 'fengShui' }, true) }] : []),
    { emphasis: 'Most functional', weights: weightsFor({ ...settings, mode: 'functional' }, fengShui) },
    { emphasis: 'Balanced', weights: { functional: 0.6, aesthetic: 0.4, fengShui: 0 } },
    { emphasis: 'Most aesthetic', weights: weightsFor({ ...settings, mode: 'aesthetic' }, fengShui) },
  ];
  // Drop contrasting profiles that duplicate one already chosen.
  const differ = (a: OptimizerWeights, b: OptimizerWeights) => Math.max(Math.abs(a.functional - b.functional), Math.abs(a.aesthetic - b.aesthetic), Math.abs(a.fengShui - b.fengShui)) > 0.05;
  const chosen: Profile[] = [];
  for (const p of all) if (chosen.every((c) => differ(c.weights, p.weights))) chosen.push(p);
  return chosen.slice(0, 3);
}

export type ProgressCallback = (done: number, total: number) => void;

export function optimize(input: OptimizeInput, onProgress: ProgressCallback = () => {}, shouldStop: () => boolean = () => false): OptimizeResult {
  const { settings } = input;
  // Raised and wall-mounted pieces (mirrors, wall cabinets) don't take up floor space, so the
  // optimizer neither moves them nor arranges around them.
  const project = { ...input.project, furniture: input.project.furniture.filter((f) => !((f.elevation ?? 0) > 0)) };
  const movableIds = new Set(input.movableIds.filter((id) => project.furniture.some((f) => f.id === id && !f.locked && f.kind !== 'fixture')));
  const context = createContext(project, movableIds, settings);
  const userWeights = weightsFor(settings, context.fengShui);
  const nameOf = (id: string) => project.furniture.find((f) => f.id === id)?.name ?? 'A piece';
  const evaluate = (p: Project) => {
    const metrics = measure(p, context);
    return { metrics, scores: score(p, metrics, context, userWeights) };
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
    assumed: context.relationships.filter((r) => r.id.startsWith('assumed:')).map((r) => RELATIONSHIP_LABELS[r.type](nameOf(r.a), nameOf(r.b))),
    purpose: context.purpose,
    seed: settings.seed,
    algorithmVersion: ALGORITHM_VERSION,
  });

  if (movable.length === 0) {
    return result('nothingToMove', 'Every piece is locked or left out, so there is nothing to rearrange. Unlock or select some pieces first.');
  }

  const budget = BUDGETS[settings.effort];
  const runs = profiles(settings, context.fengShui);
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
    const objective = objectiveFor(context, profile.weights);
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
    const explanation = explain({ project, ...base }, { project: arranged, ...evaluated }, lockedIds, settings.walkwayWidth, context.relationships);
    const comparison = compare({ project, ...base }, { project: arranged, ...evaluated }, context.relationships);
    return {
      id: `${settings.seed}-${i}`,
      title: `Layout ${String.fromCharCode(65 + i)}`,
      emphasis: c.profile.emphasis,
      weights: c.profile.weights,
      positions: [...c.poses].map(([id, pose]) => ({ id, x: pose.x, y: pose.y, rotation: normalizeRotation(pose.rotation) })),
      scores: evaluated.scores,
      ...explanation,
      comparison,
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
    // "Fully met" means at least 75%: half of "reachable from both sides" is one side, i.e. not met.
    if (Math.max(...(values as number[])) < 0.75) {
      const [id, preference] = key.split(':') as [string, keyof typeof PREFERENCE_LABELS];
      unmet.push(`${name(id)}: “${PREFERENCE_LABELS[preference].toLowerCase()}”`);
    }
  }
  for (const r of project.relationships) {
    if (Math.max(...results.map((m) => m.relationships.get(r.id) ?? 0)) < 0.75) unmet.push(RELATIONSHIP_LABELS[r.type](name(r.a), name(r.b)));
  }
  return unmet;
}
