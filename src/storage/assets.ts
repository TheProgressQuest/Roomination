import { db, type StoredAsset, type StoredAssetRecord } from './db';
import { furnitureAssetIds, parseProject, projectAssetIds } from './projectFile';
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
/** Imported 3D models are stored next to photos, always as GLB. */
export type AssetType = ImageType | 'model/gltf-binary';

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

/**
 * Thrown when the page isn't a secure context (an http:// address on the network, as when
 * testing from another device), where browsers withhold the hashing used to store photos.
 */
export class InsecurePageError extends Error {
  constructor() {
    super('Photos and 3D models can only be saved when Roomination is opened from an https:// address (or localhost). This address is plain http://. On a phone, use the https:// test address.');
  }
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) throw new InsecurePageError();
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** An image, or a GLB model (glTF 2 binary), recognised by its first bytes; null for anything else. */
export function sniffAssetType(bytes: Uint8Array): AssetType | null {
  if (bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46 && bytes[4] === 2) return 'model/gltf-binary';
  return sniffImageType(bytes);
}

/**
 * Stores an image (or an imported model's GLB) and returns its id. The same bytes always get the same id, so storing a
 * photo twice keeps one copy. Throws StorageFullError when the browser is out of space.
 */
export async function putAsset(blob: Blob, size: { width: number; height: number }): Promise<string> {
  const data = await blob.arrayBuffer();
  const type = sniffAssetType(new Uint8Array(data.slice(0, 16)));
  if (!type) throw new Error('Only PNG, JPEG and WebP images (and GLB models) can be stored.');
  const id = await sha256Hex(data);
  try {
    if (await db.assets.get(id)) return id;
    // Plain bytes, not a Blob: Safari can't store Blobs in private browsing.
    await db.assets.put({ id, data, type, width: size.width, height: size.height, bytes: data.byteLength, createdAt: Date.now() });
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
  const record = await db.assets.get(id);
  return record ? toAsset(record) : null;
}

/** A stored photo as a Blob, whether it was saved as bytes (now) or as a Blob (before). */
function toAsset({ data, blob, ...rest }: StoredAssetRecord): StoredAsset | null {
  const photo = blob ?? (data ? new Blob([data], { type: rest.type }) : null);
  return photo ? { ...rest, blob: photo } : null;
}

/** Which of these ids are actually stored (for spotting missing photos). */
export async function existingAssetIds(ids: string[]): Promise<Set<string>> {
  const found = await db.assets.bulkGet(ids);
  return new Set(found.filter((a): a is StoredAssetRecord => a !== undefined).map((a) => a.id));
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
 * Photos nothing refers to: no saved project, no library item, and nothing in `inUse` (the
 * open project's undo/redo history, so Undo can never bring back a piece whose photo is
 * gone). If any project or library item can't be read, nothing is offered for removal, so
 * a damaged record never loses its photos to a clean-up.
 */
export async function unusedAssets(inUse: Iterable<string> = []): Promise<{ id: string; bytes: number }[]> {
  const used = new Set<string>(inUse);
  let unreadable = false;
  await db.projects.each((record) => {
    const result = parseProject(record.project);
    if (!result.ok) unreadable = true;
    // Everything a saved project refers to: furniture photos, but also its reference photos and
    // room textures (Match My Room), which aren't furniture.
    else for (const id of projectAssetIds(result.project)) used.add(id);
  });
  const libraryRecords = await db.library.count();
  const library = await listLibraryRecords();
  if (library.length !== libraryRecords) unreadable = true;
  for (const item of library) for (const id of furnitureAssetIds(item.template)) used.add(id);
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
