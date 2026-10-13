import Dexie, { type EntityTable } from 'dexie';

/**
 * The app's one IndexedDB database, on this device only — nothing is ever sent anywhere.
 *
 * - projects: one record per saved project (validated and migrated every time it's read)
 * - assets:   photos, stored once each and named by the SHA-256 of their bytes
 * - library:  reusable furniture, shared by every project on this device
 */

export interface StoredProject {
  id: string;
  savedAt: number;
  /** Stored as written; validated and migrated every time it is read. */
  project: unknown;
}

export interface StoredAsset {
  /** SHA-256 of the bytes, as hex. */
  id: string;
  blob: Blob;
  /** image/webp, image/png or image/jpeg. */
  type: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: number;
}

export interface StoredLibraryItem {
  id: string;
  savedAt: number;
  /** A furniture template; validated every time it is read. */
  item: unknown;
}

export const db = new Dexie('roomination') as Dexie & {
  projects: EntityTable<StoredProject, 'id'>;
  assets: EntityTable<StoredAsset, 'id'>;
  library: EntityTable<StoredLibraryItem, 'id'>;
};

db.version(1).stores({ projects: 'id, savedAt' });
// Version 2 (Phase 3C) adds photos and the furniture library; existing projects are untouched.
db.version(2).stores({ projects: 'id, savedAt', assets: 'id, createdAt', library: 'id, savedAt' });
