import { boundingBox, pointInPolygon, type Polygon } from '../model/polygon';
import type { Point } from '../model/types';

/**
 * Walking-space analysis on a grid.
 *
 * Empty floor isn't the same as usable floor: a room can be half empty and still have
 * its doors cut off by a sofa. So instead of measuring empty area, this models a person
 * of a chosen walkway width moving around the room:
 *
 *   1. The room is rasterised into square cells. Cells outside the outline, or under
 *      furniture, stairs and other solid obstacles, are "blocked".
 *   2. A distance transform gives every free cell its distance to the nearest blocked
 *      cell. A person fits where that distance is at least half the walkway width.
 *   3. A flood fill from the doors (and the foot of any stairs) finds everywhere a person
 *      can actually walk to, and which doors, stairs and furniture fronts are reachable.
 *
 * Distances use a two-pass 8-neighbour chamfer transform, so they're accurate to a few
 * percent — plenty for comparing layouts.
 */

export interface CirculationGrid {
  /** Cell size in cm. */
  cell: number;
  cols: number;
  rows: number;
  minX: number;
  minY: number;
  /** 1 = outside the room or under something fixed (walls, locked pieces, stairs, …). */
  fixed: Uint8Array;
  /** Number of cells inside the room. */
  insideCells: number;
}

/** Aim for about this many cells: fine enough for 75 cm walkways, cheap enough to run thousands of times. */
const TARGET_CELLS = 2600;

export function createGrid(room: Polygon, fixedObstacles: Polygon[]): CirculationGrid {
  const box = boundingBox(room);
  const area = (box.maxX - box.minX) * (box.maxY - box.minY);
  // Whole centimetres, at least 5, so cell edges sit on tidy coordinates.
  const cell = Math.max(5, Math.ceil(Math.sqrt(area / TARGET_CELLS)));
  const cols = Math.ceil((box.maxX - box.minX) / cell);
  const rows = Math.ceil((box.maxY - box.minY) / cell);
  const fixed = new Uint8Array(cols * rows);
  let insideCells = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const inside = pointInPolygon({ x: box.minX + (c + 0.5) * cell, y: box.minY + (r + 0.5) * cell }, room);
      if (inside) insideCells++;
      else fixed[r * cols + c] = 1;
    }
  }
  const grid = { cell, cols, rows, minX: box.minX, minY: box.minY, fixed, insideCells };
  for (const polygon of fixedObstacles) rasterize(grid, polygon, fixed);
  return grid;
}

/** Marks every cell whose centre lies inside `polygon`. */
export function rasterize(grid: CirculationGrid, polygon: Polygon, mask: Uint8Array) {
  const box = boundingBox(polygon);
  const c0 = Math.max(0, Math.floor((box.minX - grid.minX) / grid.cell));
  const c1 = Math.min(grid.cols - 1, Math.floor((box.maxX - grid.minX) / grid.cell));
  const r0 = Math.max(0, Math.floor((box.minY - grid.minY) / grid.cell));
  const r1 = Math.min(grid.rows - 1, Math.floor((box.maxY - grid.minY) / grid.cell));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (pointInPolygon({ x: grid.minX + (c + 0.5) * grid.cell, y: grid.minY + (r + 0.5) * grid.cell }, polygon)) mask[r * grid.cols + c] = 1;
    }
  }
}

/** Chamfer distance (cm) from every cell to the nearest set cell in `mask`. */
function distanceTransform(grid: CirculationGrid, mask: Uint8Array): Float32Array {
  const { cols, rows, cell } = grid;
  const diagonal = cell * Math.SQRT2;
  const d = new Float32Array(cols * rows);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (d[i] === 0) continue;
      let best = d[i];
      if (c > 0) best = Math.min(best, d[i - 1] + cell);
      if (r > 0) {
        best = Math.min(best, d[i - cols] + cell);
        if (c > 0) best = Math.min(best, d[i - cols - 1] + diagonal);
        if (c < cols - 1) best = Math.min(best, d[i - cols + 1] + diagonal);
      }
      d[i] = best;
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      if (d[i] === 0) continue;
      let best = d[i];
      if (c < cols - 1) best = Math.min(best, d[i + 1] + cell);
      if (r < rows - 1) {
        best = Math.min(best, d[i + cols] + cell);
        if (c < cols - 1) best = Math.min(best, d[i + cols + 1] + diagonal);
        if (c > 0) best = Math.min(best, d[i + cols - 1] + diagonal);
      }
      d[i] = best;
    }
  }
  return d;
}

export interface CirculationTargets {
  /** Just inside each doorway. The first is where walking starts. */
  doors: Point[];
  /** At the foot of each staircase. */
  stairs: Point[];
  /** Where a person stands to use each piece (keyed so results can be reported per piece). */
  uses: { id: string; points: Point[] }[];
}

export interface CirculationResult {
  /** Fraction (0–1) of doors and stair feet reachable from the first door. */
  connectivity: number;
  unreachableDoors: number;
  unreachableStairs: number;
  /** Fraction (0–1) of open floor a person can actually step onto. */
  reachableFloor: number;
  /** Open floor reachable only by squeezing through (below the walkway width but above 60% of it), 0–1. */
  narrowShare: number;
  /** Open floor that can't be reached at all, even squeezing (enclosed pockets), 0–1. */
  pocketShare: number;
  /** For each piece, which of its use points can be reached. */
  usable: Map<string, boolean[]>;
  /**
   * How much longer the walks from the main door to the other doors, the stairs and each
   * piece's use point are than they'd be with no movable furniture (1 = no detour). Walks
   * that become impossible count as twice as long.
   */
  detour: number;
}

const SQUEEZE = 0.6;

/**
 * @param furniture obstacles that move during optimization (added to the fixed ones)
 * @param walkway comfortable walking width in cm
 */
export function analyseCirculation(grid: CirculationGrid, furniture: Polygon[], targets: CirculationTargets, walkway: number, baselineWalk?: Float64Array): CirculationResult {
  const blocked = grid.fixed.slice();
  for (const polygon of furniture) rasterize(grid, polygon, blocked);
  const distance = distanceTransform(grid, blocked);

  let freeCells = 0;
  for (let i = 0; i < blocked.length; i++) if (!blocked[i]) freeCells++;

  const start = targets.doors[0] ?? widestFreePoint(grid, distance);
  const comfortable = flood(grid, distance, start, walkway / 2);
  const squeezing = flood(grid, distance, start, (walkway * SQUEEZE) / 2);

  // Floor a person can step onto: within half a walkway of somewhere they can stand.
  const steppable = coverage(grid, comfortable, walkway / 2, blocked);
  const steppableSqueezing = coverage(grid, squeezing, (walkway * SQUEEZE) / 2, blocked);

  const reachable = (p: Point, region: Uint8Array, reach: number) => nearRegion(grid, region, p, reach);
  const reach = walkway / 2 + grid.cell * 1.5;
  const otherDoors = targets.doors.slice(1);
  const unreachableDoors = otherDoors.filter((p) => !reachable(p, comfortable, reach)).length;
  const unreachableStairs = targets.stairs.filter((p) => !reachable(p, comfortable, reach)).length;
  const destinations = otherDoors.length + targets.stairs.length;

  // Using a piece only needs a squeeze-width path (you step in close), not a full walkway.
  const usable = new Map<string, boolean[]>();
  for (const use of targets.uses) {
    usable.set(use.id, use.points.map((p) => reachable(p, squeezing, (walkway * SQUEEZE) / 2 + grid.cell * 1.5)));
  }

  // Walking distances (squeeze width, since stepping round furniture is allowed) versus the
  // same walks with no movable furniture in the room.
  let detour = 1;
  if (baselineWalk) {
    const walk = walkingDistances(grid, distance, start, (walkway * SQUEEZE) / 2);
    const ends = [...otherDoors, ...targets.stairs, ...targets.uses.map((u) => u.points[0]).filter(Boolean)];
    const ratios: number[] = [];
    for (const p of ends) {
      const cell = cellAt(grid, p);
      if (cell < 0 || !Number.isFinite(baselineWalk[cell]) || baselineWalk[cell] < grid.cell * 3) continue;
      ratios.push(Number.isFinite(walk[cell]) ? walk[cell] / baselineWalk[cell] : 2);
    }
    if (ratios.length > 0) detour = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  }

  const share = (n: number) => (freeCells === 0 ? 0 : n / freeCells);
  return {
    detour,
    connectivity: destinations === 0 ? 1 : 1 - (unreachableDoors + unreachableStairs) / destinations,
    unreachableDoors,
    unreachableStairs,
    reachableFloor: share(steppable),
    narrowShare: share(Math.max(0, steppableSqueezing - steppable)),
    pocketShare: share(Math.max(0, freeCells - steppableSqueezing)),
    usable,
  };
}

/**
 * Walking distance (cm) from `start` to every cell, for a person needing `radius` cm of
 * clearance (Dijkstra over 8 neighbours). A walk may end at an obstacle's edge, so each
 * blocked cell next to a walkable one gets a distance too. Unreachable cells are Infinity.
 */
export function walkingDistances(grid: CirculationGrid, distance: Float32Array, start: Point, radius: number): Float64Array {
  const { cols, rows, cell } = grid;
  // Full precision: storing rounded (32-bit) distances while comparing exact ones would let the
  // same "improvement" be found over and over.
  const walk = new Float64Array(cols * rows).fill(Infinity);
  const origin = nearestStandable(grid, distance, start, radius);
  if (origin < 0) return walk;
  const heap = new MinHeap();
  walk[origin] = 0;
  heap.push(origin, 0);
  const diagonal = cell * Math.SQRT2;
  while (heap.size > 0) {
    const [i, d] = heap.pop();
    if (d > walk[i]) continue;
    const c = i % cols;
    const r = (i - c) / cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const n = nr * cols + nc;
        const step = dr && dc ? diagonal : cell;
        const nd = d + step;
        if (nd >= walk[n]) continue;
        walk[n] = nd;
        // Only open, wide-enough cells carry the walk further; edge cells are destinations.
        if (distance[n] >= radius) heap.push(n, nd);
      }
    }
  }
  return walk;
}

/** Baseline walking distances: the room with only its fixed obstacles (computed once per run). */
export function baselineWalk(grid: CirculationGrid, start: Point, walkway: number): Float64Array {
  const distance = distanceTransform(grid, grid.fixed);
  return walkingDistances(grid, distance, start, (walkway * SQUEEZE) / 2);
}

function cellAt(grid: CirculationGrid, p: Point): number {
  const c = Math.floor((p.x - grid.minX) / grid.cell);
  const r = Math.floor((p.y - grid.minY) / grid.cell);
  return c < 0 || r < 0 || c >= grid.cols || r >= grid.rows ? -1 : r * grid.cols + c;
}

/** A small binary heap of (cell, distance) pairs, smallest distance first. */
class MinHeap {
  private cells: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.cells.length;
  }
  push(cell: number, key: number) {
    this.cells.push(cell);
    this.keys.push(key);
    let i = this.cells.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.cells[0], this.keys[0]];
    const lastCell = this.cells.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.cells.length > 0) {
      this.cells[0] = lastCell;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.keys.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.cells[a], this.cells[b]] = [this.cells[b], this.cells[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

/** Cells a person (needing `radius` cm of clearance) can reach from `start`. */
function flood(grid: CirculationGrid, distance: Float32Array, start: Point, radius: number): Uint8Array {
  const { cols, rows } = grid;
  const region = new Uint8Array(cols * rows);
  const origin = nearestStandable(grid, distance, start, radius);
  if (origin < 0) return region;
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  queue[tail++] = origin;
  region[origin] = 1;
  while (head < tail) {
    const i = queue[head++];
    const c = i % cols;
    const r = (i - c) / cols;
    for (const [dc, dr] of NEIGHBOURS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const n = nr * cols + nc;
      if (!region[n] && distance[n] >= radius) {
        region[n] = 1;
        queue[tail++] = n;
      }
    }
  }
  return region;
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** The cell nearest `p` (within one walkway) where a person fits, or −1. */
function nearestStandable(grid: CirculationGrid, distance: Float32Array, p: Point, radius: number): number {
  const reachCells = Math.ceil((radius * 2) / grid.cell) + 1;
  const pc = Math.floor((p.x - grid.minX) / grid.cell);
  const pr = Math.floor((p.y - grid.minY) / grid.cell);
  let best = -1;
  let bestDistance = Infinity;
  for (let r = pr - reachCells; r <= pr + reachCells; r++) {
    for (let c = pc - reachCells; c <= pc + reachCells; c++) {
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
      const i = r * grid.cols + c;
      if (distance[i] < radius) continue;
      const d = (c - pc) ** 2 + (r - pr) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
  }
  return best;
}

/** Whether any cell of `region` lies within `reach` cm of point `p`. */
function nearRegion(grid: CirculationGrid, region: Uint8Array, p: Point, reach: number): boolean {
  const reachCells = Math.ceil(reach / grid.cell);
  const pc = Math.floor((p.x - grid.minX) / grid.cell);
  const pr = Math.floor((p.y - grid.minY) / grid.cell);
  for (let r = pr - reachCells; r <= pr + reachCells; r++) {
    for (let c = pc - reachCells; c <= pc + reachCells; c++) {
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
      if (!region[r * grid.cols + c]) continue;
      const dx = grid.minX + (c + 0.5) * grid.cell - p.x;
      const dy = grid.minY + (r + 0.5) * grid.cell - p.y;
      if (dx * dx + dy * dy <= reach * reach) return true;
    }
  }
  return false;
}

/** How many open cells lie within `radius` cm of the region (where a person can step). */
function coverage(grid: CirculationGrid, region: Uint8Array, radius: number, blocked: Uint8Array): number {
  const distance = distanceTransform(grid, region);
  let count = 0;
  for (let i = 0; i < blocked.length; i++) if (!blocked[i] && distance[i] <= radius + grid.cell * 0.75) count++;
  return count;
}

/** With no doors drawn, start from the most open spot in the room. */
function widestFreePoint(grid: CirculationGrid, distance: Float32Array): Point {
  let best = 0;
  for (let i = 1; i < distance.length; i++) if (distance[i] > distance[best]) best = i;
  const c = best % grid.cols;
  const r = (best - c) / grid.cols;
  return { x: grid.minX + (c + 0.5) * grid.cell, y: grid.minY + (r + 0.5) * grid.cell };
}
