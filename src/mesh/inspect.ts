import { unzipSync } from 'fflate';

/**
 * Checks on 3D model files before any loader sees them (Import 3D model). Everything here is
 * plain parsing of the file's structure: nothing is decoded, rendered or fetched.
 *
 * What it guards against:
 *  - files that aren't what they claim, or are damaged (wrong header, lengths out of range);
 *  - references to anything outside the chosen files (web addresses, absolute paths, `..`),
 *    which would make the browser fetch something: privacy leak, or a broken model;
 *  - compressed meshes or textures that need decoders downloaded from the web (Draco, meshopt,
 *    Basis/KTX2), which Roomination doesn't fetch;
 *  - sizes that would exhaust a phone: file bytes, unpacked archive bytes, triangles.
 */

/** Largest file (or set of files) accepted for import. */
export const MAX_IMPORT_BYTES = 80 * 1024 * 1024;
/** Largest model kept after import (it's re-saved as one compact GLB). */
export const MAX_STORED_MODEL_BYTES = 40 * 1024 * 1024;
/** More triangles than this are refused; scanning apps can export a lighter version. */
export const MAX_TRIANGLES = 1_000_000;
/** Above this, a model is heavy for phones (it still imports, with a warning). */
export const HEAVY_TRIANGLES = 250_000;
/** USDZ archives: entries and unpacked bytes. */
const MAX_ARCHIVE_ENTRIES = 2000;
const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;

export type ModelFormat = 'glb' | 'gltf' | 'usdz' | 'usdc' | 'usda';

/** The kind of model in a file, from its bytes (and, for text formats, its first characters). */
export function detectFormat(bytes: Uint8Array): ModelFormat | null {
  const ascii = (n: number) => String.fromCharCode(...bytes.subarray(0, n));
  if (ascii(4) === 'glTF') return 'glb';
  if (ascii(8) === 'PXR-USDC') return 'usdc';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'usdz';
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart();
  if (head.startsWith('#usda')) return 'usda';
  if (head.startsWith('{')) return 'gltf';
  return null;
}

/** A plain-language reason for files Roomination recognises but can't read. */
export function unsupportedReason(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (['obj', 'fbx', 'ply', 'stl', 'las', 'spz', '3ds', 'dae', 'blend'].includes(ext))
    return `.${ext} files can’t be imported. In your scanning app, export the model as GLB (or USDZ) instead.`;
  if (ext === 'reality') return '.reality files can’t be read. Export as USDZ instead (Reality Composer: Share → Export → USDZ).';
  return null;
}

export class ModelFileError extends Error {}

const fail = (message: string): never => {
  throw new ModelFileError(message);
};

// ---------------------------------------------------------------------------
// glTF / GLB
// ---------------------------------------------------------------------------

export interface GltfJson {
  asset?: { version?: string };
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  buffers?: { uri?: string; byteLength?: number }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  accessors?: { count?: number }[];
  meshes?: { primitives?: { attributes?: Record<string, number>; indices?: number; mode?: number }[] }[];
  nodes?: unknown[];
}

/** Splits a GLB into its JSON and binary chunk, checking every length. */
export function parseGlb(bytes: Uint8Array): { json: GltfJson; bin: Uint8Array | null } {
  if (bytes.byteLength < 20) fail('This GLB file is too short to be a model.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) fail('This isn’t a GLB file.');
  if (view.getUint32(4, true) !== 2) fail('Only glTF 2 models can be read (this one is an older version).');
  const length = view.getUint32(8, true);
  if (length > bytes.byteLength || length < 20) fail('This GLB file is damaged (its length doesn’t match).');
  let offset = 12;
  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  while (offset + 8 <= length) {
    const chunkLength = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + chunkLength > length) fail('This GLB file is damaged (a section runs past its end).');
    const chunk = bytes.subarray(start, start + chunkLength);
    if (type === 0x4e4f534a && !json) json = parseJson(chunk);
    else if (type === 0x004e4942 && !bin) bin = chunk;
    offset = start + chunkLength + ((4 - (chunkLength % 4)) % 4);
  }
  if (!json) fail('This GLB file has no model description.');
  return { json: json!, bin };
}

function parseJson(bytes: Uint8Array): GltfJson {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as GltfJson;
  } catch {
    return fail('The model’s description is damaged (not valid JSON).');
  }
}

export function parseGltfText(bytes: Uint8Array): GltfJson {
  return parseJson(bytes);
}

/** Extensions whose data can't be read without downloading a decoder. */
const NEEDS_DECODER: Record<string, string> = {
  KHR_draco_mesh_compression: 'Draco-compressed meshes',
  EXT_meshopt_compression: 'meshopt-compressed meshes',
  KHR_texture_basisu: 'Basis (KTX2) textures',
};

/** A uri a model may use: embedded data, or a relative path to one of the chosen files. */
export function isSafeRelativeUri(uri: string): boolean {
  if (uri.startsWith('data:')) return /^data:(application\/(octet-stream|gltf-buffer)|image\/(png|jpeg|webp));base64,/i.test(uri);
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return false; // http:, https:, file:, blob:, javascript: …
  if (uri.startsWith('/') || uri.startsWith('\\')) return false;
  const parts = decodeURIComponent(uri).split(/[\\/]/);
  return !parts.includes('..');
}

export interface ModelSummary {
  format: ModelFormat;
  triangles: number;
  /** Relative file names the model needs besides itself (glTF only). */
  needs: string[];
  warnings: string[];
}

/** Checks a glTF description: version, references, decoders, size. Throws ModelFileError. */
export function inspectGltf(json: GltfJson, format: 'glb' | 'gltf'): ModelSummary {
  const version = json.asset?.version;
  if (typeof version !== 'string' || !version.startsWith('2')) fail('Only glTF 2 models can be read.');
  const required = Array.isArray(json.extensionsRequired) ? json.extensionsRequired : [];
  for (const ext of required) if (NEEDS_DECODER[ext]) fail(`This model uses ${NEEDS_DECODER[ext]}, which need a decoder Roomination doesn’t download. Export it again without compression.`);
  const needs: string[] = [];
  for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (!item || typeof item.uri !== 'string') continue;
    if (!isSafeRelativeUri(item.uri)) fail('This model refers to a file on the web or elsewhere on your device. Roomination only reads the files you choose, so it can’t be imported.');
    if (!item.uri.startsWith('data:')) needs.push(decodeURIComponent(item.uri));
  }
  const triangles = countTriangles(json);
  if (triangles > MAX_TRIANGLES) fail(`This model has ${triangles.toLocaleString('en')} triangles, more than the ${MAX_TRIANGLES.toLocaleString('en')} Roomination accepts. In your scanning app, export a lighter version (fewer details / smaller file).`);
  const warnings: string[] = [];
  if (triangles > HEAVY_TRIANGLES) warnings.push(`It has ${triangles.toLocaleString('en')} triangles: fine on a computer, but heavy for phones. A lighter export would draw faster.`);
  if ((json.nodes?.length ?? 0) > 5000) fail('This model has too many parts to load safely.');
  return { format, triangles, needs, warnings };
}

/** Triangles drawn by the model's meshes (each mesh counted once; triangle lists, strips and fans). */
export function countTriangles(json: GltfJson): number {
  let total = 0;
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh?.primitives ?? []) {
      const mode = p?.mode ?? 4;
      const accessor = typeof p?.indices === 'number' ? json.accessors?.[p.indices] : json.accessors?.[p?.attributes?.POSITION ?? -1];
      const count = typeof accessor?.count === 'number' && accessor.count > 0 ? accessor.count : 0;
      if (mode === 4) total += Math.floor(count / 3);
      else if (mode === 5 || mode === 6) total += Math.max(0, count - 2);
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// USDZ
// ---------------------------------------------------------------------------

/**
 * Unpacks a USDZ archive with limits, and checks its layout: the first entry must be the USD
 * layer, at the top level (as Apple's apps write them), and no entry may climb out of the
 * archive. Returns the bytes to hand to the loader.
 */
export function inspectUsdz(bytes: Uint8Array): { files: Record<string, Uint8Array>; root: string } {
  let entries = 0;
  let unpacked = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        entries++;
        unpacked += file.originalSize;
        if (entries > MAX_ARCHIVE_ENTRIES || unpacked > MAX_UNPACKED_BYTES) throw new ModelFileError('This USDZ file unpacks to more than Roomination can safely open.');
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ModelFileError) throw error;
    return fail('This USDZ file is damaged (it isn’t a readable archive).');
  }
  const names = Object.keys(files);
  if (names.length === 0) fail('This USDZ file is empty.');
  for (const name of names) if (!isSafeRelativeUri(name) || name.includes('\\')) fail('This USDZ file contains an unsafe file path.');
  const root = names[0];
  if (!/\.(usdc|usda|usd)$/i.test(root)) fail('This USDZ file doesn’t start with a USD model, so it can’t be read.');
  // A root layer inside a folder would make the loader look for missing textures on the web.
  if (root.includes('/')) fail('This USDZ file has an unusual layout (its model is inside a folder). Export it again from your scanning app.');
  return { files, root };
}
