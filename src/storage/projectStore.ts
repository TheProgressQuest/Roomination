import Dexie, { type EntityTable } from 'dexie';
import { createId } from '../model/sample';
import type { Project } from '../model/types';
import { parseProject } from './projectFile';

/**
 * Local persistence. Projects live in the browser's IndexedDB on this device only —
 * nothing is ever sent over the network.
 *
 * Each project is one record. Phase 1 stored a single record with the id "current";
 * it is still read like any other project (and migrated to the new format on load).
 */

interface StoredProject {
  id: string;
  savedAt: number;
  /** Stored as written; validated and migrated every time it is read. */
  project: unknown;
}

export interface ProjectSummary {
  id: string;
  name: string;
  savedAt: number;
  furnitureCount: number;
  /** False when the record couldn't be read; it is listed (never silently deleted) but can't be opened. */
  readable: boolean;
}

const db = new Dexie('roomination') as Dexie & {
  projects: EntityTable<StoredProject, 'id'>;
};

db.version(1).stores({
  projects: 'id, savedAt',
});

const ACTIVE_PROJECT_KEY = 'roomination.activeProjectId';

export function newProjectId(): string {
  return createId();
}

export async function saveProject(id: string, project: Project): Promise<void> {
  await db.projects.put({ id, savedAt: Date.now(), project });
}

/** Returns the project, migrated to the current format, or null if missing or unreadable. */
export async function loadProject(id: string): Promise<Project | null> {
  const stored = await db.projects.get(id);
  if (!stored) return null;
  const result = parseProject(stored.project);
  return result.ok ? result.project : null;
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id);
}

/** All saved projects, most recently saved first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const records = await db.projects.orderBy('savedAt').reverse().toArray();
  return records.map((record) => {
    const result = parseProject(record.project);
    return {
      id: record.id,
      name: result.ok ? result.project.name : 'Unreadable project',
      savedAt: record.savedAt,
      furnitureCount: result.ok ? result.project.furniture.length : 0,
      readable: result.ok,
    };
  });
}

/** Which project was open last. Kept in localStorage; failures are harmless. */
export function getActiveProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function setActiveProjectId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_PROJECT_KEY, id);
  } catch {
    // Storage blocked (e.g. private mode): the app still works, it just won't remember.
  }
}

/** Picks a name that doesn't clash with existing projects, e.g. "Studio (2)". */
export function uniqueProjectName(name: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}
