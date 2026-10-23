import { Inflate } from 'fflate';

/**
 * A small, defensive ZIP reader for scan bundles.
 *
 * Scan ZIPs can be hundreds of megabytes because they carry photos and depth recordings,
 * which the importer never needs. Instead of loading the whole archive, this reads only the
 * table of contents at the end of the file and then the few JSON entries it is asked for
 * (`Blob.slice` reads just those bytes). Photos, meshes and depth frames are never read into
 * memory, let alone decoded.
 *
 * Every size is checked: the table of contents, the number of entries, each entry's declared
 * size, and the bytes actually produced while decompressing (so a "ZIP bomb" that lies about
 * its size is stopped as soon as it passes the limit). Encrypted entries are refused, and the
 * decompressed bytes must match the archive's checksum.
 */

export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  crc: number;
  encrypted: boolean;
  /** Where the entry's local header starts. */
  offset: number;
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export const MAX_ZIP_ENTRIES = 200_000;
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024;

async function bytes(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/** The archive's list of files, read from its central directory. */
export async function listZip(blob: Blob): Promise<ZipEntry[]> {
  if (blob.size < 22) throw new ZipError('That file is too small to be a ZIP archive.');
  // The end record is the last 22 bytes (plus, for large archives, a 20-byte locator just
  // before it). Only when the archive has a comment is up to 64 KB more searched.
  let tail = await bytes(blob, Math.max(0, blob.size - 42), blob.size);
  let view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let at = tail.length - 22;
  if (view.getUint32(at, true) !== EOCD || view.getUint16(at + 20, true) !== 0) {
    tail = await bytes(blob, Math.max(0, blob.size - (42 + 0xffff)), blob.size);
    view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    at = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === EOCD) {
        at = i;
        break;
      }
    }
  }
  if (at < 0) throw new ZipError('That ZIP file is damaged (its table of contents is missing).');

  let count = view.getUint16(at + 10, true);
  let dirSize = view.getUint32(at + 12, true);
  let dirOffset = view.getUint32(at + 16, true);
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
    // ZIP64: the real numbers are in a separate record, found through a locator just before.
    const locatorAt = at - 20;
    if (locatorAt < 0 || view.getUint32(locatorAt, true) !== ZIP64_LOCATOR) throw new ZipError('That ZIP file is damaged (its large-archive record is missing).');
    const recordOffset = Number(view.getBigUint64(locatorAt + 8, true));
    if (recordOffset < 0 || recordOffset + 56 > blob.size) throw new ZipError('That ZIP file is damaged.');
    const record = await bytes(blob, recordOffset, recordOffset + 56);
    const rv = new DataView(record.buffer, record.byteOffset, record.byteLength);
    if (rv.getUint32(0, true) !== ZIP64_EOCD) throw new ZipError('That ZIP file is damaged.');
    count = Number(rv.getBigUint64(32, true));
    dirSize = Number(rv.getBigUint64(40, true));
    dirOffset = Number(rv.getBigUint64(48, true));
  }
  if (count > MAX_ZIP_ENTRIES) throw new ZipError(`That ZIP file holds too many files (over ${MAX_ZIP_ENTRIES.toLocaleString('en')}).`);
  if (dirSize > MAX_DIRECTORY_BYTES || dirOffset + dirSize > blob.size) throw new ZipError('That ZIP file is damaged (its table of contents doesn’t fit).');

  const dir = await bytes(blob, dirOffset, dirOffset + dirSize);
  const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > dir.length || dv.getUint32(p, true) !== CENTRAL) throw new ZipError('That ZIP file is damaged (a table-of-contents entry is broken).');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    let compressedSize = dv.getUint32(p + 20, true);
    let size = dv.getUint32(p + 24, true);
    const nameLength = dv.getUint16(p + 28, true);
    const extraLength = dv.getUint16(p + 30, true);
    const commentLength = dv.getUint16(p + 32, true);
    let offset = dv.getUint32(p + 42, true);
    const end = p + 46 + nameLength + extraLength + commentLength;
    if (end > dir.length) throw new ZipError('That ZIP file is damaged (a file name runs past the table of contents).');
    const name = decoder.decode(dir.subarray(p + 46, p + 46 + nameLength));
    // ZIP64 sizes and offsets live in an "extra field" when the 32-bit ones are maxed out.
    let e = p + 46 + nameLength;
    const extraEnd = e + extraLength;
    while (e + 4 <= extraEnd) {
      const id = dv.getUint16(e, true);
      const length = dv.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        const take = () => {
          if (q + 8 > e + 4 + length) throw new ZipError('That ZIP file is damaged.');
          const v = Number(dv.getBigUint64(q, true));
          q += 8;
          return v;
        };
        if (size === 0xffffffff) size = take();
        if (compressedSize === 0xffffffff) compressedSize = take();
        if (offset === 0xffffffff) offset = take();
      }
      e += 4 + length;
    }
    entries.push({ name, method, compressedSize, size, crc, encrypted: (flags & 1) === 1, offset });
    p = end;
  }
  return entries;
}

/**
 * Reads and (if needed) decompresses one entry, refusing anything that would produce more
 * than `maxBytes`, whatever the archive claims.
 */
export async function readZipEntry(blob: Blob, entry: ZipEntry, maxBytes: number): Promise<Uint8Array> {
  if (entry.encrypted) throw new ZipError(`“${entry.name}” is password-protected, so it can’t be read.`);
  if (entry.size > maxBytes) throw new ZipError(`“${entry.name}” is too large to import safely.`);
  if (entry.offset + 30 > blob.size) throw new ZipError('That ZIP file is damaged.');
  const header = await bytes(blob, entry.offset, entry.offset + 30);
  const hv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (hv.getUint32(0, true) !== LOCAL) throw new ZipError('That ZIP file is damaged (a file’s header is missing).');
  const start = entry.offset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  const end = start + entry.compressedSize;
  if (end > blob.size) throw new ZipError('That ZIP file is damaged (it’s cut short).');
  const data = await bytes(blob, start, end);

  let out: Uint8Array;
  if (entry.method === 0) {
    out = data;
  } else if (entry.method === 8) {
    out = inflateLimited(data, maxBytes, entry.name);
  } else {
    throw new ZipError(`“${entry.name}” uses a compression method this importer doesn’t support.`);
  }
  if (out.length !== entry.size || crc32(out) !== entry.crc) throw new ZipError(`“${entry.name}” is damaged (its contents don’t match its checksum).`);
  return out;
}

function inflateLimited(data: Uint8Array, maxBytes: number, name: string): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > maxBytes) throw new ZipError(`“${name}” expands to more than it claims, so it was stopped (a possible “ZIP bomb”).`);
    chunks.push(chunk);
  });
  try {
    inflater.push(data, true);
  } catch (error) {
    if (error instanceof ZipError) throw error;
    throw new ZipError(`“${name}” is damaged and can’t be decompressed.`);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

let table: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
