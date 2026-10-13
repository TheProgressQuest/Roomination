import { db, type StoredAsset } from './db';
import { furnitureAssetIds, parseProject } from './projectFile';
import { listLibraryRecords } from './library';

/**
 * Photos (furniture textures and reference photos), stored in IndexedDB on this device.
 *
 * - Each photo is stored once, named by the SHA-256 of its bytes, so reusing a photo in
 *   several projects or library items never duplicates it.
 * - Only PNG, JPEG and WebP are accepted, recognised by their bytes (never SVG).
 * - Nothing is deleted silently: unused photos are only removed when the person confirms.
 */

export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp';

/** Thrown when the browser refuses to store more (its quota is full or storage is blocked). */
export class StorageFullError extends Error {
  constructor() {
    super('There isn’t enough browser storage left to save this photo. Free some space by removing unused photos (Projects → Storage), or use a smaller photo.');
  }
}

/** Recognises an image by its first bytes, or returns null for anything else. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Stores an image and returns its id. The same bytes always get the same id, so storing a
 * photo twice keeps one copy. Throws StorageFullError when the browser is out of space.
 */
export async function putAsset(blob: Blob, size: { width: number; height: number }): Promise<string> {
  const data = await blob.arrayBuffer();
  const type = sniffImageType(new Uint8Array(data.slice(0, 16)));
  if (!type) throw new Error('Only PNG, JPEG and WebP images can be stored.');
  const id = await sha256Hex(data);
  try {
    if (await db.assets.get(id)) return id;
    await db.assets.put({ id, blob: new Blob([data], { type }), type, width: size.width, height: size.height, bytes: data.byteLength, createdAt: Date.now() });
  } catch (error) {
    if (isQuotaError(error)) throw new StorageFullError();
    throw error;
  }
  return id;
}

function isQuotaError(error: unknown): boolean {
  const name = (error as { name?: string; inner?: { name?: string } })?.name;
  const inner = (error as { inner?: { name?: string } })?.inner?.name;
  return name === 'QuotaExceededError' || inner === 'QuotaExceededError' || name === 'QuotaExceeded';
}

export async function getAsset(id: string): Promise<StoredAsset | null> {
  return (await db.assets.get(id)) ?? null;
}

/** Which of these ids are actually stored (for spotting missing photos). */
export async function existingAssetIds(ids: string[]): Promise<Set<string>> {
  const found = await db.assets.bulkGet(ids);
  return new Set(found.filter((a): a is StoredAsset => a !== undefined).map((a) => a.id));
}

// ---------------------------------------------------------------------------
// Images for drawing (cached object URLs)
// ---------------------------------------------------------------------------

const images = new Map<string, Promise<HTMLImageElement | null>>();

/** A decoded image for a stored photo, or null if it's missing or unreadable. Cached per id. */
export function loadAssetImage(id: string): Promise<HTMLImageElement | null> {
  const cached = images.get(id);
  if (cached) return cached;
  const loading = (async () => {
    const asset = await getAsset(id);
    if (!asset) return null;
    const url = URL.createObjectURL(asset.blob);
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
      return image;
    } catch {
      URL.revokeObjectURL(url);
      return null;
    }
  })();
  images.set(id, loading);
  // A missing photo may be restored later (e.g. by importing it again): don't cache the miss.
  loading.then((image) => image === null && images.delete(id));
  return loading;
}

// ---------------------------------------------------------------------------
// Storage housekeeping
// ---------------------------------------------------------------------------

export interface StorageUsage {
  /** Bytes used by this site, as reported by the browser (approximate), if available. */
  used: number | null;
  quota: number | null;
  photoCount: number;
  photoBytes: number;
}

export async function storageUsage(): Promise<StorageUsage> {
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  let photoBytes = 0;
  let photoCount = 0;
  await db.assets.each((a) => {
    photoBytes += a.bytes;
    photoCount++;
  });
  return { used: estimate?.usage ?? null, quota: estimate?.quota ?? null, photoCount, photoBytes };
}

/**
 * Photos no project and no library item refers to. Unreadable projects count as using
 * everything, so a damaged project never loses its photos to a clean-up.
 */
export async function unusedAssets(): Promise<{ id: string; bytes: number }[]> {
  const used = new Set<string>();
  let unreadable = false;
  await db.projects.each((record) => {
    const result = parseProject(record.project);
    if (!result.ok) unreadable = true;
    else for (const f of result.project.furniture) for (const id of furnitureAssetIds(f)) used.add(id);
  });
  for (const item of await listLibraryRecords()) for (const id of furnitureAssetIds(item.template)) used.add(id);
  if (unreadable) return [];
  const unused: { id: string; bytes: number }[] = [];
  await db.assets.each((a) => {
    if (!used.has(a.id)) unused.push({ id: a.id, bytes: a.bytes });
  });
  return unused;
}

/** Deletes the given photos. Only called after the person has confirmed. */
export async function deleteAssets(ids: string[]): Promise<void> {
  await db.assets.bulkDelete(ids);
  for (const id of ids) images.delete(id);
}
