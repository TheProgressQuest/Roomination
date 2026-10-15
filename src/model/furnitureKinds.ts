import type { FengShuiSettings, FurnitureKind, OptimizerSettings, OptimizerWeights, PlacementPreference, RelationshipType } from './types';

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
  fixture: 'Fixture / appliance',
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
  fixture: [],
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
  weights: { functional: 50, aesthetic: 25, fengShui: 25 },
  purpose: null,
  assumePairings: true,
};

/** Feng Shui is off until the person switches it on. */
export const DEFAULT_FENG_SHUI: FengShuiSettings = {
  enabled: false,
  method: 'entrance',
  showBagua: false,
  northBearing: null,
  entranceId: null,
};

/**
 * How much function, appearance and Feng Shui count (fractions adding up to 1) for a mode.
 * Feng Shui only counts when it's switched on for the project. Hard rules never depend on this.
 */
export function weightsFor(settings: Pick<OptimizerSettings, 'mode' | 'functionWeight' | 'weights'>, fengShuiEnabled: boolean): OptimizerWeights {
  const fromPercent = (w: OptimizerWeights): OptimizerWeights => {
    const fs = fengShuiEnabled ? Math.max(0, w.fengShui) : 0;
    const total = Math.max(0, w.functional) + Math.max(0, w.aesthetic) + fs || 1;
    return { functional: Math.max(0, w.functional) / total, aesthetic: Math.max(0, w.aesthetic) / total, fengShui: fs / total };
  };
  switch (settings.mode) {
    case 'functional':
      return { functional: 0.85, aesthetic: 0.15, fengShui: 0 };
    case 'aesthetic':
      return { functional: 0.3, aesthetic: 0.7, fengShui: 0 };
    case 'fengShui':
      return fengShuiEnabled ? { functional: 0.45, aesthetic: 0.15, fengShui: 0.4 } : { functional: 0.6, aesthetic: 0.4, fengShui: 0 };
    case 'custom':
      return fromPercent(settings.weights);
    case 'balanced':
      return { functional: settings.functionWeight, aesthetic: 1 - settings.functionWeight, fengShui: 0 };
  }
}

/** The function weighting of a mode, ignoring Feng Shui (kept for the Balanced slider). */
export function functionWeightFor(settings: Pick<OptimizerSettings, 'mode' | 'functionWeight' | 'weights'>): number {
  const w = weightsFor(settings, false);
  return w.functional / (w.functional + w.aesthetic || 1);
}
