import earcut from 'earcut';
import { boundingBox, convexInsidePolygon, findSelfIntersection, overlapArea, pointInPolygon, polygonArea, segmentsIntersect, signedArea2, type Polygon } from './polygon';
import type { BuilderNode, Furniture, FurnitureShape, Point, ShapeVertex } from './types';

/**
 * Custom furniture outlines (see ADR-0004).
 *
 * A shape is stored as corners in the piece's local frame (cm, front at +y, origin at the
 * centre of its bounding box); an edge may be a cubic Bézier curve. Everything geometric —
 * collisions, fitting in the room, the optimizer, the 2D plan and the 3D view — uses the
 * same flattened outline, so what you see is exactly what collides.
 */

/** Largest distance (cm) between a drawn curve and the straight segments that stand in for it. */
export const CURVE_TOLERANCE = 0.5;
/** Smallest footprint allowed: 25 cm² (a 5 × 5 cm piece, the smallest rectangle allowed). */
export const MIN_SHAPE_AREA = 25;
export const MAX_SHAPE_POINTS = 2000;
export const MAX_SHAPE_SIZE = 2000;

export interface Footprint {
  /** The main flattened outline, clockwise on screen (for labels, bounds and simple uses). */
  outline: Polygon;
  /** Every solid part with its holes (for drawing and exact edges). */
  rings: Ring[];
  /** Convex pieces that exactly tile the outline (one piece for convex outlines). */
  parts: Polygon[];
}

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/**
 * Points along a cubic curve (excluding its start), spaced so no chord strays more than
 * `tolerance` from the curve. With M the largest second difference of the control points,
 * the chord error with n segments is at most 6·M / (8·n²).
 */
export function flattenCubic(p0: Point, p1: Point, p2: Point, p3: Point, tolerance = CURVE_TOLERANCE): Point[] {
  const dd = (a: Point, b: Point, c: Point) => Math.hypot(a.x - 2 * b.x + c.x, a.y - 2 * b.y + c.y);
  const m = Math.max(dd(p0, p1, p2), dd(p1, p2, p3));
  const n = Math.min(64, Math.max(1, Math.ceil(Math.sqrt((6 * m) / (8 * tolerance)))));
  const points: Point[] = [];
  for (let i = 1; i <= n; i++) points.push(cubicPoint(p0, p1, p2, p3, i / n));
  return points;
}

/** The outline with curves replaced by short straight segments (local coordinates). */
export function flattenShape(shape: FurnitureShape, tolerance = CURVE_TOLERANCE): Polygon {
  const out: Polygon = [];
  const { points } = shape;
  points.forEach((v, i) => {
    const next = points[(i + 1) % points.length];
    out.push({ x: v.x, y: v.y });
    if (v.c1 && v.c2) out.push(...flattenCubic(v, v.c1, v.c2, next, tolerance).slice(0, -1));
  });
  return out;
}

export const isCurved = (v: ShapeVertex) => v.c1 !== undefined && v.c2 !== undefined;

// ---------------------------------------------------------------------------
// Convex decomposition
// ---------------------------------------------------------------------------

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Ear-clipping triangulation of a simple polygon; returns index triples into `poly`. */
export function triangulate(poly: Polygon): [number, number, number][] {
  const n = poly.length;
  if (n < 3) return [];
  // Work clockwise-on-screen (positive signed area), so an "ear" turns the same way everywhere.
  const orientation = signedArea2(poly) >= 0 ? 1 : -1;
  const remaining = poly.map((_, i) => i);
  const triangles: [number, number, number][] = [];
  const isEar = (k: number) => {
    const m = remaining.length;
    const ia = remaining[(k + m - 1) % m];
    const ib = remaining[k];
    const ic = remaining[(k + 1) % m];
    const [a, b, c] = [poly[ia], poly[ib], poly[ic]];
    if (orientation * cross(a, b, c) <= 1e-12) return false; // reflex or flat corner
    for (const j of remaining) {
      if (j === ia || j === ib || j === ic) continue;
      const p = poly[j];
      if (orientation * cross(a, b, p) >= 0 && orientation * cross(b, c, p) >= 0 && orientation * cross(c, a, p) >= 0) return false;
    }
    return true;
  };
  let guard = 0;
  while (remaining.length > 3 && guard++ < n * n) {
    const m = remaining.length;
    let clipped = false;
    for (let k = 0; k < m; k++) {
      if (!isEar(k)) continue;
      triangles.push([remaining[(k + m - 1) % m], remaining[k], remaining[(k + 1) % m]]);
      remaining.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Only straight-through (collinear) corners left to remove; drop one and carry on.
      const flat = remaining.findIndex((_, k) => Math.abs(cross(poly[remaining[(k + m - 1) % m]], poly[remaining[k]], poly[remaining[(k + 1) % m]])) <= 1e-9);
      if (flat < 0) break;
      remaining.splice(flat, 1);
    }
  }
  if (remaining.length === 3) triangles.push([remaining[0], remaining[1], remaining[2]]);
  return triangles;
}

function isConvexRing(poly: Polygon): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const c = cross(poly[i], poly[(i + 1) % poly.length], poly[(i + 2) % poly.length]);
    if (Math.abs(c) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

/**
 * Splits a simple polygon into convex pieces: triangulate, then repeatedly merge
 * neighbouring pieces whose union stays convex (Hertel–Mehlhorn). Pieces never overlap and
 * together cover the polygon exactly.
 */
export function convexParts(poly: Polygon): Polygon[] {
  if (poly.length >= 3 && isConvexRing(poly)) return [poly];
  let pieces: number[][] = triangulate(poly).map((t) => [...t]);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const union = mergeShared(pieces[i], pieces[j]);
        if (union && isConvexRing(union.map((k) => poly[k]))) {
          pieces[i] = union;
          pieces = pieces.filter((_, k) => k !== j);
          merged = true;
          break outer;
        }
      }
    }
  }
  return pieces.map((piece) => piece.map((k) => poly[k]));
}

/** Joins two index rings that share an edge (in opposite directions), or null. */
function mergeShared(a: number[], b: number[]): number[] | null {
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = a[(i + 1) % a.length];
    const j = b.findIndex((v, k) => v === q && b[(k + 1) % b.length] === p);
    if (j < 0) continue;
    // a: …p q…, b: …q p…  →  a up to p, then b's ring from after p round to before q, then q onwards.
    const fromB: number[] = [];
    for (let k = (j + 2) % b.length; k !== j; k = (k + 1) % b.length) fromB.push(b[k]);
    const result: number[] = [];
    for (let k = 0; k < a.length; k++) {
      result.push(a[k]);
      if (k === i) result.push(...fromB);
    }
    return result;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Footprints
// ---------------------------------------------------------------------------

/** One solid part of a footprint: its outer outline (clockwise) and any holes in it. */
export interface Ring {
  outer: Polygon;
  holes: Polygon[];
}

const cache = new WeakMap<FurnitureShape, Footprint>();

function rectangle(width: number, depth: number): Polygon {
  return [
    { x: -width / 2, y: -depth / 2 },
    { x: width / 2, y: -depth / 2 },
    { x: width / 2, y: depth / 2 },
    { x: -width / 2, y: depth / 2 },
  ];
}

const clockwise = (poly: Polygon) => (signedArea2(poly) >= 0 ? poly : [...poly].reverse());

/** Every solid part of a shape (main outline, then islands), flattened, with its holes. */
export function shapeRings(shape: FurnitureShape, tolerance = CURVE_TOLERANCE): Ring[] {
  const ring = (points: ShapeVertex[], holes: ShapeVertex[][] = []): Ring => ({
    outer: clockwise(flattenShape({ points }, tolerance)),
    holes: holes.map((h) => clockwise(flattenShape({ points: h }, tolerance))),
  });
  return [ring(shape.points, shape.holes), ...(shape.islands ?? []).map((i) => ring(i.points, i.holes))];
}

/** Convex pieces that exactly tile a ring's solid area (holes left empty). */
function ringParts(ring: Ring): Polygon[] {
  if (ring.holes.length === 0) return convexParts(ring.outer);
  const all = [ring.outer, ...ring.holes].flat();
  const coords = all.flatMap((p) => [p.x, p.y]);
  const holeStarts: number[] = [];
  let n = ring.outer.length;
  for (const hole of ring.holes) {
    holeStarts.push(n);
    n += hole.length;
  }
  const indices = earcut(coords, holeStarts);
  let pieces: number[][] = [];
  for (let i = 0; i < indices.length; i += 3) {
    // earcut's winding varies; make each triangle clockwise on screen like everything else.
    const tri = [indices[i], indices[i + 1], indices[i + 2]];
    pieces.push(signedArea2(tri.map((k) => all[k])) >= 0 ? tri : [tri[0], tri[2], tri[1]]);
  }
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const union = mergeShared(pieces[i], pieces[j]);
        if (union && isConvexRing(union.map((k) => all[k]))) {
          pieces[i] = union;
          pieces = pieces.filter((_, k) => k !== j);
          merged = true;
          break outer;
        }
      }
    }
  }
  return pieces.map((piece) => piece.map((k) => all[k]));
}

/** A piece's footprint in its own frame: its drawn shape, or its width × depth rectangle. */
export function localFootprint(item: Pick<Furniture, 'width' | 'depth' | 'shape'>): Footprint {
  if (!item.shape) {
    const outline = rectangle(item.width, item.depth);
    return { outline, rings: [{ outer: outline, holes: [] }], parts: [outline] };
  }
  const hit = cache.get(item.shape);
  if (hit) return hit;
  const rings = shapeRings(item.shape);
  const footprint = { outline: rings[0].outer, rings, parts: rings.flatMap(ringParts) };
  cache.set(item.shape, footprint);
  return footprint;
}

/** Converts a local point of a piece at (x, y) turned `rotation` degrees into room cm. */
export function pieceToRoom(item: Pick<Furniture, 'x' | 'y' | 'rotation'>, p: Point): Point {
  const rad = (item.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: item.x + p.x * cos - p.y * sin, y: item.y + p.x * sin + p.y * cos };
}

/** The footprint placed in the room (rigid: rotated about the piece's origin, never distorted). */
export function roomFootprint(item: Pick<Furniture, 'x' | 'y' | 'rotation' | 'width' | 'depth' | 'shape'>): Footprint {
  const local = localFootprint(item);
  const place = (poly: Polygon) => poly.map((p) => pieceToRoom(item, p));
  return { outline: place(local.outline), rings: local.rings.map((r) => ({ outer: place(r.outer), holes: r.holes.map(place) })), parts: local.parts.map(place) };
}

/** Area shared by two footprints, in cm² (exact: the convex pieces don't overlap). */
export function footprintOverlap(a: Polygon[], b: Polygon[]): number {
  let sum = 0;
  for (const p of a) for (const q of b) sum += overlapArea(p, q);
  return sum;
}

/** Whether a footprint lies entirely inside a (possibly concave) room outline. */
export function footprintInside(parts: Polygon[], container: Polygon): boolean {
  return parts.every((part) => convexInsidePolygon(part, container));
}

/** Solid area of a footprint, in cm² (holes excluded). */
export function footprintArea(footprint: Footprint): number {
  return footprint.parts.reduce((sum, p) => sum + polygonArea(p), 0);
}

/** SVG path data for rings (draw with fill-rule="evenodd" so holes stay open). */
export function ringsSvgPath(rings: Ring[]): string {
  const loop = (poly: Polygon) => `M${poly.map((p) => `${p.x},${p.y}`).join('L')}Z`;
  return rings.flatMap((r) => [r.outer, ...r.holes]).map(loop).join('');
}

// ---------------------------------------------------------------------------
// Editing helpers
// ---------------------------------------------------------------------------

/** Every outline of a shape (main, holes, islands and theirs), unflattened. */
function allOutlines(shape: FurnitureShape): ShapeVertex[][] {
  return [shape.points, ...(shape.holes ?? []), ...(shape.islands ?? []).flatMap((i) => [i.points, ...(i.holes ?? [])])];
}

/** Why an outline can't be used, in plain words, or null if it's fine. */
export function shapeProblem(shape: FurnitureShape): string | null {
  const outlines = allOutlines(shape);
  if (outlines.some((o) => o.length < 3)) return 'A shape needs at least three corners.';
  const corners = outlines.reduce((n, o) => n + o.length, 0);
  if (corners > MAX_SHAPE_POINTS) return `A shape can have at most ${MAX_SHAPE_POINTS} corners in total.`;
  const all = outlines.flat().flatMap((p) => [p, p.c1, p.c2].filter((q): q is Point => q !== undefined));
  if (!all.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return 'A corner has an invalid position.';
  const rings = shapeRings(shape);
  const box = boundingBox(rings.flatMap((r) => r.outer));
  if (box.maxX - box.minX > MAX_SHAPE_SIZE || box.maxY - box.minY > MAX_SHAPE_SIZE) return 'This shape is unrealistically large (over 20 m).';
  for (const ring of rings) {
    if (findSelfIntersection(ring.outer)) return 'The outline crosses itself. Move a corner or curve so the edges don’t cross.';
    for (const hole of ring.holes) {
      if (findSelfIntersection(hole)) return 'A hole’s outline crosses itself.';
      if (!hole.every((p) => pointInPolygon(p, ring.outer)) || crosses(hole, ring.outer)) return 'A hole must lie inside its outline.';
    }
    for (let i = 0; i < ring.holes.length; i++) {
      for (let j = i + 1; j < ring.holes.length; j++) {
        const [a, b] = [ring.holes[i], ring.holes[j]];
        if (crosses(a, b) || pointInPolygon(a[0], b) || pointInPolygon(b[0], a)) return 'Two holes overlap: merge them into one.';
      }
    }
  }
  const parts = rings.map(ringParts);
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) if (footprintOverlap(parts[i], parts[j]) > 1) return 'Two separate parts overlap: merge them into one, or move them apart.';
  }
  const area = parts.flat().reduce((sum, p) => sum + polygonArea(p), 0);
  if (area < MIN_SHAPE_AREA) return 'This shape is too small or too thin (it must cover at least 25 cm²).';
  return null;
}

function crosses(a: Polygon, b: Polygon): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) if (segmentsIntersect(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  }
  return false;
}

/** Applies `move` to every corner and curve handle of an outline. */
function mapOutline(points: ShapeVertex[], move: (p: Point) => Point): ShapeVertex[] {
  return points.map((v) => ({ ...move(v), ...(v.c1 && v.c2 ? { c1: move(v.c1), c2: move(v.c2) } : {}) }));
}

/** Outer outlines run clockwise and holes the other way (so 2D/3D fill rules agree). */
function orient(points: ShapeVertex[], clockwiseWanted: boolean): ShapeVertex[] {
  const isClockwise = signedArea2(flattenShape({ points })) >= 0;
  return isClockwise === clockwiseWanted ? points : reverseShape(points);
}

/**
 * Re-centres a shape on its bounding box and orients its outlines. Returns the shape, its
 * width and depth (the bounding box), and how far its centre moved — so the piece can be
 * moved by the same amount and stay exactly where it was in the room.
 */
export function normaliseShape(shape: FurnitureShape): { shape: FurnitureShape; width: number; depth: number; shift: Point } {
  const oriented: FurnitureShape = {
    points: orient(shape.points, true),
    ...(shape.holes?.length ? { holes: shape.holes.map((h) => orient(h, false)) } : {}),
    ...(shape.islands?.length ? { islands: shape.islands.map((i) => ({ points: orient(i.points, true), ...(i.holes?.length ? { holes: i.holes.map((h) => orient(h, false)) } : {}) })) } : {}),
  };
  const box = boundingBox(shapeRings(oriented).flatMap((r) => r.outer));
  // Offsets below the 0.01 cm storage rounding are noise: ignoring them keeps this idempotent,
  // so saving and reloading never nudges a piece.
  const settle = (v: number) => (Math.abs(v) < 0.02 ? 0 : v);
  const shift = { x: settle((box.minX + box.maxX) / 2), y: settle((box.minY + box.maxY) / 2) };
  const move = (p: Point) => ({ x: round(p.x - shift.x), y: round(p.y - shift.y) });
  return {
    shape: {
      points: mapOutline(oriented.points, move),
      ...(oriented.holes ? { holes: oriented.holes.map((h) => mapOutline(h, move)) } : {}),
      ...(oriented.islands ? { islands: oriented.islands.map((i) => ({ points: mapOutline(i.points, move), ...(i.holes ? { holes: i.holes.map((h) => mapOutline(h, move)) } : {}) })) } : {}),
      ...(shape.source ? { source: shape.source.map((node) => shiftNode(node, shift)) } : {}),
    },
    width: round(box.maxX - box.minX),
    depth: round(box.maxY - box.minY),
    shift,
  };
}

/** Moves a Shape Builder recipe by −shift (shapes carry their own positions). */
function shiftNode(node: BuilderNode, shift: Point): BuilderNode {
  if (node.type === 'shape') return { ...node, x: round(node.x - shift.x), y: round(node.y - shift.y) };
  return { ...node, children: node.children.map((c) => shiftNode(c, shift)) };
}

/** Reverses an outline's direction, keeping each curve attached to the same edge. */
function reverseShape(points: ShapeVertex[]): ShapeVertex[] {
  const n = points.length;
  return points.map((_, k) => {
    // New corner k is old corner (n - k) % n; its outgoing edge is the old edge arriving there.
    const corner = points[(n - k) % n];
    const before = points[(n - k - 1 + n) % n];
    const curve = before.c1 && before.c2 ? { c1: before.c2, c2: before.c1 } : {};
    return { x: corner.x, y: corner.y, ...curve };
  });
}

/**
 * Stretches a shape (and its curves) to a new width and depth. A Shape Builder recipe can't
 * be stretched unevenly without changing what it describes, so it's dropped: the stretched
 * outline is kept, and can still be edited as an outline.
 */
export function scaleShape(shape: FurnitureShape, sx: number, sy: number): FurnitureShape {
  const scale = (p: Point) => ({ x: round(p.x * sx), y: round(p.y * sy) });
  return {
    points: mapOutline(shape.points, scale),
    ...(shape.holes ? { holes: shape.holes.map((h) => mapOutline(h, scale)) } : {}),
    ...(shape.islands ? { islands: shape.islands.map((i) => ({ points: mapOutline(i.points, scale), ...(i.holes ? { holes: i.holes.map((h) => mapOutline(h, scale)) } : {}) })) } : {}),
  };
}

/** Lengths kept to 0.01 cm, so stored numbers stay tidy without visible rounding. */
const round = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// Starting points
// ---------------------------------------------------------------------------

export type ShapeTemplate = 'rectangle' | 'lDesk' | 'cornerTable' | 'curvedSofa' | 'kidneyTable' | 'angledLoveseat';

export const SHAPE_TEMPLATE_LABELS: Record<ShapeTemplate, string> = {
  rectangle: 'Rectangle',
  lDesk: 'L-shaped desk',
  cornerTable: 'Corner table',
  curvedSofa: 'Curved sofa',
  kidneyTable: 'Kidney table',
  angledLoveseat: 'Angled loveseat',
};

/** Ready-made outlines to start from (then edited freely). Front is +y. */
export function shapeTemplate(template: ShapeTemplate): FurnitureShape {
  const pts = (list: number[][]): ShapeVertex[] => list.map(([x, y]) => ({ x, y }));
  switch (template) {
    case 'rectangle':
      return { points: pts([[-60, -40], [60, -40], [60, 40], [-60, 40]]) };
    case 'lDesk':
      return { points: pts([[-80, -70], [80, -70], [80, 70], [20, 70], [20, -10], [-80, -10]]) };
    case 'cornerTable':
      return { points: pts([[-40, -40], [40, -40], [-40, 40]]) };
    case 'angledLoveseat':
      return { points: pts([[-75, -45], [75, -45], [90, 45], [-90, 45]]) };
    case 'curvedSofa':
      // A gentle arc: the back curves outwards and the front curves in.
      return {
        points: [
          { x: -110, y: -20, c1: { x: -60, y: -60 }, c2: { x: 60, y: -60 } },
          { x: 110, y: -20 },
          { x: 100, y: 45, c1: { x: 50, y: 15 }, c2: { x: -50, y: 15 } },
          { x: -100, y: 45 },
        ],
      };
    case 'kidneyTable':
      // A bean: one smooth curve along the back, two rounded ends, and a gentle dip at the front.
      return {
        points: [
          { x: -60, y: 10, c1: { x: -60, y: -55 }, c2: { x: 60, y: -55 } },
          { x: 60, y: 10, c1: { x: 60, y: 50 }, c2: { x: 25, y: 22 } },
          { x: 0, y: 22, c1: { x: -25, y: 22 }, c2: { x: -60, y: 50 } },
        ],
      };
  }
}
