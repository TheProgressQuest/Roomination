import { fitTemplate } from '../catalogue/fit';
import { CATALOGUE } from '../catalogue/items';
import { MIN_FURNITURE_SIZE } from '../model/geometry';
import type { FurnitureKind } from '../model/types';
import type { FurnitureTemplate } from '../storage/projectFile';

/**
 * How scanned objects become Roomination furniture.
 *
 * RoomPlan recognises 16 kinds of object and measures each as a box (no shape, colour or
 * style). Each category has a list of catalogue pieces it could be; the one closest in size
 * to the measured box is suggested, then stretched to exactly the measured width, depth and
 * height. This is ROOMINATION'S GUESS, shown separately from what the scanner reported, and
 * the person can choose another piece, a plain box, or another category.
 */

export const BOX = 'box';
export const STAIRS = 'stairs';

export interface ScanCategory {
  label: string;
  /** Catalogue ids it could be, in no particular order. */
  candidates: string[];
  /** Narrower choices when the scan says which room this part is (RoomPlan sections). */
  bySection?: Record<string, string[]>;
  /** What a plain box of this category is for. */
  kind: FurnitureKind;
}

export const SCAN_CATEGORIES: Record<string, ScanCategory> = {
  bathtub: { label: 'Bathtub', candidates: ['bathtub', 'bathtub-small', 'bathtub-freestanding'], kind: 'fixture' },
  bed: { label: 'Bed', candidates: ['bed-single', 'bed-double', 'bed-queen', 'bed-king', 'bed-super-king', 'crib'], kind: 'bed' },
  chair: {
    label: 'Chair',
    candidates: ['dining-chair', 'dining-chair-upholstered', 'office-chair', 'accent-chair', 'armchair-upholstered', 'armchair-club', 'bar-stool', 'stool'],
    bySection: { diningRoom: ['dining-chair', 'dining-chair-upholstered'], kitchen: ['dining-chair', 'bar-stool', 'stool'], livingRoom: ['accent-chair', 'armchair-upholstered', 'armchair-club'] },
    kind: 'chair',
  },
  dishwasher: { label: 'Dishwasher', candidates: ['dishwasher'], kind: 'fixture' },
  fireplace: { label: 'Fireplace', candidates: [], kind: 'fixture' },
  oven: { label: 'Oven', candidates: ['oven'], kind: 'fixture' },
  refrigerator: { label: 'Fridge', candidates: ['fridge', 'fridge-american'], kind: 'fixture' },
  sink: {
    label: 'Sink',
    candidates: ['sink-60', 'sink-double', 'vanity-integrated', 'vanity-countertop-basin', 'vanity-60', 'vanity-80', 'vanity-double', 'laundry-sink'],
    bySection: { kitchen: ['sink-60', 'sink-double'], bathroom: ['vanity-drop-in', 'vanity-integrated', 'vanity-countertop-basin', 'vanity-integrated-wide', 'vanity-60', 'vanity-80', 'vanity-double'] },
    kind: 'fixture',
  },
  sofa: { label: 'Sofa', candidates: ['loveseat', 'sofa-2', 'sofa-3', 'sofa-4', 'corner-sofa', 'sectional', 'chaise'], kind: 'sofa' },
  stairs: { label: 'Stairs', candidates: [], kind: 'custom' },
  storage: {
    label: 'Storage',
    candidates: ['wardrobe-1', 'wardrobe-2', 'wardrobe-3', 'wardrobe-4', 'bookshelf', 'bookshelf-wide', 'low-shelf', 'dresser', 'dresser-wide', 'sideboard', 'tv-unit', 'bedside', 'filing-cabinet'],
    bySection: { kitchen: ['base-40', 'base-60', 'base-80', 'drawers-60', 'pantry'], bathroom: ['bathroom-cabinet', 'wall-cabinet-bath', 'mirror-cabinet', 'vanity-integrated'] },
    kind: 'storage',
  },
  stove: { label: 'Stove or hob', candidates: ['hob-induction', 'hob-gas', 'oven'], kind: 'fixture' },
  table: {
    label: 'Table',
    candidates: ['dining-4', 'dining-6', 'dining-8', 'dining-round', 'coffee-table', 'coffee-table-round', 'side-table', 'desk-120', 'desk-140', 'desk-160'],
    bySection: { diningRoom: ['dining-4', 'dining-6', 'dining-8', 'dining-round'], kitchen: ['dining-4', 'dining-round'], livingRoom: ['coffee-table', 'coffee-table-round', 'side-table'] },
    kind: 'table',
  },
  television: { label: 'Television', candidates: [], kind: 'television' },
  toilet: { label: 'Toilet', candidates: ['toilet', 'toilet-wall'], kind: 'fixture' },
  washerDryer: { label: 'Washer or dryer', candidates: ['washer', 'dryer', 'washer-dryer-stack'], kind: 'fixture' },
};

export function categoryLabel(category: string): string {
  return SCAN_CATEGORIES[category]?.label ?? (category === 'unknown' ? 'Unknown object' : category.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()));
}

const byId = new Map(CATALOGUE.map((item) => [item.id, item]));
const sizes = new Map<string, FurnitureTemplate>();

function catalogueTemplate(id: string): FurnitureTemplate | null {
  const cached = sizes.get(id);
  if (cached) return cached;
  const item = byId.get(id);
  if (!item) return null;
  const t = item.make();
  sizes.set(id, t);
  return t;
}

export function catalogueName(id: string): string | null {
  return byId.get(id)?.name ?? null;
}

interface Measured {
  width: number;
  depth: number;
  height: number;
}

/** How different two sizes are: 0 = identical; 0.69 = one dimension twice (or half) as big. */
function sizeDistance(a: Measured, b: Measured): number {
  return Math.abs(Math.log(a.width / b.width)) + Math.abs(Math.log(a.depth / b.depth)) + Math.abs(Math.log(a.height / b.height));
}

/** How much a piece suited to the scan's room label is preferred (in size-distance units). */
const SECTION_PREFERENCE = 0.4;

/** Beyond this, stretching a catalogue piece to the measured box would distort it; a plain box is suggested instead. */
const MAX_DISTANCE = 1.6;

export interface Suggestion {
  /** A catalogue id, `box` or `stairs`. */
  as: string;
  reason: string;
}

/** The pieces offered for a category (in the review's "Shown as" menu), section-specific ones first. */
export function choicesFor(category: string, section: string | null): string[] {
  const info = SCAN_CATEGORIES[category];
  if (!info) return [];
  const preferred = (section && info.bySection?.[section]) || [];
  return [...new Set([...preferred, ...info.candidates])].filter((id) => byId.has(id));
}

export function suggestPiece(category: string, measured: Measured, section: string | null): Suggestion {
  if (category === 'stairs') return { as: STAIRS, reason: 'Scanned stairs become a straight staircase of the measured size.' };
  const info = SCAN_CATEGORIES[category];
  if (!info) return { as: BOX, reason: 'Roomination doesn’t know this kind of object, so it’s shown as a plain box of the measured size.' };
  const preferred = section ? info.bySection?.[section] : undefined;
  const pool = [...new Set([...(preferred ?? []), ...info.candidates])].filter((id) => byId.has(id));
  let best: { id: string; d: number; size: number; preferred: boolean } | null = null;
  for (const id of pool) {
    const t = catalogueTemplate(id)!;
    const size = sizeDistance(measured, t);
    // The room the scan says this is in counts, but a much better size match still wins
    // (a desk in a living room stays a desk).
    const isPreferred = !preferred || preferred.includes(id);
    const d = size + (isPreferred ? 0 : SECTION_PREFERENCE);
    if (!best || d < best.d) best = { id, d, size, preferred: isPreferred && !!preferred };
  }
  if (!best) return { as: BOX, reason: `There’s no ${info.label.toLowerCase()} in the catalogue, so it’s shown as a plain box of the measured size.` };
  if (best.size > MAX_DISTANCE) return { as: BOX, reason: `No catalogue ${info.label.toLowerCase()} is close to the measured size, so it’s shown as a plain box.` };
  const where = best.preferred ? ` for a ${section!.replace(/([A-Z])/g, ' $1').toLowerCase()} (the area the scan labelled)` : '';
  return { as: best.id, reason: `Closest catalogue ${info.label.toLowerCase()} to the measured size${where}.` };
}

/**
 * The piece to place: the chosen catalogue piece stretched to the measured size (its drawn
 * outline and components stretch with it), or a plain box.
 */
export function pieceFor(as: string, category: string, size: Measured): FurnitureTemplate {
  const width = Math.max(MIN_FURNITURE_SIZE, size.width);
  const depth = Math.max(MIN_FURNITURE_SIZE, size.depth);
  const height = Math.max(1, size.height);
  const t = as === BOX || as === STAIRS ? null : catalogueTemplate(as);
  if (!t) {
    return {
      name: `Scanned ${categoryLabel(category).toLowerCase()}`,
      category: 'furniture',
      kind: SCAN_CATEGORIES[category]?.kind ?? 'custom',
      width,
      depth,
      height,
      color: category === 'television' ? '#2a2c30' : '#d9d3c7',
      texture: 'plain',
    };
  }
  return fitTemplate(t, { width, depth, height });
}
