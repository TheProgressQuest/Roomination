import { describeConflict, obstacleName } from '../model/conflicts';
import { PREFERENCE_LABELS, RELATIONSHIP_LABELS } from '../model/furnitureKinds';
import type { Project } from '../model/types';
import { formatLength } from '../model/units';
import type { Metrics, Scores } from './scoring';

/**
 * Plain-language reasons for a suggestion. Every sentence is produced from a measured
 * difference between the current layout and the suggestion — if a number didn't change
 * meaningfully, nothing is said about it.
 */

export interface Explanation {
  improvements: string[];
  tradeoffs: string[];
  warnings: string[];
}

interface Side {
  project: Project;
  metrics: Metrics;
  scores: Scores;
}

/** Changes smaller than these aren't worth mentioning. */
const MIN_AREA_M2 = 0.3;
const MIN_DISTANCE_CM = 40;
const MIN_PREFERENCE_CHANGE = 0.3;

export function explain(before: Side, after: Side, lockedIds: string[], walkway: number): Explanation {
  const improvements: string[] = [];
  const tradeoffs: string[] = [];
  const units = after.project.units;
  const name = (id: string) => after.project.furniture.find((f) => f.id === id)?.name ?? 'A piece';
  const b = before.metrics.circulation;
  const a = after.metrics.circulation;

  // Doors and stairs.
  const blockedBefore = b.unreachableDoors + b.unreachableStairs;
  const blockedAfter = a.unreachableDoors + a.unreachableStairs;
  if (blockedAfter < blockedBefore) improvements.push(`Opened a clear walkway to ${count(blockedBefore - blockedAfter, 'more door or staircase', 'more doors or staircases')}.`);
  if (blockedAfter > blockedBefore) tradeoffs.push(`${count(blockedAfter - blockedBefore, 'door or staircase is', 'doors or staircases are')} harder to reach.`);

  // Walking space, in square metres of floor.
  const walkable = (a.reachableFloor * after.metrics.freeFloorM2) - (b.reachableFloor * before.metrics.freeFloorM2);
  // "Walkable" means reachable along paths at least as wide as the chosen walkway.
  const width = formatLength(walkway, units);
  if (walkable >= MIN_AREA_M2) improvements.push(`Created about ${walkable.toFixed(1)} m² more floor you can reach along ${width}-wide walkways.`);
  if (walkable <= -MIN_AREA_M2) tradeoffs.push(`About ${(-walkable).toFixed(1)} m² less floor can be reached along ${width}-wide walkways.`);
  if (b.narrowShare - a.narrowShare >= 0.05) improvements.push('Widened tight spots that you previously had to squeeze through.');
  if (a.narrowShare - b.narrowShare >= 0.05) tradeoffs.push('Some areas can only be reached by squeezing through.');
  if (b.pocketShare - a.pocketShare >= 0.03) improvements.push('Opened up floor that was cut off by furniture.');
  if (a.pocketShare - b.pocketShare >= 0.03) tradeoffs.push('Some floor is cut off by furniture.');

  // Furniture you can actually use.
  for (const [id, points] of a.usable) {
    const was = b.usable.get(id)?.some(Boolean) ?? false;
    const now = points.some(Boolean);
    const kind = after.project.furniture.find((f) => f.id === id)?.kind;
    if (kind === 'bed') continue; // beds are covered by their access preferences
    if (!was && now) improvements.push(`Made the ${name(id)} reachable from the side you use.`);
    if (was && !now) tradeoffs.push(`The ${name(id)} is harder to reach from the side you use.`);
  }

  // Vents, outlets, switches, radiators.
  const coverage = (m: Metrics) => {
    const map = new Map<string, number>();
    for (const c of m.softConflicts) if (c.otherKind === 'feature') map.set(c.otherId, (map.get(c.otherId) ?? 0) + c.coverage);
    return map;
  };
  const coverBefore = coverage(before.metrics);
  const coverAfter = coverage(after.metrics);
  for (const [featureId, was] of coverBefore) {
    const now = coverAfter.get(featureId) ?? 0;
    const label = obstacleName({ otherId: featureId, otherKind: 'feature' }, after.project);
    if (now === 0) improvements.push(`Cleared the ${label}.`);
    else if (now < was - 0.1) improvements.push(`Reduced obstruction around the ${label}.`);
  }
  for (const [featureId, now] of coverAfter) {
    const was = coverBefore.get(featureId) ?? 0;
    if (now > was + 0.1) tradeoffs.push(`Partly blocks the ${obstacleName({ otherId: featureId, otherKind: 'feature' }, after.project)}.`);
  }

  // The user's own preferences, with measured distances where there are any.
  for (const [key, result] of after.metrics.preferences) {
    const previous = before.metrics.preferences.get(key);
    if (!previous || result.value === null || previous.value === null) continue;
    const [id, preference] = key.split(':') as [string, keyof typeof PREFERENCE_LABELS];
    const delta = result.value - previous.value;
    const distanceKind = preference === 'nearWindow' ? 'a window' : preference === 'nearOutlet' ? 'an outlet' : null;
    if (distanceKind && result.measured !== null && previous.measured !== null) {
      const moved = previous.measured - result.measured;
      if (moved >= MIN_DISTANCE_CM) improvements.push(`Moved the ${name(id)} ${formatLength(moved, units)} closer to ${distanceKind}.`);
      if (moved <= -MIN_DISTANCE_CM) tradeoffs.push(`The ${name(id)} is ${formatLength(-moved, units)} farther from ${distanceKind}.`);
      continue;
    }
    const label = PREFERENCE_LABELS[preference].toLowerCase();
    if (delta >= MIN_PREFERENCE_CHANGE) improvements.push(`${name(id)} now meets “${label}”.`);
    if (delta <= -MIN_PREFERENCE_CHANGE) tradeoffs.push(`${name(id)} no longer meets “${label}”.`);
  }
  for (const relationship of after.project.relationships) {
    const was = before.metrics.relationships.get(relationship.id) ?? 0;
    const now = after.metrics.relationships.get(relationship.id) ?? 0;
    const label = RELATIONSHIP_LABELS[relationship.type](name(relationship.a), name(relationship.b));
    if (now - was >= MIN_PREFERENCE_CHANGE) improvements.push(`Now met: ${label}.`);
    if (was - now >= MIN_PREFERENCE_CHANGE) tradeoffs.push(`No longer met: ${label}.`);
  }

  // Appearance — labelled as a matter of taste.
  const component = (s: Scores, id: string) => s.components.find((c) => c.id === id)?.value ?? null;
  for (const [id, better, worse] of [
    ['alignment', 'Lined more pieces up with the walls.', 'Fewer pieces are square to the walls.'],
    ['orientation', 'Turned seating and the TV to face each other.', 'Seating and the TV face each other less.'],
    ['wallStanding', 'Put more storage, shelves, TVs or beds against walls.', 'Fewer storage pieces, shelves, TVs or beds stand against walls.'],
    ['spacing', 'Removed awkward small gaps between pieces.', 'Left some awkward small gaps.'],
    ['balance', 'Spread furniture more evenly around the room.', 'Furniture is bunched more to one side.'],
  ] as const) {
    const was = component(before.scores, id);
    const now = component(after.scores, id);
    if (was === null || now === null) continue;
    if (now - was >= 0.2) improvements.push(`${better} (appearance)`);
    if (was - now >= 0.2) tradeoffs.push(`${worse} (appearance)`);
  }

  // Locked pieces stay put; say so.
  const lockedNames = lockedIds.map(name);
  if (lockedNames.length > 0) {
    const shown = lockedNames.slice(0, 3).join(', ');
    improvements.push(`Kept ${shown}${lockedNames.length > 3 ? ` and ${lockedNames.length - 3} more` : ''} in ${lockedNames.length === 1 ? 'its' : 'their'} locked position.`);
  }

  return { improvements, tradeoffs, warnings: warningsFor(after) };
}

/** What's still not right in a layout (measured, not guessed). */
export function warningsFor(side: Side): string[] {
  const warnings: string[] = [];
  const c = side.metrics.circulation;
  if (c.unreachableDoors > 0) warnings.push(`${count(c.unreachableDoors, 'door has', 'doors have')} no comfortable walkway from the main door.`);
  if (c.unreachableStairs > 0) warnings.push(`${count(c.unreachableStairs, 'staircase has', 'staircases have')} no comfortable walkway to the first step.`);
  for (const conflict of side.metrics.softConflicts) warnings.push(describeConflict(conflict, side.project));
  for (const [key, result] of side.metrics.preferences) {
    const [id, preference] = key.split(':') as [string, keyof typeof PREFERENCE_LABELS];
    const item = side.project.furniture.find((f) => f.id === id)?.name ?? 'A piece';
    if (result.unavailable) warnings.push(`${item} — “${PREFERENCE_LABELS[preference].toLowerCase()}”: ${result.unavailable}`);
  }
  return warnings;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
