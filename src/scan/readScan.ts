import { parseRoomPlan, ScanFormatError, looksLikeRoomPlan } from './roomPlan';
import { describeShape } from './shape';
import { looksLikeScanFile, parseScanFile } from './scanFormat';
import type { ScanData } from './types';
import { listZip, readZipEntry, ZipError, type ZipEntry } from './zip';

/**
 * Opens a scan file the person chose, entirely in this browser.
 *
 *   - A `.json` file: Apple RoomPlan JSON (CapturedRoom or CapturedStructure) or a
 *     `roomination-scan` file.
 *   - A `.zip` file: a 3D Model Anything room or session export (`house-capture/5`), or any
 *     ZIP holding one of the JSON files above. Only the geometry JSON inside is read; photos,
 *     meshes, depth recordings and AR world maps are listed but never opened. The one exception
 *     is a RoomSheet package's own reference photos (its `photos/` folder, beside
 *     `captured-room.json`): they're offered for Match my room and read only if the person
 *     keeps them, still entirely in this browser.
 */

/** Bigger than any room-scan JSON; RoomPlan JSON is typically under 1 MB. */
export const MAX_SCAN_JSON_BYTES = 25 * 1024 * 1024;
/** ZIPs carry photos and depth recordings we skip, so they may be large; we never load them whole. */
export const MAX_SCAN_ZIP_BYTES = 4 * 1024 * 1024 * 1024;
/** How much JSON is read out of one ZIP, in total. */
const MAX_TOTAL_JSON_BYTES = 60 * 1024 * 1024;
/** How many candidate rooms are read from one ZIP. */
const MAX_ROOMS = 40;

export interface ScanChoice {
  /** e.g. "Room 2", "All rooms merged". */
  label: string;
  scan: ScanData;
  /** Reference photos the package itself contains for this room (RoomSheet's photos/ folder). */
  photos: ScanPhoto[];
}

/** A photo inside the chosen package, read only if the person adds it. */
export interface ScanPhoto {
  name: string;
  /** Its size in the package, in bytes. */
  size: number;
  read: () => Promise<File>;
}

/** Photos offered from one package, at most (RoomSheet keeps a handful). */
export const MAX_PACKAGE_PHOTOS = 40;
const PACKAGE_PHOTO = /\.(jpe?g|png|heic)$/i;
const PHOTO_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic' };

export type ReadScanResult =
  | { ok: true; choices: ScanChoice[]; /** Plain-words list of what was skipped unread. */ skipped: string | null }
  | { ok: false; error: string; /** The unrecognised JSON's structure (no values), when there was one. */ shape?: string };

const ROOM_FILE = /(?:^|\/)rooms\/room-(\d+)\.json$/;
const STRUCTURE_FILE = /(?:^|\/)structure\.json$/;
const MANIFEST_FILE = /(?:^|\/)manifest\.json$/;
const SCAN_FILE = /\.roomination-scan\.json$/i;
/**
 * RoomSheet's "Export Package…" ZIP, as documented by its developer
 * (github.com/kni927/roomsheet-support): `captured-room.json` is "RoomPlan's CapturedRoom as
 * JSON: the original capture data". Its other files (metadata.json with the device and times,
 * model-edits.json, USDZ models, plans, photos/) are never opened.
 */
const ROOMSHEET_FILE = /(?:^|\/)captured-room\.json$/;
const ROOMSHEET_EDITS = /(?:^|\/)model-edits\.json$/;

export async function readScanFile(file: Blob, fileName = ''): Promise<ReadScanResult> {
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const isZip = head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05) && (head[3] === 0x04 || head[3] === 0x06);
    return isZip ? await readZip(file) : await readJson(file, fileName);
  } catch (error) {
    if (error instanceof ScanFormatError || error instanceof ZipError) return { ok: false, error: error.message };
    return { ok: false, error: 'That file couldn’t be read as a room scan.' };
  }
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ScanFormatError('That file isn’t valid JSON, so it can’t be a room scan. It may be damaged or cut short.');
  }
}

/** Recognises the scan formats, and explains the files people most often pick by mistake. */
function interpret(data: unknown, source: string, name: string): ScanData {
  if (looksLikeScanFile(data)) return parseScanFile(data, source);
  if (looksLikeRoomPlan(data)) return parseRoomPlan(data, source, name);
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  if ('schemaVersion' in record && 'room' in record) throw new ScanFormatError('That’s a Roomination project, not a room scan. Use “Import file…” to open it.');
  if ('scanRecordSchemaVersion' in record && 'displayName' in record) {
    throw new ScanFormatError('That’s RoomSheet’s small index file (scan.json), not the room itself. Choose captured-room.json from the same folder, or the RoomSheet .zip.');
  }
  if (typeof record.format === 'string' && record.format.startsWith('house-capture')) {
    throw new ScanFormatError('That’s a scan’s manifest, which lists the files but has no room geometry. Choose the room’s .zip (or its rooms/room-N.json) instead.');
  }
  throw new ScanFormatError('That file isn’t a room scan Roomination recognises. It needs to be RoomPlan JSON, a 3D Model Anything .zip or a Roomination scan file.');
}

async function readJson(file: Blob, fileName: string): Promise<ReadScanResult> {
  if (file.size > MAX_SCAN_JSON_BYTES) return { ok: false, error: 'That file is too large to be a room scan (over 25 MB).' };
  if (file.size === 0) return { ok: false, error: 'That file is empty.' };
  const data = parseJsonText(await file.text());
  const base = fileName.replace(/\.json$/i, '').replace(/[_-]+/g, ' ').trim();
  const source = looksLikeScanFile(data) ? 'Roomination scan file' : 'Apple RoomPlan JSON';
  try {
    const scan = interpret(data, source, /^room \d+$/i.test(base) || !base ? 'Scanned room' : base.slice(0, 60));
    return { ok: true, choices: [{ label: scan.name, scan, photos: [] }], skipped: null };
  } catch (error) {
    if (error instanceof ScanFormatError) return { ok: false, error: error.message, shape: describeShape(data) };
    throw error;
  }
}

async function readZip(file: Blob): Promise<ReadScanResult> {
  if (file.size > MAX_SCAN_ZIP_BYTES) return { ok: false, error: 'That ZIP file is too large to import (over 4 GB).' };
  const entries = await listZip(file);
  if (entries.some((e) => /(?:^|\/)project\.json$/.test(e.name)) && !entries.some((e) => ROOM_FILE.test(e.name) || STRUCTURE_FILE.test(e.name))) {
    return { ok: false, error: 'That’s a Roomination project, not a room scan. Use “Import file…” to open it.' };
  }
  let budget = MAX_TOTAL_JSON_BYTES;
  const readText = async (entry: ZipEntry) => {
    if (entry.size > Math.min(MAX_SCAN_JSON_BYTES, budget)) throw new ZipError(`“${entry.name}” is too large to import safely.`);
    budget -= entry.size;
    return new TextDecoder().decode(await readZipEntry(file, entry, MAX_SCAN_JSON_BYTES));
  };

  // Is it a 3D Model Anything bundle? Its manifest says so (it is small; read it only to label rooms).
  let bundle = false;
  const manifest = entries.find((e) => MANIFEST_FILE.test(e.name) && e.size < 4 * 1024 * 1024);
  if (manifest) {
    try {
      const m = JSON.parse(await readText(manifest)) as Record<string, unknown>;
      bundle = typeof m.format === 'string' ? m.format.startsWith('house-capture') : JSON.stringify(m).includes('house-capture');
    } catch {
      // An unreadable manifest only loses the label.
    }
  }

  const rooms = entries
    .map((e) => ({ e, m: ROOM_FILE.exec(e.name) }))
    .filter((r): r is { e: ZipEntry; m: RegExpExecArray } => r.m !== null)
    .sort((a, b) => a.e.name.localeCompare(b.e.name, 'en', { numeric: true }));
  const structures = entries.filter((e) => STRUCTURE_FILE.test(e.name) && !/(?:^|\/)zones\//.test(e.name));
  const scanFiles = entries.filter((e) => SCAN_FILE.test(e.name));
  const roomSheet = entries.filter((e) => ROOMSHEET_FILE.test(e.name));
  // A ZIP made by hand may just hold a RoomPlan JSON at its top level.
  const loose = rooms.length + structures.length + scanFiles.length + roomSheet.length === 0 ? entries.filter((e) => /^[^/]+\.json$/.test(e.name) && !MANIFEST_FILE.test(e.name)) : [];
  const folders = new Set(rooms.map((r) => r.e.name.slice(0, r.e.name.length - r.m[0].length)));

  const choices: ScanChoice[] = [];
  const problems: string[] = [];
  let shape: string | undefined;
  const source = bundle ? '3D Model Anything scan (house-capture)' : 'Apple RoomPlan JSON (in a ZIP)';
  const add = async (entry: ZipEntry, label: string, from = source, photos: ScanPhoto[] = []) => {
    if (choices.length >= MAX_ROOMS) return;
    try {
      const data = parseJsonText(await readText(entry));
      shape ??= describeShape(data);
      const scan = interpret(data, `${from}, ${entry.name.split('/').slice(-2).join('/')}`, label);
      choices.push({ label, scan: { ...scan, format: bundle ? 'house-capture' : scan.format }, photos });
    } catch (error) {
      if (error instanceof ZipError && /too large|ZIP bomb/.test(error.message)) throw error;
      problems.push(`${label}: ${error instanceof Error ? error.message : 'unreadable'}`);
    }
  };
  for (const { e, m } of rooms) {
    const folder = e.name.slice(0, e.name.length - m[0].length).replace(/\/$/, '');
    await add(e, `Room ${m[1]}${folders.size > 1 && folder ? ` (${folder.split('/').pop()})` : ''}`);
  }
  for (const e of structures) await add(e, structures.length > 1 ? `All rooms merged (${e.name.split('/').slice(-2, -1)[0] ?? ''})` : 'All rooms merged');
  for (const e of roomSheet) {
    const folder = e.name.split('/').slice(-2, -1)[0];
    await add(e, roomSheet.length > 1 && folder ? folder : 'Scanned room', 'RoomSheet package (RoomPlan CapturedRoom)', packagePhotos(file, entries, e.name.slice(0, -'captured-room.json'.length)));
  }
  for (const e of [...scanFiles, ...loose]) await add(e, e.name.split('/').pop()!.replace(/\.(roomination-scan\.)?json$/i, ''));
  if (roomSheet.length && entries.some((e) => ROOMSHEET_EDITS.test(e.name))) {
    for (const c of choices) c.scan.notes.push('Edits made in RoomSheet aren’t included: Roomination imports the original capture, exactly as scanned. Make any corrections here in the review.');
  }

  if (choices.length === 0) {
    if (problems.length) return { ok: false, error: `No room in that ZIP could be read. ${problems[0]}`, shape };
    return { ok: false, error: 'That ZIP file doesn’t contain a room scan (no rooms/room-N.json, structure.json or RoomPlan JSON).' };
  }
  for (const p of problems) choices[0].scan.notes.push(`Skipped ${p}`);
  const offered = new Set(choices.flatMap((c) => c.photos.map((p) => p.name)));
  return { ok: true, choices, skipped: describeSkipped(entries.filter((e) => !offered.has(e.name))) };
}

/** The photos in a RoomSheet package's photos/ folder (`folder` ends with "/" or is ""), in name order. */
function packagePhotos(file: Blob, entries: ZipEntry[], folder: string): ScanPhoto[] {
  return entries
    .filter((e) => e.name.startsWith(`${folder}photos/`) && !e.name.slice(folder.length + 7).includes('/') && PACKAGE_PHOTO.test(e.name) && e.size > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
    .slice(0, MAX_PACKAGE_PHOTOS)
    .map((entry) => ({
      name: entry.name,
      size: entry.size,
      read: async () => {
        const bytes = await readZipEntry(file, entry, MAX_PHOTO_BYTES);
        const extension = entry.name.split('.').pop()!.toLowerCase();
        return new File([bytes as Uint8Array<ArrayBuffer>], entry.name.split('/').pop()!, { type: PHOTO_TYPES[extension] ?? '' });
      },
    }));
}

/** Larger than any phone photo; Match my room refuses photos over 30 MB anyway. */
const MAX_PHOTO_BYTES = 40 * 1024 * 1024;

/** "412 photos, 1,830 depth frames, a 3D mesh and an AR world map" — what stays unopened. */
function describeSkipped(entries: ZipEntry[]): string | null {
  const count = (re: RegExp) => entries.filter((e) => re.test(e.name)).length;
  const previews = count(/(?:^|\/)(?:scan-preview[^/]*|plan-preview)\.png$/i);
  const photos = count(/\.(jpe?g|heic|png)$/i) - count(/(?:^|\/)depth\/[^/]+\.jpe?g$/i) - count(/(?:^|\/)plan\.png$/i) - previews;
  const plans = count(/(?:^|\/)plan\.(pdf|png|svg|csv)$|\.sh3d$/i);
  const metadata = count(/(?:^|\/)metadata\.json$/i) > 0;
  const edits = count(/(?:^|\/)model-edits\.json$/i) > 0;
  const depth = count(/\.f16z$/i);
  const meshes = count(/\.(ply|usdz|obj|glb)$/i);
  const maps = count(/\.arworldmap$/i);
  const raw = count(/-data\.json$/i);
  const parts = [
    photos > 0 && `${photos.toLocaleString('en')} photo${photos === 1 ? '' : 's'}`,
    depth > 0 && `${depth.toLocaleString('en')} depth frame${depth === 1 ? '' : 's'}`,
    meshes > 0 && `${meshes} 3D model${meshes === 1 ? '' : 's'}`,
    maps > 0 && `${maps === 1 ? 'an AR world map' : `${maps} AR world maps`}`,
    raw > 0 && `${raw} raw capture file${raw === 1 ? '' : 's'}`,
    plans > 0 && `${plans} floor-plan export${plans === 1 ? '' : 's'}`,
    previews > 0 && `${previews} preview image${previews === 1 ? '' : 's'}`,
    (metadata || edits) && `the scanning app’s ${metadata && edits ? 'metadata and edits' : metadata ? 'metadata' : 'edits'}`,
  ].filter((p): p is string => typeof p === 'string');
  if (parts.length === 0) return null;
  const last = parts.pop()!;
  return parts.length ? `${parts.join(', ')} and ${last}` : last;
}
