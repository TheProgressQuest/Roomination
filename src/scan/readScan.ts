import { parseRoomPlan, ScanFormatError, looksLikeRoomPlan } from './roomPlan';
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
 *     meshes, depth recordings and AR world maps are listed but never opened.
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
}

export type ReadScanResult =
  | { ok: true; choices: ScanChoice[]; /** Plain-words list of what was skipped unread. */ skipped: string | null }
  | { ok: false; error: string };

const ROOM_FILE = /(?:^|\/)rooms\/room-(\d+)\.json$/;
const STRUCTURE_FILE = /(?:^|\/)structure\.json$/;
const MANIFEST_FILE = /(?:^|\/)manifest\.json$/;
const SCAN_FILE = /\.roomination-scan\.json$/i;

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
  const scan = interpret(data, source, /^room \d+$/i.test(base) || !base ? 'Scanned room' : base.slice(0, 60));
  return { ok: true, choices: [{ label: scan.name, scan }], skipped: null };
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
  // A ZIP made by hand may just hold a RoomPlan JSON at its top level.
  const loose = rooms.length + structures.length + scanFiles.length === 0 ? entries.filter((e) => /^[^/]+\.json$/.test(e.name) && !MANIFEST_FILE.test(e.name)) : [];
  const folders = new Set(rooms.map((r) => r.e.name.slice(0, r.e.name.length - r.m[0].length)));

  const choices: ScanChoice[] = [];
  const problems: string[] = [];
  const source = bundle ? '3D Model Anything scan (house-capture)' : 'Apple RoomPlan JSON (in a ZIP)';
  const add = async (entry: ZipEntry, label: string) => {
    if (choices.length >= MAX_ROOMS) return;
    try {
      const data = parseJsonText(await readText(entry));
      const scan = interpret(data, `${source}, ${entry.name.split('/').slice(-2).join('/')}`, label);
      choices.push({ label, scan: { ...scan, format: bundle ? 'house-capture' : scan.format } });
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
  for (const e of [...scanFiles, ...loose]) await add(e, e.name.split('/').pop()!.replace(/\.(roomination-scan\.)?json$/i, ''));

  if (choices.length === 0) {
    if (problems.length) return { ok: false, error: `No room in that ZIP could be read. ${problems[0]}` };
    return { ok: false, error: 'That ZIP file doesn’t contain a room scan (no rooms/room-N.json, structure.json or RoomPlan JSON).' };
  }
  for (const p of problems) choices[0].scan.notes.push(`Skipped ${p}`);
  return { ok: true, choices, skipped: describeSkipped(entries) };
}

/** "412 photos, 1,830 depth frames, a 3D mesh and an AR world map" — what stays unopened. */
function describeSkipped(entries: ZipEntry[]): string | null {
  const count = (re: RegExp) => entries.filter((e) => re.test(e.name)).length;
  const photos = count(/\.(jpe?g|heic|png)$/i) - count(/(?:^|\/)depth\/[^/]+\.jpe?g$/i);
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
  ].filter((p): p is string => typeof p === 'string');
  if (parts.length === 0) return null;
  const last = parts.pop()!;
  return parts.length ? `${parts.join(', ')} and ${last}` : last;
}
