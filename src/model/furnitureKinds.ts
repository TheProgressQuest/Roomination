import type { FurnitureKind, OptimizerSettings, PlacementPreference, RelationshipType } from './types';

export const FURNITURE_KIND_LABELS: Record<FurnitureKind, string> = {
  desk: 'Desk',
  chair: 'Chair',
  sofa: 'Sofa',
  armchair: 'Armchair',
  bed: 'Bed',
  bedsideTable: 'Bedside table',
  table: 'Table',
  diningTable: 'Dining table',
  coffeeTable: 'Coffee table',
  bookshelf: 'Bookshelf',
  cabinet: 'Cabinet',
  storage: 'Storage',
  television: 'Television / TV unit',
  decor: 'Decorative',
  custom: 'Other',
};

export const PREFERENCE_LABELS: Record<PlacementPreference, string> = {
  againstWall: 'Against a wall',
  nearWindow: 'Near a window',
  nearOutlet: 'Near an outlet',
  facingWall: 'Facing the wall (in use)',
  facingRoom: 'Facing into the room (in use)',
  facingTelevision: 'Facing the TV',
  nearCoffeeTable: 'Near the coffee table',
  nearSeating: 'Near seating (reading area)',
  accessBothSides: 'Reachable from both sides',
  accessOneSide: 'Reachable from one side',
};

/** Which preferences are offered for each kind (users pick; nothing is assumed). */
export const PREFERENCES_FOR_KIND: Record<FurnitureKind, PlacementPreference[]> = {
  desk: ['nearWindow', 'nearOutlet', 'facingWall', 'facingRoom', 'againstWall'],
  chair: ['nearWindow'],
  sofa: ['facingTelevision', 'nearCoffeeTable', 'againstWall', 'nearWindow'],
  armchair: ['facingTelevision', 'nearCoffeeTable', 'nearWindow', 'againstWall'],
  bed: ['againstWall', 'accessBothSides', 'accessOneSide', 'nearWindow'],
  bedsideTable: ['nearOutlet', 'againstWall'],
  table: ['nearWindow', 'againstWall'],
  diningTable: ['nearWindow'],
  coffeeTable: [],
  bookshelf: ['againstWall', 'nearSeating'],
  cabinet: ['againstWall'],
  storage: ['againstWall'],
  television: ['againstWall', 'nearOutlet'],
  decor: ['nearWindow', 'againstWall'],
  custom: ['againstWall', 'nearWindow', 'nearOutlet'],
};

export const RELATIONSHIP_LABELS: Record<RelationshipType, (a: string, b: string) => string> = {
  inFrontOf: (a, b) => `${b} in front of ${a}`,
  faces: (a, b) => `${a} faces ${b}`,
  beside: (a, b) => `${b} beside ${a}`,
  near: (a, b) => `${a} near ${b}`,
};

/**
 * A conservative guess at a piece's kind from its name, used only when migrating older
 * projects (which had no kinds). Anything unrecognised becomes "Other".
 */
export function guessKind(name: string): FurnitureKind {
  const n = name.toLowerCase();
  const rules: [RegExp, FurnitureKind][] = [
    [/coffee table/, 'coffeeTable'],
    [/dining table/, 'diningTable'],
    [/bedside|nightstand/, 'bedsideTable'],
    [/\b(tv|television)\b/, 'television'],
    [/armchair/, 'armchair'],
    [/sofa|couch|settee/, 'sofa'],
    [/desk/, 'desk'],
    [/chair|stool/, 'chair'],
    [/\bbed\b/, 'bed'],
    [/book ?shelf|bookcase/, 'bookshelf'],
    [/cabinet|dresser|sideboard/, 'cabinet'],
    [/wardrobe|closet|storage|chest/, 'storage'],
    [/plant|lamp|vase|decor/, 'decor'],
    [/table/, 'table'],
  ];
  return rules.find(([pattern]) => pattern.test(n))?.[1] ?? 'custom';
}

export const DEFAULT_OPTIMIZER: OptimizerSettings = {
  mode: 'balanced',
  functionWeight: 0.6,
  walkwayWidth: 75,
  effort: 'standard',
  seed: 1,
};

/** The function weighting each mode uses (Balanced uses the user's slider). */
export function functionWeightFor(settings: Pick<OptimizerSettings, 'mode' | 'functionWeight'>): number {
  if (settings.mode === 'functional') return 0.9;
  if (settings.mode === 'aesthetic') return 0.2;
  return settings.functionWeight;
}
