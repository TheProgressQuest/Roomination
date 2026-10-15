import { placeComponents } from '../model/components';
import type { ComponentType, Furniture, FurnitureComponent, MaterialKind, Point, SeamStyle, SurfaceFinish, UpholsteryPattern } from '../model/types';
import { seededRandom } from '../model/random';
import { luminance, shade } from './palette';
import type { SurfaceKind } from './materials';

/**
 * What each piece of furniture is made of: cushions, arms, legs, a mattress and pillows,
 * shelves and books, doors and handles, leaves… This one description drives both the 3D
 * models and the 2D presentation plan (which paints the same parts seen from above), so the
 * two views always agree.
 *
 * Parts are in the piece's LOCAL frame: x across its width, y across its depth with the
 * front at +y (as on the plan), z up from the floor, all in cm, centred on the piece.
 * **Every part, including its rounding and any turn or tilt, stays inside the piece's real
 * width × depth × height**, so nothing looks bigger than the plan and collision checks say.
 */

export type PartShape =
  /** A box with rounded edges and corners (`radius` cm). */
  | 'rounded'
  /** A cylinder filling its box (an ellipse in plan when width ≠ depth). */
  | 'cylinder'
  /** A cylinder narrowing upwards to `taper` × its base (lampshades, plant pots). */
  | 'cone'
  /** A soft ellipsoid filling its box (pillows, cushions seen from above). */
  | 'ellipsoid'
  /** A pointed, gently curved leaf blade lying along +y. */
  | 'leaf'
  /** An upright extrusion of `outline` (irregular seats, bands along edges, curved panels). */
  | 'prism';

export type PartRole =
  | 'frame'
  | 'arm'
  | 'back'
  | 'seat'
  | 'cushion'
  | 'pillow'
  | 'leg'
  | 'top'
  | 'mattress'
  | 'duvet'
  | 'throw'
  | 'headboard'
  | 'shelf'
  | 'book'
  | 'door'
  | 'drawer'
  | 'handle'
  | 'screen'
  | 'pot'
  | 'soil'
  | 'leaf'
  | 'stem'
  | 'shade'
  | 'base'
  | 'rug';

export interface FurniturePart {
  /** Centre across the width and depth (before `yaw`), cm. */
  x: number;
  y: number;
  /** Bottom above the floor, cm. */
  z: number;
  width: number;
  depth: number;
  height: number;
  shape: PartShape;
  role: PartRole;
  /** 'body' uses the piece's own material and colour; anything else is a fixed surface. */
  surface: 'body' | SurfaceKind;
  /** Edge rounding for 'rounded' parts, cm (never more than half the smallest side). */
  radius?: number;
  /** Turn about the part's own vertical axis, clockwise degrees (as on the plan). */
  yaw?: number;
  /** Tilt of a leaf's tip upwards, degrees. */
  tilt?: number;
  /** For 'cone': top radius ÷ bottom radius. The wider end fills the box, so the part never outgrows it. */
  taper?: number;
  /** A fixed colour; otherwise the piece's colour, shaded by `shade`. */
  color?: string;
  shade?: number;
  /** 'prism': its plan outline relative to (x, y), before `yaw`. */
  outline?: Point[];
  /** How `radius` shapes the edges: rounded (default) or a flat bevel (chamfer). */
  bevel?: 'round' | 'chamfer';
  /** Surface look overrides (component-built furniture). */
  finish?: SurfaceFinish;
  roughness?: number;
  textureScale?: number;
  pattern?: UpholsteryPattern;
  seams?: SeamStyle;
}

/** What a piece looks like: its kind, plus a refinement from its name for décor and chairs. */
export type Visual =
  | 'sofa'
  | 'armchair'
  | 'chair'
  | 'officeChair'
  | 'bed'
  | 'table'
  | 'coffeeTable'
  | 'diningTable'
  | 'desk'
  | 'bookshelf'
  | 'cabinet'
  | 'wardrobe'
  | 'bedsideTable'
  | 'television'
  | 'plant'
  | 'lamp'
  | 'vase'
  | 'rug'
  | 'block';

type Item = Pick<Furniture, 'id' | 'name' | 'kind' | 'category' | 'width' | 'depth' | 'height'> & Partial<Pick<Furniture, 'color' | 'appearance' | 'components'>>;

/** The visual design a piece gets. Names only refine décor and chairs; the kind decides the rest. */
export function visualOf(item: Pick<Furniture, 'name' | 'kind' | 'category'>): Visual {
  if (item.category === 'floorCovering') return 'rug';
  const name = item.name.toLowerCase();
  switch (item.kind) {
    case 'sofa':
      return 'sofa';
    case 'armchair':
      return 'armchair';
    case 'chair':
      return /desk|office|task|gaming|swivel/.test(name) ? 'officeChair' : 'chair';
    case 'bed':
      return 'bed';
    case 'table':
      return 'table';
    case 'coffeeTable':
      return 'coffeeTable';
    case 'diningTable':
      return 'diningTable';
    case 'desk':
      return 'desk';
    case 'bookshelf':
      return 'bookshelf';
    case 'cabinet':
      return 'cabinet';
    case 'storage':
      return /wardrobe|closet|armoire/.test(name) ? 'wardrobe' : 'cabinet';
    case 'bedsideTable':
      return 'bedsideTable';
    case 'television':
      return 'television';
    case 'decor':
      if (/lamp|light/.test(name)) return 'lamp';
      if (/vase|sculpture|urn|pot\b/.test(name)) return 'vase';
      return 'plant';
    case 'fixture':
      return 'block';
    case 'custom':
      if (item.category === 'decoration' && /plant|tree|fern|palm|ficus|monstera|flower/.test(name)) return 'plant';
      if (item.category === 'decoration' && /lamp|light/.test(name)) return 'lamp';
      return 'block';
  }
}

/** The surface a piece's own parts use when the person hasn't chosen a material. */
export function defaultSurface(visual: Visual): MaterialKind {
  switch (visual) {
    case 'sofa':
    case 'armchair':
    case 'bed':
    case 'officeChair':
    case 'rug':
      return 'fabric';
    case 'plant':
    case 'vase':
      return 'ceramic';
    case 'lamp':
      return 'metal';
    case 'block':
      return 'custom';
    default:
      return 'wood';
  }
}

/** The surface a piece's own parts are made of: the person's choice, or its kind's default. */
export function bodySurface(item: Item): MaterialKind {
  return item.appearance?.material ?? defaultSurface(visualOf(item));
}

// Neutral colours for parts that aren't the piece's own colour.
const BEDDING = '#f6f3ee';
const BEDDING_SHADE = '#ebe5dc';
const LEG_WOOD = '#6b5442';
const DARK_METAL = '#3c3f44';
const SCREEN = '#141619';
const SOIL = '#4a3b2e';
const BOOKS = ['#8c6a5a', '#c9b79c', '#6f7f73', '#a8574a', '#3f4a5a', '#d8cdb8', '#7d6b8f', '#b8946a', '#5c6b7a'];

/** A soft accent for pillows and throws that suits the piece's colour (sage on light, linen on dark). */
export function accentFor(color: string): string {
  return luminance(color) > 0.45 ? '#9aa58a' : '#e9e2d6';
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A part given by its extents (x0..x1, y0..y1, z0..z1). */
function span(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, rest: Omit<FurniturePart, 'x' | 'y' | 'z' | 'width' | 'depth' | 'height'>): FurniturePart {
  const width = x1 - x0;
  const depth = y1 - y0;
  const height = z1 - z0;
  const part: FurniturePart = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: z0, width, depth, height, ...rest };
  if (part.radius !== undefined) part.radius = Math.max(0, Math.min(part.radius, width / 2, depth / 2, height / 2));
  return part;
}

const rounded = (radius: number, role: PartRole, surface: FurniturePart['surface'] = 'body', extra: Partial<FurniturePart> = {}) => ({ shape: 'rounded' as const, radius, role, surface, ...extra });

/** Four legs inset from the corners. */
function legs(w: number, d: number, top: number, size: number, inset: number, extra: Partial<FurniturePart> = {}): FurniturePart[] {
  if (top <= 0.5) return [];
  const s = Math.min(size, w / 4, d / 4);
  const i = Math.min(inset, w / 2 - s, d / 2 - s);
  const xs = [-w / 2 + i, w / 2 - i - s];
  const ys = [-d / 2 + i, d / 2 - i - s];
  return xs.flatMap((x) => ys.map((y) => span(x, x + s, y, y + s, 0, top, { shape: 'cylinder', role: 'leg', surface: 'wood', color: LEG_WOOD, ...extra })));
}

// ---------------------------------------------------------------------------
// Seating
// ---------------------------------------------------------------------------

function sofa(w: number, d: number, h: number, item: Item, seats?: number): FurniturePart[] {
  const legH = h >= 60 ? clamp(h * 0.12, 4, 12) : 0;
  const seatTop = clamp(h * 0.5, Math.min(h, 20), 46);
  const cushionT = clamp((seatTop - legH) * 0.35, 4, 14);
  const arm = clamp(w * 0.1, 6, 22);
  const armTop = Math.min(h - 2, Math.max(seatTop + 10, h * 0.72));
  const backFrame = clamp(d * 0.1, 4, 10);
  const backCushion = clamp(d * 0.17, 6, 18);
  const r = clamp(Math.min(w, d) * 0.04, 1.5, 5);
  const parts: FurniturePart[] = [
    // Base under the seat, then the back and the two arms (upholstered).
    span(-w / 2, w / 2, -d / 2, d / 2, legH, seatTop - cushionT, rounded(r, 'frame')),
    span(-w / 2, w / 2, -d / 2, -d / 2 + backFrame, legH, h - 4, rounded(r, 'back', 'body', { shade: -0.06 })),
    span(-w / 2, -w / 2 + arm, -d / 2, d / 2, legH, armTop, rounded(r * 1.4, 'arm', 'body', { shade: -0.03 })),
    span(w / 2 - arm, w / 2, -d / 2, d / 2, legH, armTop, rounded(r * 1.4, 'arm', 'body', { shade: -0.03 })),
    ...legs(w, d, legH, 4, 4),
  ];
  // Seat and back cushions between the arms, with a small gap between each.
  const inner = w - 2 * arm;
  const count = seats ?? (inner >= 150 ? 3 : inner >= 95 ? 2 : 1);
  const gap = count > 1 ? 1 : 0;
  const cw = (inner - gap * (count - 1)) / count;
  for (let i = 0; i < count; i++) {
    const x0 = -w / 2 + arm + i * (cw + gap);
    parts.push(span(x0, x0 + cw, -d / 2 + backFrame + backCushion * 0.6, d / 2 - 1, seatTop - cushionT, seatTop, rounded(Math.min(6, cushionT / 2), 'cushion', 'body', { shade: 0.05 })));
    parts.push(span(x0, x0 + cw, -d / 2 + backFrame, -d / 2 + backFrame + backCushion, seatTop - cushionT, h, rounded(Math.min(7, backCushion / 2), 'cushion', 'body', { shade: 0.02 })));
  }
  // Accent pillows in the corners of longer sofas.
  if (inner >= 120 && h >= 60) {
    const size = clamp(inner * 0.2, 30, 45);
    const accent = accentFor(item.color ?? '#cccccc');
    // Leaning against the back cushions: seen from above they read as plump squares.
    const py = -d / 2 + backFrame + backCushion * 0.35;
    const pd = Math.min(size * 0.55, d / 2 - py - 6);
    const top = Math.min(h - 6, seatTop + size * 0.85);
    for (const side of [-1, 1]) {
      const x = side * (w / 2 - arm - size / 2 - 3);
      parts.push(span(x - size / 2, x + size / 2, py, py + pd, seatTop, top, { shape: 'rounded', radius: 6, role: 'pillow', surface: 'linen', color: accent, yaw: side * 6 }));
    }
  }
  return parts;
}

function chair(w: number, d: number, h: number): FurniturePart[] {
  const seatTop = Math.min(46, h * 0.52);
  const seatT = clamp(h * 0.05, 3, 6);
  const back = clamp(d * 0.12, 3, 7);
  const leg = clamp(Math.min(w, d) * 0.08, 2.5, 4.5);
  return [
    span(-w / 2, w / 2, -d / 2, d / 2, seatTop - seatT, seatTop, rounded(Math.min(w, d) * 0.18, 'seat')),
    // A pale upholstered pad on the seat.
    span(-w / 2 + 3, w / 2 - 3, -d / 2 + back, d / 2 - 3, seatTop - 1, seatTop + Math.min(3, h - seatTop - 1), rounded(Math.min(w, d) * 0.14, 'cushion', 'fabric', { color: '#e8e1d5' })),
    span(-w / 2 + 1, w / 2 - 1, -d / 2, -d / 2 + back, seatTop, h, rounded(Math.min(back / 2, 3), 'back')),
    ...legs(w, d, seatTop - seatT, leg, 2, { surface: 'body', color: undefined, shade: -0.18 }),
  ];
}

function officeChair(w: number, d: number, h: number): FurniturePart[] {
  const seatTop = Math.min(50, h * 0.5);
  const r = Math.min(w, d) / 2;
  const base = Math.min(6, seatTop * 0.15);
  const parts: FurniturePart[] = [];
  // A five-star base: slim spokes from the central column, each turned to point outwards.
  const len = r - 3;
  for (let i = 0; i < 5; i++) {
    const a = ((i * 72 - 90) * Math.PI) / 180;
    const spoke = Math.min(4, r * 0.3);
    const tall = base - 1;
    parts.push({ x: (Math.cos(a) * len) / 2, y: (Math.sin(a) * len) / 2, z: 1, width: spoke, depth: len, height: tall, shape: 'rounded', radius: Math.min(1, spoke / 2, tall / 2), role: 'base', surface: 'metal', color: DARK_METAL, yaw: i * 72 - 180 });
  }
  parts.push(span(-3, 3, -3, 3, base, seatTop - 7, { shape: 'cylinder', role: 'stem', surface: 'metal', color: DARK_METAL }));
  parts.push(span(-w / 2 + 2, w / 2 - 2, -d / 2 + 4, d / 2 - 2, seatTop - 7, seatTop, rounded(8, 'seat', 'body')));
  parts.push(span(-w / 2 + 5, w / 2 - 5, -d / 2, -d / 2 + 7, seatTop - 2, h, rounded(6, 'back', 'body', { shade: -0.05 })));
  return parts;
}

// ---------------------------------------------------------------------------
// Beds
// ---------------------------------------------------------------------------

function bed(w: number, d: number, h: number, item: Item): FurniturePart[] {
  const board = clamp(d * 0.04, 4, 9);
  const frameTop = h * 0.5;
  const mattressTop = h * 0.86;
  const inset = Math.min(2, w * 0.02);
  const head = -d / 2 + board;
  const accent = accentFor(item.color ?? '#cccccc');
  const parts: FurniturePart[] = [
    span(-w / 2, w / 2, head, d / 2, 0, frameTop, rounded(3, 'frame')),
    span(-w / 2, w / 2, -d / 2, head, 0, h, rounded(Math.min(3, board / 2), 'headboard', 'body', { shade: -0.05 })),
    span(-w / 2 + inset, w / 2 - inset, head, d / 2 - inset, frameTop, mattressTop, rounded(5, 'mattress', 'linen', { color: BEDDING_SHADE })),
  ];
  // The duvet covers the lower two-thirds, with a throw across the foot.
  const duvetStart = head + Math.min(55, d * 0.28);
  const duvetTop = Math.min(h - 1, mattressTop + 3);
  parts.push(span(-w / 2 + inset * 0.5, w / 2 - inset * 0.5, duvetStart, d / 2 - inset * 0.5, frameTop + 2, duvetTop, rounded(4, 'duvet', 'linen', { color: BEDDING })));
  if (d >= 120) {
    const throwStart = d / 2 - Math.min(55, d * 0.27);
    parts.push(span(-w / 2 + inset * 0.3, w / 2 - inset * 0.3, throwStart, d / 2 - inset * 0.3 - 4, frameTop + 3, Math.min(h, duvetTop + 1), rounded(3, 'throw', 'fabric', { color: accent })));
  }
  // Pillows against the headboard; decorative cushions in front on wider beds.
  const pillows = w >= 120 ? 2 : w >= 50 ? 1 : 0;
  if (pillows > 0) {
    const gap = Math.min(5, w * 0.04);
    const pw = (w - 2 * inset - gap * (pillows + 1)) / pillows;
    const pd = Math.min(40, d * 0.18);
    for (let i = 0; i < pillows; i++) {
      const x0 = -w / 2 + inset + gap + i * (pw + gap);
      parts.push(span(x0, x0 + pw, head + 3, head + 3 + pd, mattressTop - 1, h, rounded(7, 'pillow', 'linen', { color: BEDDING })));
    }
    if (w >= 140 && d >= 150) {
      const size = Math.min(45, (w - 2 * inset) / 4);
      for (const side of [-1, 1]) {
        const x = side * (size / 2 + 2);
        parts.push(span(x - size / 2, x + size / 2, head + 3 + pd - 6, head + 3 + pd + 6, mattressTop, Math.min(h, mattressTop + size * 0.5), { shape: 'rounded', radius: 5, role: 'pillow', surface: 'linen', color: accent, yaw: side * 8 }));
      }
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Tables and desks
// ---------------------------------------------------------------------------

function table(w: number, d: number, h: number, visual: Visual): FurniturePart[] {
  const top = clamp(h * 0.055, 2.5, 5);
  const leg = clamp(Math.min(w, d) * 0.07, 3, 6);
  const parts: FurniturePart[] = [span(-w / 2, w / 2, -d / 2, d / 2, h - top, h, rounded(Math.min(1.5, top / 2), 'top'))];
  parts.push(...legs(w, d, h - top, leg, visual === 'coffeeTable' ? 3 : 5, { surface: 'body', color: undefined, shade: -0.15, shape: 'rounded', radius: 0.8 }));
  if (visual === 'coffeeTable' && h >= 30) {
    // A lower shelf, common on coffee tables.
    parts.push(span(-w / 2 + 3, w / 2 - 3, -d / 2 + 3, d / 2 - 3, h * 0.22, h * 0.22 + 2, rounded(1, 'shelf', 'body', { shade: -0.06 })));
  }
  return parts;
}

function desk(w: number, d: number, h: number): FurniturePart[] {
  const top = clamp(h * 0.045, 2.5, 4);
  const side = clamp(w * 0.03, 2, 4);
  const parts: FurniturePart[] = [
    span(-w / 2, w / 2, -d / 2, d / 2, h - top, h, rounded(1, 'top')),
    span(-w / 2, -w / 2 + side, -d / 2, d / 2, 0, h - top, rounded(0.5, 'frame', 'body', { shade: -0.12 })),
    // A modesty panel at the back keeps the front (where you sit) open.
    span(-w / 2 + side, w / 2 - side, -d / 2, -d / 2 + 2, h * 0.45, h - top, rounded(0.5, 'frame', 'body', { shade: -0.15 })),
  ];
  if (w >= 100 && d >= 40) {
    // A drawer pedestal on the right, drawers facing the person.
    const pw = Math.min(42, w * 0.32);
    const x0 = w / 2 - pw;
    parts.push(span(x0, w / 2, -d / 2, d / 2 - 1.5, 0, h - top, rounded(0.6, 'frame', 'body', { shade: -0.04 })));
    const drawers = 3;
    const dh = (h - top - 4) / drawers;
    for (let i = 0; i < drawers; i++) {
      const z0 = 2 + i * dh;
      parts.push(span(x0 + 1, w / 2 - 1, d / 2 - 1.5, d / 2 - 0.8, z0 + 0.5, z0 + dh - 0.5, rounded(0.3, 'drawer', 'body', { shade: 0.04 })));
      parts.push(span(x0 + pw / 2 - 5, x0 + pw / 2 + 5, d / 2 - 0.8, d / 2, z0 + dh / 2 - 0.6, z0 + dh / 2 + 0.6, { shape: 'rounded', radius: 0.5, role: 'handle', surface: 'brass', color: '#b08d57' }));
    }
  } else {
    parts.push(span(w / 2 - side, w / 2, -d / 2, d / 2, 0, h - top, rounded(0.5, 'frame', 'body', { shade: -0.12 })));
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function bookshelf(w: number, d: number, h: number, item: Item): FurniturePart[] {
  const t = clamp(Math.min(w, d) * 0.06, 1.5, 2.5);
  const plinth = Math.min(8, h * 0.08);
  const parts: FurniturePart[] = [
    span(-w / 2, -w / 2 + t, -d / 2, d / 2, 0, h, rounded(0.4, 'frame')),
    span(w / 2 - t, w / 2, -d / 2, d / 2, 0, h, rounded(0.4, 'frame')),
    span(-w / 2 + t, w / 2 - t, -d / 2, -d / 2 + 1, 0, h, rounded(0.2, 'back', 'body', { shade: -0.18 })),
    span(-w / 2 + t, w / 2 - t, -d / 2, d / 2, h - t, h, rounded(0.4, 'top')),
    span(-w / 2 + t, w / 2 - t, -d / 2, d / 2, 0, plinth, rounded(0.4, 'frame', 'body', { shade: -0.08 })),
  ];
  const shelves = Math.max(1, Math.floor((h - plinth) / 34));
  const gapH = (h - plinth - t) / shelves;
  const random = seededRandom(hash(item.id) || 1);
  for (let s = 0; s < shelves; s++) {
    const z = plinth + s * gapH;
    if (s > 0) parts.push(span(-w / 2 + t, w / 2 - t, -d / 2 + 1, d / 2, z - t / 2, z + t / 2, rounded(0.3, 'shelf')));
    // Books along most of the shelf, varied in height and colour, leaving a gap here and there.
    const usable = w - 2 * t - 2;
    let x = -w / 2 + t + 1 + random() * usable * 0.1;
    const end = -w / 2 + t + 1 + usable * (0.65 + random() * 0.3);
    const bookDepth = Math.min(d - 4, 24);
    while (x < end) {
      const bw = 2 + random() * 3;
      const bh = Math.min(gapH - t - 2, gapH * (0.55 + random() * 0.35));
      if (x + bw > end || bh < 4) break;
      parts.push(span(x, x + bw, -d / 2 + 2, -d / 2 + 2 + bookDepth * (0.75 + random() * 0.25), z + t / 2, z + t / 2 + bh, { shape: 'rounded', radius: 0.3, role: 'book', surface: 'paper', color: BOOKS[Math.floor(random() * BOOKS.length)] }));
      x += bw + (random() < 0.12 ? 4 + random() * 6 : 0.2);
    }
  }
  return parts;
}

function cabinet(w: number, d: number, h: number, visual: Visual): FurniturePart[] {
  const front = Math.min(2, d * 0.1);
  const raised = visual === 'bedsideTable' || h >= 60;
  const legH = raised ? Math.min(12, h * 0.15) : 0;
  const plinth = raised ? 0 : Math.min(6, h * 0.08);
  const body0 = Math.max(legH, plinth);
  const parts: FurniturePart[] = [span(-w / 2, w / 2, -d / 2, d / 2 - front, body0, h, rounded(1, 'frame'))];
  if (legH > 0) parts.push(...legs(w, d, legH, 3.5, 3, { surface: 'body', color: undefined, shade: -0.2 }));
  else parts.push(span(-w / 2 + 2, w / 2 - 2, -d / 2 + 2, d / 2 - front, 0, plinth, rounded(0.4, 'frame', 'body', { shade: -0.25 })));
  const seam = 0.6;
  if (visual === 'bedsideTable') {
    const drawers = h >= 45 ? 2 : 1;
    const dh = (h - body0 - 2) / drawers;
    for (let i = 0; i < drawers; i++) {
      const z0 = body0 + 1 + i * dh;
      parts.push(span(-w / 2 + 1, w / 2 - 1, d / 2 - front, d / 2 - 0.8, z0 + seam, z0 + dh - seam, rounded(0.3, 'drawer', 'body', { shade: 0.05 })));
      parts.push(span(-1.6, 1.6, d / 2 - 0.8, d / 2, z0 + dh / 2 - 1.6, z0 + dh / 2 + 1.6, { shape: 'cylinder', role: 'handle', surface: 'brass', color: '#b08d57' }));
    }
    return parts;
  }
  const doors = visual === 'wardrobe' ? Math.max(2, Math.round(w / 50)) : w > 70 ? 2 : 1;
  const dw = (w - seam * (doors + 1)) / doors;
  for (let i = 0; i < doors; i++) {
    const x0 = -w / 2 + seam + i * (dw + seam);
    parts.push(span(x0, x0 + dw, d / 2 - front, d / 2 - 0.8, body0 + seam, h - seam, rounded(0.3, 'door', 'body', { shade: 0.05 })));
    // Handles beside the meeting edges of door pairs.
    const hx = doors === 1 ? x0 + dw - 4 : i % 2 === 0 ? x0 + dw - 3 : x0 + 3;
    const hl = visual === 'wardrobe' ? Math.min(40, (h - body0) * 0.25) : Math.min(12, (h - body0) * 0.3);
    const hz = visual === 'wardrobe' ? body0 + (h - body0) * 0.5 : h - Math.min(12, (h - body0) * 0.3) - 4;
    parts.push(span(hx - 0.7, hx + 0.7, d / 2 - 0.8, d / 2, hz - hl / 2, hz + hl / 2, { shape: 'rounded', radius: 0.5, role: 'handle', surface: 'brass', color: '#b08d57' }));
  }
  return parts;
}

function television(w: number, d: number, h: number): FurniturePart[] {
  const screenDepth = Math.min(d, 5);
  if (d < 25) {
    const stand = Math.min(h * 0.12, 10);
    return [
      span(-w * 0.18, w * 0.18, -d / 2, d / 2, 0, 1.5, rounded(0.5, 'base', 'metal', { color: DARK_METAL })),
      span(-2, 2, -screenDepth / 2, screenDepth / 2, 1.5, stand, { shape: 'rounded', radius: 0.5, role: 'stem', surface: 'metal', color: DARK_METAL }),
      span(-w / 2, w / 2, -screenDepth / 2, screenDepth / 2, stand, h, rounded(0.6, 'screen', 'screen', { color: SCREEN })),
    ];
  }
  // A low unit with the screen standing on it, at the back.
  const unit = h * 0.55;
  const sw = w * 0.85;
  return [
    ...cabinet(w, d, unit, 'cabinet'),
    span(-sw * 0.12, sw * 0.12, -d / 2 + 6, -d / 2 + 14, unit, unit + 1.5, rounded(0.5, 'base', 'metal', { color: DARK_METAL })),
    span(-sw / 2, sw / 2, -d / 2 + 3, -d / 2 + 3 + screenDepth, unit + 1.5, h, rounded(0.6, 'screen', 'screen', { color: SCREEN })),
  ];
}

// ---------------------------------------------------------------------------
// Décor
// ---------------------------------------------------------------------------

function plant(w: number, d: number, h: number, item: Item): FurniturePart[] {
  const random = seededRandom(hash(item.id) || 7);
  const reach = Math.min(w, d) / 2;
  const potR = Math.min(reach * 0.55, 22);
  const potH = Math.min(h * 0.32, 45);
  const leafColor = item.color ?? '#7f9c6a';
  const parts: FurniturePart[] = [
    span(-potR, potR, -potR, potR, 0, potH, { shape: 'cone', taper: 1.15, role: 'pot', surface: 'ceramic', color: '#ece8e1' }),
    span(-potR * 0.92, potR * 0.92, -potR * 0.92, potR * 0.92, potH - 1.5, potH - 0.5, { shape: 'cylinder', role: 'soil', surface: 'soil', color: SOIL }),
  ];
  // Leaves radiate from the pot in tiers; taller plants get more tiers on a stem.
  const tiers = h > 110 ? 3 : h > 60 ? 2 : 1;
  const crown = h - potH;
  if (tiers > 1) parts.push(span(-1.2, 1.2, -1.2, 1.2, potH - 1, potH + crown * 0.75, { shape: 'cylinder', role: 'stem', surface: 'wood', color: '#6d5a40' }));
  for (let t = 0; t < tiers; t++) {
    const base = potH - 1 + (crown * 0.75 * t) / tiers;
    const count = 13 - t * 3;
    const tierReach = reach * (1 - t * 0.18);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 360 + random() * 25 + t * 17;
      const tilt = 18 + random() * 34;
      const rad = (tilt * Math.PI) / 180;
      const leafW = clamp(tierReach * 0.4, 4, 18);
      // Longest leaf that still ends inside the piece (horizontally and vertically).
      const maxLen = Math.min((tierReach - leafW / 2) / Math.cos(rad), (h - base - 1) / Math.sin(rad));
      const len = maxLen * (0.75 + random() * 0.25);
      if (len < 4) continue;
      const centreDist = (len / 2) * Math.cos(rad);
      const a = (angle * Math.PI) / 180;
      const thick = Math.min(2, len * 0.05);
      parts.push({
        x: Math.cos(a) * centreDist,
        y: Math.sin(a) * centreDist,
        // The leaf's base sits at the stem; z is the bottom of its (untilted) box.
        z: base + (len / 2) * Math.sin(rad) - thick / 2,
        width: leafW,
        depth: len,
        height: thick,
        shape: 'leaf',
        role: 'leaf',
        surface: 'foliage',
        color: shade(leafColor, (random() - 0.5) * 0.25),
        yaw: angle - 90,
        tilt,
      });
    }
  }
  return parts;
}

function lamp(w: number, d: number, h: number, item: Item): FurniturePart[] {
  const r = Math.min(w, d) / 2;
  const shadeH = Math.min(35, h * 0.28);
  return [
    span(-r * 0.7, r * 0.7, -r * 0.7, r * 0.7, 0, 2.5, { shape: 'cylinder', role: 'base', surface: 'metal', color: DARK_METAL }),
    span(-1.2, 1.2, -1.2, 1.2, 2.5, h - shadeH * 0.6, { shape: 'cylinder', role: 'stem', surface: 'brass', color: '#b08d57' }),
    span(-r, r, -r, r, h - shadeH, h, { shape: 'cone', taper: 0.72, role: 'shade', surface: 'lampshade', color: item.color ?? '#f3ead8' }),
  ];
}

function vase(w: number, d: number, h: number): FurniturePart[] {
  const r = Math.min(w, d) / 2;
  return [
    span(-r * 0.75, r * 0.75, -r * 0.75, r * 0.75, 0, h * 0.7, { shape: 'cone', taper: 1.3, role: 'pot', surface: 'body' }),
    span(-r * 0.45, r * 0.45, -r * 0.45, r * 0.45, h * 0.7, h, { shape: 'cone', taper: 0.9, role: 'pot', surface: 'body', shade: -0.05 }),
  ];
}

// ---------------------------------------------------------------------------

/** The parts that make up one piece, in its local frame (empty sizes dropped). */
export function furnitureParts(item: Item): FurniturePart[] {
  const parts = item.components?.length ? componentParts(item.components) : partsFor(item);
  return parts.filter((p) => p.width > 0.05 && p.depth > 0.05 && p.height > 0.05);
}

const COMPONENT_ROLES: Record<ComponentType, PartRole> = {
  base: 'frame',
  seat: 'seat',
  backrest: 'back',
  armrest: 'arm',
  cushion: 'cushion',
  pillow: 'pillow',
  headrest: 'cushion',
  leg: 'leg',
  foot: 'leg',
  tabletop: 'top',
  shelf: 'shelf',
  drawer: 'drawer',
  door: 'door',
  support: 'base',
  detail: 'frame',
  custom: 'frame',
  group: 'frame',
};

/**
 * Parts for a piece built from components (Advanced Furniture Builder). Unlike the built-in
 * designs these follow the person's components exactly, even where they reach past the
 * footprint (the builder warns about that).
 */
export function componentParts(components: readonly FurnitureComponent[]): FurniturePart[] {
  const parts: FurniturePart[] = [];
  for (const placed of placeComponents(components)) {
    const c = placed.component;
    const radius = Math.max(0, c.radius ?? 0);
    const look: Partial<FurniturePart> = {
      role: COMPONENT_ROLES[c.type],
      surface: c.material ?? 'body',
      ...(c.color ? { color: c.color } : {}),
      ...(c.finish ? { finish: c.finish } : {}),
      ...(c.roughness !== undefined ? { roughness: c.roughness } : {}),
      ...(c.textureScale !== undefined && c.textureScale !== 1 ? { textureScale: c.textureScale } : {}),
      ...(c.pattern && c.pattern !== 'plain' ? { pattern: c.pattern } : {}),
      ...(c.seams && c.seams !== 'none' ? { seams: c.seams } : {}),
      ...(c.tilt ? { tilt: c.tilt } : {}),
      ...(placed.yaw ? { yaw: placed.yaw } : {}),
    };
    const at = { x: placed.x, y: placed.y, z: placed.z, height: c.height };
    const bevel = c.edgeStyle === 'bevel' ? ('chamfer' as const) : undefined;
    let outline = placed.outline;
    // A bevelled box is drawn as a prism (rounded boxes have their own geometry).
    if (!outline && c.shape === 'box' && bevel && radius > 0) outline = rectOutline(c.width, c.depth);
    if (outline && outline.length >= 3) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const q of outline) {
        minX = Math.min(minX, q.x);
        maxX = Math.max(maxX, q.x);
        minY = Math.min(minY, q.y);
        maxY = Math.max(maxY, q.y);
      }
      const r = c.edgeStyle === 'square' ? 0 : Math.min(radius, (maxX - minX) / 2, (maxY - minY) / 2, c.height / 2);
      parts.push({ ...at, width: maxX - minX, depth: maxY - minY, shape: 'prism', outline, radius: r, ...(bevel ? { bevel } : {}), ...look } as FurniturePart);
      continue;
    }
    const base = { ...at, width: c.width, depth: c.depth, ...look };
    switch (c.shape) {
      case 'cylinder':
        parts.push({ ...base, shape: c.taper !== undefined && c.taper !== 1 ? 'cone' : 'cylinder', ...(c.taper !== undefined && c.taper !== 1 ? { taper: c.taper } : {}) } as FurniturePart);
        break;
      case 'ellipsoid':
        parts.push({ ...base, shape: 'ellipsoid' } as FurniturePart);
        break;
      default:
        parts.push({ ...base, shape: 'rounded', radius: c.edgeStyle === 'square' ? 0 : Math.min(radius, c.width / 2, c.depth / 2, c.height / 2) } as FurniturePart);
    }
  }
  return parts;
}

const rectOutline = (w: number, d: number): Point[] => [
  { x: -w / 2, y: -d / 2 },
  { x: w / 2, y: -d / 2 },
  { x: w / 2, y: d / 2 },
  { x: -w / 2, y: d / 2 },
];

function partsFor(item: Item): FurniturePart[] {
  const { width: w, depth: d, height: h } = item;
  const visual = visualOf(item);
  // Too small for detailed parts to fit: a simple rounded block keeps the real size.
  const tiny = visual !== 'rug' && (Math.min(w, d) < 15 || h < 8);
  switch (tiny ? 'block' : visual) {
    case 'rug':
      return [span(-w / 2, w / 2, -d / 2, d / 2, 0, Math.min(h, 1.5), rounded(0.5, 'rug'))];
    case 'sofa':
      return sofa(w, d, h, item);
    case 'armchair':
      return sofa(w, d, h, item, 1);
    case 'chair':
      return chair(w, d, h);
    case 'officeChair':
      return officeChair(w, d, h);
    case 'bed':
      return bed(w, d, h, item);
    case 'table':
    case 'coffeeTable':
    case 'diningTable':
      return table(w, d, h, visual);
    case 'desk':
      return desk(w, d, h);
    case 'bookshelf':
      return bookshelf(w, d, h, item);
    case 'cabinet':
    case 'wardrobe':
    case 'bedsideTable':
      return cabinet(w, d, h, visual);
    case 'television':
      return television(w, d, h);
    case 'plant':
      return plant(w, d, h, item);
    case 'lamp':
      return lamp(w, d, h, item);
    case 'vase':
      return vase(w, d, h);
    case 'block':
      return [span(-w / 2, w / 2, -d / 2, d / 2, 0, h, rounded(Math.min(2, w / 10, d / 10), 'frame'))];
  }
}

/** A small stable number from a string (so each piece's books and leaves look its own). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The 8 corners of a part after its yaw and tilt (for bounds checks and tests). Leaves are
 * tilted about their own centre's x axis, then turned by yaw.
 */
export function partCorners(p: FurniturePart): { x: number; y: number; z: number }[] {
  const t = ((p.tilt ?? 0) * Math.PI) / 180;
  const yaw = ((p.yaw ?? 0) * Math.PI) / 180;
  const corners: { x: number; y: number; z: number }[] = [];
  const ring = p.shape === 'prism' && p.outline ? p.outline : [-0.5, 0.5].flatMap((sx) => [-0.5, 0.5].map((sy) => ({ x: sx * p.width, y: sy * p.depth })));
  for (const q of ring) {
    {
      for (const sz of [-0.5, 0.5]) {
        const lx = q.x;
        let ly = q.y;
        let lz = sz * p.height;
        // Tilt raises +y: rotate (y, z) by t.
        [ly, lz] = [ly * Math.cos(t) - lz * Math.sin(t), ly * Math.sin(t) + lz * Math.cos(t)];
        // Yaw, clockwise on the plan (as furniture rotation).
        const x = lx * Math.cos(yaw) - ly * Math.sin(yaw);
        const y = lx * Math.sin(yaw) + ly * Math.cos(yaw);
        corners.push({ x: p.x + x, y: p.y + y, z: p.z + p.height / 2 + lz });
      }
    }
  }
  return corners;
}
