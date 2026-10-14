import { componentId, scaleComponents, shiftComponents } from '../model/components';
import { normaliseShape } from '../model/shape';
import type { FurnitureComponent, FurnitureKind, FurnitureShape, MaterialKind, Point, ShapeVertex } from '../model/types';
import { footprintEdges, recomputeComponents } from './componentGeometry';

/**
 * Starting templates for the Advanced Furniture Builder, and the reusable generator behind
 * the upholstered ones. Every template is ordinary editable components on an ordinary
 * footprint: nothing about any particular person's furniture is built in.
 *
 * Sizes are typical retail dimensions, meant to be replaced by the person's measurements.
 */

export interface BuiltPiece {
  name: string;
  kind: FurnitureKind;
  width: number;
  depth: number;
  height: number;
  shape?: FurnitureShape;
  color: string;
  material: MaterialKind;
  components: FurnitureComponent[];
}

export type PresetId =
  | 'sofa'
  | 'loveseat'
  | 'deepLoveseat'
  | 'angledLoveseat'
  | 'wedgeLoveseat'
  | 'cornerSofa'
  | 'sectional'
  | 'chaise'
  | 'armchair'
  | 'ottoman'
  | 'roundOttoman'
  | 'roundTable'
  | 'ovalTable'
  | 'lDesk'
  | 'irregularCabinet';

export const PRESETS: { id: PresetId; label: string; hint: string }[] = [
  { id: 'sofa', label: 'Standard sofa', hint: '3 seats, arms, back cushions' },
  { id: 'loveseat', label: 'Loveseat', hint: '2 seats' },
  { id: 'deepLoveseat', label: 'Deep-seat loveseat', hint: 'Low, deep, one big cushion' },
  { id: 'angledLoveseat', label: 'Angled-back loveseat', hint: 'Back in two angled sections' },
  { id: 'wedgeLoveseat', label: 'Corner wedge loveseat', hint: 'Angled back, deep seat, cut front corner' },
  { id: 'cornerSofa', label: 'Corner sofa', hint: 'L-shaped, back on two sides' },
  { id: 'sectional', label: 'Sectional sofa', hint: 'L-shaped with a long side' },
  { id: 'chaise', label: 'Chaise lounge', hint: 'Back at one end' },
  { id: 'armchair', label: 'Armchair', hint: '1 seat' },
  { id: 'ottoman', label: 'Ottoman', hint: 'Upholstered, on legs' },
  { id: 'roundOttoman', label: 'Circular ottoman', hint: 'Tufted top' },
  { id: 'roundTable', label: 'Round table', hint: 'Pedestal base' },
  { id: 'ovalTable', label: 'Oval table', hint: 'Four legs' },
  { id: 'lDesk', label: 'L-shaped desk', hint: 'With a drawer pedestal' },
  { id: 'irregularCabinet', label: 'Irregular cabinet', hint: 'Angled sides, two doors' },
];

const pts = (list: number[][]): ShapeVertex[] => list.map(([x, y]) => ({ x, y }));
const KAPPA = 0.5523;

/** An ellipse as four curved edges (clockwise from the back). */
function ellipse(w: number, d: number): FurnitureShape {
  const a = w / 2;
  const b = d / 2;
  return {
    points: [
      { x: 0, y: -b, c1: { x: a * KAPPA, y: -b }, c2: { x: a, y: -b * KAPPA } },
      { x: a, y: 0, c1: { x: a, y: b * KAPPA }, c2: { x: a * KAPPA, y: b } },
      { x: 0, y: b, c1: { x: -a * KAPPA, y: b }, c2: { x: -a, y: b * KAPPA } },
      { x: -a, y: 0, c1: { x: -a, y: -b * KAPPA }, c2: { x: -a * KAPPA, y: -b } },
    ],
  };
}

// ---------------------------------------------------------------------------
// Upholstered pieces (any footprint)
// ---------------------------------------------------------------------------

export interface UpholsteryOptions {
  /** Footprint edges with a backrest section each (sections meeting at a corner are mitred). */
  backEdges: number[];
  /** Footprint edges with an armrest. */
  armEdges: number[];
  legHeight: number;
  /** Top of the upholstered base (the seat deck), cm above the floor. */
  deckHeight: number;
  seatThickness: number;
  backHeight: number;
  armHeight: number;
  backThickness: number;
  armThickness: number;
  /** Separate back cushions in front of each back section, this deep (0 = none). */
  backCushionDepth: number;
  /** Seat cushions, split across this edge (usually the front). */
  seatCushions: number;
  splitAlong: number;
  /** Accent pillows per back section. */
  pillows: number;
  /** Corner rounding of the upholstery, cm. */
  softness: number;
  /** Accent colour for pillows (missing = a soft sage). */
  accent?: string;
}

/** The interior angle at a footprint corner (degrees), between the edge arriving and the one leaving. */
function cornerAngle(edges: ReturnType<typeof footprintEdges>, corner: number): number {
  const n = edges.length;
  const arriving = edges[(corner - 1 + n) % n].points;
  const leaving = edges[corner].points;
  const a = arriving[arriving.length - 2];
  const v = leaving[0];
  const b = leaving[1];
  const u1 = { x: a.x - v.x, y: a.y - v.y };
  const u2 = { x: b.x - v.x, y: b.y - v.y };
  const cos = (u1.x * u2.x + u1.y * u2.y) / (Math.hypot(u1.x, u1.y) * Math.hypot(u2.x, u2.y) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/**
 * Upholstered seating on any footprint: a base filling the footprint, a backrest section
 * along each back edge and an arm along each arm edge (mitred where they meet), seat cushions
 * cut from what's left, optional back cushions and pillows, and legs. Bands and seats follow
 * the footprint, so editing the footprint's measurements reshapes them.
 */
export function upholster(piece: { width: number; depth: number; shape?: FurnitureShape }, o: UpholsteryOptions): FurnitureComponent[] {
  const edges = footprintEdges(piece);
  const n = edges.length;
  const list: FurnitureComponent[] = [];
  const add = (c: Omit<FurnitureComponent, 'id'>) => {
    const id = componentId(list);
    list.push({ ...c, id });
    return id;
  };
  const banded = new Set([...o.backEdges, ...o.armEdges].map((e) => ((e % n) + n) % n));
  const deckZ = o.legHeight;
  const deckH = Math.max(4, o.deckHeight - o.legHeight);
  const soft = o.softness;

  // Legs: short cylinders just inside the footprint's convex corners.
  if (o.legHeight > 0.5) {
    const group = add({ name: 'Legs', type: 'group', shape: 'box', x: 0, y: 0, z: 0, width: 1, depth: 1, height: 1, rotation: 0 });
    edges.forEach((edge, i) => {
      const angle = cornerAngle(edges, i);
      if (angle > 175 || edge.length < 20) return;
      const v = edge.points[0];
      // Step in along the corner's bisector.
      const prev = edges[(i - 1 + n) % n].points;
      const a = prev[prev.length - 2];
      const b = edge.points[1];
      const u1 = norm({ x: a.x - v.x, y: a.y - v.y });
      const u2 = norm({ x: b.x - v.x, y: b.y - v.y });
      const bis = norm({ x: u1.x + u2.x, y: u1.y + u2.y });
      const inset = 7 / Math.sin(((angle / 2) * Math.PI) / 180);
      if (cross(u1, u2) > 0) return; // a corner that turns inwards (concave): no leg there
      add({ name: `Leg ${i + 1}`, type: 'leg', parentId: group, shape: 'cylinder', x: round(v.x + bis.x * inset), y: round(v.y + bis.y * inset), z: 0, width: 5, depth: 5, height: o.legHeight, rotation: 0, taper: 0.75, material: 'wood', color: '#5b4636', finish: 'satin' });
    });
  }

  add({ name: 'Base', type: 'base', shape: 'footprint', x: 0, y: 0, z: deckZ, width: piece.width, depth: piece.depth, height: deckH, rotation: 0, inset: 0, radius: Math.min(soft, 3), seams: 'piped' });

  const backs: string[] = [];
  for (const e of o.backEdges) {
    const i = ((e % n) + n) % n;
    backs.push(
      add({
        name: o.backEdges.length > 1 ? `Backrest ${backs.length + 1}` : 'Backrest',
        type: 'backrest',
        shape: 'edge',
        x: 0,
        y: 0,
        z: deckZ,
        width: edges[i].length,
        depth: o.backThickness,
        height: Math.max(4, o.backHeight - deckZ),
        rotation: 0,
        radius: soft,
        edges: { from: i, to: i, startTrim: 0, endTrim: 0, inset: 0, thickness: o.backThickness, miterStart: banded.has((i - 1 + n) % n), miterEnd: banded.has((i + 1) % n) },
        seams: 'piped',
      }),
    );
  }
  const arms: string[] = [];
  for (const e of o.armEdges) {
    const i = ((e % n) + n) % n;
    arms.push(
      add({
        name: o.armEdges.length > 1 ? `Armrest ${arms.length + 1}` : 'Armrest',
        type: 'armrest',
        shape: 'edge',
        x: 0,
        y: 0,
        z: deckZ,
        width: edges[i].length,
        depth: o.armThickness,
        height: Math.max(4, o.armHeight - deckZ),
        rotation: 0,
        radius: soft * 1.2,
        edges: { from: i, to: i, startTrim: 0, endTrim: 0, inset: 0, thickness: o.armThickness, miterStart: banded.has((i - 1 + n) % n), miterEnd: banded.has((i + 1) % n) },
        seams: 'piped',
      }),
    );
  }
  const backCushions: string[] = [];
  if (o.backCushionDepth > 0) {
    for (const e of o.backEdges) {
      const i = ((e % n) + n) % n;
      // Stop short of an arm at either end (measured along this edge).
      const trimFor = (corner: number, armEdge: number) => (o.armEdges.some((a) => ((a % n) + n) % n === armEdge) ? o.armThickness / Math.max(0.2, Math.sin((cornerAngle(edges, corner) * Math.PI) / 180)) + 1 : 0);
      backCushions.push(
        add({
          name: 'Back cushion',
          type: 'cushion',
          shape: 'edge',
          x: 0,
          y: 0,
          z: o.deckHeight,
          width: edges[i].length,
          depth: o.backCushionDepth,
          height: Math.max(4, o.backHeight - o.deckHeight - 3),
          rotation: 0,
          radius: Math.min(soft * 1.6, o.backCushionDepth / 2),
          edges: { from: i, to: i, startTrim: trimFor(i, (i - 1 + n) % n), endTrim: trimFor((i + 1) % n, (i + 1) % n), inset: o.backThickness + 0.5, thickness: o.backCushionDepth, miterStart: o.backEdges.some((b) => ((b % n) + n) % n === (i - 1 + n) % n), miterEnd: o.backEdges.some((b) => ((b % n) + n) % n === (i + 1) % n) },
          seams: 'piped',
        }),
      );
    }
  }
  const count = Math.max(1, Math.round(o.seatCushions));
  for (let k = 0; k < count; k++) {
    add({
      name: count > 1 ? `Seat cushion ${k + 1}` : 'Seat cushion',
      type: 'cushion',
      shape: 'footprint',
      x: 0,
      y: 0,
      z: o.deckHeight,
      width: piece.width,
      depth: piece.depth,
      height: o.seatThickness,
      rotation: 0,
      inset: 1,
      cut: [...backs, ...arms, ...backCushions],
      radius: Math.min(soft * 1.6, o.seatThickness / 2),
      seams: 'piped',
      ...(count > 1 ? { split: { along: o.splitAlong, count, index: k, gap: 1 } } : {}),
    });
  }
  // Pillows lean against each back section, facing into the seat.
  if (o.pillows > 0) {
    for (const e of o.backEdges) {
      const edge = edges[((e % n) + n) % n];
      const a = edge.points[0];
      const b = edge.points[edge.points.length - 1];
      const u = norm({ x: b.x - a.x, y: b.y - a.y });
      const inward = { x: -u.y, y: u.x };
      const into = o.backThickness + o.backCushionDepth + 9;
      const size = Math.min(45, Math.max(30, (o.backHeight - o.deckHeight) * 0.9));
      for (let k = 0; k < o.pillows; k++) {
        const t = (k + 1) / (o.pillows + 1);
        // Pillows sit towards the ends of a section, where they're usually placed.
        const along = o.pillows === 1 ? 0.5 : t < 0.5 ? 0.22 : 0.78;
        const cx = a.x + (b.x - a.x) * along + inward.x * into;
        const cy = a.y + (b.y - a.y) * along + inward.y * into;
        add({
          name: 'Pillow',
          type: 'pillow',
          shape: 'ellipsoid',
          x: round(cx),
          y: round(cy),
          z: o.deckHeight + o.seatThickness - 3,
          width: round(size),
          depth: 14,
          // Leaning back raises the top a little: keep it below the backrest.
          height: round(Math.max(12, Math.min(size * 0.85, o.backHeight - (o.deckHeight + o.seatThickness - 3) - 6))),
          rotation: round((((Math.atan2(u.y, u.x) * 180) / Math.PI) % 360 + 360) % 360),
          tilt: 14,
          material: 'linen',
          color: o.accent ?? '#9aa58a',
          seams: 'piped',
        });
      }
    }
  }
  return list;
}

const norm = (v: Point) => {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
};
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
// `|| 0` turns −0 into 0, so saved data reads back identically.
const round = (v: number) => Math.round(v * 100) / 100 || 0;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const SOFA_COLOUR = '#e2d9c8';

function seating(name: string, kind: FurnitureKind, width: number, depth: number, height: number, shape: FurnitureShape | undefined, options: Partial<UpholsteryOptions>): BuiltPiece {
  const o: UpholsteryOptions = {
    backEdges: [0],
    armEdges: [1, 3],
    legHeight: 8,
    deckHeight: 38,
    seatThickness: 12,
    backHeight: height,
    armHeight: Math.min(height - 4, 62),
    backThickness: 16,
    armThickness: 18,
    backCushionDepth: 16,
    seatCushions: 1,
    splitAlong: 2,
    pillows: 0,
    softness: 4,
    ...options,
  };
  // Re-centre the footprint first, so pillows (placed from its edges) land in the right frame.
  const normal = shape ? normaliseShape(shape) : null;
  const footprint = normal ? { width: normal.width, depth: normal.depth, shape: normal.shape } : { width, depth };
  return finish({ name, kind, height, color: SOFA_COLOUR, material: 'fabric', ...footprint, components: upholster(footprint, o) });
}

/** Normalises the footprint (clockwise, centred) and computes every band and seat outline. */
function finish(piece: BuiltPiece): BuiltPiece {
  let { shape, width, depth, components } = piece;
  if (shape) {
    const normal = normaliseShape(shape);
    shape = normal.shape;
    width = normal.width;
    depth = normal.depth;
    components = shiftComponents(components, -normal.shift.x, -normal.shift.y);
  }
  ({ components } = recomputeComponents({ width, depth, shape, components }));
  return { ...piece, shape, width, depth, components };
}

/** A piece's own footprint and height, to build a template onto instead of the template's sizes. */
export interface KeepFootprint {
  width: number;
  depth: number;
  height: number;
  shape?: FurnitureShape;
}

const SEATING: PresetId[] = ['sofa', 'loveseat', 'deepLoveseat', 'angledLoveseat', 'wedgeLoveseat', 'cornerSofa', 'sectional', 'chaise', 'armchair'];

/**
 * A template. With `keep`, it's built onto that footprint and height instead (the person's
 * own measurements): upholstered templates are regenerated for the footprint; others are
 * stretched to it.
 */
export function buildPreset(id: PresetId, keep?: KeepFootprint): BuiltPiece {
  const template = presetAtTemplateSize(id);
  if (!keep) return template;
  if (SEATING.includes(id)) {
    const n = keep.shape?.points.length ?? 4;
    const choice = SEATING_EDGES[id];
    // Edge choices that suit the person's footprint (by number of sides).
    const edges = choice(n);
    const o = PRESET_OPTIONS[id] ?? {};
    return seating(template.name, template.kind, keep.width, keep.depth, keep.height, keep.shape, { ...o, ...edges, backHeight: keep.height, armHeight: Math.min(keep.height - 4, o.armHeight ?? 62) });
  }
  const sx = keep.width / template.width;
  const sy = keep.depth / template.depth;
  const sz = keep.height / template.height;
  return finish({ ...template, width: keep.width, depth: keep.depth, height: keep.height, shape: keep.shape, components: scaleComponents(template.components, sx, sy, sz) });
}

/** Which footprint edges get backs and arms, for a footprint with `n` sides. */
const SEATING_EDGES: Record<string, (n: number) => Partial<UpholsteryOptions>> = {
  sofa: () => ({ backEdges: [0], armEdges: [1, 3] }),
  loveseat: () => ({ backEdges: [0], armEdges: [1, 3] }),
  deepLoveseat: () => ({ backEdges: [0], armEdges: [1, 3] }),
  armchair: () => ({ backEdges: [0], armEdges: [1, 3] }),
  chaise: () => ({ backEdges: [3], armEdges: [0] }),
  // Two back sections need at least five sides; otherwise one back along edge 1.
  angledLoveseat: (n) => (n >= 5 ? { backEdges: [0, 1], armEdges: [2, n - 1] } : { backEdges: [0], armEdges: [1, 3] }),
  // Two back sections (an angled one and one along the wall) on a six-sided footprint; no arms.
  wedgeLoveseat: (n) => (n >= 6 ? { backEdges: [0, 1], armEdges: [] } : { backEdges: [0], armEdges: [] }),
  cornerSofa: (n) => (n >= 6 ? { backEdges: [0, n - 1], armEdges: [1, n - 2] } : { backEdges: [0, 3], armEdges: [1, 2] }),
  sectional: (n) => (n >= 6 ? { backEdges: [0], armEdges: [1, n - 1] } : { backEdges: [0], armEdges: [1, 3] }),
};

/** The upholstery choices of each seating template (besides its edges). */
const PRESET_OPTIONS: Partial<Record<PresetId, Partial<UpholsteryOptions>>> = {
  sofa: { seatCushions: 3, pillows: 2 },
  loveseat: { seatCushions: 2, pillows: 2 },
  deepLoveseat: { deckHeight: 30, seatThickness: 14, backThickness: 24, armThickness: 22, armHeight: 56, backCushionDepth: 0, legHeight: 3, softness: 7, pillows: 1 },
  angledLoveseat: { deckHeight: 32, seatThickness: 14, backThickness: 22, armThickness: 20, armHeight: 58, backCushionDepth: 0, legHeight: 3, softness: 7, pillows: 1 },
  wedgeLoveseat: { deckHeight: 30, seatThickness: 15, backThickness: 16, backCushionDepth: 20, legHeight: 2, softness: 7, pillows: 0, armHeight: 60 },
  cornerSofa: { seatCushions: 2, splitAlong: 2, pillows: 1 },
  sectional: { seatCushions: 3, splitAlong: 5, pillows: 2 },
  chaise: { backHeight: 80, armHeight: 55, backCushionDepth: 0, seatThickness: 10, deckHeight: 34, backThickness: 18, armThickness: 12 },
  armchair: { seatCushions: 1, pillows: 1 },
};

function presetAtTemplateSize(id: PresetId): BuiltPiece {
  switch (id) {
    case 'sofa':
      return seating('Sofa', 'sofa', 210, 92, 82, undefined, { seatCushions: 3, pillows: 2 });
    case 'loveseat':
      return seating('Loveseat', 'sofa', 150, 88, 80, undefined, { seatCushions: 2, pillows: 2 });
    case 'deepLoveseat':
      // Low and deep: no separate back cushions, one large seat cushion.
      return seating('Deep-seat loveseat', 'sofa', 170, 105, 72, undefined, { deckHeight: 30, seatThickness: 14, backThickness: 24, armThickness: 22, armHeight: 56, backCushionDepth: 0, legHeight: 3, softness: 7, pillows: 1 });
    case 'angledLoveseat': {
      // The back is two sections meeting at an angle; arms on the short sides.
      const shape: FurnitureShape = { points: pts([[-88, -12], [0, -48], [88, -12], [80, 48], [-80, 48]]) };
      return seating('Angled-back loveseat', 'sofa', 176, 96, 74, shape, { backEdges: [0, 1], armEdges: [2, 4], deckHeight: 32, seatThickness: 14, backThickness: 22, armThickness: 20, armHeight: 58, backCushionDepth: 0, legHeight: 3, softness: 7, pillows: 1 });
    }
    case 'wedgeLoveseat': {
      // A corner wedge: an angled back section on the left meeting a straight back along the
      // wall, a deep seat, a cut front-left corner and a short left side. Typical sizes only.
      const shape: FurnitureShape = { points: pts([[-90, -10], [-35, -60], [90, -60], [90, 60], [-45, 60], [-90, 20]]) };
      const piece = seating('Corner wedge loveseat', 'sofa', 180, 120, 76, shape, { backEdges: [0, 1], armEdges: [], ...PRESET_OPTIONS.wedgeLoveseat });
      return { ...piece, color: '#5b3b33', material: 'velvet' };
    }
    case 'cornerSofa': {
      const shape: FurnitureShape = { points: pts([[-125, -110], [125, -110], [125, -15], [-30, -15], [-30, 110], [-125, 110]]) };
      return seating('Corner sofa', 'sofa', 250, 220, 80, shape, { backEdges: [0, 5], armEdges: [1, 4], seatCushions: 2, splitAlong: 2, pillows: 1 });
    }
    case 'sectional': {
      const shape: FurnitureShape = { points: pts([[-150, -80], [150, -80], [150, 85], [70, 85], [70, 10], [-150, 10]]) };
      return seating('Sectional sofa', 'sofa', 300, 165, 82, shape, { backEdges: [0], armEdges: [1, 5], seatCushions: 3, splitAlong: 5, pillows: 2 });
    }
    case 'chaise':
      return seating('Chaise lounge', 'sofa', 170, 72, 80, undefined, { backEdges: [3], armEdges: [0], backHeight: 80, armHeight: 55, backCushionDepth: 0, seatThickness: 10, deckHeight: 34, backThickness: 18, armThickness: 12 });
    case 'armchair':
      return seating('Armchair', 'armchair', 86, 86, 80, undefined, { seatCushions: 1, pillows: 1 });
    case 'ottoman': {
      const components: FurnitureComponent[] = [];
      const add = (c: Omit<FurnitureComponent, 'id'>) => components.push({ ...c, id: componentId(components) });
      add({ name: 'Base', type: 'base', shape: 'box', x: 0, y: 0, z: 10, width: 80, depth: 60, height: 22, rotation: 0, radius: 3, seams: 'piped' });
      add({ name: 'Cushion top', type: 'cushion', shape: 'box', x: 0, y: 0, z: 32, width: 80, depth: 60, height: 10, rotation: 0, radius: 4, seams: 'piped' });
      for (const [x, y] of [[-34, -24], [34, -24], [-34, 24], [34, 24]]) add({ name: 'Leg', type: 'leg', shape: 'cylinder', x, y, z: 0, width: 5, depth: 5, height: 10, rotation: 0, taper: 0.75, material: 'wood', color: '#5b4636' });
      return { name: 'Ottoman', kind: 'decor', width: 80, depth: 60, height: 42, color: SOFA_COLOUR, material: 'fabric', components };
    }
    case 'roundOttoman': {
      const components: FurnitureComponent[] = [];
      const add = (c: Omit<FurnitureComponent, 'id'>) => components.push({ ...c, id: componentId(components) });
      add({ name: 'Base', type: 'base', shape: 'cylinder', x: 0, y: 0, z: 0, width: 70, depth: 70, height: 32, rotation: 0, seams: 'piped' });
      add({ name: 'Tufted top', type: 'cushion', shape: 'cylinder', x: 0, y: 0, z: 32, width: 70, depth: 70, height: 10, rotation: 0, seams: 'tufted', material: 'velvet' });
      return { name: 'Circular ottoman', kind: 'decor', width: 70, depth: 70, height: 42, color: '#a3b094', material: 'velvet', components };
    }
    case 'roundTable': {
      const components: FurnitureComponent[] = [];
      const add = (c: Omit<FurnitureComponent, 'id'>) => components.push({ ...c, id: componentId(components) });
      add({ name: 'Foot', type: 'foot', shape: 'cylinder', x: 0, y: 0, z: 0, width: 52, depth: 52, height: 4, rotation: 0, taper: 0.85 });
      add({ name: 'Pedestal', type: 'support', shape: 'cylinder', x: 0, y: 0, z: 4, width: 12, depth: 12, height: 68, rotation: 0, taper: 1.3 });
      add({ name: 'Tabletop', type: 'tabletop', shape: 'cylinder', x: 0, y: 0, z: 72, width: 110, depth: 110, height: 3.5, rotation: 0 });
      return { name: 'Round table', kind: 'diningTable', width: 110, depth: 110, height: 75.5, color: '#c9a77c', material: 'wood', components };
    }
    case 'ovalTable': {
      const shape = ellipse(200, 100);
      const components: FurnitureComponent[] = [];
      const add = (c: Omit<FurnitureComponent, 'id'>) => components.push({ ...c, id: componentId(components) });
      add({ name: 'Tabletop', type: 'tabletop', shape: 'footprint', x: 0, y: 0, z: 72, width: 200, depth: 100, height: 3.5, rotation: 0, inset: 0, radius: 1, edgeStyle: 'bevel' });
      add({ name: 'Apron', type: 'support', shape: 'box', x: 0, y: 0, z: 64, width: 130, depth: 60, height: 8, rotation: 0, radius: 1 });
      for (const [x, y] of [[-60, -26], [60, -26], [-60, 26], [60, 26]]) add({ name: 'Leg', type: 'leg', shape: 'cylinder', x, y, z: 0, width: 6, depth: 6, height: 72, rotation: 0, taper: 0.7 });
      return finish({ name: 'Oval table', kind: 'diningTable', width: 200, depth: 100, height: 75.5, shape, color: '#c9a77c', material: 'wood', components });
    }
    case 'lDesk': {
      const shape: FurnitureShape = { points: pts([[-80, -70], [80, -70], [80, 70], [20, 70], [20, -10], [-80, -10]]) };
      const components: FurnitureComponent[] = [];
      const add = (c: Omit<FurnitureComponent, 'id'>) => {
        const id = componentId(components);
        components.push({ ...c, id });
        return id;
      };
      add({ name: 'Desktop', type: 'tabletop', shape: 'footprint', x: 0, y: 0, z: 72, width: 160, depth: 140, height: 3, rotation: 0, inset: 0, radius: 0.6 });
      add({ name: 'End panel', type: 'support', shape: 'box', x: -78, y: -40, z: 0, width: 3, depth: 56, height: 72, rotation: 0 });
      add({ name: 'End panel', type: 'support', shape: 'box', x: 50, y: 68, z: 0, width: 56, depth: 3, height: 72, rotation: 0 });
      const ped = add({ name: 'Drawer pedestal', type: 'group', shape: 'box', x: 58, y: -45, z: 0, width: 1, depth: 1, height: 1, rotation: 0 });
      add({ name: 'Carcass', type: 'base', parentId: ped, shape: 'box', x: 0, y: 0, z: 0, width: 40, depth: 46, height: 70, rotation: 0, radius: 0.5 });
      for (let k = 0; k < 3; k++) {
        const z = 4 + k * 22;
        const d = add({ name: `Drawer ${k + 1}`, type: 'drawer', parentId: ped, shape: 'box', x: 0, y: 22.2, z, width: 37, depth: 1.6, height: 20, rotation: 0, radius: 0.4 });
        add({ name: 'Handle', type: 'detail', parentId: d, shape: 'box', x: 0, y: 0, z: 14, width: 12, depth: 1.4, height: 1.2, rotation: 0, material: 'metal', color: '#b08d57', radius: 0.5 });
      }
      return finish({ name: 'L-shaped desk', kind: 'desk', width: 160, depth: 140, height: 75, shape, color: '#c9a77c', material: 'wood', components });
    }
    case 'irregularCabinet': {
      const shape: FurnitureShape = { points: pts([[-50, -22], [50, -22], [60, 22], [-60, 22]]) };
      const components: FurnitureComponent[] = [];
      const add = (c: Omit<FurnitureComponent, 'id'>) => {
        const id = componentId(components);
        components.push({ ...c, id });
        return id;
      };
      add({ name: 'Plinth', type: 'base', shape: 'footprint', x: 0, y: 0, z: 0, width: 120, depth: 44, height: 6, rotation: 0, inset: 3, color: '#3f362e' });
      add({ name: 'Carcass', type: 'base', shape: 'footprint', x: 0, y: 0, z: 6, width: 120, depth: 44, height: 72, rotation: 0, inset: 0, radius: 0.5 });
      add({ name: 'Top', type: 'tabletop', shape: 'footprint', x: 0, y: 0, z: 78, width: 120, depth: 44, height: 2.5, rotation: 0, inset: 0, radius: 0.8, edgeStyle: 'bevel', material: 'stone', color: '#ece8e1' });
      for (const [x, name] of [[-27, 'Left door'], [27, 'Right door']] as const) {
        const door = add({ name, type: 'door', shape: 'box', x, y: 20.5, z: 10, width: 52, depth: 1.8, height: 64, rotation: 0, radius: 0.3 });
        add({ name: 'Handle', type: 'detail', parentId: door, shape: 'cylinder', x: x < 0 ? 22 : -22, y: 0, z: 36, width: 1.4, depth: 1.4, height: 14, rotation: 0, material: 'metal', color: '#b08d57' });
      }
      return finish({ name: 'Irregular cabinet', kind: 'cabinet', width: 120, depth: 44, height: 80.5, shape, color: '#7a5a43', material: 'wood', components });
    }
  }
}
