import type { WallHole } from './model';

/** A point on a wall face: (distance along the wall, height), in cm. */
export type UV = [number, number];

/**
 * One face of a wall as polygons in (distance along the wall, height), with door and
 * window holes. Openings touching the floor or ceiling become notches in the outline,
 * and openings running floor to ceiling split the face into separate pieces.
 */
export function faceShapes(from: number, to: number, height: number, holes: WallHole[]): { contour: UV[]; holes: UV[][] }[] {
  const atFloor = (h: WallHole) => h.bottom <= 0.01;
  const atCeiling = (h: WallHole) => h.top >= height - 0.01;
  const inRange = holes
    .map((h) => ({ ...h, start: Math.max(h.start, from), end: Math.min(h.end, to) }))
    .filter((h) => h.end - h.start > 0.01);
  const pieces: [number, number][] = [];
  let cursor = from;
  for (const h of inRange.filter((h) => atFloor(h) && atCeiling(h))) {
    if (h.start > cursor + 0.01) pieces.push([cursor, h.start]);
    cursor = Math.max(cursor, h.end);
  }
  if (to > cursor + 0.01) pieces.push([cursor, to]);

  return pieces.map(([a, b]) => {
    const inside = inRange.filter((h) => !(atFloor(h) && atCeiling(h)) && h.start >= a - 0.01 && h.end <= b + 0.01);
    const contour: UV[] = [[a, 0]];
    for (const h of inside.filter(atFloor)) contour.push([h.start, 0], [h.start, h.top], [h.end, h.top], [h.end, 0]);
    contour.push([b, 0], [b, height]);
    for (const h of inside.filter(atCeiling).reverse()) contour.push([h.end, height], [h.end, h.bottom], [h.start, h.bottom], [h.start, height]);
    contour.push([a, height]);
    const holesInside = inside.filter((h) => !atFloor(h) && !atCeiling(h)).map((h): UV[] => [[h.start, h.bottom], [h.end, h.bottom], [h.end, h.top], [h.start, h.top]]);
    // Openings flush with a wall end leave repeated corners; the triangulator needs them removed.
    const distinct = contour.filter((p, i) => {
      const q = contour[(i + 1) % contour.length];
      return Math.abs(p[0] - q[0]) > 1e-6 || Math.abs(p[1] - q[1]) > 1e-6;
    });
    return { contour: distinct, holes: holesInside };
  });
}
