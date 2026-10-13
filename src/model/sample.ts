import type { Furniture, Project, Room } from './types';

/** Warm, distinguishable furniture colours. Names are read out by screen readers. */
export const FURNITURE_COLORS = [
  { name: 'Terracotta', value: '#e9a178' },
  { name: 'Sage', value: '#8fb996' },
  { name: 'Honey', value: '#f2c879' },
  { name: 'Sky', value: '#9bb7d4' },
  { name: 'Lavender', value: '#c9a7d8' },
  { name: 'Rose', value: '#d98f8f' },
];

export function createId(): string {
  // randomUUID is only available on HTTPS/localhost; fall back for e.g. testing over a LAN IP.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createFurniture(fields: Partial<Furniture> & Pick<Furniture, 'x' | 'y'>): Furniture {
  return {
    id: createId(),
    name: 'New piece',
    width: 80,
    depth: 50,
    height: 75,
    rotation: 0,
    color: FURNITURE_COLORS[0].value,
    ...fields,
  };
}

export const DEFAULT_ROOM: Room = { width: 400, length: 350, height: 250 };

export function createEmptyProject(room: Room = DEFAULT_ROOM): Project {
  return { schemaVersion: 1, name: 'My room', units: 'metric', room, furniture: [] };
}

/** A cosy living room so first-time visitors have something to play with. */
export function createSampleProject(): Project {
  return {
    schemaVersion: 1,
    name: 'Sample living room',
    units: 'metric',
    room: { width: 480, length: 380, height: 260 },
    furniture: [
      createFurniture({ name: 'Sofa', x: 240, y: 330, width: 220, depth: 90, height: 85, color: '#e9a178' }),
      createFurniture({ name: 'Coffee table', x: 240, y: 220, width: 110, depth: 60, height: 45, color: '#f2c879' }),
      createFurniture({ name: 'TV console', x: 240, y: 25, width: 160, depth: 40, height: 55, color: '#9bb7d4' }),
      createFurniture({ name: 'Armchair', x: 70, y: 200, width: 80, depth: 80, height: 90, rotation: 90, color: '#8fb996' }),
      createFurniture({ name: 'Bookshelf', x: 455, y: 150, width: 100, depth: 35, height: 180, rotation: 90, color: '#c9a7d8' }),
      createFurniture({ name: 'Plant', x: 445, y: 330, width: 45, depth: 45, height: 120, color: '#8fb996' }),
    ],
  };
}
