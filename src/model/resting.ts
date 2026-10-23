import { placeComponents } from './components';
import type { Furniture, Point, Project } from './types';

/**
 * Things resting on other things (Decorate My Room): bottles on a worktop, books on a shelf,
 * a soap dispenser in a tray. A resting piece keeps `restsOn` (its support's id) and sits at a
 * surface's height; when the support moves, turns or rises, everything on it goes along.
 */

/** A flat top a piece offers: its name, height above the floor and outline on the plan (cm). */
export interface Surface {
  pieceId: string;
  /** e.g. "Worktop", "Shelf 2", "Top". */
  name: string;
  height: number;
  outline: Point[];
}

/** Component types whose top is something you'd set things on. */
const SURFACE_TYPES = new Set(['tabletop', 'shelf', 'base', 'seat', 'support', 'custom']);

const toRoom = (piece: Pick<Furniture, 'x' | 'y' | 'rotation'>, p: Point): Point => {
  const r = (piece.rotation * Math.PI) / 180;
  return { x: piece.x + p.x * Math.cos(r) - p.y * Math.sin(r), y: piece.y + p.x * Math.sin(r) + p.y * Math.cos(r) };
};

const rect = (cx: number, cy: number, w: number, d: number, turn = 0): Point[] => {
  const r = (turn * Math.PI) / 180;
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([x, y]) => ({ x: cx + x * Math.cos(r) - y * Math.sin(r), y: cy + x * Math.sin(r) + y * Math.cos(r) }));
};

/**
 * The surfaces a piece offers, highest first: the tops of its worktops, shelves and other
 * flat parts (component-built pieces), or simply its own top.
 */
export function surfacesOf(piece: Furniture): Surface[] {
  const base = piece.elevation ?? 0;
  const parts = piece.components?.length ? placeComponents(piece.components) : [];
  const flat = parts.filter((p) => SURFACE_TYPES.has(p.component.type) && p.component.shape !== 'ellipsoid' && p.component.width >= 4 && p.component.depth >= 4 && !p.component.hidden);
  if (flat.length === 0) return [{ pieceId: piece.id, name: 'Top', height: base + piece.height, outline: rect(0, 0, piece.width, piece.depth).map((p) => toRoom(piece, p)) }];
  const counts = new Map<string, number>();
  for (const p of flat) counts.set(p.component.name, (counts.get(p.component.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return flat
    .map((p) => {
      const n = (seen.get(p.component.name) ?? 0) + 1;
      seen.set(p.component.name, n);
      return {
        pieceId: piece.id,
        name: (counts.get(p.component.name) ?? 0) > 1 ? `${p.component.name} ${n}` : p.component.name,
        height: Math.round((base + p.z + p.component.height) * 10) / 10,
        outline: rect(p.x, p.y, p.component.width, p.component.depth, p.yaw ?? 0).map((q) => toRoom(piece, q)),
      };
    })
    .sort((a, b) => b.height - a.height);
}

/** The surface a new item should land on: a worktop or tabletop if there is one, else the highest. */
export function preferredSurface(piece: Furniture): Surface {
  const all = surfacesOf(piece);
  return all.find((s) => /worktop|top|counter/i.test(s.name)) ?? all[0];
}

export function surfaceCentre(s: Surface): Point {
  return { x: s.outline.reduce((t, p) => t + p.x, 0) / s.outline.length, y: s.outline.reduce((t, p) => t + p.y, 0) / s.outline.length };
}

/** The ids of everything resting on a piece, directly or on something resting on it. */
export function restingOn(furniture: Furniture[], id: string): string[] {
  const out: string[] = [];
  let frontier = [id];
  for (let depth = 0; depth < 8 && frontier.length; depth++) {
    frontier = furniture.filter((f) => f.restsOn && frontier.includes(f.restsOn)).map((f) => f.id);
    out.push(...frontier);
  }
  return out;
}

const posed = (a: Furniture, b: Furniture) => a.x !== b.x || a.y !== b.y || a.rotation !== b.rotation || (a.elevation ?? 0) !== (b.elevation ?? 0) || a.height !== b.height;

/**
 * After an edit: carries resting items along with their supports, and removes items whose
 * support was deleted (an undo brings them back). Items moved by the edit itself stay put.
 */
export function carryResting(before: Project, after: Project): { project: Project; removed: number } {
  const was = new Map(before.furniture.map((f) => [f.id, f]));
  let furniture = after.furniture;
  let removed = 0;
  for (let pass = 0; pass < 8; pass++) {
    const now = new Map(furniture.map((f) => [f.id, f]));
    let changed = false;
    const next: Furniture[] = [];
    for (const item of furniture) {
      if (!item.restsOn) {
        next.push(item);
        continue;
      }
      const parent = now.get(item.restsOn);
      if (!parent) {
        removed++;
        changed = true;
        continue;
      }
      const parentBefore = was.get(item.restsOn);
      const itemBefore = was.get(item.id);
      if (!parentBefore || !itemBefore || posed(itemBefore, item) || !posed(parentBefore, parent)) {
        next.push(item);
        continue;
      }
      // Turn and move with the support, and rise with its base (or its top, for things on top).
      const turn = parent.rotation - parentBefore.rotation;
      const r = (turn * Math.PI) / 180;
      const rel = { x: item.x - parentBefore.x, y: item.y - parentBefore.y };
      const topBefore = (parentBefore.elevation ?? 0) + parentBefore.height;
      const onTop = Math.abs((item.elevation ?? 0) - topBefore) < 0.5;
      const rise = onTop ? (parent.elevation ?? 0) + parent.height - topBefore : (parent.elevation ?? 0) - (parentBefore.elevation ?? 0);
      const round = (v: number) => Math.round(v * 10) / 10;
      next.push({
        ...item,
        x: round(parent.x + rel.x * Math.cos(r) - rel.y * Math.sin(r)),
        y: round(parent.y + rel.x * Math.sin(r) + rel.y * Math.cos(r)),
        rotation: round((((item.rotation + turn) % 360) + 360) % 360),
        elevation: Math.max(0, round((item.elevation ?? 0) + rise)),
      });
      changed = true;
    }
    furniture = next;
    // Items carried this pass have now moved, so the next pass carries what rests on them.
    if (!changed) break;
  }
  return { project: furniture === after.furniture ? after : { ...after, furniture }, removed };
}
