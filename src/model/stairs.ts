import { boundingBox, overlapArea, type Polygon } from './polygon';
import type { Point, Staircase, StairSection } from './types';

/**
 * Staircase geometry. A staircase is a chain of rectangular sections (flights and
 * landings). Each section starts where the previous one exits; a landing may turn the
 * direction of travel 90° left or right. All shapes are convex rectangles, so the
 * existing collision code handles stairs without new algorithms.
 *
 * Local coordinates are centred on the footprint's bounding box, so a staircase rotates
 * around its middle and its stored (x, y) is the centre of its footprint.
 */

export const DEFAULT_TREAD = 25;
export const DEFAULT_STAIR_WIDTH = 90;

export interface LaidOutSection {
  section: StairSection;
  index: number;
  /** Corners in the staircase's local, centred frame. */
  corners: Polygon;
  /** Where travel enters and leaves this section (local). */
  entry: Point;
  exit: Point;
  /** Unit vector of travel through this section. */
  heading: Point;
}

export interface StairLayout {
  sections: LaidOutSection[];
  /** Footprint size in cm. */
  width: number;
  depth: number;
  /** Walking line through all sections (local), for the direction arrow. */
  path: Point[];
}

const add = (a: Point, b: Point, k = 1): Point => ({ x: a.x + b.x * k, y: a.y + b.y * k });
/** Right-hand normal of a heading, in screen coordinates (y down). */
const rightOf = (h: Point): Point => ({ x: -h.y, y: h.x });

export function layoutStair(sections: StairSection[]): StairLayout {
  let entry: Point = { x: 0, y: 0 };
  let heading: Point = { x: 1, y: 0 };
  const raw: LaidOutSection[] = [];
  const path: Point[] = [entry];

  sections.forEach((section, index) => {
    const n = rightOf(heading);
    const half = section.width / 2;
    const end = add(entry, heading, section.length);
    const corners = [add(entry, n, -half), add(end, n, -half), add(end, n, half), add(entry, n, half)];
    let exit = end;
    let nextHeading = heading;
    if (section.kind === 'landing' && section.turn !== 'straight') {
      // Leave through the landing's side: right turns exit on the right-hand side.
      const side = section.turn === 'right' ? 1 : -1;
      const middle = add(entry, heading, section.length / 2);
      exit = add(middle, n, side * half);
      nextHeading = { x: n.x * side, y: n.y * side };
      path.push(middle);
    }
    path.push(exit);
    raw.push({ section, index, corners, entry, exit, heading });
    entry = exit;
    heading = nextHeading;
  });

  // Centre everything on the footprint's bounding box.
  const box = boundingBox(raw.flatMap((r) => r.corners));
  const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  const shift = (p: Point) => ({ x: p.x - centre.x, y: p.y - centre.y });
  return {
    sections: raw.map((r) => ({ ...r, corners: r.corners.map(shift), entry: shift(r.entry), exit: shift(r.exit) })),
    width: box.maxX - box.minX,
    depth: box.maxY - box.minY,
    path: path.map(shift),
  };
}

/** Converts a local point to room coordinates for a staircase at (x, y) with `rotation`. */
export function stairToRoom(stair: Pick<Staircase, 'x' | 'y' | 'rotation'>, p: Point): Point {
  const rad = (stair.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: stair.x + p.x * cos - p.y * sin, y: stair.y + p.x * sin + p.y * cos };
}

/** Each section's rectangle in room coordinates. */
export function stairPolygons(stair: Staircase): Polygon[] {
  return layoutStair(stair.sections).sections.map((s) => s.corners.map((p) => stairToRoom(stair, p)));
}

export function totalSteps(stair: Pick<Staircase, 'sections'>): number {
  return stair.sections.reduce((sum, s) => sum + (s.kind === 'flight' ? s.steps : 0), 0);
}

/** "Straight", "L-shaped", "U-shaped" or "Custom", from the arrangement of sections. */
export function describeStairShape(sections: StairSection[]): string {
  const turns = sections.filter((s) => s.kind === 'landing' && s.turn !== 'straight');
  const flights = sections.filter((s) => s.kind === 'flight').length;
  if (turns.length === 0 && flights === 1 && sections.length === 1) return 'Straight';
  if (turns.length === 1 && flights === 2 && sections.length === 3) return 'L-shaped';
  if (turns.length === 2 && flights === 2 && sections.length === 4 && turns[0].turn === turns[1].turn) return 'U-shaped';
  return 'Custom';
}

/**
 * Problems that make the staircase physically impossible (sections overlapping each
 * other, flights without steps). These are shown as warnings — never a crash — and
 * are not a building-code or safety check.
 */
export function stairProblems(stair: Pick<Staircase, 'sections'>): string[] {
  const problems: string[] = [];
  if (stair.sections.length === 0) problems.push('A staircase needs at least one flight.');
  if (!stair.sections.some((s) => s.kind === 'flight')) problems.push('Add at least one flight of steps.');
  stair.sections.forEach((s, i) => {
    if (s.kind === 'flight' && s.steps < 1) problems.push(`Section ${i + 1} needs at least one step.`);
  });
  const laid = layoutStair(stair.sections).sections;
  for (let i = 0; i < laid.length; i++) {
    for (let j = i + 2; j < laid.length; j++) {
      // Neighbouring sections touch along an edge; anything further apart must not overlap.
      if (overlapArea(laid[i].corners, laid[j].corners) > 1) {
        problems.push(`Sections ${i + 1} and ${j + 1} overlap, so this staircase couldn’t be built as drawn.`);
      }
    }
  }
  return problems;
}

/** Ready-made layouts. Lengths come from the step count × a typical 25 cm tread. */
export function stairPreset(shape: 'straight' | 'L' | 'U', width: number, makeId: () => string, turn: 'left' | 'right' = 'right'): StairSection[] {
  const flight = (steps: number): StairSection => ({ id: makeId(), kind: 'flight', length: steps * DEFAULT_TREAD, width, steps, turn: 'straight' });
  const landing = (t: StairSection['turn']): StairSection => ({ id: makeId(), kind: 'landing', length: width, width, steps: 0, turn: t });
  switch (shape) {
    case 'straight':
      return [flight(14)];
    case 'L':
      return [flight(7), landing(turn), flight(7)];
    case 'U':
      return [flight(7), landing(turn), landing(turn), flight(7)];
  }
}
