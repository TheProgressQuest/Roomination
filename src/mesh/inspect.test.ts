import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { countTriangles, detectFormat, inspectGltf, inspectUsdz, isSafeRelativeUri, MAX_TRIANGLES, ModelFileError, parseGlb, parseGltfText, unsupportedReason } from './inspect';
import { checkerPng, syntheticGlb, syntheticGltfFiles } from './synthetic';

describe('recognising model files', () => {
  it('by their bytes, not their names', () => {
    expect(detectFormat(syntheticGlb())).toBe('glb');
    expect(detectFormat(syntheticGltfFiles().gltf)).toBe('gltf');
    expect(detectFormat(zipSync({ 'model.usdc': strToU8('PXR-USDC') }))).toBe('usdz');
    expect(detectFormat(strToU8('PXR-USDC\0\0\0'))).toBe('usdc');
    expect(detectFormat(strToU8('#usda 1.0\n'))).toBe('usda');
    expect(detectFormat(checkerPng())).toBeNull();
  });

  it('explains formats it can’t read', () => {
    expect(unsupportedReason('radio.obj')).toMatch(/export the model as GLB/);
    expect(unsupportedReason('radio.reality')).toMatch(/USDZ/);
    expect(unsupportedReason('radio.glb')).toBeNull();
  });
});

describe('glTF and GLB checks', () => {
  it('reads a valid GLB: its description, binary data and triangles', () => {
    const { json, bin } = parseGlb(syntheticGlb());
    expect(bin?.byteLength).toBeGreaterThan(0);
    expect(inspectGltf(json, 'glb')).toMatchObject({ format: 'glb', triangles: 12, needs: [], warnings: [] });
  });

  it('refuses damaged GLBs', () => {
    const glb = syntheticGlb();
    expect(() => parseGlb(glb.subarray(0, 10))).toThrow(ModelFileError);
    const wrongLength = glb.slice();
    new DataView(wrongLength.buffer).setUint32(8, glb.length + 100, true);
    expect(() => parseGlb(wrongLength)).toThrow(/length/);
    const version1 = glb.slice();
    new DataView(version1.buffer).setUint32(4, 1, true);
    expect(() => parseGlb(version1)).toThrow(/glTF 2/);
  });

  it('lists the separate files a .gltf needs, and refuses web or outside references', () => {
    const { gltf } = syntheticGltfFiles();
    expect(inspectGltf(parseGltfText(gltf), 'gltf').needs).toEqual(['box.bin']);
    const json = parseGltfText(gltf);
    for (const uri of ['https://example.com/box.bin', 'file:///etc/passwd', '/abs/box.bin', '../box.bin', 'textures/../../x.png', 'blob:abc', 'javascript:alert(1)']) {
      expect(() => inspectGltf({ ...json, buffers: [{ uri, byteLength: 10 }] }, 'gltf')).toThrow(/web or elsewhere/);
    }
    expect(isSafeRelativeUri('textures/radio_diff_1k.jpg')).toBe(true);
    expect(isSafeRelativeUri('data:application/octet-stream;base64,AAAA')).toBe(true);
    expect(isSafeRelativeUri('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
  });

  it('refuses compression that needs a downloaded decoder', () => {
    const json = parseGltfText(syntheticGltfFiles().gltf);
    expect(() => inspectGltf({ ...json, extensionsRequired: ['KHR_draco_mesh_compression'] }, 'gltf')).toThrow(/Draco/);
    expect(() => inspectGltf({ ...json, extensionsRequired: ['KHR_texture_basisu'] }, 'gltf')).toThrow(/Basis/);
    // Used but not required: the loader falls back, so it's fine.
    expect(() => inspectGltf({ ...json, extensionsUsed: ['KHR_materials_clearcoat'] }, 'gltf')).not.toThrow();
  });

  it('counts triangles and limits them', () => {
    const json = parseGltfText(syntheticGltfFiles().gltf);
    expect(countTriangles({ accessors: [{ count: 30 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }] })).toBe(10);
    expect(countTriangles({ accessors: [{ count: 30 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 5 }] }] })).toBe(28);
    const huge = { ...json, accessors: [...(json.accessors ?? []).slice(0, 3), { count: (MAX_TRIANGLES + 1) * 3 }] };
    expect(() => inspectGltf(huge, 'gltf')).toThrow(/lighter version/);
    const heavy = { ...json, accessors: [...(json.accessors ?? []).slice(0, 3), { count: 300_000 * 3 }] };
    expect(inspectGltf(heavy, 'gltf').warnings[0]).toMatch(/heavy for phones/);
  });
});

describe('USDZ checks', () => {
  it('accepts a model layer at the top with its textures', () => {
    const usdz = zipSync({ 'radio.usdc': strToU8('PXR-USDC....'), '0/radio_diffuse.png': checkerPng() }, { level: 0 });
    expect(inspectUsdz(usdz).root).toBe('radio.usdc');
  });

  it('refuses archives that don’t start with a model, hide it in a folder, or climb out', () => {
    expect(() => inspectUsdz(zipSync({ 'a.png': checkerPng(), 'radio.usdc': strToU8('PXR-USDC') }))).toThrow(/doesn’t start/);
    expect(() => inspectUsdz(zipSync({ 'models/radio.usdc': strToU8('PXR-USDC') }))).toThrow(/unusual layout/);
    expect(() => inspectUsdz(zipSync({ 'radio.usdc': strToU8('PXR-USDC'), '../../evil.png': checkerPng() }))).toThrow(/unsafe/);
    expect(() => inspectUsdz(strToU8('PK\x03\x04 not really a zip'))).toThrow(/damaged/);
  });

  it('refuses archives that unpack to too much (zip bombs)', () => {
    // 210 MB of zeros compresses to a few hundred kilobytes.
    const bomb = zipSync({ 'radio.usdc': new Uint8Array(210 * 1024 * 1024) }, { level: 9 });
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    expect(() => inspectUsdz(bomb)).toThrow(/more than Roomination can safely open/);
    // Compressing 210 MB takes a few seconds on a busy machine.
  }, 60_000);
});
