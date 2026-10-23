import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from 'fflate';
import type { Furniture, Project } from '../model/types';
import { existingAssetIds, getAsset, putAsset, sniffImageType } from './assets';
import { MAX_IMPORT_BYTES, furnitureAssetIds, parseProjectFile, projectAssetIds, serializeProject, type ParseResult } from './projectFile';

/**
 * Exporting and importing whole projects, photos included.
 *
 * - Projects without photos are exported as plain JSON (as before).
 * - Projects with photos are exported as a ZIP: `project.json` plus `assets/<sha256>.<ext>`.
 *   An export never refers to a photo it doesn't contain.
 * - Imports treat the file as untrusted: only `project.json` and image files named by their
 *   hash are read; images must really be PNG, JPEG or WebP (checked by their bytes, never
 *   SVG), must decode, and are re-hashed; sizes are capped.
 */

const MAX_ZIP_BYTES = 80 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 60 * 1024 * 1024;
const ASSET_PATH = /^assets\/([0-9a-f]{64})\.(png|jpe?g|webp)$/;
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export interface ExportedFile {
  blob: Blob;
  filename: string;
  /** Photos the project referred to that weren't on this device (left out of the export). */
  missing: number;
}

function baseName(project: Project): string {
  return project.name.replace(/[^\w\- ]+/g, '').trim() || 'room';
}

export async function exportProjectFile(project: Project): Promise<ExportedFile> {
  const ids = projectAssetIds(project);
  if (ids.length === 0) {
    return { blob: new Blob([serializeProject(project)], { type: 'application/json' }), filename: `${baseName(project)}.roomination.json`, missing: 0 };
  }
  const files: Record<string, Uint8Array> = {};
  const included = new Set<string>();
  for (const id of ids) {
    const asset = await getAsset(id);
    if (!asset) continue;
    files[`assets/${id}.${EXTENSIONS[asset.type] ?? 'png'}`] = new Uint8Array(await asset.blob.arrayBuffer());
    included.add(id);
  }
  // Never export a reference to a photo the file doesn't contain.
  const exported = withAssets(project, (id) => (included.has(id) ? id : null));
  if (included.size === 0) {
    return { blob: new Blob([serializeProject(exported)], { type: 'application/json' }), filename: `${baseName(project)}.roomination.json`, missing: ids.length };
  }
  files['project.json'] = strToU8(serializeProject(exported));
  // Photos are already compressed, so they're stored as-is (level 0); the JSON is compressed.
  const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) => [name, [data, { level: name.endsWith('.json') ? 6 : 0 }]])));
  return { blob: new Blob([zipped], { type: 'application/zip' }), filename: `${baseName(project)}.roomination.zip`, missing: ids.length - included.size };
}

export type ImportResult = (ParseResult & { ok: false }) | { ok: true; project: Project; warnings: string[] };

/**
 * Reads a JSON or ZIP project file. Photos inside a ZIP are checked and stored on this device.
 * `canDecode` checks an image really opens (the browser's decoder by default).
 */
export async function importProjectFile(file: Blob, canDecode: (blob: Blob) => Promise<boolean> = decodes): Promise<ImportResult> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  if (!isZip) {
    if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: 'That file is too large to be a Roomination project.' };
    const result = parseProjectFile(await file.text());
    if (!result.ok) return result;
    return { ok: true, project: dropMissing(result.project, await existingAssetIds(projectAssetIds(result.project))), warnings: [] };
  }

  if (file.size > MAX_ZIP_BYTES) return { ok: false, error: 'That file is too large to import (over 80 MB).' };
  let entries: Unzipped;
  let total = 0;
  let tooBig = false;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      // Only ever unpack the project and hash-named images, and refuse anything oversized.
      filter: (entry) => {
        const wanted = entry.name === 'project.json' || ASSET_PATH.test(entry.name);
        if (!wanted) return false;
        const limit = entry.name === 'project.json' ? MAX_IMPORT_BYTES : MAX_IMAGE_BYTES;
        if (entry.originalSize > limit) tooBig = true;
        total += entry.originalSize;
        return !tooBig && total <= MAX_TOTAL_IMAGE_BYTES + MAX_IMPORT_BYTES;
      },
    });
  } catch {
    return { ok: false, error: 'That ZIP file is damaged or isn’t a Roomination project.' };
  }
  if (tooBig || total > MAX_TOTAL_IMAGE_BYTES + MAX_IMPORT_BYTES) return { ok: false, error: 'That file contains photos that are too large to import safely.' };
  if (!entries['project.json']) return { ok: false, error: 'That ZIP file doesn’t contain a Roomination project.' };
  const parsed = parseProjectFile(strFromU8(entries['project.json']));
  if (!parsed.ok) return parsed;

  const warnings: string[] = [];
  const stored = new Map<string, string>();
  let rejected = 0;
  for (const [name, bytes] of Object.entries(entries)) {
    const match = ASSET_PATH.exec(name);
    if (!match) continue;
    const type = sniffImageType(bytes.subarray(0, 16));
    const blob = type ? new Blob([new Uint8Array(bytes)], { type }) : null;
    if (!blob || !(await canDecode(blob))) {
      rejected++;
      continue;
    }
    // Stored under its real hash (even if the file was renamed or edited after export),
    // and the project's references are pointed at that.
    stored.set(match[1], await putAsset(blob, await imageSize(blob)));
  }
  if (rejected > 0) warnings.push(`${rejected} file${rejected === 1 ? '' : 's'} in the ZIP ${rejected === 1 ? 'wasn’t a usable image and was' : 'weren’t usable images and were'} skipped.`);

  const onDevice = await existingAssetIds(projectAssetIds(parsed.project).filter((id) => !stored.has(id)));
  let dropped = 0;
  const project = withAssets(parsed.project, (id) => {
    const mapped = stored.get(id) ?? (onDevice.has(id) ? id : null);
    if (!mapped) dropped++;
    return mapped;
  });
  if (dropped > 0) warnings.push(`${dropped} photo reference${dropped === 1 ? ' was' : 's were'} missing from the file; those pieces use their colour and material instead.`);
  return { ok: true, project, warnings };
}

/** Removes references to photos that aren't stored on this device (e.g. a JSON exported elsewhere). */
function dropMissing(project: Project, available: Set<string>): Project {
  return withAssets(project, (id) => (available.has(id) ? id : null));
}

/** Rewrites (or, returning null, removes) every photo reference in a project. */
export function withAssets(project: Project, map: (id: string) => string | null): Project {
  const texture = <T extends { assetId: string }>(t: T | undefined): T | undefined => {
    if (!t) return undefined;
    const id = map(t.assetId);
    return id ? { ...t, assetId: id } : undefined;
  };
  const room = project.room;
  const { photo, ...floor } = room.floor;
  const { wallTexture, wallFinishes, ...walls } = room;
  const floorPhoto = texture(photo);
  const wallTex = texture(wallTexture);
  const finishes = Object.fromEntries(
    Object.entries(wallFinishes ?? {})
      .map(([id, f]) => {
        const t = texture(f.texture);
        const next = { ...(f.color ? { color: f.color } : {}), ...(t ? { texture: t } : {}) };
        return [id, next] as const;
      })
      .filter(([, f]) => f.color || f.texture),
  );
  const photos = (project.referencePhotos ?? []).map((p) => texture(p)).filter((p) => p !== undefined);
  const { referencePhotos: _photos, ...rest } = project;
  return {
    ...rest,
    room: {
      ...walls,
      floor: { ...floor, ...(floorPhoto ? { photo: floorPhoto } : {}) },
      ...(wallTex ? { wallTexture: wallTex } : {}),
      ...(Object.keys(finishes).length ? { wallFinishes: finishes } : {}),
    },
    furniture: project.furniture.map((f) => remapFurniture(f, map)),
    ...(photos.length ? { referencePhotos: photos } : {}),
  };
}

function remapFurniture(item: Furniture, map: (id: string) => string | null): Furniture {
  if (furnitureAssetIds(item).length === 0 || !item.appearance) return item;
  const { textures, photos, ...rest } = item.appearance;
  const nextTextures = Object.fromEntries(
    Object.entries(textures ?? {})
      .map(([surface, id]) => [surface, id ? map(id) : null])
      .filter(([, id]) => id),
  );
  const nextPhotos = (photos ?? []).map(map).filter((id): id is string => id !== null);
  return {
    ...item,
    appearance: { ...rest, ...(Object.keys(nextTextures).length ? { textures: nextTextures } : {}), ...(nextPhotos.length ? { photos: nextPhotos } : {}) },
  };
}

async function decodes(blob: Blob): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(blob);
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap !== 'function') return { width: 0, height: 0 };
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: 0, height: 0 };
  }
}
