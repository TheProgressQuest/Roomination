import * as clip from 'polygon-clipping';
import { boundingBox, polygonArea, type Polygon } from '../model/polygon';
import { flattenShape, normaliseShape, shapeProblem } from '../model/shape';
import type { BuilderNode, FurnitureShape, Point, PrimitiveKind, ShapeVertex } from '../model/types';

/**
 * The Shape Builder's geometry: turns a recipe (basic shapes combined by merge, subtract,
 * intersect and group) into a furniture outline with holes and separate parts.
 *
 * Shapes that no operation touches keep their exact curves (a lone circle stays four true
 * curves). Combined shapes are worked out on outlines flattened to within 0.5 cm, by
 * polygon-clipping. Coordinates are local cm; +y is the piece's front.
 */

export type ShapeNode = Extract<BuilderNode, { type: 'shape' }>;
export type Operation = Exclude<BuilderNode['type'], 'shape'>;

export const PRIMITIVE_LABELS: Record<Exclude<PrimitiveKind, 'outline'>, string> = {
  rectangle: 'Rectangle',
  square: 'Square',
  circle: 'Circle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  polygon: 'Polygon',
  arc: 'Curved section',
};

export const OPERATION_LABELS: Record<Operation, string> = {
  union: 'Merged',
  subtract: 'Cut out',
  intersect: 'Overlap',
  group: 'Group',
};

/** Pieces of a shape smaller than this (cm²) are slivers left by the arithmetic, and dropped. */
const SLIVER = 1;
const KAPPA = 0.5523;

// ---------------------------------------------------------------------------
// Basic shapes
// ---------------------------------------------------------------------------

/** A new basic shape of a sensible size, centred at `at`. */
export function createPrimitive(kind: Exclude<PrimitiveKind, 'outline'>, id: string, at: Point = { x: 0, y: 0 }): ShapeNode {
  const base = { id, type: 'shape' as const, kind, x: at.x, y: at.y, rotation: 0 };
  switch (kind) {
    case 'rectangle':
      return { ...base, width: 100, depth: 60 };
    case 'square':
      return { ...base, width: 60, depth: 60 };
    case 'circle':
      return { ...base, width: 60, depth: 60 };
    case 'ellipse':
      return { ...base, width: 100, depth: 60 };
    case 'triangle':
      return { ...base, width: 80, depth: 70 };
    case 'polygon':
      return { ...base, width: 60, depth: 60, sides: 6 };
    case 'arc':
      return { ...base, width: 240, depth: 90, sweep: 120 };
  }
}

/** Circles and squares keep equal sides. */
export const isFixedRatio = (kind: PrimitiveKind) => kind === 'circle' || kind === 'square';

/** Arc points measured from the back (−y): θ = 0 is straight back, positive turns towards +x. */
const onArc = (r: number, t: number): Point => ({ x: r * Math.sin(t), y: -r * Math.cos(t) });

/** Cubic curves along a circle of radius r from angle a to b (radians), one per ≤ 90°. */
function arcVertices(r: number, a: number, b: number): ShapeVertex[] {
  const steps = Math.max(1, Math.ceil(Math.abs(b - a) / (Math.PI / 2) - 1e-9));
  const out: ShapeVertex[] = [];
  for (let i = 0; i < steps; i++) {
    const t0 = a + ((b - a) * i) / steps;
    const t1 = a + ((b - a) * (i + 1)) / steps;
    const k = (4 / 3) * Math.tan((t1 - t0) / 4) * r;
    const p0 = onArc(r, t0);
    const p1 = onArc(r, t1);
    // The tangent of onArc is (cos t, sin t).
    out.push({ ...p0, c1: { x: p0.x + k * Math.cos(t0), y: p0.y + k * Math.sin(t0) }, c2: { x: p1.x - k * Math.cos(t1), y: p1.y - k * Math.sin(t1) } });
  }
  return out;
}

function ellipse(rx: number, ry: number): ShapeVertex[] {
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  return [
    { x: 0, y: -ry, c1: { x: kx, y: -ry }, c2: { x: rx, y: -ky } },
    { x: rx, y: 0, c1: { x: rx, y: ky }, c2: { x: kx, y: ry } },
    { x: 0, y: ry, c1: { x: -kx, y: ry }, c2: { x: -rx, y: ky } },
    { x: -rx, y: 0, c1: { x: -rx, y: -ky }, c2: { x: -kx, y: -ry } },
  ];
}

/** A basic shape's outline (and any hole) before it's turned and placed, centred on its box. */
function primitiveOutline(node: ShapeNode): { points: ShapeVertex[]; holes?: ShapeVertex[][] } {
  const w = node.width;
  const d = isFixedRatio(node.kind) ? node.width : node.depth;
  switch (node.kind) {
    case 'rectangle':
    case 'square':
      return { points: [{ x: -w / 2, y: -d / 2 }, { x: w / 2, y: -d / 2 }, { x: w / 2, y: d / 2 }, { x: -w / 2, y: d / 2 }] };
    case 'circle':
    case 'ellipse':
      return { points: ellipse(w / 2, d / 2) };
    case 'triangle':
      return { points: [{ x: 0, y: -d / 2 }, { x: w / 2, y: d / 2 }, { x: -w / 2, y: d / 2 }] };
    case 'polygon': {
      const n = Math.max(3, Math.min(64, Math.round(node.sides ?? 6)));
      const points = Array.from({ length: n }, (_, i) => {
        const t = (2 * Math.PI * i) / n - Math.PI / 2;
        return { x: (w / 2) * Math.cos(t), y: (d / 2) * Math.sin(t) };
      });
      return centred({ points });
    }
    case 'arc':
      return centred(arcOutline(w / 2, Math.min(node.depth, w / 2), Math.min(360, Math.max(1, node.sweep ?? 180))));
    case 'outline': {
      const pts = node.points ?? [];
      const box = boundingBox(flattenShape({ points: pts }));
      const sx = w / Math.max(box.maxX - box.minX, 1e-9);
      const sy = d / Math.max(box.maxY - box.minY, 1e-9);
      const cx = (box.minX + box.maxX) / 2;
      const cy = (box.minY + box.maxY) / 2;
      const map = (p: Point) => ({ x: (p.x - cx) * sx, y: (p.y - cy) * sy });
      return { points: pts.map((v) => ({ ...map(v), ...(v.c1 && v.c2 ? { c1: map(v.c1), c2: map(v.c2) } : {}) })) };
    }
  }
}

/** A curved band (outer radius r, `band` thick) sweeping `sweep`° around the back; opens to the front. */
function arcOutline(r: number, band: number, sweep: number): { points: ShapeVertex[]; holes?: ShapeVertex[][] } {
  const inner = r - band;
  if (sweep >= 360) return inner > 0.5 ? { points: ellipse(r, r), holes: [ellipse(inner, inner)] } : { points: ellipse(r, r) };
  const half = (sweep * Math.PI) / 360;
  // Each curve runs to the next corner, so the arc's far end is a corner of its own; the ends
  // of the band are straight.
  const outer = [...arcVertices(r, -half, half), onArc(r, half)];
  if (inner <= 0.5) return { points: [...outer, { x: 0, y: 0 }] };
  return { points: [...outer, ...arcVertices(inner, half, -half), onArc(inner, -half)] };
}

/** Moves an outline so the centre of its box is at (0, 0). */
function centred(shape: { points: ShapeVertex[]; holes?: ShapeVertex[][] }) {
  const box = boundingBox(flattenShape({ points: shape.points }));
  const c = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  const move = (p: Point) => ({ x: p.x - c.x, y: p.y - c.y });
  const map = (pts: ShapeVertex[]) => pts.map((v) => ({ ...move(v), ...(v.c1 && v.c2 ? { c1: move(v.c1), c2: move(v.c2) } : {}) }));
  return { points: map(shape.points), ...(shape.holes ? { holes: shape.holes.map(map) } : {}) };
}

/** A basic shape's exact outline in the recipe's frame: turned and placed. */
export function shapeOutline(node: ShapeNode): { points: ShapeVertex[]; holes?: ShapeVertex[][] } {
  const local = primitiveOutline(node);
  const r = (node.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const place = (p: Point) => ({ x: node.x + p.x * cos - p.y * sin, y: node.y + p.x * sin + p.y * cos });
  const map = (pts: ShapeVertex[]) => pts.map((v) => ({ ...place(v), ...(v.c1 && v.c2 ? { c1: place(v.c1), c2: place(v.c2) } : {}) }));
  return { points: map(local.points), ...(local.holes ? { holes: local.holes.map(map) } : {}) };
}

// ---------------------------------------------------------------------------
// Combining
// ---------------------------------------------------------------------------

type Geo = clip.MultiPolygon;

/** One solid part of the result: its area as polygons, and its exact outline when untouched. */
interface Solid {
  geo: Geo;
  exact?: { points: ShapeVertex[]; holes?: ShapeVertex[][] };
}

const toRing = (poly: Polygon): clip.Ring => poly.map((p) => [p.x, p.y] as clip.Pair);
const fromRing = (ring: clip.Ring): Polygon => {
  const pts = ring.map(([x, y]) => ({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }));
  const [first, last] = [pts[0], pts.at(-1)];
  return first && last && first.x === last.x && first.y === last.y ? pts.slice(0, -1) : pts;
};

function geoArea(geo: Geo): number {
  return geo.reduce((sum, poly) => sum + polygonArea(fromRing(poly[0])) - poly.slice(1).reduce((s, h) => s + polygonArea(fromRing(h)), 0), 0);
}

function shapeGeo(exact: { points: ShapeVertex[]; holes?: ShapeVertex[][] }): Geo {
  return [[toRing(flattenShape({ points: exact.points })), ...(exact.holes ?? []).map((h) => toRing(flattenShape({ points: h })))]];
}

/** All the geometry of a node, as one area. */
function nodeGeo(node: BuilderNode): Geo {
  return mergeGeo(solidsOf(node).map((s) => s.geo));
}

function mergeGeo(geos: Geo[]): Geo {
  const nonEmpty = geos.filter((g) => g.length > 0);
  if (nonEmpty.length === 0) return [];
  if (nonEmpty.length === 1) return nonEmpty[0];
  return clip.union(nonEmpty[0], ...nonEmpty.slice(1));
}

function solidsOf(node: BuilderNode): Solid[] {
  if (node.type === 'shape') {
    const exact = shapeOutline(node);
    return [{ geo: shapeGeo(exact), exact }];
  }
  const children = node.children;
  if (children.length === 0) return [];
  switch (node.type) {
    case 'group':
      return separateSolids(children.flatMap(solidsOf));
    case 'union':
      return children.length === 1 ? solidsOf(children[0]) : [{ geo: mergeGeo(children.map(nodeGeo)) }];
    case 'subtract': {
      const [base, ...cuts] = children.map(nodeGeo);
      return [{ geo: cuts.length && base.length ? clip.difference(base, ...cuts.filter((c) => c.length > 0)) : base }];
    }
    case 'intersect': {
      const geos = children.map(nodeGeo);
      return [{ geo: geos.some((g) => g.length === 0) ? [] : geos.length === 1 ? geos[0] : clip.intersection(geos[0], ...geos.slice(1)) }];
    }
  }
}

/**
 * Grouped parts stay separate where they don't touch. Parts that overlap can't be separate
 * pieces of one footprint, so the overlapping ones are joined (the recipe still keeps them
 * as separate shapes to edit).
 */
function separateSolids(solids: Solid[]): Solid[] {
  const clusters: Solid[][] = [];
  for (const solid of solids) {
    const touching = clusters.filter((c) => c.some((other) => overlaps(other.geo, solid.geo)));
    const merged = [solid, ...touching.flat()];
    for (const t of touching) clusters.splice(clusters.indexOf(t), 1);
    clusters.push(merged);
  }
  return clusters.map((c) => (c.length === 1 ? c[0] : { geo: mergeGeo(c.map((s) => s.geo)) }));
}

function overlaps(a: Geo, b: Geo): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const ba = geoBox(a);
  const bb = geoBox(b);
  if (ba.maxX < bb.minX || bb.maxX < ba.minX || ba.maxY < bb.minY || bb.maxY < ba.minY) return false;
  return geoArea(clip.intersection(a, b)) > SLIVER;
}

function geoBox(geo: Geo) {
  return boundingBox(geo.flatMap((poly) => fromRing(poly[0])));
}

export interface BuildResult {
  /** The finished outline (centred), with the recipe attached; null if there's nothing usable. */
  shape: FurnitureShape | null;
  width: number;
  depth: number;
  /** A plain reason when the result can't be used. */
  problem: string | null;
}

/**
 * A recipe's outline where the shapes are (not yet centred), or the reason it can't be used.
 * The builder draws this; `buildShape` centres it for saving.
 */
export function evaluateRecipe(nodes: BuilderNode[]): { shape: FurnitureShape | null; problem: string | null } {
  if (nodes.length === 0) return { shape: null, problem: 'Add a shape to start.' };
  const solids = separateSolids(nodes.flatMap(solidsOf));
  const pieces: { points: ShapeVertex[]; holes?: ShapeVertex[][]; area: number }[] = [];
  for (const solid of solids) {
    if (solid.exact) {
      pieces.push({ ...solid.exact, area: geoArea(solid.geo) });
      continue;
    }
    for (const poly of solid.geo) {
      const outer = fromRing(poly[0]);
      const holes = poly.slice(1).map(fromRing).filter((h) => h.length >= 3 && polygonArea(h) > SLIVER);
      const area = polygonArea(outer) - holes.reduce((s, h) => s + polygonArea(h), 0);
      if (outer.length >= 3 && area > SLIVER) pieces.push({ points: outer, ...(holes.length ? { holes } : {}), area });
    }
  }
  if (pieces.length === 0) return { shape: null, problem: 'Nothing is left: the cut or overlap removes the whole shape.' };
  pieces.sort((a, b) => b.area - a.area);
  const [main, ...rest] = pieces;
  const shape: FurnitureShape = {
    points: main.points,
    ...(main.holes ? { holes: main.holes } : {}),
    ...(rest.length ? { islands: rest.map((p) => ({ points: p.points, ...(p.holes ? { holes: p.holes } : {}) })) } : {}),
    source: nodes,
  };
  const problem = shapeProblem(shape);
  return problem ? { shape: null, problem } : { shape, problem: null };
}

/** Works out a recipe's furniture shape, centred, with the recipe kept for re-editing. */
export function buildShape(nodes: BuilderNode[]): BuildResult {
  const { shape, problem } = evaluateRecipe(nodes);
  if (!shape) return { shape: null, width: 0, depth: 0, problem };
  const normal = normaliseShape(shape);
  return { shape: normal.shape, width: normal.width, depth: normal.depth, problem: null };
}

/** A recipe for a shape that was drawn without the builder (its outline, holes cut out, parts grouped). */
export function recipeFor(shape: FurnitureShape, newId: () => string): BuilderNode[] {
  if (shape.source?.length) return shape.source;
  const outlineNode = (points: ShapeVertex[]): ShapeNode => {
    const box = boundingBox(flattenShape({ points }));
    const c = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    const move = (p: Point) => ({ x: p.x - c.x, y: p.y - c.y });
    const width = Math.max(box.maxX - box.minX, 0.01);
    const depth = Math.max(box.maxY - box.minY, 0.01);
    // A plain rectangle becomes a rectangle you can resize, not a drawn outline.
    const onBox = (p: Point) => (Math.abs(p.x - box.minX) < 0.01 || Math.abs(p.x - box.maxX) < 0.01) && (Math.abs(p.y - box.minY) < 0.01 || Math.abs(p.y - box.maxY) < 0.01);
    if (points.length === 4 && points.every((v) => !v.c1 && onBox(v))) return { id: newId(), type: 'shape', kind: 'rectangle', x: c.x, y: c.y, rotation: 0, width, depth };
    return {
      id: newId(),
      type: 'shape',
      kind: 'outline',
      x: c.x,
      y: c.y,
      rotation: 0,
      width,
      depth,
      points: points.map((v) => ({ ...move(v), ...(v.c1 && v.c2 ? { c1: move(v.c1), c2: move(v.c2) } : {}) })),
    };
  };
  const part = (points: ShapeVertex[], holes?: ShapeVertex[][]): BuilderNode =>
    holes?.length ? { id: newId(), type: 'subtract', children: [outlineNode(points), ...holes.map(outlineNode)] } : outlineNode(points);
  return [part(shape.points, shape.holes), ...(shape.islands ?? []).map((i) => part(i.points, i.holes))];
}

// ---------------------------------------------------------------------------
// Editing the recipe
// ---------------------------------------------------------------------------

/** Every basic shape inside a node. */
export function leaves(node: BuilderNode): ShapeNode[] {
  return node.type === 'shape' ? [node] : node.children.flatMap(leaves);
}

/** The box around a node's shapes (exact curves included, as flattened). */
export function nodeBounds(node: BuilderNode) {
  return boundingBox(leaves(node).flatMap((leaf) => flattenShape({ points: shapeOutline(leaf).points })));
}

export function findNode(nodes: BuilderNode[], id: string): BuilderNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.type !== 'shape') {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** The list that directly contains a node (null if it's not there). */
export function parentList(nodes: BuilderNode[], id: string): BuilderNode[] | null {
  if (nodes.some((n) => n.id === id)) return nodes;
  for (const n of nodes) {
    if (n.type !== 'shape') {
      const found = parentList(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Replaces nodes by id (anywhere in the tree). */
export function mapNodes(nodes: BuilderNode[], change: (node: BuilderNode) => BuilderNode | null): BuilderNode[] {
  return nodes.flatMap((n) => {
    const next = change(n);
    if (next === null) return [];
    if (next !== n) return [next];
    return n.type === 'shape' ? [n] : [{ ...n, children: mapNodes(n.children, change) }];
  });
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function translateNode(node: BuilderNode, dx: number, dy: number): BuilderNode {
  if (node.type === 'shape') return { ...node, x: r2(node.x + dx), y: r2(node.y + dy) };
  return { ...node, children: node.children.map((c) => translateNode(c, dx, dy)) };
}

/** Turns a node by `degrees` about `about` (each shape turns and swings round). */
export function rotateNode(node: BuilderNode, degrees: number, about: Point): BuilderNode {
  if (node.type === 'shape') {
    const r = (degrees * Math.PI) / 180;
    const dx = node.x - about.x;
    const dy = node.y - about.y;
    return {
      ...node,
      x: r2(about.x + dx * Math.cos(r) - dy * Math.sin(r)),
      y: r2(about.y + dx * Math.sin(r) + dy * Math.cos(r)),
      rotation: r2((((node.rotation + degrees) % 360) + 360) % 360),
    };
  }
  return { ...node, children: node.children.map((c) => rotateNode(c, degrees, about)) };
}

/**
 * Stretches a node by sx × sy about `about`. Shapes square to the axes stretch exactly; a
 * shape turned at another angle can't be stretched unevenly and stay the same kind of
 * shape, so it's scaled evenly (by the average) instead.
 */
export function scaleNode(node: BuilderNode, sx: number, sy: number, about: Point): BuilderNode {
  if (node.type === 'shape') {
    const turn = ((node.rotation % 180) + 180) % 180;
    const square = Math.abs(turn) < 0.01 || Math.abs(turn - 180) < 0.01;
    const quarter = Math.abs(turn - 90) < 0.01;
    const even = Math.sqrt(Math.abs(sx * sy));
    const [fw, fd] = square ? [sx, sy] : quarter ? [sy, sx] : [even, even];
    const width = r2(Math.max(1, node.width * fw));
    return {
      ...node,
      x: r2(about.x + (node.x - about.x) * sx),
      y: r2(about.y + (node.y - about.y) * sy),
      width,
      depth: isFixedRatio(node.kind) ? width : r2(Math.max(1, node.depth * fd)),
    };
  }
  return { ...node, children: node.children.map((c) => scaleNode(c, sx, sy, about)) };
}

/**
 * Combines sibling nodes into one operation, in their list order (for a cut, the first is
 * kept and the rest are cut out of it). Returns null if they aren't siblings.
 */
export function combine(nodes: BuilderNode[], ids: string[], type: Operation, id: string): BuilderNode[] | null {
  if (ids.length < 2) return null;
  const list = parentList(nodes, ids[0]);
  if (!list || !ids.every((i) => list.some((n) => n.id === i))) return null;
  const chosen = list.filter((n) => ids.includes(n.id));
  const combined: BuilderNode = { id, type, children: chosen };
  const replace = (items: BuilderNode[]): BuilderNode[] => {
    if (items === list) {
      const at = items.findIndex((n) => ids.includes(n.id));
      const kept = items.filter((n) => !ids.includes(n.id));
      kept.splice(items.slice(0, at).filter((n) => !ids.includes(n.id)).length, 0, combined);
      return kept;
    }
    return items.map((n) => (n.type === 'shape' ? n : { ...n, children: replace(n.children) }));
  };
  return replace(nodes);
}

/** Undoes a group or merge: its parts take its place. Basic shapes can't be separated. */
export function separate(nodes: BuilderNode[], id: string): BuilderNode[] {
  return nodes.flatMap((n) => {
    if (n.id === id) return n.type === 'shape' ? [n] : n.children;
    return n.type === 'shape' ? [n] : [{ ...n, children: separate(n.children, id) }];
  });
}

/** Copies a node with fresh ids, nudged so the copy is visible. */
export function duplicateNode(node: BuilderNode, newId: () => string, offset = 10): BuilderNode {
  const copy = (n: BuilderNode): BuilderNode => (n.type === 'shape' ? { ...n, id: newId() } : { ...n, id: newId(), children: n.children.map(copy) });
  return translateNode(copy(node), offset, offset);
}

/** What a node is called in the list. */
export function nodeLabel(node: BuilderNode): string {
  if (node.type === 'shape') return node.kind === 'outline' ? 'Drawn outline' : node.kind === 'polygon' ? `${node.sides ?? 6}-sided polygon` : PRIMITIVE_LABELS[node.kind];
  return `${OPERATION_LABELS[node.type]} (${node.children.length})`;
}
