import type { FurnitureShape, Point } from '../model/types';
import type { ScanObject } from './types';

/**
 * An L-shaped sofa as one piece. RoomPlan (iOS 17+) measures an L-shaped sofa as two boxes: the
 * long side (`SofaType: lShaped`) and the short side (`lShapedExtension`), linking the second to
 * the first with `parentIdentifier`. Only that explicit pair is joined, never two sofas that just
 * happen to stand close together, and only when their boxes really form an L: square to each
 * other, touching, the short side at one end of the long side and reaching out in front of it.
 *
 * The joined outline is the two measured boxes together (their sizes and positions are kept; an
 * end within a few centimetres of the long side's end is lined up with it, and the review says
 * by how much). Anything else keeps the two pieces separate, with the reason.
 */

/** How far (cm) the short side's end may be from the long side's end, or apart from it, and still join. */
const JOIN_TOLERANCE = 25;
/** Degrees the two boxes may be off square. */
const ANGLE_TOLERANCE = 10;

export function isSectionalPair(main: ScanObject, extension: ScanObject): boolean {
  return extension.parentId === main.id && main.category === 'sofa' && extension.category === 'sofa' && extension.attributes.SofaType === 'lShapedExtension' && main.attributes.SofaType !== 'lShapedExtension';
}

export interface JoinedSectional {
  /** Centre of the joined piece, in the scan's plan coordinates. */
  center: Point;
  /** Clockwise degrees: the long side's own turn, or half a turn more if the short side stood behind it. */
  rotation: number;
  width: number;
  depth: number;
  height: number;
  /** The L outline, in the piece's own frame (back along the top, the short side reaching forward). */
  shape: FurnitureShape;
  /** How far (cm) the short side was moved to line up with the long side's end and front. */
  adjusted: number;
}

/** Plan point → the box's own frame (front at +y), and back. Rotation is clockwise on screen. */
function toLocal(p: Point, c: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: dx * Math.cos(r) + dy * Math.sin(r), y: -dx * Math.sin(r) + dy * Math.cos(r) };
}

function toPlan(p: Point, c: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180;
  return { x: c.x + p.x * Math.cos(r) - p.y * Math.sin(r), y: c.y + p.x * Math.sin(r) + p.y * Math.cos(r) };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** The pair joined into one L, or a plain-words reason why they can't be. */
export function joinSectional(main: ScanObject, extension: ScanObject): JoinedSectional | { problem: string } {
  const offSquare = (((extension.rotation - main.rotation) % 90) + 90) % 90;
  if (Math.min(offSquare, 90 - offSquare) > ANGLE_TOLERANCE) return { problem: 'its two parts aren’t square to each other' };
  if (Math.abs(main.bottom - extension.bottom) > JOIN_TOLERANCE) return { problem: 'its two parts stand at different heights' };

  // The short side's box, in the long side's frame.
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => toLocal(toPlan({ x: (sx * extension.width) / 2, y: (sy * extension.depth) / 2 }, extension.center, extension.rotation), main.center, main.rotation));
  let x0 = Math.min(...corners.map((p) => p.x));
  let x1 = Math.max(...corners.map((p) => p.x));
  let y0 = Math.min(...corners.map((p) => p.y));
  let y1 = Math.max(...corners.map((p) => p.y));
  const W = main.width / 2;
  const D = main.depth / 2;
  let rotation = main.rotation;
  // The short side reaches forward from the seat. If it stands behind the long side, the scanner's
  // "front" was its back: turn the piece half round (the boxes stay where they were measured).
  if (y1 < D && y0 < -D) {
    [x0, x1, y0, y1] = [-x1, -x0, -y1, -y0];
    rotation += 180;
  }
  if (y1 < D + 20) return { problem: 'the short side doesn’t reach out in front of the long side' };
  if (y0 > D + JOIN_TOLERANCE) return { problem: 'its two parts don’t touch' };
  const atLeft = Math.abs(x0 + W) <= JOIN_TOLERANCE;
  const atRight = Math.abs(x1 - W) <= JOIN_TOLERANCE;
  if (atLeft === atRight || x1 - x0 > main.width - 30) return { problem: 'the short side isn’t at one end of the long side' };

  const front = Math.max(D, y1);
  const inner = atLeft ? x1 : x0;
  const adjusted = round1(Math.max(atLeft ? Math.abs(x0 + W) : Math.abs(x1 - W), Math.max(0, y0 - D)));
  // Clockwise from the back's left end, as the catalogue's sectional: back, then the arm ends.
  const outline: Point[] = atLeft
    ? [{ x: -W, y: -D }, { x: W, y: -D }, { x: W, y: D }, { x: inner, y: D }, { x: inner, y: front }, { x: -W, y: front }]
    : [{ x: -W, y: -D }, { x: W, y: -D }, { x: W, y: front }, { x: inner, y: front }, { x: inner, y: D }, { x: -W, y: D }];
  const middle = (front - D) / 2;
  const shape: FurnitureShape = { points: outline.map((p) => ({ x: round1(p.x), y: round1(p.y - middle) })) };
  return {
    center: toPlan({ x: 0, y: middle }, main.center, rotation),
    rotation: ((rotation % 360) + 360) % 360,
    width: round1(main.width),
    depth: round1(front + D),
    height: round1(Math.max(main.height, extension.height)),
    shape,
    adjusted,
  };
}
