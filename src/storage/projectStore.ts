import Dexie, { type EntityTable } from 'dexie';
import type { Furniture, Project } from '../model/types';

/**
 * Local persistence. Projects live in the browser's IndexedDB on this device only —
 * nothing is ever sent over the network.
 *
 * Phase 1 keeps a single "current" project. The table is keyed by id so multiple
 * projects and layout variations can be added later without a migration.
 */

const CURRENT_PROJECT_ID = 'current';

interface StoredProject {
  id: string;
  savedAt: number;
  project: Project;
}

const db = new Dexie('roomination') as Dexie & {
  projects: EntityTable<StoredProject, 'id'>;
};

db.version(1).stores({
  projects: 'id, savedAt',
});

export async function saveCurrentProject(project: Project): Promise<void> {
  await db.projects.put({ id: CURRENT_PROJECT_ID, savedAt: Date.now(), project });
}

/** Returns the saved project, or null if there is none or it can't be read. */
export async function loadCurrentProject(): Promise<Project | null> {
  const stored = await db.projects.get(CURRENT_PROJECT_ID);
  if (!stored) return null;
  return parseProject(stored.project);
}

/**
 * Checks that unknown data (from storage today, from imported files later) really
 * is a project. Returns null rather than trusting malformed data.
 */
export function parseProject(data: unknown): Project | null {
  if (!isRecord(data) || data.schemaVersion !== 1) return null;
  const { name, units, room, furniture } = data;
  if (typeof name !== 'string' || (units !== 'metric' && units !== 'imperial')) return null;
  if (!isRecord(room) || !allPositiveNumbers(room.width, room.length, room.height)) return null;
  if (!Array.isArray(furniture) || !furniture.every(isFurniture)) return null;
  return {
    schemaVersion: 1,
    name,
    units,
    room: { width: room.width as number, length: room.length as number, height: room.height as number },
    furniture: furniture.map((f) => ({ ...f })),
  };
}

function isFurniture(value: unknown): value is Furniture {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.color === 'string' &&
    allFiniteNumbers(value.x, value.y, value.rotation) &&
    allPositiveNumbers(value.width, value.depth, value.height)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function allFiniteNumbers(...values: unknown[]): boolean {
  return values.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function allPositiveNumbers(...values: unknown[]): boolean {
  return allFiniteNumbers(...values) && values.every((v) => (v as number) > 0);
}
