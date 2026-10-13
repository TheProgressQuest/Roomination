import type { Furniture } from '../model/types';

/**
 * Simple 3D shapes for furniture, built from a few boxes per piece.
 *
 * Parts are in the piece's LOCAL frame: x across its width, y across its depth with
 * the front at +y (the same convention as the plan), z up from the floor, all in cm,
 * centred on the piece. Every part stays inside the piece's real width × depth × height
 * box, so a piece never looks bigger in 3D than the plan says it is.
 */

export interface FurniturePart {
  /** Centre across the width and depth, in cm. */
  x: number;
  y: number;
  /** Bottom of the part above the floor, in cm. */
  z: number;
  width: number;
  depth: number;
  height: number;
  /** A fixed colour (mattress, screen); otherwise the piece's colour, shaded. */
  color?: string;
  /** Darkens (< 0) or lightens (> 0) the piece's colour, e.g. legs a bit darker. */
  shade?: number;
}

/** Clamps to lo..hi, but never beyond `cap` (keeps parts sane on tiny pieces). */
const clamp = (v: number, lo: number, hi: number, cap = Infinity) => Math.min(cap, hi, Math.max(lo, v));

/** A part given by its extents (x0..x1, y0..y1, z0..z1). */
function span(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, extra: Partial<FurniturePart> = {}): FurniturePart {
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: z0, width: x1 - x0, depth: y1 - y0, height: z1 - z0, ...extra };
}

const LEG_SHADE = -0.28;
const MATTRESS = '#f1ece3';
const PILLOW = '#fbf8f2';
const SCREEN = '#1c1e22';

function legs(w: number, d: number, top: number, size: number): FurniturePart[] {
  const hx = w / 2;
  const hy = d / 2;
  return [
    [-hx, -hy],
    [hx - size, -hy],
    [-hx, hy - size],
    [hx - size, hy - size],
  ].map(([x0, y0]) => span(x0, x0 + size, y0, y0 + size, 0, top, { shade: LEG_SHADE }));
}

function table(w: number, d: number, h: number): FurniturePart[] {
  const top = clamp(h * 0.06, 2, 5, h / 3);
  const leg = clamp(Math.min(w, d) * 0.08, 3, 7, Math.min(w, d) / 4);
  return [span(-w / 2, w / 2, -d / 2, d / 2, h - top, h), ...legs(w, d, h - top, leg)];
}

function desk(w: number, d: number, h: number): FurniturePart[] {
  const top = clamp(h * 0.05, 2, 4, h / 3);
  const side = clamp(w * 0.03, 2, 4, w / 4);
  return [
    span(-w / 2, w / 2, -d / 2, d / 2, h - top, h),
    span(-w / 2, -w / 2 + side, -d / 2, d / 2, 0, h - top, { shade: LEG_SHADE }),
    span(w / 2 - side, w / 2, -d / 2, d / 2, 0, h - top, { shade: LEG_SHADE }),
    // A modesty panel at the back, so the front (where you sit) stays open.
    span(-w / 2 + side, w / 2 - side, -d / 2, -d / 2 + 2, h * 0.45, h - top, { shade: -0.15 }),
  ];
}

function chair(w: number, d: number, h: number): FurniturePart[] {
  const seatTop = Math.min(46, h * 0.5);
  const seat = clamp(h * 0.05, 3, 6, seatTop / 2);
  const back = clamp(d * 0.12, 3, 8, d / 3);
  const leg = clamp(Math.min(w, d) * 0.09, 2.5, 5, Math.min(w, d) / 4);
  return [
    span(-w / 2, w / 2, -d / 2, d / 2, seatTop - seat, seatTop),
    span(-w / 2, w / 2, -d / 2, -d / 2 + back, seatTop, h),
    ...legs(w, d, seatTop - seat, leg),
  ];
}

function sofa(w: number, d: number, h: number): FurniturePart[] {
  const seatTop = Math.min(45, h * 0.52);
  const back = clamp(d * 0.22, 10, 28, d / 3);
  const arm = clamp(w * 0.1, 8, 22, w / 4);
  const armTop = Math.min(h, Math.max(seatTop + 12, h * 0.72));
  return [
    span(-w / 2 + arm, w / 2 - arm, -d / 2 + back, d / 2, 0, seatTop),
    span(-w / 2, w / 2, -d / 2, -d / 2 + back, 0, h, { shade: -0.1 }),
    span(-w / 2, -w / 2 + arm, -d / 2 + back, d / 2, 0, armTop, { shade: -0.1 }),
    span(w / 2 - arm, w / 2, -d / 2 + back, d / 2, 0, armTop, { shade: -0.1 }),
  ];
}

function bed(w: number, d: number, h: number): FurniturePart[] {
  const base = h * 0.45;
  const mattressTop = h * 0.85;
  const board = clamp(d * 0.04, 3, 8, d / 4);
  const inset = Math.min(2, w * 0.02);
  const pillowDepth = Math.min(35, d * 0.18);
  const gap = Math.min(6, w * 0.05);
  const pillows = w >= 120 ? 2 : w >= 40 ? 1 : 0;
  const pillowWidth = (w - 2 * inset - gap * (pillows + 1)) / pillows;
  const head = -d / 2 + board;
  return [
    span(-w / 2, w / 2, head, d / 2, 0, base),
    span(-w / 2, w / 2, -d / 2, head, 0, h, { shade: -0.2 }),
    span(-w / 2 + inset, w / 2 - inset, head, d / 2 - inset, base, mattressTop, { color: MATTRESS }),
    ...Array.from({ length: pillows }, (_, i) => {
      const x0 = -w / 2 + inset + gap + i * (pillowWidth + gap);
      return span(x0, x0 + pillowWidth, head + 4, head + 4 + pillowDepth, mattressTop, h, { color: PILLOW });
    }),
  ];
}

function bookshelf(w: number, d: number, h: number): FurniturePart[] {
  const t = clamp(Math.min(w, d) * 0.06, 1.5, 3, Math.min(w, d) / 4);
  const parts = [
    span(-w / 2, -w / 2 + t, -d / 2, d / 2, 0, h),
    span(w / 2 - t, w / 2, -d / 2, d / 2, 0, h),
    span(-w / 2 + t, w / 2 - t, -d / 2, -d / 2 + t, 0, h, { shade: -0.2 }),
    span(-w / 2 + t, w / 2 - t, -d / 2, d / 2, h - t, h),
    span(-w / 2 + t, w / 2 - t, -d / 2, d / 2, 0, Math.min(8, h * 0.1)),
  ];
  const shelves = Math.max(0, Math.floor(h / 35) - 1);
  for (let i = 1; i <= shelves; i++) {
    const z = (h * i) / (shelves + 1);
    parts.push(span(-w / 2 + t, w / 2 - t, -d / 2 + t, d / 2, z - t / 2, z + t / 2));
  }
  return parts;
}

function cabinet(w: number, d: number, h: number): FurniturePart[] {
  const front = Math.min(2, d * 0.1);
  const plinth = Math.min(8, h * 0.08);
  const doors = w > 70 ? 2 : 1;
  const seam = Math.min(1, w * 0.02);
  const doorWidth = (w - seam * (doors - 1)) / doors;
  return [
    span(-w / 2, w / 2, -d / 2, d / 2 - front, 0, h),
    span(-w / 2 + Math.min(2, w / 4), w / 2 - Math.min(2, w / 4), d / 2 - front, d / 2, 0, plinth, { shade: LEG_SHADE }),
    ...Array.from({ length: doors }, (_, i) => {
      const x0 = -w / 2 + i * (doorWidth + seam);
      return span(x0, x0 + doorWidth, d / 2 - front, d / 2, plinth + 0.5, h, { shade: 0.08 });
    }),
  ];
}

function television(w: number, d: number, h: number): FurniturePart[] {
  const screenDepth = Math.min(d, 6);
  if (d < 25) {
    // Just a screen on a small stand.
    const stand = Math.min(h * 0.12, 10);
    return [
      span(-w * 0.15, w * 0.15, -d / 2, d / 2, 0, stand, { color: SCREEN }),
      span(-w / 2, w / 2, -screenDepth / 2, screenDepth / 2, stand, h, { color: SCREEN }),
    ];
  }
  // A TV unit with the screen standing on it, at the back.
  const unit = h * 0.6;
  const screenWidth = w * 0.85;
  return [
    ...cabinet(w, d, unit),
    span(-screenWidth / 2, screenWidth / 2, -d / 2 + 4, -d / 2 + 4 + screenDepth, unit, h, { color: SCREEN }),
  ];
}

function decor(w: number, d: number, h: number): FurniturePart[] {
  const pot = h * 0.35;
  return [span(-w * 0.3, w * 0.3, -d * 0.3, d * 0.3, 0, pot, { shade: -0.25 }), span(-w / 2, w / 2, -d / 2, d / 2, pot, h)];
}

/** The parts that make up one piece, in its local frame. */
export function furnitureParts(item: Pick<Furniture, 'kind' | 'category' | 'width' | 'depth' | 'height'>): FurniturePart[] {
  return partsForKind(item).filter((p) => p.width > 0 && p.depth > 0 && p.height > 0);
}

function partsForKind(item: Pick<Furniture, 'kind' | 'category' | 'width' | 'depth' | 'height'>): FurniturePart[] {
  const { width: w, depth: d, height: h } = item;
  // Rugs and mats are flat, whatever their kind.
  if (item.category === 'floorCovering') return [span(-w / 2, w / 2, -d / 2, d / 2, 0, Math.min(h, 1.5))];
  switch (item.kind) {
    case 'desk':
      return desk(w, d, h);
    case 'table':
    case 'diningTable':
    case 'coffeeTable':
      return table(w, d, h);
    case 'chair':
      return chair(w, d, h);
    case 'sofa':
    case 'armchair':
      return sofa(w, d, h);
    case 'bed':
      return bed(w, d, h);
    case 'bookshelf':
      return bookshelf(w, d, h);
    case 'cabinet':
    case 'storage':
    case 'bedsideTable':
      return cabinet(w, d, h);
    case 'television':
      return television(w, d, h);
    case 'decor':
      return decor(w, d, h);
    case 'custom':
      return [span(-w / 2, w / 2, -d / 2, d / 2, 0, h)];
  }
}
