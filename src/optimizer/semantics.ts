import { isSolid } from '../model/conflicts';
import type { Furniture, FurnitureKind, Project, Relationship, RoomPurpose } from '../model/types';

/**
 * What furniture is for. Most people never draw "this chair goes with that desk", so the
 * optimizer would otherwise treat a chair as an unrelated box. These are the pairings almost
 * everyone expects; they're shown to the person as assumptions, can be switched off, and
 * never override a relationship the person set themselves.
 */

export interface AssumedRelationship extends Relationship {
  assumed: true;
  /** Why it's assumed, for the interface. */
  reason: string;
}

const dist = (a: Furniture, b: Furniture) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Pairings implied by the furniture in the room. Each piece is paired at most once per
 * role, with the nearest suitable partner (so two desks get a chair each).
 */
export function assumedRelationships(project: Project): AssumedRelationship[] {
  const solids = project.furniture.filter(isSolid);
  const of = (...kinds: FurnitureKind[]) => solids.filter((f) => kinds.includes(f.kind));
  const explicit = new Set(project.relationships.flatMap((r) => [`${r.a}|${r.b}`, `${r.b}|${r.a}`]));
  // A piece the person has already related to something keeps the person's pairing.
  const userPaired = new Set(project.relationships.flatMap((r) => [r.a, r.b]));
  const out: AssumedRelationship[] = [];
  const add = (type: Relationship['type'], a: Furniture, b: Furniture, reason: string) => {
    if (explicit.has(`${a.id}|${b.id}`)) return;
    out.push({ id: `assumed:${type}:${a.id}:${b.id}`, type, a: a.id, b: b.id, assumed: true, reason });
  };

  // Each desk gets the nearest free chair in front of it.
  const chairs = of('chair').filter((c) => !userPaired.has(c.id));
  for (const desk of of('desk')) {
    if (userPaired.has(desk.id)) continue;
    const chair = chairs.sort((a, b) => dist(a, desk) - dist(b, desk))[0];
    if (!chair) break;
    chairs.splice(chairs.indexOf(chair), 1);
    add('inFrontOf', desk, chair, 'A desk is used from a chair in front of it.');
  }

  // Seating faces the TV.
  const tv = of('television')[0];
  if (tv) for (const seat of of('sofa', 'armchair')) if (!userPaired.has(seat.id)) add('faces', seat, tv, 'Sofas and armchairs usually face the TV.');

  // The coffee table sits in front of the main sofa.
  const sofa = of('sofa').sort((a, b) => b.width * b.depth - a.width * a.depth)[0];
  if (sofa) for (const table of of('coffeeTable').slice(0, 1)) if (!userPaired.has(table.id)) add('inFrontOf', sofa, table, 'A coffee table usually sits in front of the sofa.');

  // Bedside tables beside the nearest bed.
  const beds = of('bed');
  for (const side of of('bedsideTable')) {
    if (userPaired.has(side.id) || beds.length === 0) continue;
    const bed = [...beds].sort((a, b) => dist(a, side) - dist(b, side))[0];
    add('beside', bed, side, 'Bedside tables go beside the bed.');
  }

  // The remaining chairs gather round a dining table.
  const table = of('diningTable')[0];
  if (table && !userPaired.has(table.id)) for (const chair of chairs) add('near', table, chair, 'Dining chairs gather round the dining table.');
  return out;
}

/** Every relationship the optimizer should consider: the person's own, plus assumed ones if enabled. */
export function allRelationships(project: Project, assume: boolean): Relationship[] {
  return assume ? [...project.relationships, ...assumedRelationships(project)] : project.relationships;
}

/** A sensible guess at what a room is for, from what's in it (the person can change it). */
export function guessPurpose(project: Project): RoomPurpose {
  const kinds = new Set(project.furniture.map((f) => f.kind));
  if (kinds.has('bed') && (kinds.has('desk') || kinds.has('sofa'))) return 'studio';
  if (kinds.has('bed')) return 'bedroom';
  if (kinds.has('desk') && !kinds.has('sofa')) return 'office';
  if (kinds.has('diningTable') && !kinds.has('sofa')) return 'dining';
  if (kinds.has('sofa') || kinds.has('television')) return 'living';
  return 'multipurpose';
}

export const PURPOSE_LABELS: Record<RoomPurpose, string> = {
  living: 'Living room',
  bedroom: 'Bedroom',
  office: 'Home office',
  studio: 'Studio',
  dining: 'Dining room',
  multipurpose: 'Multipurpose room',
};
