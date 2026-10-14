import { boundingBox, pointInPolygon, projectOntoSegment } from './polygon';
import { localFootprint } from './shape';
import type { ComponentType, Furniture, FurnitureComponent, Point } from './types';

/**
 * Component-built furniture (Advanced Furniture Builder): the lightweight half that the plan,
 * the 3D view and saving need. Positions are in the piece's local frame (cm, x across, y
 * towards the front, origin at the footprint's centre, z up from the floor); a component with
 * a parent is placed relative to the parent's centre, turn and bottom.
 *
 * Geometry that needs polygon clipping (bands along footprint edges, seats cut from the
 * footprint) is computed by the builder (builder/componentGeometry) and stored as `outline`,
 * so nothing here needs a geometry library.
 */

export const COMPONENT_TYPE_LABELS: Record<ComponentType, string> = {
  base: 'Base',
  seat: 'Seat',
  backrest: 'Backrest',
  armrest: 'Armrest',
  cushion: 'Cushion',
  pillow: 'Pillow',
  headrest: 'Headrest',
  leg: 'Leg',
  foot: 'Foot',
  tabletop: 'Tabletop',
  shelf: 'Shelf',
  drawer: 'Drawer',
  door: 'Cabinet door',
  support: 'Support',
  detail: 'Decorative detail',
  custom: 'Custom component',
  group: 'Group',
};

/** Most components a piece may have (keeps files and rendering bounded). */
export const MAX_COMPONENTS = 120;
/** Deepest nesting of parents allowed. */
export const MAX_COMPONENT_DEPTH = 6;

/** A component placed in the piece's frame, ready to draw. */
export interface PlacedComponent {
  component: FurnitureComponent;
  /** Centre in the piece's frame, cm. */
  x: number;
  y: number;
  /** Bottom above the floor, cm. */
  z: number;
  /** Total clockwise turn (its own plus its parents'), degrees. */
  yaw: number;
  /** 'outline' for shapes drawn from an outline (polygon, curved, edge, footprint). */
  outline: Point[] | null;
}

/** Shapes drawn from an outline rather than a box. */
export function usesOutline(c: Pick<FurnitureComponent, 'shape'>): boolean {
  return c.shape === 'polygon' || c.shape === 'curved' || c.shape === 'edge' || c.shape === 'footprint';
}

/**
 * Every visible component placed in the piece's frame, parents before children. Components
 * whose parent is missing (or that form a loop) are placed as if they had none.
 */
export function placeComponents(components: readonly FurnitureComponent[]): PlacedComponent[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const placed = new Map<string, PlacedComponent>();
  const place = (c: FurnitureComponent, depth: number): PlacedComponent => {
    const hit = placed.get(c.id);
    if (hit) return hit;
    const parent = c.parentId && c.parentId !== c.id && depth < MAX_COMPONENT_DEPTH ? byId.get(c.parentId) : undefined;
    let result: PlacedComponent;
    if (!parent) {
      result = { component: c, x: c.x, y: c.y, z: c.z, yaw: c.rotation, outline: usesOutline(c) ? (c.outline ?? null) : null };
    } else {
      const p = place(parent, depth + 1);
      const rad = (p.yaw * Math.PI) / 180;
      result = {
        component: c,
        x: p.x + c.x * Math.cos(rad) - c.y * Math.sin(rad),
        y: p.y + c.x * Math.sin(rad) + c.y * Math.cos(rad),
        z: p.z + c.z,
        yaw: p.yaw + c.rotation,
        outline: usesOutline(c) ? (c.outline ?? null) : null,
      };
    }
    placed.set(c.id, result);
    return result;
  };
  for (const c of components) place(c, 0);
  // Hidden components (and everything inside a hidden one) aren't drawn.
  const hidden = (c: FurnitureComponent, depth = 0): boolean => !!c.hidden || (!!c.parentId && depth < MAX_COMPONENT_DEPTH && !!byId.get(c.parentId) && hidden(byId.get(c.parentId)!, depth + 1));
  return components.filter((c) => c.type !== 'group' && !hidden(c)).map((c) => placed.get(c.id)!);
}

/**
 * The 3D corner points of a placed component in the piece's frame (outline or box corners at
 * its bottom and top, tilted and turned). Round shapes are approximated by 24 points.
 */
export function componentPoints(p: PlacedComponent): { x: number; y: number; z: number }[] {
  const c = p.component;
  let ring: Point[];
  if (p.outline && p.outline.length >= 3) ring = p.outline;
  else if (c.shape === 'cylinder' || c.shape === 'ellipsoid') {
    ring = Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      return { x: (Math.cos(a) * c.width) / 2, y: (Math.sin(a) * c.depth) / 2 };
    });
  } else {
    ring = [
      { x: -c.width / 2, y: -c.depth / 2 },
      { x: c.width / 2, y: -c.depth / 2 },
      { x: c.width / 2, y: c.depth / 2 },
      { x: -c.width / 2, y: c.depth / 2 },
    ];
  }
  const t = ((c.tilt ?? 0) * Math.PI) / 180;
  const yaw = (p.yaw * Math.PI) / 180;
  const points: { x: number; y: number; z: number }[] = [];
  for (const lz of [-c.height / 2, c.height / 2]) {
    for (const q of ring) {
      // Lean back: the top moves towards −y.
      const ly = q.y * Math.cos(t) - lz * Math.sin(t);
      const z = q.y * Math.sin(t) + lz * Math.cos(t);
      points.push({ x: p.x + q.x * Math.cos(yaw) - ly * Math.sin(yaw), y: p.y + q.x * Math.sin(yaw) + ly * Math.cos(yaw), z: p.z + c.height / 2 + z });
    }
  }
  return points;
}

export interface ComponentOverflow {
  id: string;
  name: string;
  /** How far it reaches outside the footprint in plan, cm (0 if it doesn't). */
  outside: number;
  /** How far below the floor it reaches, cm (0 if it doesn't). */
  below: number;
}

export interface ComponentExtent {
  /** Highest point of any component, cm. */
  top: number;
  /** Components that reach outside the footprint or below the floor (more than `tolerance`). */
  overflow: ComponentOverflow[];
  /** The components' plan bounding box (piece frame). */
  box: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

/**
 * How the components sit against the piece's footprint: their total height, and any that
 * stick out of the footprint (which collisions and the optimizer use) or below the floor.
 * Nothing is changed: the person decides whether to grow the footprint.
 */
export function componentExtent(item: Pick<Furniture, 'width' | 'depth' | 'shape' | 'components'>, tolerance = 0.5): ComponentExtent {
  const placed = placeComponents(item.components ?? []);
  if (placed.length === 0) return { top: 0, overflow: [], box: null };
  const { rings } = localFootprint(item);
  const inside = (q: Point) => rings.some((r) => pointInPolygon(q, r.outer) && !r.holes.some((h) => pointInPolygon(q, h)));
  const distanceOut = (q: Point) => {
    if (inside(q)) return 0;
    let best = Infinity;
    for (const r of rings) {
      for (const loop of [r.outer, ...r.holes]) {
        for (let i = 0; i < loop.length; i++) best = Math.min(best, projectOntoSegment(q, loop[i], loop[(i + 1) % loop.length]).distance);
      }
    }
    return best;
  };
  let top = 0;
  const overflow: ComponentOverflow[] = [];
  const all: Point[] = [];
  for (const p of placed) {
    const pts = componentPoints(p);
    let outside = 0;
    let lowest = Infinity;
    for (const q of pts) {
      top = Math.max(top, q.z);
      lowest = Math.min(lowest, q.z);
      outside = Math.max(outside, distanceOut(q));
      all.push(q);
    }
    const below = Math.max(0, -lowest);
    if (outside > tolerance || below > tolerance) overflow.push({ id: p.component.id, name: p.component.name, outside: round(outside), below: round(below) });
  }
  return { top: round(top), overflow, box: boundingBox(all) };
}

// ---------------------------------------------------------------------------
// Editing helpers (pure)
// ---------------------------------------------------------------------------

/** A short unique id for a new component. */
export function componentId(existing: readonly FurnitureComponent[]): string {
  const ids = new Set(existing.map((c) => c.id));
  for (let i = existing.length + 1; ; i++) {
    const id = `c${i}`;
    if (!ids.has(id)) return id;
  }
}

/** A component and everything nested inside it, in list order. */
export function withDescendants(components: readonly FurnitureComponent[], id: string): FurnitureComponent[] {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of components) {
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  return components.filter((c) => ids.has(c.id));
}

/** Removes a component and everything inside it; cut lists no longer mention them. */
export function removeComponent(components: readonly FurnitureComponent[], id: string): FurnitureComponent[] {
  const gone = new Set(withDescendants(components, id).map((c) => c.id));
  return components.filter((c) => !gone.has(c.id)).map((c) => (c.cut?.some((k) => gone.has(k)) ? { ...c, cut: c.cut.filter((k) => !gone.has(k)) } : c));
}

/** Copies a component (and its children) beside the original, with new ids. */
export function duplicateComponent(components: readonly FurnitureComponent[], id: string, offset: Point = { x: 10, y: 10 }): { components: FurnitureComponent[]; copyId: string | null } {
  const family = withDescendants(components, id);
  if (family.length === 0 || components.length + family.length > MAX_COMPONENTS) return { components: [...components], copyId: null };
  const list = [...components];
  const used = new Set(list.map((c) => c.id));
  let n = list.length + 1;
  const fresh = () => {
    while (used.has(`c${n}`)) n++;
    used.add(`c${n}`);
    return `c${n}`;
  };
  const ids = new Map(family.map((c) => [c.id, fresh()]));
  const copies = family.map((c) => {
    const copy: FurnitureComponent = { ...c, id: ids.get(c.id)!, name: c.id === id ? `${c.name} copy` : c.name, locked: false };
    if (c.parentId && ids.has(c.parentId)) copy.parentId = ids.get(c.parentId);
    if (c.id === id) {
      copy.x = round(c.x + offset.x);
      copy.y = round(c.y + offset.y);
      // A copied edge band or footprint cut is a fixed outline: it no longer follows the footprint.
      if (c.shape === 'edge' || c.shape === 'footprint') {
        copy.shape = 'polygon';
        delete copy.edges;
        delete copy.cut;
        delete copy.split;
      }
    }
    return copy;
  });
  const last = components.findIndex((c) => c.id === family[family.length - 1].id);
  list.splice(last + 1, 0, ...copies);
  return { components: list, copyId: ids.get(id)! };
}

/** Moves a component one place earlier (−1) or later (+1) in the list (drawing order). */
export function reorderComponent(components: readonly FurnitureComponent[], id: string, step: -1 | 1): FurnitureComponent[] {
  const i = components.findIndex((c) => c.id === id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= components.length) return [...components];
  const list = [...components];
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

/**
 * Puts components into a new group (keeping where they are). Components already inside one
 * of the others move with it, so only the top-most selected ones are re-parented.
 */
export function groupComponents(components: readonly FurnitureComponent[], ids: string[], name = 'Group'): { components: FurnitureComponent[]; groupId: string | null } {
  const chosen = components.filter((c) => ids.includes(c.id) && !c.parentId);
  if (chosen.length === 0 || components.length >= MAX_COMPONENTS) return { components: [...components], groupId: null };
  const id = componentId(components);
  const xs = chosen.map((c) => c.x);
  const ys = chosen.map((c) => c.y);
  const cx = round((Math.min(...xs) + Math.max(...xs)) / 2);
  const cy = round((Math.min(...ys) + Math.max(...ys)) / 2);
  const group: FurnitureComponent = { id, name, type: 'group', shape: 'box', x: cx, y: cy, z: 0, width: 1, depth: 1, height: 1, rotation: 0 };
  const chosenIds = new Set(chosen.map((c) => c.id));
  const first = components.findIndex((c) => chosenIds.has(c.id));
  const list = components.map((c) => (chosenIds.has(c.id) ? { ...c, parentId: id, x: round(c.x - cx), y: round(c.y - cy) } : c));
  list.splice(first, 0, group);
  return { components: list, groupId: id };
}

/** Takes a group's members out (keeping where they are) and removes the group. */
export function ungroupComponents(components: readonly FurnitureComponent[], groupId: string): FurnitureComponent[] {
  const group = components.find((c) => c.id === groupId && c.type === 'group');
  if (!group) return [...components];
  const rad = (group.rotation * Math.PI) / 180;
  return components
    .filter((c) => c.id !== groupId)
    .map((c) => {
      if (c.parentId !== groupId) return c;
      const out: FurnitureComponent = {
        ...c,
        x: round(group.x + c.x * Math.cos(rad) - c.y * Math.sin(rad)),
        y: round(group.y + c.x * Math.sin(rad) + c.y * Math.cos(rad)),
        z: round(group.z + c.z),
        rotation: normalizeAngle(group.rotation + c.rotation),
      };
      if (group.parentId) out.parentId = group.parentId;
      else delete out.parentId;
      return out;
    });
}

/** Moves top-level components (e.g. when the footprint is re-centred by −shift). */
export function shiftComponents(components: readonly FurnitureComponent[], dx: number, dy: number): FurnitureComponent[] {
  if (dx === 0 && dy === 0) return [...components];
  return components.map((c) => (c.parentId ? c : { ...c, x: round(c.x + dx), y: round(c.y + dy) }));
}

/**
 * Stretches every component with the piece (new width, depth or height typed elsewhere):
 * positions, sizes and outlines scale; turns are kept. Reopening the builder recomputes bands
 * and seats exactly from the new footprint.
 */
export function scaleComponents(components: readonly FurnitureComponent[], sx: number, sy: number, sz: number): FurnitureComponent[] {
  if (sx === 1 && sy === 1 && sz === 1) return [...components];
  return components.map((c) => {
    // A turned box stretched unevenly stays a box: scale its own sides by how its axes line up.
    const rad = (c.rotation * Math.PI) / 180;
    const ax = Math.hypot(sx * Math.cos(rad), sy * Math.sin(rad));
    const ay = Math.hypot(sx * Math.sin(rad), sy * Math.cos(rad));
    const out: FurnitureComponent = {
      ...c,
      x: round(c.x * sx),
      y: round(c.y * sy),
      z: round(c.z * sz),
      width: round(Math.max(0.5, c.width * ax)),
      depth: round(Math.max(0.5, c.depth * ay)),
      height: round(Math.max(0.5, c.height * sz)),
    };
    if (c.outline) {
      // Outlines are stored unturned: scale them in the component's own axes.
      out.outline = c.outline.map((q) => ({ x: round(q.x * ax), y: round(q.y * ay) }));
    }
    return out;
  });
}

const round = (v: number) => Math.round(v * 100) / 100;
const normalizeAngle = (deg: number) => round(((deg % 360) + 360) % 360);
