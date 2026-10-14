import { findConflicts, isSolid } from '../model/conflicts';
import { footprintInside, roomFootprint } from '../model/shape';
import type { Furniture, OptimizerWeights, Point, Project } from '../model/types';
import { frontOf, isHard, localToRoom, measure, score, type LayoutContext } from './scoring';

/**
 * Searching for good arrangements.
 *
 * 1. Greedy construction: pieces are placed one at a time — anchors before the pieces
 *    related to them, larger before smaller — at the best of a set of sensible candidate
 *    spots (backs against walls, in front of / beside related pieces, open floor).
 * 2. Simulated annealing: random small changes (shift, turn, relocate, swap) are kept
 *    when they improve the score, and occasionally when they don't, early on, to escape
 *    dead ends. The "temperature" falls over a fixed number of steps.
 *
 * Every candidate must pass the hard constraints first (`fitsHard`). The random generator
 * is seeded and step counts are fixed (never time-based), so the same inputs give the
 * same results.
 */

export interface Pose {
  x: number;
  y: number;
  rotation: number;
}

export type Arrangement = Map<string, Pose>;

/** Whether a piece really moved or turned (ignoring sub-centimetre noise and 360° wrap-around). */
export function hasMoved(before: Pose, after: Pose): boolean {
  const turn = Math.abs((((before.rotation - after.rotation) % 360) + 360) % 360);
  return Math.hypot(before.x - after.x, before.y - after.y) > 5 || Math.min(turn, 360 - turn) > 1;
}

/** The project with the given pieces moved to their poses. */
export function withPoses(project: Project, poses: Arrangement): Project {
  return { ...project, furniture: project.furniture.map((f) => (poses.has(f.id) ? { ...f, ...poses.get(f.id)! } : f)) };
}

/**
 * Hard constraints for a piece that has moved: fully inside the room's real outline, no
 * collision with any other piece, wall, column or radiator, not on stairs, not in a
 * doorway. Previously accepted overlaps don't count here — they were accepted for the
 * old positions only.
 */
export function fitsHard(project: Project, item: Furniture, context: LayoutContext): boolean {
  if (!footprintInside(roomFootprint(item).parts, context.room)) return false;
  if (!isSolid(item)) return true;
  return !findConflicts(project, item.id).some((c) => isHard(c, project));
}

/** Directions furniture can sensibly face: square to each wall direction in the room. */
export function sensibleRotations(context: LayoutContext): number[] {
  const bases = new Set(context.walls.map((w) => Math.round((((w.angle % 90) + 90) % 90) * 10) / 10));
  return [...bases].flatMap((b) => [b, b + 90, b + 180, b + 270].map((r) => ((r % 360) + 360) % 360));
}

/** Rotation whose front points along `direction`. */
function rotationFacing(direction: Point): number {
  const r = (Math.atan2(-direction.x, direction.y) * 180) / Math.PI;
  return Math.round((((r % 360) + 360) % 360) * 1000) / 1000;
}

/** Candidate spots for one piece, given what's already placed. */
export function candidatePoses(item: Furniture, project: Project, context: LayoutContext, random: () => number, interiorSamples: number): Pose[] {
  const poses: Pose[] = [];

  // Backs against walls, facing into the room (both sides of interior walls).
  for (const wall of context.walls) {
    if (wall.length < item.width) continue;
    const d = { x: (wall.end.x - wall.start.x) / wall.length, y: (wall.end.y - wall.start.y) / wall.length };
    const inward = { x: -d.y, y: d.x };
    const sides = wall.chain === 'outline' ? [{ n: inward, inset: 1 }] : [
      { n: inward, inset: wall.thickness / 2 + 1 },
      { n: { x: -inward.x, y: -inward.y }, inset: wall.thickness / 2 + 1 },
    ];
    const step = Math.max(25, (wall.length - item.width) / 6);
    for (let t = item.width / 2; t <= wall.length - item.width / 2 + 0.01; t += step) {
      for (const { n, inset } of sides) {
        const along = { x: wall.start.x + d.x * t, y: wall.start.y + d.y * t };
        poses.push({ x: along.x + n.x * (item.depth / 2 + inset), y: along.y + n.y * (item.depth / 2 + inset), rotation: rotationFacing(n) });
        if (item.kind === 'desk') {
          // Also "commanding": out from the wall with the person sitting between desk and wall,
          // facing into the room (needs about a metre behind the desk for the chair).
          const out = item.depth / 2 + inset + 100;
          poses.push({ x: along.x + n.x * out, y: along.y + n.y * out, rotation: rotationFacing({ x: -n.x, y: -n.y }) });
        }
      }
    }
  }

  // Positions defined by relationships with pieces already in place.
  const placed = (id: string) => project.furniture.find((f) => f.id === id);
  for (const r of context.relationships) {
    if (r.b === item.id && r.type !== 'faces') {
      const a = placed(r.a);
      if (!a) continue;
      if (r.type === 'inFrontOf') {
        const centre = localToRoom(a, { x: 0, y: a.depth / 2 + 45 + item.depth / 2 });
        const facesA = item.kind === 'chair' || item.kind === 'armchair';
        poses.push({ ...centre, rotation: facesA ? (a.rotation + 180) % 360 : a.rotation });
      } else if (r.type === 'beside') {
        for (const side of [-1, 1]) {
          const centre = localToRoom(a, { x: side * (a.width / 2 + item.width / 2 + 5), y: -a.depth / 2 + item.depth / 2 });
          poses.push({ ...centre, rotation: a.rotation });
        }
      } else {
        for (const [x, y] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const centre = localToRoom(a, { x: x * (a.width / 2 + item.depth / 2 + 30), y: y * (a.depth / 2 + item.depth / 2 + 30) });
          const towards = { x: a.x - centre.x, y: a.y - centre.y };
          poses.push({ ...centre, rotation: item.kind === 'chair' ? rotationFacing(towards) : a.rotation });
        }
      }
    }
    if (r.type === 'faces' && r.a === item.id) {
      const target = placed(r.b);
      if (!target) continue;
      for (const distance of [230, 300]) {
        const front = frontOf(target);
        const centre = { x: target.x + front.x * distance, y: target.y + front.y * distance };
        poses.push({ ...centre, rotation: rotationFacing({ x: target.x - centre.x, y: target.y - centre.y }) });
      }
    }
  }

  // Open floor, square to the walls.
  const rotations = sensibleRotations(context);
  const box = { minX: Math.min(...context.room.map((p) => p.x)), maxX: Math.max(...context.room.map((p) => p.x)), minY: Math.min(...context.room.map((p) => p.y)), maxY: Math.max(...context.room.map((p) => p.y)) };
  for (let i = 0; i < interiorSamples; i++) {
    poses.push({
      x: box.minX + random() * (box.maxX - box.minX),
      y: box.minY + random() * (box.maxY - box.minY),
      rotation: rotations[Math.floor(random() * rotations.length)],
    });
  }
  return poses;
}

/**
 * Order of placement: a piece waits for the pieces it relates to (a chair waits for its
 * desk; a sofa that faces a TV waits for the TV), otherwise larger pieces go first.
 */
export function placementOrder(movable: Furniture[], project: Project, relationships: Project['relationships']): Furniture[] {
  const dependsOn = new Map<string, Set<string>>(movable.map((f) => [f.id, new Set()]));
  for (const r of relationships) {
    const [dependent, anchor] = r.type === 'faces' ? [r.a, r.b] : [r.b, r.a];
    dependsOn.get(dependent)?.add(anchor);
  }
  const remaining = [...movable].sort((a, b) => b.width * b.depth - a.width * a.depth || a.id.localeCompare(b.id));
  const order: Furniture[] = [];
  const done = new Set(project.furniture.filter((f) => !dependsOn.has(f.id)).map((f) => f.id));
  while (remaining.length > 0) {
    const ready = remaining.findIndex((f) => [...dependsOn.get(f.id)!].every((d) => done.has(d)));
    const next = remaining.splice(ready === -1 ? 0 : ready, 1)[0];
    order.push(next);
    done.add(next.id);
  }
  return order;
}

export interface SearchBudget {
  /** Candidate spots sampled on open floor per piece during construction. */
  interiorSamples: number;
  /** Annealing steps. */
  steps: number;
}

export interface SearchOutcome {
  poses: Arrangement;
  objective: number;
  /** Pieces that couldn't be placed anywhere without breaking a hard constraint. */
  unplaced: string[];
}

type Objective = (project: Project) => number;

/** Places every movable piece from scratch, greedily. */
export function construct(project: Project, movable: Furniture[], context: LayoutContext, objective: Objective, random: () => number, budget: SearchBudget): SearchOutcome {
  const poses: Arrangement = new Map();
  const movableIds = new Set(movable.map((m) => m.id));
  const unplaced: string[] = [];

  for (const item of placementOrder(movable, project, context.relationships)) {
    // Fixed pieces plus those placed so far; pieces still waiting are left out, so they can't block anything.
    const placedSoFar = withPoses(project, poses);
    const base = { ...placedSoFar, furniture: placedSoFar.furniture.filter((f) => !movableIds.has(f.id) || poses.has(f.id)) };
    let best: { pose: Pose; value: number } | null = null;
    for (const pose of candidatePoses(item, base, context, random, budget.interiorSamples)) {
      const moved = { ...item, ...pose };
      const trial = { ...base, furniture: [...base.furniture, moved] };
      if (!fitsHard(trial, moved, context)) continue;
      // Tiny seeded jitter breaks exact ties without favouring list order.
      const value = objective(trial) + random() * 1e-6;
      if (!best || value > best.value) best = { pose, value };
    }
    if (best) {
      poses.set(item.id, best.pose);
    } else {
      unplaced.push(item.id);
    }
  }
  const final = withPoses(project, poses);
  return { poses, objective: unplaced.length === 0 ? objective(final) : -Infinity, unplaced };
}

/** Steps between pauses, so callers can report progress and notice cancellation. */
export const ANNEAL_PAUSE_EVERY = 100;

/**
 * Improves an arrangement by simulated annealing. A generator: it pauses every
 * `ANNEAL_PAUSE_EVERY` steps (yielding the number of steps done) and returns the best
 * arrangement found when finished.
 */
export function* anneal(project: Project, start: Arrangement, movable: Furniture[], context: LayoutContext, objective: Objective, random: () => number, budget: SearchBudget): Generator<number, SearchOutcome> {
  if (movable.length === 0 || budget.steps === 0) return { poses: start, objective: objective(withPoses(project, start)), unplaced: [] };
  let current = new Map(start);
  let currentValue = objective(withPoses(project, current));
  let best = new Map(current);
  let bestValue = currentValue;
  const rotations = sensibleRotations(context);
  const startTemperature = 6;
  const endTemperature = 0.15;

  for (let step = 0; step < budget.steps; step++) {
    if (step > 0 && step % ANNEAL_PAUSE_EVERY === 0) yield step;
    const progress = step / budget.steps;
    const temperature = startTemperature * (endTemperature / startTemperature) ** progress;
    const proposal = new Map(current);
    const item = movable[Math.floor(random() * movable.length)];
    const pose = proposal.get(item.id)!;
    const move = random();
    let changed: Furniture[];

    if (move < 0.45) {
      // Shift: big early on, fine at the end.
      const reach = 80 * (1 - progress) + 4;
      proposal.set(item.id, { ...pose, x: pose.x + (random() * 2 - 1) * reach, y: pose.y + (random() * 2 - 1) * reach });
      changed = [item];
    } else if (move < 0.62) {
      proposal.set(item.id, { ...pose, rotation: rotations[Math.floor(random() * rotations.length)] });
      changed = [item];
    } else if (move < 0.87) {
      // Relocate to a sensible spot (against a wall, by a related piece, open floor).
      const others = withPoses(project, proposal);
      const spots = candidatePoses(item, { ...others, furniture: others.furniture.filter((f) => f.id !== item.id) }, context, random, 4);
      proposal.set(item.id, spots[Math.floor(random() * spots.length)]);
      changed = [item];
    } else {
      // Swap with a piece of similar size.
      const partner = movable[Math.floor(random() * movable.length)];
      if (partner.id === item.id || Math.abs(partner.width * partner.depth - item.width * item.depth) > 0.5 * item.width * item.depth) continue;
      const other = proposal.get(partner.id)!;
      proposal.set(item.id, { ...other });
      proposal.set(partner.id, { ...pose });
      changed = [item, partner];
    }

    const trial = withPoses(project, proposal);
    if (!changed.every((f) => fitsHard(trial, trial.furniture.find((t) => t.id === f.id)!, context))) continue;
    const value = objective(trial);
    if (value >= currentValue || random() < Math.exp((value - currentValue) / temperature)) {
      current = proposal;
      currentValue = value;
      if (value > bestValue) {
        best = new Map(proposal);
        bestValue = value;
      }
    }
  }
  return { poses: best, objective: bestValue, unplaced: [] };
}

/** The objective used during search: the overall score at a given weighting. */
export function objectiveFor(context: LayoutContext, weights: OptimizerWeights): Objective {
  return (project) => score(project, measure(project, context), context, weights).overall;
}
