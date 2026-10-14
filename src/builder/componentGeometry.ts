import * as clip from 'polygon-clipping';
import { placeComponents, componentPoints } from '../model/components';
import { polygonArea, signedArea2 } from '../model/polygon';
import { flattenCubic } from '../model/shape';
import type { EdgeAttachment, Furniture, FurnitureComponent, Point } from '../model/types';

/**
 * Geometry for the Advanced Furniture Builder that needs polygon clipping (so it's loaded
 * only with the builder): bands that follow edges of the footprint (backrests and arms along
 * angled or curved sides), seats cut from the footprint, and curved panels.
 *
 * Results are stored on the components as outlines centred on their own box, so the plan and
 * the 3D view draw them without this module.
 */

type Item = Pick<Furniture, 'width' | 'depth' | 'shape'>;

/** One edge of the footprint as a polyline (curved edges flattened), from corner `index` to the next. */
export interface FootprintEdge {
  index: number;
  points: Point[];
  length: number;
}

/**
 * The footprint's edges, clockwise on screen (the inside is on the right of each edge).
 * A plain piece's edges are 0 back, 1 right, 2 front, 3 left.
 */
export function footprintEdges(item: Item): FootprintEdge[] {
  const corners = item.shape?.points ?? [
    { x: -item.width / 2, y: -item.depth / 2 },
    { x: item.width / 2, y: -item.depth / 2 },
    { x: item.width / 2, y: item.depth / 2 },
    { x: -item.width / 2, y: item.depth / 2 },
  ];
  const n = corners.length;
  const edges: FootprintEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % n];
    const points: Point[] = [{ x: a.x, y: a.y }];
    if (a.c1 && a.c2) points.push(...flattenCubic(a, a.c1, a.c2, b));
    else points.push({ x: b.x, y: b.y });
    let length = 0;
    for (let k = 1; k < points.length; k++) length += Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y);
    edges.push({ index: i, points, length });
  }
  return edges;
}

/** +1 when the footprint runs clockwise on screen (saved shapes always do), −1 otherwise. */
function windingOf(item: Item): number {
  const corners = item.shape?.points;
  return corners && signedArea2(corners.map((c) => ({ x: c.x, y: c.y }))) < 0 ? -1 : 1;
}

/** The footprint as one flattened ring (clockwise on screen). */
function footprintRing(item: Item): Point[] {
  const ring: Point[] = [];
  for (const e of footprintEdges(item)) ring.push(...e.points.slice(0, -1));
  return ring;
}

// ---------------------------------------------------------------------------
// Offsets (built directly; polygon-clipping only cuts a few simple shapes)
// ---------------------------------------------------------------------------

/** Coordinates snapped to 1/1000 cm: polygon-clipping is far more robust without float noise. */
const snap = (v: number, step = 1000) => Math.round(v * step) / step;
const toRing = (poly: Point[], step = 1000): clip.Ring => {
  const ring = poly.map((p) => [snap(p.x, step), snap(p.y, step)] as clip.Pair);
  ring.push(ring[0]);
  return ring;
};
const fromRing = (ring: clip.Ring): Point[] => ring.slice(0, -1).map(([x, y]) => ({ x, y }));

/**
 * Runs a clipping operation; polygon-clipping occasionally fails on nearly coincident
 * edges, so it's retried on a coarser grid (1/100 cm) before giving up with `fallback`.
 */
function safely<T>(op: (step: number) => T, fallback: T): T {
  for (const step of [1000, 100, 20]) {
    try {
      return op(step);
    } catch {
      // try a coarser grid
    }
  }
  return fallback;
}

/** The largest outer ring of a clipping result (holes dropped, near-straight corners removed), or null. */
function largest(result: clip.MultiPolygon): Point[] | null {
  let best: Point[] | null = null;
  let bestArea = 0.5;
  for (const poly of result) {
    const outer = fromRing(poly[0]);
    const area = polygonArea(outer);
    if (area > bestArea) {
      best = outer;
      bestArea = area;
    }
  }
  return best ? simplify(best, 0.05) : null;
}

/** Drops corners that sit within `tolerance` cm of the line through their neighbours. */
function simplify(ring: Point[], tolerance: number): Point[] {
  let points = ring;
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    for (let i = 0; i < points.length && points.length > 3; i++) {
      const a = points[(i - 1 + points.length) % points.length];
      const p = points[i];
      const b = points[(i + 1) % points.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const off = len > 1e-9 ? Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len : Math.hypot(p.x - a.x, p.y - a.y);
      if (off < tolerance) {
        points = points.filter((_, k) => k !== i);
        changed = true;
      }
    }
  }
  return points;
}

/** Unit normal pointing to the right of a→b (the inside of a clockwise outline); `sign` −1 flips it. */
function inward(a: Point, b: Point, sign = 1): Point {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (-(b.y - a.y) / len) * sign, y: ((b.x - a.x) / len) * sign };
}

/** Where the lines p1 + t·u1 and p2 + s·u2 meet, or null if they're parallel. */
function meet(p1: Point, u1: Point, p2: Point, u2: Point): Point | null {
  const den = u1.x * u2.y - u1.y * u2.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p2.x - p1.x) * u2.y - (p2.y - p1.y) * u2.x) / den;
  return { x: p1.x + u1.x * t, y: p1.y + u1.y * t };
}

/**
 * A polyline moved `d` cm to its right (inwards, for clockwise outlines), with mitred joins
 * (bevelled where a mitre would spike). `closed` treats it as a ring.
 */
function offsetLine(points: Point[], d: number, closed: boolean): Point[] {
  const pts = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 1e-6);
  if (closed && pts.length > 1 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-6) pts.pop();
  const n = pts.length;
  if (n < 2 || d === 0) return pts;
  const segs = closed ? n : n - 1;
  const lines = Array.from({ length: segs }, (_, i) => {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const nrm = inward(a, b);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { p: { x: a.x + nrm.x * d, y: a.y + nrm.y * d }, q: { x: b.x + nrm.x * d, y: b.y + nrm.y * d }, u: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
  });
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? lines[(i - 1 + segs) % segs] : i > 0 ? lines[i - 1] : null;
    const next = closed ? lines[i % segs] : i < segs ? lines[i] : null;
    if (!prev) {
      out.push(next!.p);
      continue;
    }
    if (!next) {
      out.push(prev.q);
      continue;
    }
    const m = meet(prev.p, prev.u, next.p, next.u);
    const corner = pts[i];
    if (m && Math.hypot(m.x - corner.x, m.y - corner.y) <= Math.abs(d) * 2.5) out.push(m);
    else out.push(prev.q, next.p); // bevel instead of a long spike
  }
  return out;
}

/** Tidies a ring that may cross itself (from a large offset) into its largest simple part. */
function tidy(ring: Point[]): Point[] | null {
  if (ring.length < 3) return null;
  return safely((step) => largest(clip.union([toRing(ring, step)])), ring);
}

/** A ring shrunk by `d`, kept inside the original; null if nothing is left. */
export function insetRing(ring: Point[], d: number): Point[] | null {
  if (d <= 0) return ring;
  const inner = tidy(offsetLine(ring, d, true));
  if (!inner) return null;
  return safely((step) => largest(clip.intersection([toRing(inner, step)], [toRing(ring, step)])), inner);
}

/** A ring grown by `d`. */
function outsetRing(ring: Point[], d: number): Point[] {
  if (d <= 0) return ring;
  return tidy(offsetLine(ring, -d, true)) ?? ring;
}

/** A local square on the side of the line through `at` (direction `dir`) that contains `away`. */
function wedge(at: Point, dir: Point, away: Point, size: number): Point[] {
  let n = { x: -dir.y, y: dir.x };
  if ((away.x - at.x) * n.x + (away.y - at.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  return [
    { x: at.x - dir.x * size, y: at.y - dir.y * size },
    { x: at.x + dir.x * size, y: at.y + dir.y * size },
    { x: at.x + dir.x * size + n.x * size, y: at.y + dir.y * size + n.y * size },
    { x: at.x - dir.x * size + n.x * size, y: at.y - dir.y * size + n.y * size },
  ];
}

// ---------------------------------------------------------------------------
// Bands along edges (backrests, arms)
// ---------------------------------------------------------------------------

/** The edges a run covers, from `from` to `to` (wrapping), clamped to the footprint. */
function runEdges(edges: FootprintEdge[], from: number, to: number): FootprintEdge[] {
  const n = edges.length;
  const start = ((from % n) + n) % n;
  const end = ((to % n) + n) % n;
  const run: FootprintEdge[] = [];
  for (let i = start; ; i = (i + 1) % n) {
    run.push(edges[i]);
    if (i === end || run.length >= n) break;
  }
  return run;
}

/**
 * A band `thickness` cm wide along footprint edges, inside the footprint, starting `inset`
 * from the edge. Mitred ends are cut along the bisector of the corner they end at, so two
 * bands meeting at a corner (an angled back in two sections) fit together exactly.
 */
export function edgeBand(item: Item, attach: EdgeAttachment): Point[] | null {
  const edges = footprintEdges(item);
  const thickness = attach.thickness;
  if (edges.length < 3 || !(thickness > 0)) return null;
  const sign = windingOf(item);
  const run = runEdges(edges, attach.from, attach.to);
  const all = edges.length;
  const closed = run.length >= all;
  let line: Point[] = [];
  for (const e of run) line.push(...(line.length ? e.points.slice(1) : e.points));
  if (sign < 0) line = [...line].reverse();
  line = trimPolyline(line, Math.max(0, attach.startTrim), Math.max(0, attach.endTrim));
  if (line.length < 2) return null;
  const unit = (a: Point, b: Point) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  };
  const lo = Math.max(0, attach.inset);
  const hi = lo + thickness;
  const first = unit(line[0], line[1]);
  const last = unit(line[line.length - 2], line[line.length - 1]);
  const mitreStart = !closed && attach.miterStart && attach.startTrim <= 0;
  const mitreEnd = !closed && attach.miterEnd && attach.endTrim <= 0;
  // A mitred end reaches past the corner first (then is cut back along the bisector), so
  // bands meeting at an inward-turning corner still close up.
  const reach = hi * 3 + 5;
  const ext = [...line];
  if (mitreStart) ext[0] = { x: line[0].x - first.x * reach, y: line[0].y - first.y * reach };
  if (mitreEnd) ext[ext.length - 1] = { x: line[line.length - 1].x + last.x * reach, y: line[line.length - 1].y + last.y * reach };
  const outer = offsetLine(ext, lo, false);
  const inner = offsetLine(ext, hi, false);
  const raw = tidy([...outer, ...inner.reverse()]);
  if (!raw) return null;
  const ring = footprintRing(item);
  let band: Point[] | null = safely((step) => largest(clip.intersection([toRing(raw, step)], [toRing(ring, step)])), null);
  if (!band) return null;
  if (!closed) {
    const before = edges[(run[0].index - 1 + all) % all];
    const after = edges[(run[run.length - 1].index + 1) % all];
    const prevDir = sign > 0 ? unit(before.points[before.points.length - 2], before.points[before.points.length - 1]) : unit(after.points[1], after.points[0]);
    const nextDir = sign > 0 ? unit(after.points[0], after.points[1]) : unit(before.points[before.points.length - 1], before.points[before.points.length - 2]);
    const cut = (at: Point, incoming: Point, outgoing: Point, mitre: boolean, atStart: boolean) => {
      const along = atStart ? outgoing : incoming;
      let dir = { x: -along.y, y: along.x };
      if (mitre) {
        const bis = { x: outgoing.x - incoming.x, y: outgoing.y - incoming.y };
        const len = Math.hypot(bis.x, bis.y);
        if (len > 1e-6) dir = { x: bis.x / len, y: bis.y / len };
      }
      const away = atStart ? { x: at.x - along.x, y: at.y - along.y } : { x: at.x + along.x, y: at.y + along.y };
      const w = wedge(at, dir, away, reach + hi);
      const current = band!;
      band = safely((step) => largest(clip.difference([toRing(current, step)], [toRing(w, step)])), current);
    };
    cut(line[0], prevDir, first, mitreStart, true);
    if (band) cut(line[line.length - 1], last, nextDir, mitreEnd, false);
  }
  return band;
}

/** A polyline shortened by `start` cm at its beginning and `end` cm at its end. */
function trimPolyline(line: Point[], start: number, end: number): Point[] {
  const total = line.reduce((sum, p, i) => (i ? sum + Math.hypot(p.x - line[i - 1].x, p.y - line[i - 1].y) : 0), 0);
  if (start + end >= total - 0.5) return [];
  const at = (dist: number): { point: Point; segment: number } => {
    let walked = 0;
    for (let i = 1; i < line.length; i++) {
      const len = Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
      if (walked + len >= dist) {
        const t = len > 0 ? (dist - walked) / len : 0;
        return { point: { x: line[i - 1].x + (line[i].x - line[i - 1].x) * t, y: line[i - 1].y + (line[i].y - line[i - 1].y) * t }, segment: i };
      }
      walked += len;
    }
    return { point: line[line.length - 1], segment: line.length - 1 };
  };
  const s = at(start);
  const e = at(total - end);
  return [s.point, ...line.slice(s.segment, e.segment), e.point];
}

// ---------------------------------------------------------------------------
// Seats cut from the footprint
// ---------------------------------------------------------------------------

/**
 * The footprint inset by `inset`, minus the plan outlines of the `cut` components (each grown
 * by the same gap), optionally split into strips across one edge's direction.
 */
export function footprintSeat(item: Item & Pick<Furniture, 'components'>, component: FurnitureComponent): Point[] | null {
  const ring = footprintRing(item);
  const gap = Math.max(0, component.inset ?? 0);
  let seat = insetRing(ring, gap);
  if (!seat) return null;
  const cutIds = new Set(component.cut ?? []);
  if (cutIds.size > 0) {
    const others = placeComponents(item.components ?? []).filter((p) => cutIds.has(p.component.id) && p.component.id !== component.id);
    for (const other of others) {
      const plan = planRing(other);
      if (!plan || !seat) continue;
      const grown = outsetRing(plan, gap);
      const current: Point[] = seat;
      seat = safely((step) => largest(clip.difference([toRing(current, step)], [toRing(grown, step)])), current);
    }
  }
  if (!seat) return null;
  const split = component.split;
  if (split && split.count > 1) {
    const edges = footprintEdges(item);
    const edge = edges[((split.along % edges.length) + edges.length) % edges.length];
    const a = edge.points[0];
    const b = edge.points[edge.points.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const ts = seat.map((p) => (p.x - a.x) * u.x + (p.y - a.y) * u.y);
    const lo = Math.min(...ts);
    const hi = Math.max(...ts);
    const step = (hi - lo) / split.count;
    const index = Math.min(split.count - 1, Math.max(0, split.index));
    const t0 = lo + step * index + (index > 0 ? split.gap / 2 : 0);
    const t1 = lo + step * (index + 1) - (index < split.count - 1 ? split.gap / 2 : 0);
    // A strip between two lines across u, as a polygon large enough to cover the seat.
    const n = { x: -u.y, y: u.x };
    const big = 1e4;
    const strip = [
      { x: a.x + u.x * t0 - n.x * big, y: a.y + u.y * t0 - n.y * big },
      { x: a.x + u.x * t1 - n.x * big, y: a.y + u.y * t1 - n.y * big },
      { x: a.x + u.x * t1 + n.x * big, y: a.y + u.y * t1 + n.y * big },
      { x: a.x + u.x * t0 + n.x * big, y: a.y + u.y * t0 + n.y * big },
    ];
    const current = seat;
    seat = safely((s) => largest(clip.intersection([toRing(current, s)], [toRing(strip, s)])), null);
  }
  return seat;
}

/** A placed component's outline in plan (its footprint seen from above), in the piece frame. */
export function planRing(p: ReturnType<typeof placeComponents>[number]): Point[] | null {
  const pts = componentPoints(p);
  // Bottom ring only (the top is the same outline, shifted by any tilt).
  const half = pts.slice(0, pts.length / 2);
  if (half.length < 3) return null;
  return signedArea2(half) >= 0 ? half : [...half].reverse();
}

// ---------------------------------------------------------------------------
// Curved panels
// ---------------------------------------------------------------------------

/**
 * A panel `width` cm across (its chord) and `depth` thick, bent through `sweep` degrees so it
 * bulges towards the back (−y), centred on its box.
 */
export function curvedOutline(width: number, depth: number, sweep: number): Point[] {
  const theta = (Math.min(300, Math.max(1, sweep)) * Math.PI) / 180;
  const r = width / (2 * Math.sin(theta / 2));
  const outer = r + depth / 2;
  const inner = Math.max(0.1, r - depth / 2);
  const steps = Math.max(8, Math.ceil(sweep / 6));
  const pts: Point[] = [];
  // Angles measured from straight back (−y), so the middle of the arc is at the back.
  for (let i = 0; i <= steps; i++) {
    const a = -theta / 2 + (theta * i) / steps;
    pts.push({ x: Math.sin(a) * outer, y: -Math.cos(a) * outer });
  }
  for (let i = steps; i >= 0; i--) {
    const a = -theta / 2 + (theta * i) / steps;
    pts.push({ x: Math.sin(a) * inner, y: -Math.cos(a) * inner });
  }
  return centred(pts).outline;
}

// ---------------------------------------------------------------------------
// Updating components
// ---------------------------------------------------------------------------

/** An outline moved so its box is centred on (0, 0), with that box's centre and size. */
export function centred(outline: Point[]): { outline: Point[]; centre: Point; width: number; depth: number } {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const clockwise = signedArea2(outline) >= 0 ? outline : [...outline].reverse();
  return { outline: clockwise.map((p) => ({ x: round(p.x - centre.x), y: round(p.y - centre.y) })), centre, width: round(maxX - minX), depth: round(maxY - minY) };
}

/**
 * Recomputes the outlines of every curved, edge and footprint component from the current
 * footprint and the other components. Edge and footprint components are in the piece's frame
 * (no parent, no turn). Components that can no longer be made (e.g. a band trimmed away)
 * keep their last outline and are reported.
 */
export function recomputeComponents(item: Item & Pick<Furniture, 'components'>): { components: FurnitureComponent[]; failed: string[] } {
  const failed: string[] = [];
  let list = [...(item.components ?? [])];
  const set = (c: FurnitureComponent, outline: Point[] | null) => {
    if (!outline || outline.length < 3) {
      failed.push(c.name);
      return c;
    }
    const box = centred(outline);
    const { parentId: _p, ...rest } = c;
    return { ...rest, x: round(box.centre.x), y: round(box.centre.y), rotation: 0, width: box.width, depth: box.depth, outline: box.outline };
  };
  // Curved panels and bands first; seats are cut from them.
  list = list.map((c) => {
    if (c.shape === 'curved') {
      const outline = curvedOutline(c.width, c.depth, c.sweep ?? 60);
      return { ...c, outline };
    }
    if (c.shape === 'edge' && c.edges) return set(c, edgeBand(item, c.edges));
    return c;
  });
  // Seats can be cut by bands (and by other seats earlier in the list).
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.shape !== 'footprint') continue;
    list[i] = set(c, footprintSeat({ ...item, components: list }, c));
  }
  return { components: list, failed };
}

const round = (v: number) => Math.round(v * 100) / 100;
