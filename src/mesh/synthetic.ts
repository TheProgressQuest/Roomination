import { zlibSync } from 'fflate';

/**
 * Synthetic 3D models for tests (never real scans): a box with a small checker texture,
 * written byte by byte as a GLB, or as a .gltf with its buffer and texture as separate files.
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A PNG of `size` × `size` pixels: a two-colour checker. */
export function checkerPng(size = 8, a: [number, number, number] = [176, 92, 48], b: [number, number, number] = [236, 214, 170]): Uint8Array {
  const raw = new Uint8Array(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set((x + y) % 2 ? a : b, y * (size * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** A box `w` × `h` × `d` metres (glTF units), sitting on y = 0, as positions, normals, uvs, indices. */
function boxGeometry(w: number, h: number, d: number) {
  const faces: [number[], number[], number[], number[], number[]][] = [
    // normal, then corners (counter-clockwise from outside)
    [[0, 0, 1], [-w / 2, 0, d / 2], [w / 2, 0, d / 2], [w / 2, h, d / 2], [-w / 2, h, d / 2]],
    [[0, 0, -1], [w / 2, 0, -d / 2], [-w / 2, 0, -d / 2], [-w / 2, h, -d / 2], [w / 2, h, -d / 2]],
    [[1, 0, 0], [w / 2, 0, d / 2], [w / 2, 0, -d / 2], [w / 2, h, -d / 2], [w / 2, h, d / 2]],
    [[-1, 0, 0], [-w / 2, 0, -d / 2], [-w / 2, 0, d / 2], [-w / 2, h, d / 2], [-w / 2, h, -d / 2]],
    [[0, 1, 0], [-w / 2, h, d / 2], [w / 2, h, d / 2], [w / 2, h, -d / 2], [-w / 2, h, -d / 2]],
    [[0, -1, 0], [-w / 2, 0, -d / 2], [w / 2, 0, -d / 2], [w / 2, 0, d / 2], [-w / 2, 0, d / 2]],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  faces.forEach(([n, ...corners], f) => {
    corners.forEach((c, i) => {
      positions.push(...c);
      normals.push(...n);
      uvs.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 0 : 1);
    });
    indices.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
  });
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

const pad4 = (n: number) => (n + 3) & ~3;

/** The pieces of a textured box model: its JSON (buffers and image by `uri`, or embedded). */
function boxModel(size: { w: number; h: number; d: number }, png: Uint8Array) {
  const g = boxGeometry(size.w, size.h, size.d);
  const arrays = [g.positions, g.normals, g.uvs, g.indices, png];
  const offsets: number[] = [];
  let length = 0;
  for (const a of arrays) {
    offsets.push(length);
    length = pad4(length + a.byteLength);
  }
  const bin = new Uint8Array(length);
  arrays.forEach((a, i) => bin.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), offsets[i]));
  const view = (i: number, target?: number) => ({ buffer: 0, byteOffset: offsets[i], byteLength: arrays[i].byteLength, ...(target ? { target } : {}) });
  const json = {
    asset: { version: '2.0', generator: 'Roomination synthetic test model' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Box' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.8 } }],
    textures: [{ source: 0 }],
    images: [{ bufferView: 4, mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-size.w / 2, 0, -size.d / 2], max: [size.w / 2, size.h, size.d / 2] },
      { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 24, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
    bufferViews: [view(0, 34962), view(1, 34962), view(2, 34962), view(3, 34963), view(4)],
    buffers: [{ byteLength: length }] as { byteLength: number; uri?: string }[],
  };
  return { json, bin };
}

/** A textured box as one GLB file (sizes in metres; default a 30 × 35 × 19 cm "radio"). */
export function syntheticGlb(size = { w: 0.3, h: 0.35, d: 0.19 }, png = checkerPng()): Uint8Array {
  const { json, bin } = boxModel(size, png);
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad4(jsonBytes.length);
  const total = 12 + 8 + jsonLength + 8 + bin.length;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, jsonLength, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength);
  v.setUint32(20 + jsonLength, bin.length, true);
  v.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(bin, 28 + jsonLength);
  return out;
}

/** The same box as a .gltf whose binary data lives in a separate .bin file. */
export function syntheticGltfFiles(size = { w: 0.3, h: 0.35, d: 0.19 }, png = checkerPng()): { gltf: Uint8Array; bin: Uint8Array; binName: string } {
  const { json, bin } = boxModel(size, png);
  json.buffers[0].uri = 'box.bin';
  return { gltf: new TextEncoder().encode(JSON.stringify(json)), bin, binName: 'box.bin' };
}
