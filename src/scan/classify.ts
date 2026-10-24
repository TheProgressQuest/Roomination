import type { ScanObject } from './types';

/**
 * What the scanner's own classification says a scanned object is, before sizes are compared.
 *
 * RoomPlan (iOS 17+) adds details to some objects: a sofa's type (rectangular, single seat,
 * L-shaped or the short side of an L), a table's shape and use, whether storage is a shelf or a
 * cabinet, and a chair's type, arms, back and legs. Each known detail narrows the catalogue pieces
 * the object may be; the closest in size among those is then suggested (see furnitureMap.ts).
 *
 * Three kinds of information are kept apart:
 *   - measured: the box (size, position, turn), always authoritative;
 *   - classified: what the scanner said (these details), stated as the scanner's;
 *   - inferred: Roomination's conclusions (a cabinet with a chair linked to it is probably a desk),
 *     always labelled as Roomination's and never stored as the scanner's.
 *
 * Unknown and "unidentified" values narrow nothing. When two details contradict each other (a
 * "stool" with arms), the more specific type wins and the disagreement is reported, not hidden.
 * Nothing here knows about any particular room: only the scanner's vocabulary.
 */

export type ClassificationBasis = 'classified' | 'inferred' | 'size';

export interface Classification {
  /** Catalogue ids the details allow, in no particular order; null when nothing narrows them. */
  pool: string[] | null;
  /** What the scanner said, in plain words for a sentence ("a rectangular dining table"); null if nothing usable. */
  said: string | null;
  basis: ClassificationBasis;
  /** Details that disagreed with the others and were set aside, in plain words. */
  conflict: string | null;
}

const DINING_CHAIRS = ['dining-chair', 'dining-chair-upholstered', 'dining-chair-black'];
const STOOLS = ['bar-stool', 'stool'];
const ARMCHAIRS = ['armchair-upholstered', 'armchair-club', 'armchair-leather', 'accent-chair', 'tub-chair'];
const STRAIGHT_SOFAS = ['loveseat', 'deep-loveseat', 'sofa-2', 'sofa-3', 'sofa-4'];
const RECT_DINING = ['dining-4', 'dining-6', 'dining-8', 'dining-marble'];
const ROUND_DINING = ['dining-round', 'dining-oval'];
const RECT_COFFEE = ['coffee-table', 'coffee-table-walnut'];
const ROUND_COFFEE = ['coffee-table-round', 'coffee-table-oval'];
const DESKS = ['desk-120', 'desk-140', 'desk-160', 'standing-desk', 'dressing-table'];
export const SHELVES = ['bookshelf', 'bookshelf-wide', 'low-shelf', 'office-bookcase'];
export const CABINETS = ['sideboard', 'display-cabinet', 'dresser', 'dresser-wide', 'filing-cabinet', 'bedside', 'tv-unit', 'tv-unit-long', 'wardrobe-1', 'wardrobe-2', 'wardrobe-3', 'wardrobe-4', 'base-40', 'base-60', 'base-80', 'drawers-60', 'pantry', 'bathroom-cabinet', 'wall-cabinet-bath', 'mirror-cabinet'];

interface Detail {
  /** RoomPlan's attribute key. */
  key: string;
  /** Known values: the pieces each allows, and how to say it. */
  values: Record<string, { pool: string[]; words: string }>;
}

/** Per category, its details in order of authority (the type first, then its features). */
const DETAILS: Record<string, Detail[]> = {
  sofa: [
    {
      key: 'SofaType',
      values: {
        rectangular: { pool: STRAIGHT_SOFAS, words: 'a straight sofa' },
        singleSeat: { pool: ['armchair-upholstered', 'armchair-club', 'accent-chair', 'loveseat', 'deep-loveseat'], words: 'a single-seat sofa' },
        // Alone (its extension not linked or not joinable), the long side is shown straight.
        lShaped: { pool: STRAIGHT_SOFAS, words: 'the long side of an L-shaped sofa' },
        lShapedExtension: { pool: ['chaise'], words: 'the short side of an L-shaped sofa' },
      },
    },
  ],
  table: [
    {
      key: 'TableShapeType',
      values: {
        rectangular: { pool: [...RECT_DINING, ...RECT_COFFEE, 'side-table', ...DESKS], words: 'rectangular' },
        circularElliptic: { pool: [...ROUND_DINING, ...ROUND_COFFEE, 'side-table-round'], words: 'round or oval' },
        lShaped: { pool: ['l-desk'], words: 'L-shaped' },
      },
    },
    {
      key: 'TableType',
      values: {
        dining: { pool: [...RECT_DINING, ...ROUND_DINING], words: 'dining' },
        coffee: { pool: [...RECT_COFFEE, ...ROUND_COFFEE], words: 'coffee' },
      },
    },
  ],
  storage: [
    {
      key: 'StorageType',
      values: {
        shelf: { pool: SHELVES, words: 'open shelving' },
        cabinet: { pool: CABINETS, words: 'a cabinet' },
      },
    },
  ],
  chair: [
    {
      key: 'ChairType',
      values: {
        dining: { pool: DINING_CHAIRS, words: 'a dining chair' },
        stool: { pool: STOOLS, words: 'a stool' },
        swivel: { pool: ['office-chair'], words: 'a swivel chair' },
      },
    },
    {
      key: 'ChairArmType',
      values: {
        existing: { pool: [...ARMCHAIRS, 'office-chair'], words: 'with arms' },
        missing: { pool: [...DINING_CHAIRS, ...STOOLS, 'office-chair'], words: 'without arms' },
      },
    },
    {
      key: 'ChairBackType',
      values: {
        existing: { pool: [...DINING_CHAIRS, ...ARMCHAIRS, 'office-chair', 'bar-stool'], words: 'with a back' },
        missing: { pool: STOOLS, words: 'without a back' },
      },
    },
    {
      key: 'ChairLegType',
      values: {
        four: { pool: [...DINING_CHAIRS, ...STOOLS, ...ARMCHAIRS], words: 'on four legs' },
        star: { pool: ['office-chair'], words: 'on a star base' },
      },
    },
  ],
};

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function classify(category: string, attributes: Record<string, string>): Classification {
  const details = DETAILS[category] ?? [];
  let pool: string[] | null = null;
  const used: string[] = [];
  const setAside: string[] = [];
  for (const d of details) {
    const known = d.values[attributes[d.key]];
    if (!known) continue; // missing, "unidentified" or a value this version doesn't know
    const next: string[] = pool === null ? known.pool : pool.filter((id) => known.pool.includes(id));
    if (next.length === 0) {
      setAside.push(`“${known.words}”`);
      continue;
    }
    pool = next;
    used.push(known.words);
  }
  if (pool === null) return { pool: null, said: null, basis: 'size', conflict: null };
  return { pool, said: describe(category, used), basis: 'classified', conflict: setAside.length ? `The scanner also said ${setAside.join(' and ')}, which doesn’t fit with the rest, so it was set aside.` : null };
}

function describe(category: string, words: string[]): string {
  if (category === 'table') {
    // "a rectangular dining table", "a round or oval table", "a coffee table"
    const text = `${words.join(' ')} table`;
    return `${/^[aeiou]/i.test(text) ? 'an' : 'a'} ${text}`;
  }
  return words.map(lower).join(', ');
}

/** Height range (cm) of a work surface a chair is pulled up to. */
const DESK_HEIGHT = { min: 65, max: 110 };
const DESK_MIN_WIDTH = 70;

/**
 * Roomination's inference (not the scanner's): storage the scanner classified as a cabinet (or
 * didn't classify), with a chair the scanner linked to it, at work-surface height and wide enough,
 * outside a kitchen or bathroom, is probably a desk or a dressing table. Null when it doesn't apply.
 */
export function inferDesk(object: ScanObject, all: ScanObject[], section: string | null): Classification | null {
  if (object.category !== 'storage') return null;
  const type = object.attributes.StorageType;
  if (type !== undefined && type !== 'cabinet' && type !== 'unidentified') return null;
  if (section === 'kitchen' || section === 'bathroom') return null;
  if (object.height < DESK_HEIGHT.min || object.height > DESK_HEIGHT.max || object.width < DESK_MIN_WIDTH) return null;
  const chairs = all.filter((o) => o.parentId === object.id && o.category === 'chair').length;
  if (chairs === 0) return null;
  return {
    pool: [...DESKS, 'l-desk'],
    said: `storage${type === 'cabinet' ? ' (a cabinet)' : ''}, with ${chairs === 1 ? 'a chair' : `${chairs} chairs`} linked to it`,
    basis: 'inferred',
    conflict: null,
  };
}
