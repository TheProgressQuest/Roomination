import { buildPreset, type PresetId } from '../builder/furniturePresets';
import { curvedOutline, recomputeComponents } from '../builder/componentGeometry';
import { componentExtent } from '../model/components';
import { normaliseShape } from '../model/shape';
import type { FurnitureKind, FurnitureLight, FurnitureShape, FurnitureTexture, MaterialKind, ShapeVertex, SurfaceFinish } from '../model/types';
import type { FurnitureTemplate } from '../storage/projectFile';
import { Kit } from './kit';

/**
 * Roomination's furniture catalogue: ready-made pieces in typical real-world sizes, each
 * drawn by the same 2D/3D system as everything else. Familiar pieces use the built-in
 * designs; fixtures, appliances, outdoor and special pieces are built from components, so
 * they can be opened in the Advanced Furniture Builder and changed.
 *
 * Nothing here comes from another product's catalogue: shapes are generic, sizes typical.
 */

export type CatalogueCategory = 'living' | 'dining' | 'bedroom' | 'office' | 'kitchen' | 'bathroom' | 'laundry' | 'sauna' | 'outdoor' | 'lighting' | 'decor' | 'rugs';

export const CATEGORY_LABELS: Record<CatalogueCategory, string> = {
  living: 'Living room',
  dining: 'Dining',
  bedroom: 'Bedroom',
  office: 'Office',
  kitchen: 'Kitchen',
  bathroom: 'Bathroom',
  laundry: 'Laundry',
  sauna: 'Sauna',
  outdoor: 'Outdoor',
  lighting: 'Lighting',
  decor: 'Décor & plants',
  rugs: 'Rugs',
};

export interface CatalogueItem {
  id: string;
  name: string;
  category: CatalogueCategory;
  /** Extra words people might search for. */
  tags: string;
  /** Builds the piece (lazily: component items do some geometry). */
  make: () => FurnitureTemplate;
}

// Natural palette (matches the app's furniture colours).
const OATMEAL = '#e2d9c8';
const LINEN = '#ece6da';
const SAGE = '#a3b094';
const OAK = '#c9a77c';
const WALNUT = '#7a5a43';
const TERRACOTTA = '#c98a6b';
const MIST = '#a7b7c4';
const CHARCOAL = '#4b4d52';
const COGNAC = '#9a5b34';
const WHITE = '#f2f0eb';
const CERAMIC = '#f5f4f1';
const STEEL = '#c6c9cd';
const BLACK = '#1f2124';
const MARBLE = '#ece8e1';
const TEAK = '#a87a52';
const BRASS = '#b08d57';
const WATER = '#6fb3bf';

type Base = { kind: FurnitureKind; width: number; depth: number; height: number; color: string; /** Mounted this far above the floor (cm). */ elevation?: number; /** The light it gives, for light fittings. */ light?: FurnitureLight; material?: MaterialKind; finish?: SurfaceFinish; category?: FurnitureTemplate['category']; texture?: FurnitureTexture; shape?: FurnitureShape };

function template(name: string, b: Base, components?: Kit): FurnitureTemplate {
  let shape = b.shape;
  let { width, depth } = b;
  if (shape) {
    const n = normaliseShape(shape);
    shape = n.shape;
    width = n.width;
    depth = n.depth;
  }
  const t: FurnitureTemplate = {
    name,
    category: b.category ?? 'furniture',
    kind: b.kind,
    width,
    depth,
    height: b.height,
    color: b.color,
    texture: b.texture ?? 'plain',
    ...(b.elevation ? { elevation: b.elevation } : {}),
    ...(b.light ? { light: b.light } : {}),
    ...(shape ? { shape } : {}),
    ...(b.material ? { appearance: { material: b.material, finish: b.finish ?? 'satin' } } : {}),
  };
  if (components) {
    // A light's shades, diffusers and bulbs glow while it's on.
    const list = b.light ? components.list.map((c) => (GLOWING.has(c.name) ? { ...c, glow: true } : c)) : components.list;
    t.components = recomputeComponents({ width, depth, shape, components: list }).components;
    // The overall height is the tallest component (a tap rises above a worktop).
    t.height = Math.max(1, Math.round(componentExtent({ width, depth, shape, components: t.components }).top * 10) / 10);
  }
  return t;
}

const GLOWING = new Set(['Shade', 'Diffuser', 'Bulb']);

/** Typical light output: a lamp or sconce, a vanity bar, a bright multi-bulb bar. */
const lamp = (lumens: number, direction: FurnitureLight['direction'] = 'all'): FurnitureLight => ({ on: true, lumens, kelvin: 3000, direction });

/** A built-in design (drawn from its kind and name). */
const simple = (id: string, name: string, category: CatalogueCategory, tags: string, b: Base): CatalogueItem => ({ id, name, category, tags, make: () => template(name, b) });

/** A component-built piece. */
const built = (id: string, name: string, category: CatalogueCategory, tags: string, b: Base, build: (k: Kit, b: Base) => void): CatalogueItem => ({
  id,
  name,
  category,
  tags,
  make: () => {
    const k = new Kit();
    build(k, b);
    return template(name, b, k);
  },
});

/** A builder template (sofas and tables with editable components). */
const preset = (id: string, presetId: PresetId, category: CatalogueCategory, tags: string, name?: string): CatalogueItem => ({
  id,
  name: name ?? '',
  category,
  tags,
  make: () => {
    const p = buildPreset(presetId);
    return { name: name ?? p.name, category: 'furniture', kind: p.kind, width: p.width, depth: p.depth, height: p.height, color: p.color, texture: 'plain', ...(p.shape ? { shape: p.shape } : {}), appearance: { material: p.material, finish: 'matte' }, components: p.components };
  },
});

const ellipse = (w: number, d: number): FurnitureShape => {
  const a = w / 2;
  const b = d / 2;
  const k = 0.5523;
  return {
    points: [
      { x: 0, y: -b, c1: { x: a * k, y: -b }, c2: { x: a, y: -b * k } },
      { x: a, y: 0, c1: { x: a, y: b * k }, c2: { x: a * k, y: b } },
      { x: 0, y: b, c1: { x: -a * k, y: b }, c2: { x: -a, y: b * k } },
      { x: -a, y: 0, c1: { x: -a, y: -b * k }, c2: { x: -a * k, y: -b } },
    ] as ShapeVertex[],
  };
};

// ---------------------------------------------------------------------------
// Builders for fixtures and special pieces
// ---------------------------------------------------------------------------

/** Kitchen base unit: plinth, carcass, fronts and a stone worktop (90 cm high, 60 deep). */
function baseUnit(k: Kit, b: Base, fronts: 'doors' | 'drawers' | 'oven' | 'dishwasher' | 'none' = 'doors') {
  const { width: w, depth: d } = b;
  k.span('base', 'Plinth', -w / 2 + 1, w / 2 - 1, -d / 2 + 2, d / 2 - 6, 0, 10, { color: '#2e2f33' });
  k.span('base', 'Carcass', -w / 2, w / 2, -d / 2, d / 2 - 4.3, 10, 86, { color: b.color, radius: 0.3 });
  const z0 = 11;
  const z1 = 85;
  if (fronts === 'doors') k.fronts('door', w, d, z0, z1, w > 50 ? 2 : 1, { color: b.color, handle: 'bar', handleColor: BRASS });
  else if (fronts === 'drawers') {
    const third = (z1 - z0) / 3;
    for (let i = 0; i < 3; i++) k.fronts('drawer', w, d, z0 + i * third + 0.3, z0 + (i + 1) * third - 0.3, 1, { color: b.color, handle: 'bar', handleColor: BRASS });
  } else if (fronts === 'oven') {
    k.fronts('door', w, d, z0, z0 + 14, 1, { color: b.color, handle: 'none' });
    const door = k.box('door', 'Oven door', 0, d / 2 - 3.4, z0 + 15, w - 1, 1.8, 54, { color: BLACK, material: 'glass', finish: 'gloss', radius: 0.4 });
    k.box('detail', 'Oven handle', 0, 1.6, 48, w * 0.7, 2, 1.6, { parent: door, material: 'metal', color: STEEL, radius: 0.8 });
    k.box('detail', 'Controls', 0, d / 2 - 3.4, z0 + 70, w - 1, 1.8, 5, { color: '#2a2c30', radius: 0.3 });
  } else if (fronts === 'dishwasher') k.fronts('door', w, d, z0, z1, 1, { color: b.color, handle: 'bar', handleColor: BRASS });
  k.span('tabletop', 'Worktop', -w / 2, w / 2, -d / 2, d / 2, 86, 90, { material: 'stone', color: MARBLE, finish: 'satin', radius: 0.4, edge: 'bevel' });
}

function sink(k: Kit, b: Base, bowls: 1 | 2) {
  baseUnit(k, b, 'doors');
  const { width: w, depth: d } = b;
  const bw = bowls === 1 ? Math.min(55, w - 20) : Math.min(100, w - 20);
  k.box('detail', 'Sink', 0, 2, 89.4, bw, 44, 1.2, { material: 'metal', color: STEEL, finish: 'satin', radius: 4 });
  for (let i = 0; i < bowls; i++) {
    const x = bowls === 1 ? 0 : (i === 0 ? -1 : 1) * (bw / 4 + 1);
    k.box('detail', 'Bowl', x, 3, 89.6, bowls === 1 ? bw - 8 : bw / 2 - 6, 36, 1.2, { material: 'metal', color: '#a9adb2', finish: 'satin', radius: 5 });
    k.cyl('detail', 'Drain', x, 4, 89.9, 4, 4, 1, { material: 'metal', color: '#7d8186' });
  }
  k.cyl('detail', 'Tap', 0, -d / 2 + 8, 90, 5, 5, 26, { material: 'metal', color: STEEL, finish: 'gloss' });
  k.box('detail', 'Spout', 0, -d / 2 + 15, 112, 2.4, 16, 2.4, { material: 'metal', color: STEEL, finish: 'gloss', radius: 1 });
}

function hob(k: Kit, b: Base, gas: boolean) {
  baseUnit(k, b, 'drawers');
  const { width: w } = b;
  k.box('detail', 'Hob', 0, 1, 90, w - 8, 50, 0.6, { material: 'glass', color: BLACK, finish: 'gloss', radius: 1.5 });
  const pos = [
    [-w / 4 + 1, -11, 18],
    [w / 4 - 1, -11, 15],
    [-w / 4 + 1, 12, 15],
    [w / 4 - 1, 12, 21],
  ];
  for (const [x, y, s] of pos) {
    if (gas) {
      k.cyl('detail', 'Burner', x, y, 90.6, s, s, 1.4, { material: 'metal', color: '#2b2d31' });
      k.cyl('detail', 'Burner cap', x, y, 91.6, s * 0.45, s * 0.45, 0.8, { material: 'metal', color: '#16171a' });
    } else k.cyl('detail', 'Zone', x, y, 90.6, s, s, 0.1, { material: 'glass', color: '#34363b', finish: 'gloss' });
  }
}

function fridge(k: Kit, b: Base, sideBySide: boolean) {
  const { width: w, depth: d, height: h } = b;
  // Doors sit back from the front edge, so the handles stay inside the footprint.
  const fy = d / 2 - 4.2;
  // Appliance bodies are painted steel (satin plastic shading): polished metal reads black without reflections.
  k.span('base', 'Cabinet', -w / 2, w / 2, -d / 2, fy - 1, 0, h, { color: b.color, material: 'plastic', finish: 'satin', radius: 1.5 });
  if (sideBySide) {
    const left = k.box('door', 'Freezer door', -w / 4, fy, 2, w / 2 - 0.6, 2, h - 4, { color: b.color, material: 'plastic', finish: 'satin', radius: 0.8 });
    const right = k.box('door', 'Fridge door', w / 4, fy, 2, w / 2 - 0.6, 2, h - 4, { color: b.color, material: 'plastic', finish: 'satin', radius: 0.8 });
    k.box('detail', 'Handle', w / 4 - 3, 1.8, h * 0.3, 2, 2.4, h * 0.4, { parent: left, material: 'metal', color: STEEL, radius: 0.8 });
    k.box('detail', 'Handle', -w / 4 + 3, 1.8, h * 0.3, 2, 2.4, h * 0.4, { parent: right, material: 'metal', color: STEEL, radius: 0.8 });
  } else {
    const split = h * 0.62;
    const top = k.box('door', 'Fridge door', 0, fy, h - split, w - 1, 2, split - 2, { color: b.color, material: 'plastic', finish: 'satin', radius: 0.8 });
    const bottom = k.box('door', 'Freezer door', 0, fy, 2, w - 1, 2, h - split - 3, { color: b.color, material: 'plastic', finish: 'satin', radius: 0.8 });
    k.box('detail', 'Handle', w / 2 - 5, 1.8, 6, 2, 2.4, 36, { parent: top, material: 'metal', color: STEEL, radius: 0.8 });
    k.box('detail', 'Handle', w / 2 - 5, 1.8, (h - split) - 30, 2, 2.4, 24, { parent: bottom, material: 'metal', color: STEEL, radius: 0.8 });
  }
}

function tall(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  k.span('base', 'Plinth', -w / 2 + 1, w / 2 - 1, -d / 2 + 2, d / 2 - 6, 0, 10, { color: '#2e2f33' });
  k.span('base', 'Carcass', -w / 2, w / 2, -d / 2, d / 2 - 4.3, 10, h, { color: b.color, radius: 0.3 });
  k.fronts('door', w, d, 11, 11 + (h - 12) * 0.6, w > 50 ? 2 : 1, { color: b.color, handle: 'bar', handleColor: BRASS });
  k.fronts('door', w, d, 12 + (h - 12) * 0.6, h - 1, w > 50 ? 2 : 1, { color: b.color, handle: 'bar', handleColor: BRASS });
}

function island(k: Kit, b: Base) {
  const { width: w, depth: d } = b;
  const body = d - 28;
  // The carcass sits towards the front; the worktop overhangs at the back for stools.
  k.span('base', 'Plinth', -w / 2 + 3, w / 2 - 3, -d / 2 + 28 + 3, d / 2 - 6, 0, 10, { color: '#2e2f33' });
  k.span('base', 'Carcass', -w / 2 + 2, w / 2 - 2, d / 2 - body, d / 2 - 4.3, 10, 88, { color: b.color, radius: 0.3 });
  const n = Math.max(2, Math.round((w - 4) / 60));
  for (let i = 0; i < 3; i++) k.fronts('drawer', w - 4, d, 11 + i * 25.5, 11 + (i + 1) * 25.5 - 0.6, n, { color: b.color, handle: 'bar', handleColor: BRASS });
  k.span('tabletop', 'Worktop', -w / 2, w / 2, -d / 2, d / 2, 88, 92, { material: 'stone', color: MARBLE, finish: 'satin', radius: 0.6, edge: 'bevel' });
}

function toilet(k: Kit, b: Base, wallHung: boolean, bidet = false) {
  const { width: w, depth: d } = b;
  if (!bidet) {
    if (wallHung) k.span('base', 'Wall panel', -w / 2, w / 2, -d / 2, -d / 2 + 12, 0, 100, { color: WHITE, radius: 0.4 });
    else k.span('base', 'Cistern', -w / 2 + 1, w / 2 - 1, -d / 2, -d / 2 + 18, 40, 78, { material: 'ceramic', color: CERAMIC, finish: 'gloss', radius: 3 });
    k.cyl('detail', 'Flush', 0, -d / 2 + (wallHung ? 6 : 9), wallHung ? 100 : 78, 6, 6, 0.8, { material: 'metal', color: STEEL });
  }
  const bowlD = d - (bidet ? 4 : 20);
  const cy = d / 2 - bowlD / 2 - 1;
  if (!wallHung) k.cyl('base', 'Pedestal', 0, cy + 2, 0, w * 0.6, bowlD * 0.7, 30, { material: 'ceramic', color: CERAMIC, finish: 'gloss', taper: 1.3 });
  k.cyl('seat', 'Bowl', 0, cy, wallHung ? 22 : 28, w - 2, bowlD, 12, { material: 'ceramic', color: CERAMIC, finish: 'gloss', taper: 1.05 });
  if (bidet) {
    k.cyl('detail', 'Basin', 0, cy, 39.5, w - 10, bowlD - 10, 1, { material: 'ceramic', color: '#e4e2de', finish: 'gloss' });
    k.cyl('detail', 'Tap', 0, cy - bowlD / 2 + 6, 40, 3, 3, 8, { material: 'metal', color: STEEL });
  } else k.cyl('cushion', 'Seat and lid', 0, cy, wallHung ? 34 : 40, w - 3, bowlD - 1, 2.5, { material: 'ceramic', color: '#fbfaf8', finish: 'gloss' });
}

function vanity(k: Kit, b: Base, basins: 1 | 2) {
  const { width: w, depth: d } = b;
  k.span('base', 'Cabinet', -w / 2, w / 2, -d / 2, d / 2 - 4.3, 15, 80, { color: b.color, radius: 0.5 });
  k.fronts('drawer', w, d, 16, 47, 1, { color: b.color, handle: 'bar', handleColor: BRASS });
  k.fronts('drawer', w, d, 48, 79, 1, { color: b.color, handle: 'bar', handleColor: BRASS });
  k.span('tabletop', 'Top', -w / 2, w / 2, -d / 2, d / 2, 80, 85, { material: 'ceramic', color: CERAMIC, finish: 'gloss', radius: 1 });
  for (let i = 0; i < basins; i++) {
    const x = basins === 1 ? 0 : (i ? 1 : -1) * w / 4;
    k.box('detail', 'Basin', x, 2, 84.6, Math.min(48, w / basins - 12), d - 16, 0.6, { material: 'ceramic', color: '#e6e4e0', finish: 'gloss', radius: 8 });
    k.cyl('detail', 'Tap', x, -d / 2 + 6, 85, 3.5, 3.5, 18, { material: 'metal', color: STEEL, finish: 'gloss' });
    k.box('detail', 'Spout', x, -d / 2 + 10, 100, 2, 9, 2, { material: 'metal', color: STEEL, finish: 'gloss', radius: 0.8 });
  }
}

/**
 * A vanity: a cabinet with doors on a recessed plinth, a worktop at the piece's height, and an
 * integrated basin (set into the top) or a countertop basin (sitting on it), with a tap.
 */
function vanityTop(k: Kit, b: Base, basin: 'integrated' | 'countertop' | 'dropIn', worktop: { material: MaterialKind; color: string }, handle: 'bar' | 'knob' = 'bar') {
  const { width: w, depth: d, height: top } = b;
  k.span('base', 'Plinth', -w / 2 + 2, w / 2 - 2, -d / 2, d / 2 - 7, 0, 9, { color: shadeHex(b.color), radius: 0.3 });
  k.span('base', 'Cabinet', -w / 2, w / 2, -d / 2, d / 2 - 4.3, 9, top - 3, { color: b.color, radius: 0.4 });
  k.fronts('door', w, d, 9.5, top - 3.5, w > 70 ? 2 : 1, { color: b.color, handle, handleColor: STEEL });
  k.span('tabletop', 'Worktop', -w / 2, w / 2, -d / 2, d / 2, top - 3, top, { material: worktop.material, color: worktop.color, finish: 'gloss', radius: 0.6, edge: 'rounded' });
  const bw = Math.min(46, w - 14);
  const bd = Math.min(36, d - 14);
  if (basin === 'dropIn') {
    // An oval bowl set into the worktop: its glazed rim sits just proud of the top.
    k.cyl('detail', 'Basin rim', 0, 2, top - 0.2, bw + 6, bd + 6, 1.4, { material: 'ceramic', color: CERAMIC, finish: 'gloss' });
    k.cyl('detail', 'Basin', 0, 2, top + 1, bw, bd, 0.3, { material: 'ceramic', color: '#e4e2de', finish: 'gloss' });
    k.cyl('detail', 'Drain', 0, 3, top + 1.2, 3.2, 3.2, 0.2, { material: 'metal', color: '#8d9196' });
  } else if (basin === 'integrated') {
    k.box('detail', 'Basin', 0, 1.5, top - 0.3, bw, bd, 0.4, { material: 'ceramic', color: '#e4e2de', finish: 'gloss', radius: 9 });
    k.cyl('detail', 'Drain', 0, 2.5, top - 0.1, 3.2, 3.2, 0.3, { material: 'metal', color: '#8d9196' });
  } else {
    k.cyl('detail', 'Basin', 0, 2, top, bw * 0.92, bd, 13, { material: 'ceramic', color: CERAMIC, finish: 'gloss', taper: 1.18 });
    k.cyl('detail', 'Bowl', 0, 2, top + 12.7, bw * 0.8, bd - 5, 0.4, { material: 'ceramic', color: '#e4e2de', finish: 'gloss' });
  }
  const tapHeight = basin === 'countertop' ? 30 : 20;
  k.cyl('detail', 'Tap', 0, -d / 2 + 5, top, 3.4, 3.4, tapHeight, { material: 'metal', color: STEEL, finish: 'gloss' });
  k.box('detail', 'Spout', 0, -d / 2 + 9.5, top + tapHeight - 2.4, 2.2, 9, 2.2, { material: 'metal', color: STEEL, finish: 'gloss', radius: 1 });
  k.box('detail', 'Lever', 0, -d / 2 + 3, top + tapHeight - 1, 1.4, 5, 1.2, { material: 'metal', color: STEEL, finish: 'gloss', radius: 0.5 });
}

/** A wall mirror: a frame with a silvered pane on its front (rectangular or round). Back at −y, against the wall. */
function mirror(k: Kit, b: Base, round: boolean, frame: { material: MaterialKind; color: string } | null) {
  const { width: w, depth: d, height: h } = b;
  const inset = frame ? 2.5 : 0;
  // The glass stands proud of the frame at the front, so the two faces never fight for the same depth.
  const glassBack = frame ? d / 2 - 1 : -d / 2;
  if (round) {
    if (frame) k.soft('base', 'Frame', 0, -0.4, 0, w, d - 0.8, h, { material: frame.material, color: frame.color, finish: 'satin' });
    k.soft('detail', 'Mirror', 0, (glassBack + d / 2) / 2, inset, w - inset * 2, d / 2 - glassBack, h - inset * 2, { material: 'mirror', color: '#dfe6ea', finish: 'gloss' });
  } else {
    if (frame) k.span('base', 'Frame', -w / 2, w / 2, -d / 2, d / 2 - 0.6, 0, h, { material: frame.material, color: frame.color, finish: 'satin', radius: 0.3 });
    k.span('detail', 'Mirror', -w / 2 + inset, w / 2 - inset, glassBack, d / 2, inset, h - inset, { material: 'mirror', color: '#dfe6ea', finish: 'gloss', radius: frame ? 0 : 0.6 });
  }
}

/** A mirrored wall cabinet: a shallow box with a mirror door. */
function mirrorCabinet(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  k.span('base', 'Cabinet', -w / 2, w / 2, -d / 2, d / 2 - 1.6, 0, h, { color: b.color, radius: 0.4 });
  k.span('door', 'Mirror door', -w / 2 + 0.3, w / 2 - 0.3, d / 2 - 1.6, d / 2, 0.3, h - 0.3, { material: 'mirror', color: '#dfe6ea', finish: 'gloss', radius: 0.3 });
}

/** A wall cabinet with doors (hung above a toilet or a worktop). */
function wallCabinet(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  k.span('base', 'Cabinet', -w / 2, w / 2, -d / 2, d / 2 - 4.3, 0, h, { color: b.color, radius: 0.4 });
  k.fronts('door', w, d, 0.5, h - 0.5, w > 45 ? 2 : 1, { color: b.color, handle: 'knob', handleColor: STEEL });
}

/** Wall lights: a long bar over a mirror, or a sconce with a small shade. */
function wallLight(k: Kit, b: Base, style: 'bar' | 'sconce') {
  const { width: w, depth: d, height: h } = b;
  if (style === 'bar') {
    k.span('base', 'Backplate', -w / 2 + 2, w / 2 - 2, -d / 2, -d / 2 + 1.5, 0, h, { material: 'metal', color: STEEL, finish: 'satin', radius: 0.4 });
    k.span('detail', 'Diffuser', -w / 2, w / 2, -d / 2 + 1.5, d / 2, h * 0.15, h * 0.85, { material: 'plastic', color: '#fbf7ec', finish: 'satin', radius: Math.min(2.5, h * 0.3) });
  } else {
    k.span('base', 'Backplate', -w / 4, w / 4, -d / 2, -d / 2 + 1.5, h * 0.25, h * 0.75, { material: 'metal', color: BRASS, finish: 'satin', radius: 0.4 });
    k.span('support', 'Arm', -0.8, 0.8, -d / 2 + 1.5, d / 2 - w / 2, h * 0.45, h * 0.52, { material: 'metal', color: BRASS, finish: 'satin' });
    k.cyl('detail', 'Shade', 0, d / 2 - w / 2, h * 0.3, w, w, h * 0.7, { material: 'linen', color: '#f3ead8', taper: 0.75 });
  }
}

/** A row of wall lights on a bar: shades on short arms (a vanity light). */
function lightBar(k: Kit, b: Base, count: number) {
  const { width: w, depth: d, height: h } = b;
  k.span('base', 'Backplate', -6, 6, -d / 2, -d / 2 + 1.5, h * 0.25, h * 0.6, { material: 'metal', color: STEEL, finish: 'satin', radius: 0.4 });
  k.span('support', 'Bar', -w / 2, w / 2, -d / 2 + 1.5, -d / 2 + 4, h * 0.3, h * 0.42, { material: 'metal', color: STEEL, finish: 'gloss', radius: 0.8 });
  const shade = Math.min(12, (w / count) * 0.8);
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + shade / 2 + (i * (w - shade)) / Math.max(1, count - 1);
    k.span('support', 'Arm', x - 0.8, x + 0.8, -d / 2 + 2, d / 2 - shade / 2, h * 0.36, h * 0.42, { material: 'metal', color: STEEL, finish: 'gloss' });
    k.cyl('support', 'Cup', x, d / 2 - shade / 2, h * 0.36, 5, 5, 3, { material: 'metal', color: STEEL, finish: 'gloss' });
    k.cyl('detail', 'Shade', x, d / 2 - shade / 2, h * 0.42, shade, shade, h * 0.58, { material: 'plastic', color: '#f7f6f1', finish: 'satin' });
  }
}

/** A toilet roll on a holder mounted to a wall or cabinet side. */
function rollHolder(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  k.span('base', 'Mount', -2, 2, -d / 2, -d / 2 + 1.5, h * 0.3, h * 0.7, { material: 'metal', color: STEEL, finish: 'satin', radius: 0.6 });
  k.span('support', 'Arm', -w / 2, w / 2, -d / 2 + 1.5, -d / 2 + 3, h * 0.45, h * 0.55, { material: 'metal', color: STEEL, finish: 'gloss', radius: 0.5 });
  k.soft('cushion', 'Roll', 0, d / 2 - 5.5, 0, w - 1, 11, h, { material: 'cotton', color: '#f6f5f2' });
}

/** A wall pegboard with small shelves (for toiletries, tools or a desk). */
function pegboard(k: Kit, b: Base, shelves: number) {
  const { width: w, depth: d, height: h } = b;
  k.span('base', 'Board', -w / 2, w / 2, -d / 2, -d / 2 + 1.5, 0, h, { color: b.color, finish: 'matte', radius: 0.3 });
  for (let i = 0; i < shelves; i++) {
    const z = h * ((i + 0.6) / (shelves + 0.2));
    k.span('tabletop', 'Shelf', -w / 2 + 2, w / 2 - 2, -d / 2 + 1.5, d / 2, z, z + 1, { material: 'metal', color: '#222326', finish: 'satin' });
    k.span('detail', 'Lip', -w / 2 + 2, w / 2 - 2, d / 2 - 0.6, d / 2, z + 1, z + 3, { material: 'metal', color: '#222326', finish: 'satin' });
  }
}

/** A shower curtain on a rod: pleated fabric hanging from rings. */
function showerCurtain(k: Kit, b: Base, material: MaterialKind = 'cotton') {
  const { width: w, depth: d, height: h } = b;
  k.span('support', 'Rod', -w / 2, w / 2, -1.2, 1.2, h - 2.4, h, { material: 'metal', color: STEEL, finish: 'gloss', radius: 1.1 });
  const pleats = Math.max(4, Math.round(w / 9));
  const pw = w / pleats;
  for (let i = 0; i < pleats; i++) {
    const x = -w / 2 + pw / 2 + i * pw;
    // Folds alternate towards the front and the back of the curtain's depth.
    // Folds overlap their neighbours, except at the ends where they stop at the curtain's edge.
    const fw = Math.min(pw * 1.35, (w / 2 - Math.abs(x)) * 2);
    // Upright, elliptical pleats read as soft folds of hanging fabric.
    k.cyl('cushion', 'Fold', x, (i % 2 ? 1 : -1) * (d / 2 - 1.6), 0, fw, 3.2, h - 4, { material, color: b.color });
  }
}

/** A towel bar on two brackets, with a towel hanging over it. */
function towelBar(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  for (const sx of [-1, 1]) k.span('support', 'Bracket', sx * (w / 2) - (sx > 0 ? 3 : 0), sx * (w / 2) + (sx < 0 ? 3 : 0), -d / 2, d / 2, h - 5, h - 2, { material: 'metal', color: STEEL, finish: 'gloss', radius: 0.8 });
  k.span('detail', 'Bar', -w / 2 + 1, w / 2 - 1, d / 2 - 3, d / 2 - 0.6, h - 4.6, h - 2.4, { material: 'metal', color: STEEL, finish: 'gloss', radius: 1 });
  k.span('cushion', 'Towel', -w * 0.32, w * 0.32, d / 2 - 4.5, d / 2 - 0.2, 0, h - 2.4, { material: 'cotton', color: '#f4f1ea', radius: 1.2 });
}

function shadeHex(color: string): string {
  return color.toLowerCase() === WHITE ? '#d9d6cf' : '#2e2f33';
}

function bathtub(k: Kit, b: Base, freestanding: boolean) {
  const { width: w, depth: d, height: h } = b;
  if (freestanding) {
    k.cyl('base', 'Tub', 0, 0, 0, w, d, h, { material: 'ceramic', color: CERAMIC, finish: 'gloss', taper: 1.04 });
    k.cyl('detail', 'Basin', 0, 0, h - 0.4, w - 10, d - 10, 0.6, { material: 'ceramic', color: '#e3e1dd', finish: 'gloss' });
    k.cyl('detail', 'Floor tap', w / 2 + 0.01 - 8, 0, 0, 3, 3, h + 20, { material: 'metal', color: STEEL });
  } else {
    k.span('base', 'Tub', -w / 2, w / 2, -d / 2, d / 2, 0, h, { material: 'ceramic', color: CERAMIC, finish: 'gloss', radius: 3 });
    k.box('detail', 'Basin', 4, 0, h - 0.4, w - 22, d - 14, 0.6, { material: 'ceramic', color: '#e3e1dd', finish: 'gloss', radius: 16 });
    k.box('detail', 'Tap', -w / 2 + 5, 0, h, 5, 14, 6, { material: 'metal', color: STEEL, finish: 'gloss', radius: 1.5 });
    k.cyl('detail', 'Drain', -w / 2 + 18, 0, h - 0.2, 4, 4, 0.6, { material: 'metal', color: '#8d9196' });
  }
}

function shower(k: Kit, b: Base, enclosure: 'corner' | 'walkIn') {
  const { width: w, depth: d } = b;
  k.span('base', 'Tray', -w / 2, w / 2, -d / 2, d / 2, 0, 5, { material: 'ceramic', color: CERAMIC, finish: 'gloss', radius: 1.5 });
  k.cyl('detail', 'Drain', 0, 0, 5, 8, 8, 0.4, { material: 'metal', color: '#8d9196' });
  // Glass: one panel for a walk-in shower, two meeting at the corner otherwise.
  k.span('detail', 'Glass panel', -w / 2 + (enclosure === 'walkIn' ? w * 0.4 : 0), w / 2, d / 2 - 1, d / 2, 5, 200, { material: 'glass', color: '#dfeaee', radius: 0.2 });
  if (enclosure === 'corner') k.span('detail', 'Glass panel', w / 2 - 1, w / 2, -d / 2, d / 2 - 1, 5, 200, { material: 'glass', color: '#dfeaee', radius: 0.2 });
  k.cyl('detail', 'Shower head', 0, -d / 2 + 14, 195, 22, 22, 1.5, { material: 'metal', color: STEEL, finish: 'gloss' });
  k.span('support', 'Riser', -1, 1, -d / 2, -d / 2 + 3, 100, 198, { material: 'metal', color: STEEL });
}

function laundry(k: Kit, b: Base, stacked: boolean, dryerOnly = false) {
  const { width: w, depth: d } = b;
  const machine = (z: number, name: string) => {
    const body = k.span('base', name, -w / 2, w / 2, -d / 2, d / 2 - 1, z, z + 84, { color: WHITE, material: 'plastic', finish: 'gloss', radius: 1.5 });
    k.box('detail', 'Control panel', 0, d / 2 - 1.5, 70, w - 4, 1.6, 10, { parent: body, color: '#e7e6e2', radius: 0.4 });
    k.soft('door', 'Door', -2, d / 2 - 2.2, 18, 36, 4, 36, { parent: body, material: 'glass', color: '#3a4046', finish: 'gloss' });
    k.cyl('detail', 'Knob', w / 2 - 10, d / 2 - 3.5, z + 74, 5, 5, 1, { material: 'metal', color: STEEL });
  };
  machine(0, dryerOnly ? 'Dryer' : 'Washer');
  if (stacked) machine(85, 'Dryer');
}

function saunaBench(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  const slats = Math.max(3, Math.round(d / 9));
  const sw = (d - (slats - 1) * 1.2) / slats;
  for (let i = 0; i < slats; i++) {
    const y = -d / 2 + sw / 2 + i * (sw + 1.2);
    k.box('seat', 'Slat', 0, y, h - 3, w, sw, 3, { material: 'wood', color: '#d9b588', radius: 0.6 });
  }
  for (const x of [-w / 2 + 6, w / 2 - 6, ...(w > 160 ? [0] : [])]) k.box('support', 'Support', x, 0, 0, 5, d - 4, h - 3, { material: 'wood', color: '#c9a273', radius: 0.4 });
}

function saunaHeater(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  k.span('base', 'Heater', -w / 2, w / 2, -d / 2, d / 2, 0, h - 8, { material: 'metal', color: '#3b3d41', radius: 1.5 });
  // A heap of stones in the top basket.
  let seed = 7;
  const rand = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  for (let i = 0; i < 22; i++) {
    const s = 6 + rand() * 4;
    const x = (rand() - 0.5) * (w - s - 4);
    const y = (rand() - 0.5) * (d - s - 4);
    k.soft('detail', 'Stone', x, y, h - 9 + rand() * 2, s, s * 0.9, s * 0.7, { material: 'stone', color: rand() > 0.5 ? '#6e6c69' : '#8a8783' });
  }
}

/**
 * A rim around the footprint (a hot tub's edge), `thickness` wide: one band per side, mitred
 * at the corners. (A single band all the way round would close into a solid lid.)
 */
function rim(k: Kit, edges: number, z: number, h: number, thickness: number, o: Parameters<Kit['box']>[8]) {
  for (let i = 0; i < edges; i++) {
    k.box('detail', 'Rim side', 0, 0, z, 1, 1, h, o);
    const c = k.list[k.list.length - 1];
    c.shape = 'edge';
    c.edges = { from: i, to: i, startTrim: 0, endTrim: 0, inset: 0, thickness, miterStart: true, miterEnd: true };
  }
}

function hotTub(k: Kit, b: Base, round: boolean) {
  const { width: w, depth: d, height: h } = b;
  if (round) {
    // A wooden tub: staves around the outside, water inside.
    k.cyl('base', 'Tub', 0, 0, 0, w, d, h - 8, { material: 'wood', color: '#6d5543' });
    k.cyl('detail', 'Water', 0, 0, h - 11, w - 16, d - 16, 4, { material: 'water', color: WATER, finish: 'gloss' });
    rim(k, 4, h - 8, 8, 8, { material: 'wood', color: '#7d6350', radius: 2 });
  } else {
    k.span('base', 'Cabinet', -w / 2, w / 2, -d / 2, d / 2, 0, h - 6, { material: 'plastic', color: '#5b5f63', radius: 4 });
    k.span('detail', 'Water', -w / 2 + 16, w / 2 - 16, -d / 2 + 16, d / 2 - 16, h - 14, h - 5, { material: 'water', color: WATER, finish: 'gloss', radius: 18 });
    k.span('seat', 'Lounger seat', -w / 2 + 16, -w / 2 + 54, -d / 2 + 16, d / 2 - 62, h - 34, h - 24, { material: 'plastic', color: '#eef0ef', radius: 6 });
    rim(k, 4, h - 6, 6, 16, { material: 'plastic', color: '#eef0ef', finish: 'gloss', radius: 3 });
  }
}

function outdoorSofa(k: Kit, b: Base, seats: number) {
  const { width: w, depth: d, height: h } = b;
  const arm = 9;
  k.span('base', 'Teak base', -w / 2, w / 2, -d / 2, d / 2, 10, 30, { material: 'wood', color: TEAK, radius: 1 });
  k.legs(w, d, 10, 6, 2, { material: 'wood', color: TEAK }, false);
  k.span('backrest', 'Back', -w / 2, w / 2, -d / 2, -d / 2 + 8, 30, h, { material: 'wood', color: TEAK, radius: 1 });
  k.span('armrest', 'Arm', -w / 2, -w / 2 + arm, -d / 2, d / 2, 30, 58, { material: 'wood', color: TEAK, radius: 1 });
  k.span('armrest', 'Arm', w / 2 - arm, w / 2, -d / 2, d / 2, 30, 58, { material: 'wood', color: TEAK, radius: 1 });
  const inner = w - 2 * arm;
  const cw = (inner - (seats - 1)) / seats;
  for (let i = 0; i < seats; i++) {
    const x0 = -w / 2 + arm + i * (cw + 1);
    k.span('cushion', 'Seat cushion', x0, x0 + cw, -d / 2 + 18, d / 2 - 1, 30, 42, { material: 'cotton', color: LINEN, radius: 4, seams: 'piped' });
    k.span('cushion', 'Back cushion', x0, x0 + cw, -d / 2 + 8, -d / 2 + 20, 42, h - 4, { material: 'cotton', color: LINEN, radius: 5, seams: 'piped', tilt: 8 });
  }
  // Pillows at the ends of a sofa, one in the middle of an armchair.
  for (const x of seats > 1 ? [-w / 2 + arm + 22, w / 2 - arm - 22] : [0]) k.soft('pillow', 'Pillow', x, -d / 2 + 30, 40, 40, 13, 34, { material: 'linen', color: SAGE, tilt: 14 });
}

function slattedTable(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  const n = Math.max(4, Math.round(d / 9));
  const sw = (d - (n - 1) * 1) / n;
  for (let i = 0; i < n; i++) k.box('tabletop', 'Slat', 0, -d / 2 + sw / 2 + i * (sw + 1), h - 3, w, sw, 3, { material: 'wood', color: TEAK, radius: 0.5 });
  k.legs(w, d, h - 3, 5, 3, { material: 'wood', color: TEAK }, false);
}

function lounger(k: Kit, b: Base) {
  const { width: w, depth: d } = b;
  // Head end at the back (−y).
  k.span('base', 'Frame', -w / 2, w / 2, -d / 2, d / 2, 10, 24, { material: 'wood', color: TEAK, radius: 1 });
  k.legs(w, d, 10, 5, 2, { material: 'wood', color: TEAK }, false);
  k.span('cushion', 'Cushion', -w / 2 + 2, w / 2 - 2, -d / 2 + 60, d / 2 - 2, 24, 31, { material: 'cotton', color: LINEN, radius: 3, seams: 'piped' });
  k.span('backrest', 'Backrest', -w / 2 + 2, w / 2 - 2, -d / 2 + 4, -d / 2 + 58, 24, 40, { material: 'cotton', color: LINEN, radius: 3, seams: 'piped', tilt: 35 });
}

function parasol(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  k.cyl('foot', 'Base', 0, 0, 0, 50, 50, 8, { material: 'stone', color: '#7b7d80' });
  k.cyl('support', 'Pole', 0, 0, 8, 5, 5, h - 40, { material: 'wood', color: TEAK });
  k.cyl('detail', 'Canopy', 0, 0, h - 40, w, d, 32, { material: 'cotton', color: b.color, taper: 0.04 });
}

function firePit(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  k.cyl('base', 'Stone ring', 0, 0, 0, w, d, h, { material: 'stone', color: '#8c8780', taper: 0.95 });
  k.cyl('detail', 'Fire bowl', 0, 0, h - 1, w - 20, d - 20, 1.2, { material: 'metal', color: '#24221f' });
  for (let i = 0; i < 4; i++) k.box('detail', 'Log', 0, 0, h, w * 0.4, 7, 7, { material: 'wood', color: '#5a3d26', rotation: i * 45, radius: 3 });
}

function tubChair(k: Kit, b: Base) {
  const { width: w, depth: d } = b;
  // A round seat with a curved back wrapping around it.
  k.cyl('base', 'Base', 0, 2, 4, w - 6, d - 6, 34, { color: b.color, material: 'velvet' });
  k.cyl('cushion', 'Seat cushion', 0, 6, 38, w - 22, d - 26, 10, { color: b.color, material: 'velvet', seams: 'piped' });
  // Size the back so its real (bulging) outline fits: scale the chord until the outline is w − 2 wide.
  const sweep = 200;
  const t = 16;
  let chord = w - 4;
  for (let i = 0; i < 6; i++) {
    const box = bounds(curvedOutline(chord, t, sweep));
    chord *= (w - 2) / box.w;
  }
  const box = bounds(curvedOutline(chord, t, sweep));
  k.curved('backrest', 'Curved back', 0, -d / 2 + 1 + box.d / 2, 4, chord, t, 70, sweep, { color: b.color, material: 'velvet', radius: 5 });
  k.legs(w * 0.75, d * 0.75, 4, 4, 2, { material: 'wood', color: WALNUT });
}

function stool(k: Kit, b: Base, bar: boolean) {
  const { width: w, depth: d, height: h } = b;
  k.cyl('seat', 'Seat', 0, 0, h - 5, w, d, 5, { material: bar ? 'leather' : 'wood', color: bar ? COGNAC : OAK, seams: bar ? 'stitched' : undefined });
  const g = k.group('Legs');
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.cyl('leg', 'Leg', x * (w / 2 - 5), y * (d / 2 - 5), 0, 3, 3, h - 5, { parent: g, material: 'metal', color: BLACK });
  if (bar) k.cyl('support', 'Footrest', 0, 0, 28, w - 6, d - 6, 1.5, { material: 'metal', color: BLACK, taper: 1 });
}

function bench(k: Kit, b: Base, upholstered: boolean) {
  const { width: w, depth: d, height: h } = b;
  if (upholstered) k.span('cushion', 'Seat', -w / 2, w / 2, -d / 2, d / 2, h - 10, h, { material: 'linen', color: b.color, radius: 3, seams: 'piped' });
  else k.span('tabletop', 'Seat', -w / 2, w / 2, -d / 2, d / 2, h - 4, h, { material: 'wood', color: OAK, radius: 1 });
  k.legs(w, d, h - (upholstered ? 10 : 4), 4.5, 3, { material: 'wood', color: WALNUT }, true);
}

function crib(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  k.span('base', 'Mattress', -w / 2 + 3, w / 2 - 3, -d / 2 + 3, d / 2 - 3, 30, 42, { material: 'cotton', color: WHITE, radius: 3 });
  for (const [x0, x1, y0, y1] of [[-w / 2, w / 2, -d / 2, -d / 2 + 3], [-w / 2, w / 2, d / 2 - 3, d / 2], [-w / 2, -w / 2 + 3, -d / 2, d / 2], [w / 2 - 3, w / 2, -d / 2, d / 2]]) k.span('support', 'Rail', x0, x1, y0, y1, h - 4, h, { material: 'wood', color: WHITE, radius: 1 });
  k.legs(w, d, h, 4, 0, { material: 'wood', color: WHITE }, false);
  k.span('detail', 'Blanket', -w / 2 + 6, w / 2 - 6, 0, d / 2 - 8, 42, 44, { material: 'cotton', color: SAGE, radius: 2 });
}

function chestOfDrawers(k: Kit, b: Base, rows: number, cols: number) {
  const { width: w, depth: d, height: h } = b;
  k.span('base', 'Carcass', -w / 2, w / 2, -d / 2, d / 2 - 4.3, 8, h, { color: b.color, material: 'wood', radius: 0.5 });
  k.legs(w, d, 8, 3.5, 3, { material: 'wood', color: WALNUT }, true);
  const rh = (h - 10) / rows;
  for (let i = 0; i < rows; i++) k.fronts('drawer', w, d, 9 + i * rh + 0.3, 9 + (i + 1) * rh - 0.3, cols, { color: b.color, material: 'wood', handle: 'knob', handleColor: BRASS });
}

function floorMirror(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  k.span('base', 'Frame', -w / 2, w / 2, -d / 2, d / 2, 0, h, { material: 'wood', color: OAK, radius: 1 });
  k.span('detail', 'Mirror', -w / 2 + 3, w / 2 - 3, d / 2 - 0.4, d / 2, 3, h - 3, { material: 'glass', color: '#dfe7ea', finish: 'gloss' });
}

function divider(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  const panels = 3;
  const pw = w / panels;
  for (let i = 0; i < panels; i++) {
    const x = -w / 2 + pw / 2 + i * pw;
    // Folded panels zig-zag a little either side of the centre line.
    k.box('detail', 'Panel', x, (i % 2 ? 1 : -1) * (d / 2 - 7), 2, pw - 1, 3, h - 2, { material: 'wood', color: OAK, radius: 0.5, rotation: i % 2 ? 8 : -8 });
  }
}

function arcLamp(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  k.span('foot', 'Marble base', -w / 2, -w / 2 + 30, -d / 2, d / 2, 0, 6, { material: 'stone', color: MARBLE, radius: 1 });
  k.cyl('support', 'Stem', -w / 2 + 15, 0, 6, 3, 3, h - 30, { material: 'metal', color: BRASS });
  k.box('support', 'Arc', 0, 0, h - 26, w - 30, 3, 3, { material: 'metal', color: BRASS, radius: 1.5 });
  k.cyl('detail', 'Shade', w / 2 - 20, 0, h - 40, 38, 38, 22, { material: 'metal', color: BRASS, taper: 0.45 });
}

function tripodLamp(k: Kit, b: Base) {
  const { width: w, height: h } = b;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    k.cyl('leg', 'Leg', Math.cos(a) * w * 0.32, Math.sin(a) * w * 0.32, 0, 3, 3, h - 40, { material: 'wood', color: WALNUT, tilt: 0 });
  }
  k.cyl('detail', 'Shade', 0, 0, h - 42, w * 0.9, w * 0.9, 40, { material: 'linen', color: LINEN, taper: 0.9 });
}

function pouf(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  k.cyl('cushion', 'Pouf', 0, 0, 0, w, d, h, { material: 'cotton', color: b.color, seams: 'stitched', taper: 0.92 });
}

function basket(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  k.cyl('base', 'Basket', 0, 0, 0, w, d, h, { material: 'linen', color: '#c7ab82', taper: 1.08 });
  k.cyl('detail', 'Throw', 0, 0, h - 6, w - 8, d - 8, 8, { material: 'cotton', color: SAGE });
}

function bbq(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  k.span('base', 'Cart', -w / 2, w / 2, -d / 2, d / 2, 10, h - 25, { material: 'metal', color: '#2c2e31', radius: 1 });
  k.legs(w, d, 10, 4, 2, { material: 'metal', color: BLACK }, true);
  k.span('detail', 'Lid', -w / 2 + 15, w / 2 - 15, -d / 2 + 2, d / 2 - 2, h - 25, h, { material: 'metal', color: '#1c1d20', radius: 8 });
  k.span('tabletop', 'Side shelf', -w / 2, -w / 2 + 14, -d / 2, d / 2, h - 26, h - 24, { material: 'metal', color: STEEL });
  k.span('tabletop', 'Side shelf', w / 2 - 14, w / 2, -d / 2, d / 2, h - 26, h - 24, { material: 'metal', color: STEEL });
}

function planter(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  k.span('base', 'Planter', -w / 2, w / 2, -d / 2, d / 2, 0, h, { material: 'wood', color: TEAK, radius: 1 });
  k.span('detail', 'Soil', -w / 2 + 3, w / 2 - 3, -d / 2 + 3, d / 2 - 3, h - 2, h - 1, { color: '#4a3b2e' });
  const n = Math.max(2, Math.round(w / 35));
  for (let i = 0; i < n; i++) k.soft('detail', 'Shrub', -w / 2 + (i + 0.5) * (w / n), 0, h - 2, Math.min(w / n, d) - 2, d - 4, 28, { material: 'custom', color: i % 2 ? '#6f8f5c' : '#5d7d4c' });
}

function rack(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  k.span('support', 'Frame', -w / 2, -w / 2 + 2, -d / 2, d / 2, 0, h, { material: 'metal', color: STEEL });
  k.span('support', 'Frame', w / 2 - 2, w / 2, -d / 2, d / 2, 0, h, { material: 'metal', color: STEEL });
  for (let i = 0; i < 6; i++) k.cyl('detail', 'Rail', 0, -d / 2 + 4 + (i * (d - 8)) / 5, h - 2, w - 4, 1.2, 1.2, { material: 'metal', color: STEEL });
  k.span('detail', 'Towel', -w / 2 + 10, -w / 2 + 40, -d / 2 + 2, d / 2 - 2, h - 3, h - 1, { material: 'cotton', color: MIST });
}

function towelRail(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  k.span('support', 'Side', -w / 2, -w / 2 + 3, -d / 2, d / 2, 10, h, { material: 'metal', color: STEEL, radius: 1 });
  k.span('support', 'Side', w / 2 - 3, w / 2, -d / 2, d / 2, 10, h, { material: 'metal', color: STEEL, radius: 1 });
  for (let i = 0; i < 10; i++) k.cyl('detail', 'Bar', 0, 0, 14 + i * ((h - 18) / 9), w - 6, 2, 2, { material: 'metal', color: STEEL });
  k.span('detail', 'Towel', -w / 2 + 4, w / 2 - 4, -d / 2, d / 2, h * 0.55, h * 0.75, { material: 'cotton', color: LINEN, radius: 1 });
}

function bucket(k: Kit, b: Base) {
  const { width: w, depth: d, height: h } = b;
  k.cyl('base', 'Bucket', 0, 0, 0, w, d, h, { material: 'wood', color: '#c9a273', taper: 1.15 });
  k.cyl('detail', 'Water', 0, 0, h - 4, w - 4, d - 4, 1, { material: 'water', color: WATER });
  k.box('detail', 'Ladle', 0, 0, h, w + 0, 4, 2, { material: 'wood', color: '#b08a5c', radius: 1, rotation: 30 });
}

function laundrySink(k: Kit, b: Base) {
  const { width: w, depth: d } = b;
  k.span('base', 'Cabinet', -w / 2, w / 2, -d / 2, d / 2 - 4.3, 10, 86, { color: WHITE, radius: 0.4 });
  k.fronts('door', w, d, 11, 85, 1, { color: WHITE, handle: 'bar', handleColor: STEEL });
  k.span('tabletop', 'Top', -w / 2, w / 2, -d / 2, d / 2, 86, 90, { material: 'metal', color: STEEL, finish: 'satin', radius: 0.5 });
  k.box('detail', 'Deep bowl', 0, 3, 89.6, w - 12, d - 18, 0.6, { material: 'metal', color: '#a9adb2', radius: 4 });
  k.cyl('detail', 'Tap', 0, -d / 2 + 6, 90, 4, 4, 24, { material: 'metal', color: STEEL });
}

function bounds(pts: { x: number; y: number }[]) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) };
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

const sofa = (w: number, d: number, color: string, material: MaterialKind = 'fabric'): Base => ({ kind: 'sofa', width: w, depth: d, height: 82, color, material, finish: 'matte' });
const plantSize = (s: number, h: number): Base => ({ kind: 'decor', category: 'decoration', width: s, depth: s, height: h, color: '#7f9c6a' });

export const CATALOGUE: CatalogueItem[] = [
  // Living room ----------------------------------------------------------
  simple('sofa-2', '2-seat sofa', 'living', 'couch settee loveseat', sofa(160, 88, OATMEAL)),
  simple('sofa-3', '3-seat sofa', 'living', 'couch settee', sofa(210, 92, LINEN)),
  simple('sofa-4', '4-seat sofa', 'living', 'couch settee large', sofa(250, 95, OATMEAL)),
  simple('sofa-3-sage', '3-seat sofa, sage', 'living', 'couch green', sofa(215, 92, SAGE, 'linen')),
  simple('sofa-3-velvet', '3-seat velvet sofa', 'living', 'couch terracotta', sofa(205, 90, TERRACOTTA, 'velvet')),
  simple('sofa-3-leather', '3-seat leather sofa', 'living', 'couch cognac', sofa(200, 92, COGNAC, 'leather')),
  simple('sofa-2-charcoal', '2-seat sofa, charcoal', 'living', 'couch grey dark', sofa(170, 88, CHARCOAL)),
  preset('loveseat', 'loveseat', 'living', 'small sofa couch'),
  preset('deep-loveseat', 'deepLoveseat', 'living', 'small sofa couch deep'),
  preset('angled-loveseat', 'angledLoveseat', 'living', 'small sofa couch angled'),
  preset('wedge-loveseat', 'wedgeLoveseat', 'living', 'corner wedge sofa couch'),
  preset('corner-sofa', 'cornerSofa', 'living', 'l-shaped sofa couch sectional'),
  preset('sectional', 'sectional', 'living', 'sectional sofa couch l-shaped'),
  preset('chaise', 'chaise', 'living', 'chaise longue daybed'),
  preset('armchair-upholstered', 'armchair', 'living', 'armchair chair'),
  simple('armchair-club', 'Club armchair', 'living', 'armchair chair', { kind: 'armchair', width: 85, depth: 85, height: 80, color: SAGE, material: 'fabric', finish: 'matte' }),
  simple('armchair-leather', 'Leather armchair', 'living', 'armchair chair', { kind: 'armchair', width: 82, depth: 86, height: 82, color: COGNAC, material: 'leather' }),
  simple('accent-chair', 'Accent chair', 'living', 'armchair small chair', { kind: 'armchair', width: 70, depth: 74, height: 78, color: MIST, material: 'fabric', finish: 'matte' }),
  built('tub-chair', 'Round tub chair', 'living', 'armchair barrel round velvet', { kind: 'armchair', width: 78, depth: 74, height: 74, color: OATMEAL, material: 'velvet' }, tubChair),
  preset('ottoman', 'ottoman', 'living', 'footstool'),
  preset('round-ottoman', 'roundOttoman', 'living', 'footstool pouf round'),
  built('pouf', 'Pouf', 'living', 'footstool floor cushion', { kind: 'decor', width: 50, depth: 50, height: 40, color: TERRACOTTA }, pouf),
  simple('coffee-table', 'Coffee table', 'living', 'low table', { kind: 'coffeeTable', width: 120, depth: 60, height: 42, color: OAK, material: 'wood' }),
  simple('coffee-table-walnut', 'Walnut coffee table', 'living', 'low table', { kind: 'coffeeTable', width: 110, depth: 55, height: 40, color: WALNUT, material: 'wood' }),
  simple('coffee-table-round', 'Round marble coffee table', 'living', 'low table circle', { kind: 'coffeeTable', width: 90, depth: 90, height: 40, color: MARBLE, material: 'stone', shape: ellipse(90, 90) }),
  simple('coffee-table-oval', 'Oval coffee table', 'living', 'low table', { kind: 'coffeeTable', width: 130, depth: 70, height: 40, color: OAK, material: 'wood', shape: ellipse(130, 70) }),
  simple('side-table', 'Side table', 'living', 'end table', { kind: 'table', width: 45, depth: 45, height: 55, color: OAK, material: 'wood' }),
  simple('side-table-round', 'Round side table', 'living', 'end table circle', { kind: 'table', width: 45, depth: 45, height: 55, color: MARBLE, material: 'stone', shape: ellipse(45, 45) }),
  simple('tv-unit', 'TV unit', 'living', 'media console television', { kind: 'television', width: 160, depth: 40, height: 55, color: WALNUT, material: 'wood' }),
  simple('tv-unit-long', 'Long TV unit', 'living', 'media console television', { kind: 'television', width: 200, depth: 42, height: 50, color: OAK, material: 'wood' }),
  simple('bookshelf', 'Bookshelf', 'living', 'bookcase shelving', { kind: 'bookshelf', width: 80, depth: 35, height: 180, color: OAK, material: 'wood' }),
  simple('bookshelf-wide', 'Wide bookshelf', 'living', 'bookcase shelving', { kind: 'bookshelf', width: 120, depth: 35, height: 200, color: WHITE, material: 'wood' }),
  simple('low-shelf', 'Low shelf', 'living', 'bookcase sideboard', { kind: 'bookshelf', width: 140, depth: 35, height: 75, color: WALNUT, material: 'wood' }),
  // Dining -----------------------------------------------------------------
  simple('dining-4', 'Dining table, 4 seats', 'dining', 'kitchen table', { kind: 'diningTable', width: 120, depth: 80, height: 75, color: OAK, material: 'wood' }),
  simple('dining-6', 'Dining table, 6 seats', 'dining', 'kitchen table', { kind: 'diningTable', width: 180, depth: 90, height: 75, color: OAK, material: 'wood' }),
  simple('dining-8', 'Dining table, 8 seats', 'dining', 'kitchen table large', { kind: 'diningTable', width: 240, depth: 100, height: 75, color: WALNUT, material: 'wood' }),
  simple('dining-marble', 'Marble dining table', 'dining', 'kitchen table stone', { kind: 'diningTable', width: 160, depth: 90, height: 75, color: MARBLE, material: 'stone' }),
  preset('dining-round', 'roundTable', 'dining', 'circle kitchen table pedestal'),
  preset('dining-oval', 'ovalTable', 'dining', 'kitchen table'),
  simple('dining-chair', 'Dining chair', 'dining', 'chair wood', { kind: 'chair', width: 45, depth: 50, height: 85, color: OAK, material: 'wood' }),
  simple('dining-chair-upholstered', 'Upholstered dining chair', 'dining', 'chair fabric', { kind: 'chair', width: 48, depth: 54, height: 88, color: OATMEAL, material: 'fabric' }),
  simple('dining-chair-black', 'Black dining chair', 'dining', 'chair dark', { kind: 'chair', width: 45, depth: 50, height: 82, color: BLACK, material: 'wood' }),
  built('bench-wood', 'Dining bench', 'dining', 'bench seat', { kind: 'chair', width: 150, depth: 38, height: 45, color: OAK, material: 'wood' }, (k, b) => bench(k, b, false)),
  built('bench-upholstered', 'Upholstered bench', 'dining', 'bench seat end of bed', { kind: 'chair', width: 130, depth: 40, height: 46, color: OATMEAL, material: 'linen' }, (k, b) => bench(k, b, true)),
  built('bar-stool', 'Bar stool', 'dining', 'counter stool kitchen', { kind: 'chair', width: 40, depth: 40, height: 75, color: COGNAC }, (k, b) => stool(k, b, true)),
  built('stool', 'Stool', 'dining', 'seat', { kind: 'chair', width: 36, depth: 36, height: 46, color: OAK }, (k, b) => stool(k, b, false)),
  simple('sideboard', 'Sideboard', 'dining', 'buffet credenza cabinet', { kind: 'cabinet', width: 160, depth: 45, height: 80, color: WALNUT, material: 'wood' }),
  simple('display-cabinet', 'Display cabinet', 'dining', 'cabinet hutch', { kind: 'cabinet', width: 90, depth: 40, height: 180, color: WHITE, material: 'wood' }),
  // Bedroom ------------------------------------------------------------------
  simple('bed-single', 'Single bed', 'bedroom', 'twin bed 90', { kind: 'bed', width: 90, depth: 200, height: 90, color: LINEN, material: 'fabric' }),
  simple('bed-double', 'Double bed', 'bedroom', 'full bed 140', { kind: 'bed', width: 140, depth: 200, height: 95, color: LINEN, material: 'fabric' }),
  simple('bed-queen', 'Queen bed', 'bedroom', 'bed 160', { kind: 'bed', width: 160, depth: 205, height: 100, color: OATMEAL, material: 'fabric' }),
  simple('bed-king', 'King bed', 'bedroom', 'bed 180', { kind: 'bed', width: 180, depth: 210, height: 100, color: SAGE, material: 'fabric' }),
  simple('bed-super-king', 'Super king bed', 'bedroom', 'california king bed 200', { kind: 'bed', width: 200, depth: 215, height: 105, color: OATMEAL, material: 'fabric' }),
  simple('bed-wood', 'Wooden double bed', 'bedroom', 'bed oak frame', { kind: 'bed', width: 150, depth: 205, height: 90, color: OAK, material: 'wood' }),
  built('crib', 'Cot / crib', 'bedroom', 'baby nursery kids', { kind: 'bed', width: 66, depth: 126, height: 90, color: WHITE, material: 'wood' }, crib),
  simple('bedside', 'Bedside table', 'bedroom', 'nightstand', { kind: 'bedsideTable', width: 45, depth: 40, height: 55, color: OAK, material: 'wood' }),
  simple('bedside-walnut', 'Walnut bedside table', 'bedroom', 'nightstand', { kind: 'bedsideTable', width: 50, depth: 40, height: 50, color: WALNUT, material: 'wood' }),
  built('dresser', 'Chest of drawers', 'bedroom', 'dresser drawers', { kind: 'cabinet', width: 80, depth: 45, height: 90, color: OAK, material: 'wood' }, (k, b) => chestOfDrawers(k, b, 4, 1)),
  built('dresser-wide', 'Wide dresser', 'bedroom', 'chest of drawers', { kind: 'cabinet', width: 140, depth: 48, height: 80, color: WHITE, material: 'wood' }, (k, b) => chestOfDrawers(k, b, 3, 2)),
  simple('wardrobe-1', 'Wardrobe, 1 door', 'bedroom', 'closet armoire', { kind: 'storage', width: 60, depth: 60, height: 200, color: WHITE, material: 'wood' }),
  simple('wardrobe-2', 'Wardrobe, 2 doors', 'bedroom', 'closet armoire', { kind: 'storage', width: 100, depth: 60, height: 200, color: WHITE, material: 'wood' }),
  simple('wardrobe-3', 'Wardrobe, 3 doors', 'bedroom', 'closet armoire', { kind: 'storage', width: 150, depth: 60, height: 220, color: OAK, material: 'wood' }),
  simple('wardrobe-4', 'Wardrobe, 4 doors', 'bedroom', 'closet armoire large', { kind: 'storage', width: 200, depth: 60, height: 230, color: WHITE, material: 'wood' }),
  simple('dressing-table', 'Dressing table', 'bedroom', 'vanity makeup desk', { kind: 'desk', width: 100, depth: 45, height: 75, color: WHITE, material: 'wood' }),
  // Office -------------------------------------------------------------------
  simple('desk-120', 'Desk 120', 'office', 'writing desk', { kind: 'desk', width: 120, depth: 60, height: 75, color: OAK, material: 'wood' }),
  simple('desk-140', 'Desk 140', 'office', 'writing desk', { kind: 'desk', width: 140, depth: 70, height: 75, color: WHITE, material: 'wood' }),
  simple('desk-160', 'Large desk', 'office', 'writing desk', { kind: 'desk', width: 160, depth: 80, height: 75, color: WALNUT, material: 'wood' }),
  simple('standing-desk', 'Standing desk', 'office', 'sit stand desk', { kind: 'desk', width: 140, depth: 70, height: 110, color: OAK, material: 'wood' }),
  preset('l-desk', 'lDesk', 'office', 'corner desk'),
  simple('office-chair', 'Desk chair', 'office', 'office task chair swivel', { kind: 'chair', width: 65, depth: 65, height: 110, color: CHARCOAL, material: 'fabric' }),
  built('filing-cabinet', 'Filing cabinet', 'office', 'drawers pedestal', { kind: 'cabinet', width: 42, depth: 55, height: 70, color: WHITE, material: 'metal' }, (k, b) => chestOfDrawers(k, b, 3, 1)),
  simple('office-bookcase', 'Office bookcase', 'office', 'shelving', { kind: 'bookshelf', width: 90, depth: 35, height: 200, color: WALNUT, material: 'wood' }),
  // Kitchen ------------------------------------------------------------------
  built('base-40', 'Base cabinet 40', 'kitchen', 'kitchen unit cupboard', { kind: 'fixture', width: 40, depth: 60, height: 90, color: WHITE }, (k, b) => baseUnit(k, b, 'doors')),
  built('base-60', 'Base cabinet 60', 'kitchen', 'kitchen unit cupboard', { kind: 'fixture', width: 60, depth: 60, height: 90, color: WHITE }, (k, b) => baseUnit(k, b, 'doors')),
  built('base-80', 'Base cabinet 80', 'kitchen', 'kitchen unit cupboard', { kind: 'fixture', width: 80, depth: 60, height: 90, color: WHITE }, (k, b) => baseUnit(k, b, 'doors')),
  built('drawers-60', 'Drawer unit 60', 'kitchen', 'kitchen drawers', { kind: 'fixture', width: 60, depth: 60, height: 90, color: SAGE }, (k, b) => baseUnit(k, b, 'drawers')),
  built('sink-60', 'Sink unit', 'kitchen', 'kitchen sink tap', { kind: 'fixture', width: 80, depth: 60, height: 90, color: WHITE }, (k, b) => sink(k, b, 1)),
  built('sink-double', 'Double sink unit', 'kitchen', 'kitchen sink two bowls', { kind: 'fixture', width: 120, depth: 60, height: 90, color: WHITE }, (k, b) => sink(k, b, 2)),
  built('hob-gas', 'Gas hob unit', 'kitchen', 'stove cooktop burners range', { kind: 'fixture', width: 60, depth: 60, height: 90, color: WHITE }, (k, b) => hob(k, b, true)),
  built('hob-induction', 'Induction hob unit', 'kitchen', 'stove cooktop electric', { kind: 'fixture', width: 80, depth: 60, height: 90, color: WHITE }, (k, b) => hob(k, b, false)),
  built('oven', 'Oven unit', 'kitchen', 'built-in oven', { kind: 'fixture', width: 60, depth: 60, height: 90, color: WHITE }, (k, b) => baseUnit(k, b, 'oven')),
  built('dishwasher', 'Dishwasher', 'kitchen', 'appliance', { kind: 'fixture', width: 60, depth: 60, height: 90, color: WHITE }, (k, b) => baseUnit(k, b, 'dishwasher')),
  built('fridge', 'Fridge freezer', 'kitchen', 'refrigerator appliance', { kind: 'fixture', width: 60, depth: 65, height: 190, color: STEEL }, (k, b) => fridge(k, b, false)),
  built('fridge-american', 'American fridge freezer', 'kitchen', 'refrigerator side by side appliance', { kind: 'fixture', width: 91, depth: 72, height: 178, color: STEEL }, (k, b) => fridge(k, b, true)),
  built('pantry', 'Tall pantry cabinet', 'kitchen', 'larder tall unit', { kind: 'fixture', width: 60, depth: 60, height: 215, color: WHITE }, tall),
  built('island', 'Kitchen island', 'kitchen', 'breakfast bar counter', { kind: 'fixture', width: 180, depth: 95, height: 92, color: SAGE }, island),
  built('island-large', 'Large kitchen island', 'kitchen', 'breakfast bar counter', { kind: 'fixture', width: 240, depth: 105, height: 92, color: WALNUT }, island),
  // Bathroom -------------------------------------------------------------------
  built('toilet', 'Toilet', 'bathroom', 'wc loo', { kind: 'fixture', width: 38, depth: 68, height: 80, color: CERAMIC, material: 'ceramic' }, (k, b) => toilet(k, b, false)),
  built('toilet-wall', 'Wall-hung toilet', 'bathroom', 'wc loo', { kind: 'fixture', width: 38, depth: 58, height: 100, color: CERAMIC, material: 'ceramic' }, (k, b) => toilet(k, b, true)),
  built('bidet', 'Bidet', 'bathroom', 'wc', { kind: 'fixture', width: 38, depth: 54, height: 41, color: CERAMIC, material: 'ceramic' }, (k, b) => toilet(k, b, false, true)),
  built('vanity-60', 'Vanity unit 60', 'bathroom', 'basin sink wash', { kind: 'fixture', width: 60, depth: 46, height: 85, color: WHITE }, (k, b) => vanity(k, b, 1)),
  built('vanity-80', 'Vanity unit 80', 'bathroom', 'basin sink wash', { kind: 'fixture', width: 80, depth: 46, height: 85, color: OAK }, (k, b) => vanity(k, b, 1)),
  built('vanity-double', 'Double vanity', 'bathroom', 'two basins sink', { kind: 'fixture', width: 130, depth: 50, height: 85, color: WALNUT }, (k, b) => vanity(k, b, 2)),
  built('bathtub', 'Bathtub', 'bathroom', 'bath tub', { kind: 'fixture', width: 170, depth: 75, height: 58, color: CERAMIC, material: 'ceramic' }, (k, b) => bathtub(k, b, false)),
  built('bathtub-small', 'Small bathtub', 'bathroom', 'bath tub', { kind: 'fixture', width: 150, depth: 70, height: 55, color: CERAMIC, material: 'ceramic' }, (k, b) => bathtub(k, b, false)),
  built('bathtub-freestanding', 'Freestanding bath', 'bathroom', 'bath tub oval', { kind: 'fixture', width: 170, depth: 80, height: 60, color: CERAMIC, material: 'ceramic', shape: ellipse(170, 80) }, (k, b) => bathtub(k, b, true)),
  built('shower-90', 'Shower 90 × 90', 'bathroom', 'shower tray enclosure', { kind: 'fixture', width: 90, depth: 90, height: 200, color: CERAMIC, material: 'ceramic' }, (k, b) => shower(k, b, 'corner')),
  built('shower-walk-in', 'Walk-in shower', 'bathroom', 'shower wet room', { kind: 'fixture', width: 140, depth: 90, height: 200, color: CERAMIC, material: 'ceramic' }, (k, b) => shower(k, b, 'walkIn')),
  built('wall-sconce', 'Wall sconce', 'lighting', 'wall light lamp', { kind: 'decor', width: 16, depth: 22, height: 30, color: BRASS, elevation: 160, light: lamp(400) }, (k, b) => wallLight(k, b, 'sconce')),
  built('towel-rail', 'Towel radiator', 'bathroom', 'heated towel rail', { kind: 'fixture', width: 50, depth: 10, height: 120, color: STEEL, material: 'metal' }, towelRail),
  simple('bathroom-cabinet', 'Bathroom cabinet', 'bathroom', 'tall storage', { kind: 'cabinet', width: 40, depth: 30, height: 170, color: WHITE, material: 'wood' }),
  built('vanity-countertop-basin', 'Vanity, countertop basin', 'bathroom', 'basin sink vessel wash', { kind: 'fixture', width: 80, depth: 48, height: 86, color: WHITE }, (k, b) => vanityTop(k, b, 'countertop', { material: 'stone', color: MARBLE })),
  built('vanity-integrated', 'Vanity, integrated basin', 'bathroom', 'basin sink wash top', { kind: 'fixture', width: 80, depth: 48, height: 86, color: WHITE }, (k, b) => vanityTop(k, b, 'integrated', { material: 'ceramic', color: CERAMIC })),
  built('vanity-integrated-wide', 'Wide vanity, integrated basin', 'bathroom', 'basin sink wash top', { kind: 'fixture', width: 120, depth: 50, height: 86, color: OAK }, (k, b) => vanityTop(k, b, 'integrated', { material: 'stone', color: MARBLE })),
  built('vanity-drop-in', 'Vanity, drop-in basin', 'bathroom', 'basin sink oval laminate shaker', { kind: 'fixture', width: 90, depth: 53, height: 81, color: WHITE }, (k, b) => vanityTop(k, b, 'dropIn', { material: 'stone', color: '#3a3b3e' }, 'knob')),
  built('backsplash', 'Backsplash strip', 'bathroom', 'splashback upstand worktop kitchen', { kind: 'fixture', width: 90, depth: 1.5, height: 10, color: WHITE, elevation: 80 }, (k, b) => {
    k.box('base', 'Backsplash', 0, 0, 0, b.width, b.depth, b.height, { material: 'stone', color: b.color, finish: 'satin', radius: 0.3 });
  }),
  built('vanity-light-3', 'Three-light vanity bar', 'bathroom', 'wall light lamp over mirror shades', { kind: 'fixture', width: 62, depth: 20, height: 22, color: STEEL, elevation: 195, light: lamp(1200) }, (k, b) => lightBar(k, b, 3)),
  built('shower-curtain-clear', 'Clear shower curtain', 'bathroom', 'bath curtain plastic liner', { kind: 'fixture', width: 150, depth: 8, height: 175, color: '#eef1f3', elevation: 25 }, (k, b) => showerCurtain(k, b, 'glass')),
  built('toilet-roll-holder', 'Toilet roll holder', 'bathroom', 'paper tissue', { kind: 'fixture', width: 16, depth: 14, height: 12, color: STEEL, elevation: 65 }, rollHolder),
  built('pegboard', 'Pegboard with shelves', 'office', 'wall organiser shelf storage', { kind: 'storage', width: 36, depth: 12, height: 56, color: WHITE, elevation: 120 }, (k, b) => pegboard(k, b, 3)),
  built('mirror-wall', 'Wall mirror', 'bathroom', 'mirror looking glass', { kind: 'decor', width: 60, depth: 3, height: 80, color: '#c9cdd1', elevation: 110 }, (k, b) => mirror(k, b, false, { material: 'metal', color: '#2b2d31' })),
  built('mirror-frameless', 'Frameless mirror', 'bathroom', 'mirror looking glass', { kind: 'decor', width: 70, depth: 1.5, height: 90, color: '#c9cdd1', elevation: 105 }, (k, b) => mirror(k, b, false, null)),
  built('mirror-round', 'Round mirror', 'bathroom', 'mirror looking glass circle', { kind: 'decor', width: 60, depth: 3, height: 60, color: '#c9cdd1', elevation: 125 }, (k, b) => mirror(k, b, true, { material: 'metal', color: BRASS })),
  built('mirror-cabinet', 'Mirror cabinet', 'bathroom', 'medicine cabinet mirror', { kind: 'fixture', width: 60, depth: 14, height: 70, color: WHITE, elevation: 120 }, mirrorCabinet),
  built('wall-cabinet-bath', 'Bathroom wall cabinet', 'bathroom', 'over toilet storage cupboard', { kind: 'fixture', width: 60, depth: 22, height: 70, color: WHITE, elevation: 140 }, wallCabinet),
  built('vanity-light', 'Vanity light bar', 'bathroom', 'wall light lamp over mirror', { kind: 'fixture', width: 60, depth: 9, height: 10, color: STEEL, elevation: 195, light: lamp(900) }, (k, b) => wallLight(k, b, 'bar')),
  built('shower-curtain', 'Shower curtain and rod', 'bathroom', 'bath curtain', { kind: 'fixture', width: 150, depth: 8, height: 175, color: '#f2f0ea', elevation: 25 }, showerCurtain),
  built('towel-bar', 'Towel bar', 'bathroom', 'towel rail rack holder', { kind: 'fixture', width: 60, depth: 9, height: 45, color: STEEL, elevation: 80 }, towelBar),
  // Laundry ----------------------------------------------------------------------
  built('washer', 'Washing machine', 'laundry', 'washer appliance', { kind: 'fixture', width: 60, depth: 60, height: 85, color: WHITE }, (k, b) => laundry(k, b, false)),
  built('dryer', 'Tumble dryer', 'laundry', 'dryer appliance', { kind: 'fixture', width: 60, depth: 60, height: 85, color: WHITE }, (k, b) => laundry(k, b, false, true)),
  built('washer-dryer-stack', 'Stacked washer and dryer', 'laundry', 'washer dryer tower appliance', { kind: 'fixture', width: 60, depth: 60, height: 170, color: WHITE }, (k, b) => laundry(k, b, true)),
  built('laundry-sink', 'Utility sink', 'laundry', 'laundry tub sink', { kind: 'fixture', width: 60, depth: 55, height: 90, color: WHITE }, laundrySink),
  built('utility-cabinet', 'Utility cabinet', 'laundry', 'tall cupboard storage broom', { kind: 'fixture', width: 60, depth: 60, height: 200, color: WHITE }, tall),
  built('drying-rack', 'Drying rack', 'laundry', 'clothes airer', { kind: 'decor', width: 100, depth: 55, height: 95, color: STEEL }, rack),
  // Sauna ----------------------------------------------------------------------------
  built('sauna-bench', 'Sauna bench', 'sauna', 'lower bench slats', { kind: 'fixture', width: 180, depth: 50, height: 45, color: '#d9b588', material: 'wood' }, saunaBench),
  built('sauna-bench-upper', 'Upper sauna bench', 'sauna', 'top bench slats', { kind: 'fixture', width: 180, depth: 60, height: 90, color: '#d9b588', material: 'wood' }, saunaBench),
  built('sauna-heater', 'Sauna heater', 'sauna', 'stove stones kiuas', { kind: 'fixture', width: 45, depth: 40, height: 75, color: '#3b3d41', material: 'metal' }, saunaHeater),
  built('sauna-bucket', 'Sauna bucket', 'sauna', 'pail ladle', { kind: 'decor', width: 26, depth: 26, height: 22, color: '#c9a273', material: 'wood' }, bucket),
  // Outdoor --------------------------------------------------------------------------
  built('hot-tub', 'Hot tub', 'outdoor', 'spa jacuzzi', { kind: 'fixture', width: 210, depth: 210, height: 90, color: '#5b5f63' }, (k, b) => hotTub(k, b, false)),
  built('hot-tub-round', 'Round hot tub', 'outdoor', 'spa jacuzzi wooden tub', { kind: 'fixture', width: 190, depth: 190, height: 95, color: '#6d5543', shape: ellipse(190, 190) }, (k, b) => hotTub(k, b, true)),
  built('outdoor-sofa', 'Outdoor sofa', 'outdoor', 'garden patio teak', { kind: 'sofa', width: 190, depth: 80, height: 75, color: LINEN }, (k, b) => outdoorSofa(k, b, 3)),
  built('outdoor-loveseat', 'Outdoor loveseat', 'outdoor', 'garden patio teak 2 seat', { kind: 'sofa', width: 140, depth: 80, height: 75, color: LINEN }, (k, b) => outdoorSofa(k, b, 2)),
  built('outdoor-armchair', 'Outdoor armchair', 'outdoor', 'garden patio teak', { kind: 'armchair', width: 80, depth: 80, height: 75, color: LINEN }, (k, b) => outdoorSofa(k, b, 1)),
  built('outdoor-coffee-table', 'Outdoor coffee table', 'outdoor', 'garden patio teak slatted', { kind: 'coffeeTable', width: 110, depth: 60, height: 40, color: TEAK, material: 'wood' }, slattedTable),
  built('outdoor-dining', 'Outdoor dining table', 'outdoor', 'garden patio teak slatted', { kind: 'diningTable', width: 180, depth: 90, height: 75, color: TEAK, material: 'wood' }, slattedTable),
  built('sun-lounger', 'Sun lounger', 'outdoor', 'deck chair sunbed', { kind: 'chair', width: 70, depth: 195, height: 40, color: LINEN }, lounger),
  built('parasol', 'Parasol', 'outdoor', 'umbrella shade', { kind: 'decor', width: 270, depth: 270, height: 250, color: '#efe9dd' }, parasol),
  built('fire-pit', 'Fire pit', 'outdoor', 'firepit stone', { kind: 'decor', width: 100, depth: 100, height: 35, color: '#8c8780', shape: ellipse(100, 100) }, firePit),
  built('bbq', 'Barbecue', 'outdoor', 'grill bbq', { kind: 'decor', width: 140, depth: 60, height: 110, color: '#2c2e31' }, bbq),
  built('planter', 'Planter box', 'outdoor', 'garden plants shrubs', { kind: 'decor', category: 'decoration', width: 100, depth: 40, height: 45, color: TEAK }, planter),
  // Lighting ---------------------------------------------------------------------------
  simple('floor-lamp', 'Floor lamp', 'lighting', 'standing lamp light', { kind: 'decor', category: 'decoration', width: 40, depth: 40, height: 160, color: '#f3ead8', light: lamp(800) }),
  simple('reading-lamp', 'Reading lamp', 'lighting', 'floor lamp light', { kind: 'decor', category: 'decoration', width: 30, depth: 30, height: 140, color: LINEN, light: lamp(600, 'down') }),
  built('arc-lamp', 'Arc floor lamp', 'lighting', 'arching lamp light', { kind: 'decor', category: 'decoration', width: 150, depth: 40, height: 200, color: BRASS, light: lamp(800, 'down') }, arcLamp),
  built('tripod-lamp', 'Tripod lamp', 'lighting', 'floor lamp light', { kind: 'decor', category: 'decoration', width: 50, depth: 50, height: 150, color: LINEN, light: lamp(800) }, tripodLamp),
  simple('table-lamp', 'Table lamp', 'lighting', 'desk lamp bedside light', { kind: 'decor', category: 'decoration', width: 25, depth: 25, height: 45, color: '#f3ead8', light: lamp(450) }),
  // Décor and plants -------------------------------------------------------------------
  simple('plant-small', 'Small plant', 'decor', 'pot houseplant', plantSize(30, 50)),
  simple('plant-medium', 'Plant', 'decor', 'pot houseplant', plantSize(45, 100)),
  simple('plant-large', 'Large plant', 'decor', 'pot houseplant monstera', plantSize(65, 150)),
  simple('plant-tree', 'Indoor tree', 'decor', 'fig palm tree pot', plantSize(80, 200)),
  simple('vase', 'Floor vase', 'decor', 'urn pot', { kind: 'decor', category: 'decoration', width: 30, depth: 30, height: 60, color: TERRACOTTA }),
  built('floor-mirror', 'Floor mirror', 'decor', 'standing mirror', { kind: 'decor', category: 'decoration', width: 60, depth: 6, height: 170, color: OAK }, floorMirror),
  built('room-divider', 'Room divider', 'decor', 'folding screen partition', { kind: 'decor', category: 'decoration', width: 150, depth: 25, height: 170, color: OAK }, divider),
  built('basket', 'Blanket basket', 'decor', 'storage basket throw', { kind: 'decor', category: 'decoration', width: 40, depth: 40, height: 45, color: '#c7ab82' }, basket),
  // Rugs -------------------------------------------------------------------------------
  simple('rug-160', 'Rug 160 × 230', 'rugs', 'carpet', { kind: 'decor', category: 'floorCovering', width: 230, depth: 160, height: 1, color: '#d9cdb8', texture: 'bordered' }),
  simple('rug-200', 'Rug 200 × 300', 'rugs', 'carpet large', { kind: 'decor', category: 'floorCovering', width: 300, depth: 200, height: 1, color: '#e3dac9', texture: 'woven' }),
  simple('rug-120', 'Rug 120 × 170', 'rugs', 'carpet small', { kind: 'decor', category: 'floorCovering', width: 170, depth: 120, height: 1, color: SAGE, texture: 'plain' }),
  simple('rug-round', 'Round rug', 'rugs', 'carpet circle', { kind: 'decor', category: 'floorCovering', width: 160, depth: 160, height: 1, color: '#d9cdb8', texture: 'woven', shape: ellipse(160, 160) }),
  simple('rug-striped', 'Striped rug', 'rugs', 'carpet stripes', { kind: 'decor', category: 'floorCovering', width: 200, depth: 140, height: 1, color: TERRACOTTA, texture: 'striped' }),
  simple('runner', 'Runner', 'rugs', 'hallway rug', { kind: 'decor', category: 'floorCovering', width: 240, depth: 80, height: 1, color: TERRACOTTA, texture: 'striped' }),
  simple('bath-mat', 'Bath mat', 'rugs', 'bathroom mat', { kind: 'decor', category: 'floorCovering', width: 80, depth: 50, height: 1, color: MIST, texture: 'plain' }),
  simple('outdoor-rug', 'Outdoor rug', 'rugs', 'patio rug', { kind: 'decor', category: 'floorCovering', width: 240, depth: 170, height: 1, color: '#cfc7b6', texture: 'checked' }),
  simple('door-mat', 'Door mat', 'rugs', 'entry mat', { kind: 'decor', category: 'floorCovering', width: 90, depth: 60, height: 1, color: '#e8dcc6', texture: 'woven' }),
];

// Builder templates take their names from the template unless overridden.
for (const item of CATALOGUE) if (!item.name) item.name = item.make().name;

/** Items matching a search (name, category and extra words), optionally in one category. */
export function searchCatalogue(query: string, category: CatalogueCategory | 'all' = 'all'): CatalogueItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return CATALOGUE.filter((item) => {
    if (category !== 'all' && item.category !== category) return false;
    const text = `${item.name} ${CATEGORY_LABELS[item.category]} ${item.tags}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
