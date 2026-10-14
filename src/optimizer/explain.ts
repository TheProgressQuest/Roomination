import { describeConflict, findConflicts, obstacleName } from '../model/conflicts';
import { PREFERENCE_LABELS, RELATIONSHIP_LABELS } from '../model/furnitureKinds';
import type { Project, Relationship } from '../model/types';
import { formatLength } from '../model/units';
import { isHard, type Metrics, type Scores } from './scoring';

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

export function explain(before: Side, after: Side, lockedIds: string[], walkway: number, relationships: Relationship[] = []): Explanation {
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

  // The usual pairings (desk + chair, sofa → TV, …): said the way a person would.
  const pairText = (r: Relationship, met: boolean) => {
    const [a, b] = [name(r.a), name(r.b)];
    switch (r.type) {
      case 'faces':
        return met ? `Turned the ${a} to face the ${b}.` : `The ${a} no longer faces the ${b}.`;
      case 'inFrontOf':
        return met ? `Placed the ${b} in front of the ${a}.` : `The ${b} is no longer in front of the ${a}.`;
      case 'beside':
        return met ? `Put the ${b} beside the ${a}.` : `The ${b} is no longer beside the ${a}.`;
      case 'near':
        return met ? `Brought the ${b} to the ${a}.` : `The ${b} is farther from the ${a}.`;
    }
  };
  for (const r of relationships) {
    if (!r.id.startsWith('assumed:')) continue;
    const was = before.metrics.pairs.get(r.id) ?? 0;
    const now = after.metrics.pairs.get(r.id) ?? 0;
    if (now >= 0.7 && was < 0.5) improvements.push(pairText(r, true));
    if (was >= 0.7 && now < 0.5) tradeoffs.push(pairText(r, false));
  }

  // Room in front of each piece (legroom, pulling a chair out, opening doors).
  for (const space of after.metrics.frontSpace) {
    const previous = before.metrics.frontSpace.find((f) => f.id === space.id);
    if (!previous) continue;
    const item = after.project.furniture.find((f) => f.id === space.id);
    const amount = formatLength(Math.min(space.clear, 999), units);
    if (space.clear >= space.need && previous.clear < space.need) {
      improvements.push(item?.kind === 'desk' ? `Gave the ${name(space.id)} room to pull its chair out (${amount}).` : `Cleared space in front of the ${name(space.id)} (now ${amount}).`);
    }
    if (space.clear < space.need && previous.clear >= space.need) tradeoffs.push(`Less space in front of the ${name(space.id)} (${amount}).`);
  }
  for (const bed of after.metrics.bedSides) {
    const previous = before.metrics.bedSides.find((b) => b.id === bed.id);
    const both = (sides: [number, number]) => Math.min(...sides) >= 60;
    if (previous && both(bed.sides) && !both(previous.sides)) improvements.push(`Made both sides of the ${name(bed.id)} reachable.`);
    if (previous && !both(bed.sides) && both(previous.sides)) tradeoffs.push(`One side of the ${name(bed.id)} is harder to reach.`);
  }
  if (b.detour - a.detour >= 0.1) improvements.push(`Shortened walking routes: walks are now ${pct(a.detour - 1)} longer than in an empty room (was ${pct(b.detour - 1)}).`);
  if (a.detour - b.detour >= 0.1) tradeoffs.push(`Walking routes are longer: ${pct(a.detour - 1)} longer than in an empty room (was ${pct(b.detour - 1)}).`);

  // Feng Shui — an interpretive preference, labelled as such.
  if (after.metrics.fengShui && before.metrics.fengShui) {
    for (const now of after.metrics.fengShui.commanding) {
      const was = before.metrics.fengShui.commanding.find((c) => c.itemId === now.itemId);
      if (!was) continue;
      const item = after.project.furniture.find((f) => f.id === now.itemId);
      const who = item?.kind === 'bed' ? `the ${name(now.itemId)} so you can see the entrance from it` : `the ${name(now.itemId)} so the seated person can see the entrance`;
      if (now.seesEntrance >= 0.8 && was.seesEntrance < 0.5) improvements.push(`Positioned ${who} (Feng Shui).`);
      if (was.seesEntrance >= 0.8 && now.seesEntrance < 0.5) tradeoffs.push(`The entrance is no longer in view from the ${name(now.itemId)} (Feng Shui).`);
      if (now.outOfDoorLine === 1 && was.outOfDoorLine < 1) improvements.push(`Kept the ${name(now.itemId)} out of direct line with the doorway (Feng Shui).`);
      if (now.outOfDoorLine < 1 && was.outOfDoorLine === 1) tradeoffs.push(`The ${name(now.itemId)} is now in line with the doorway (Feng Shui).`);
      if (now.support - was.support >= 0.5) improvements.push(`Gave the ${name(now.itemId)} a solid wall behind it (Feng Shui).`);
    }
    const fsComponent = (m: Metrics, id: string) => m.fengShui?.components.find((c) => c.id === id)?.value ?? null;
    for (const [id, better, worse] of [
      ['entry', 'Opened up the space just inside the entrance (Feng Shui).', 'The space inside the entrance is more crowded (Feng Shui).'],
      ['conversation', 'Turned the seating towards each other for conversation (Feng Shui).', 'The seating is less conversational (Feng Shui).'],
    ] as const) {
      const was = fsComponent(before.metrics, id);
      const now = fsComponent(after.metrics, id);
      if (was === null || now === null) continue;
      if (now - was >= 0.3) improvements.push(better);
      if (was - now >= 0.3) tradeoffs.push(worse);
    }
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

function pct(fraction: number): string {
  return `${Math.max(0, Math.round(fraction * 100))}%`;
}

export interface ComparisonRow {
  label: string;
  before: string;
  after: string;
  /** true: better, false: worse, null: unchanged or not comparable. */
  better: boolean | null;
}

/**
 * Side-by-side measurements of the current layout and a suggestion, all calculated (never
 * estimated). Feng Shui appears only when it's switched on, labelled as interpretive.
 */
export function compare(before: Side, after: Side, relationships: Relationship[]): ComparisonRow[] {
  const rows: ComparisonRow[] = [];
  const row = (label: string, b: number, a: number, format: (v: number) => string, higherIsBetter: boolean) =>
    rows.push({ label, before: format(b), after: format(a), better: Math.abs(a - b) < 1e-6 ? null : higherIsBetter ? a > b : a < b });
  const hard = (side: Side) => findConflicts(side.project).filter((c) => isHard(c, side.project) && c.type === 'collision').length;
  const doorIssues = (side: Side) =>
    side.metrics.circulation.unreachableDoors + findConflicts(side.project).filter((c) => c.otherKind === 'feature' && side.project.features.find((f) => f.id === c.otherId)?.kind === 'door').length;
  const stairIssues = (side: Side) => side.metrics.circulation.unreachableStairs + findConflicts(side.project).filter((c) => c.otherKind === 'stairs').length;
  const met = (side: Side) => {
    const values = [...side.metrics.pairs.values(), ...relationships.filter((r) => !r.id.startsWith('assumed:')).map((r) => side.metrics.relationships.get(r.id) ?? 0)];
    return values.filter((v) => v >= 0.7).length;
  };
  const pairsTotal = after.metrics.pairs.size + relationships.filter((r) => !r.id.startsWith('assumed:')).length;
  const roomy = (side: Side) => side.metrics.frontSpace.filter((f) => f.clear >= f.need).length;
  const n = (v: number) => String(v);

  row('Overlapping furniture', hard(before), hard(after), n, false);
  row('Doors blocked or swung into', doorIssues(before), doorIssues(after), n, false);
  if (before.project.stairs.length > 0) row('Stairs blocked', stairIssues(before), stairIssues(after), n, false);
  row('Floor you can walk to', before.metrics.circulation.reachableFloor, after.metrics.circulation.reachableFloor, (v) => `${Math.round(v * 100)}%`, true);
  row('Extra walking (vs. an empty room)', before.metrics.circulation.detour - 1, after.metrics.circulation.detour - 1, pct, false);
  if (pairsTotal > 0) row('Pieces placed with what they go with', met(before), met(after), (v) => `${v} of ${pairsTotal}`, true);
  if (after.metrics.frontSpace.length > 0) row('Pieces with room in front', roomy(before), roomy(after), (v) => `${v} of ${after.metrics.frontSpace.length}`, true);
  row('Functional score', before.scores.functional, after.scores.functional, (v) => Math.round(v).toString(), true);
  row('Appearance score (subjective)', before.scores.aesthetic, after.scores.aesthetic, (v) => Math.round(v).toString(), true);
  if (before.scores.fengShui !== null && after.scores.fengShui !== null) row('Feng Shui (interpretive preference)', before.scores.fengShui, after.scores.fengShui, (v) => Math.round(v).toString(), true);
  return rows;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
