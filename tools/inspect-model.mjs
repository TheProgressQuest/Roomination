// Diagnoses a 3D model file on this Mac, with the same checks the app runs, and prints its
// structure: format, archive contents, USD up axis and units, materials, textures and triangle
// counts. It prints no pictures, geometry or file contents, so the report is safe to share.
//
//   npm run inspect-model -- ~/Downloads/Radio.usdz
//   npm run inspect-model -- ~/Downloads/radio/scene.gltf
import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { unzipSync } from 'fflate';
import { countTriangles, detectFormat, inspectGltf, inspectUsdz, parseGlb, parseGltfText, unsupportedReason } from '../src/mesh/inspect.ts';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run inspect-model -- <path to .usdz, .glb or .gltf>');
  process.exit(1);
}
const bytes = new Uint8Array(readFileSync(file));
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const lines = [`File: ${basename(file)} (${mb(statSync(file).size)})`];
const say = (s) => lines.push(s);
const ok = (label, fn) => {
  try {
    const result = fn();
    say(`✓ ${label}${result ? `: ${result}` : ''}`);
    return true;
  } catch (error) {
    say(`✗ ${label}: ${error.message}`);
    return false;
  }
};

const format = detectFormat(bytes);
say(`Format by its bytes: ${format ?? 'not a model Roomination reads'}${extname(file) ? ` (named ${extname(file)})` : ''}`);
if (!format) {
  const reason = unsupportedReason(file);
  if (reason) say(reason);
  say(`First bytes: ${[...bytes.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
}

function describeGltf(json) {
  say(`Generator: ${json.asset?.generator ?? '(not stated)'}; glTF ${json.asset?.version ?? '?'}`);
  say(`Extensions used: ${(json.extensionsUsed ?? []).join(', ') || 'none'}; required: ${(json.extensionsRequired ?? []).join(', ') || 'none'}`);
  say(`Meshes ${json.meshes?.length ?? 0}, nodes ${json.nodes?.length ?? 0}, materials ${json.materials?.length ?? 0}, textures ${json.textures?.length ?? 0}, triangles ${countTriangles(json).toLocaleString('en')}`);
  for (const [i, image] of (json.images ?? []).entries()) say(`  image ${i + 1}: ${image.mimeType ?? '(type from file)'}${image.uri ? (image.uri.startsWith('data:') ? ', embedded' : `, separate file "${image.uri}"`) : ', inside the file'}`);
  for (const [i, m] of (json.materials ?? []).entries()) {
    const pbr = m.pbrMetallicRoughness ?? {};
    const maps = [pbr.baseColorTexture && 'colour', pbr.metallicRoughnessTexture && 'metal/rough', m.normalTexture && 'normal', m.occlusionTexture && 'AO', m.emissiveTexture && 'emissive'].filter(Boolean);
    say(`  material ${i + 1}: maps ${maps.join(', ') || 'none'}; metallic ${pbr.metallicFactor ?? 1}, roughness ${pbr.roughnessFactor ?? 1}${m.alphaMode && m.alphaMode !== 'OPAQUE' ? `, ${m.alphaMode}` : ''}${m.doubleSided ? ', double-sided' : ''}`);
  }
  ok('Roomination’s checks', () => {
    const s = inspectGltf(json, format === 'glb' ? 'glb' : 'gltf');
    return [s.needs.length ? `needs ${s.needs.length} other file(s)` : 'self-contained', ...s.warnings].join('; ');
  });
}

async function describeUsd(layer, name) {
  const crate = String.fromCharCode(...layer.subarray(0, 8)) === 'PXR-USDC';
  say(`Model layer: ${name} (${crate ? 'binary USDC' : 'text USDA'}, ${mb(layer.byteLength)})`);
  if (!crate) {
    const text = new TextDecoder().decode(layer.subarray(0, 4096));
    for (const key of ['upAxis', 'metersPerUnit', 'defaultPrim']) {
      const m = text.match(new RegExp(`${key}\\s*=\\s*("?[^\\s)"]+"?)`));
      if (m) say(`  ${key} = ${m[1]}`);
    }
    return;
  }
  try {
    const { USDCParser } = await import('three/examples/jsm/loaders/usd/USDCParser.js');
    const data = new USDCParser().parseData(layer.buffer.slice(layer.byteOffset, layer.byteOffset + layer.byteLength));
    const root = data?.specsByPath?.['/']?.fields ?? data?.['/'] ?? {};
    for (const key of ['upAxis', 'metersPerUnit', 'defaultPrim']) if (root[key] !== undefined) say(`  ${key} = ${JSON.stringify(root[key])}`);
    const paths = Object.keys(data?.specsByPath ?? {});
    const kinds = {};
    for (const p of paths) {
      const t = data.specsByPath[p]?.fields?.typeName;
      if (t && /^[A-Z][A-Za-z]+$/.test(t)) kinds[t] = (kinds[t] ?? 0) + 1;
    }
    if (Object.keys(kinds).length) say(`  prims: ${Object.entries(kinds).map(([k, n]) => `${k} ×${n}`).join(', ')}`);
  } catch (error) {
    say(`  (couldn’t read the USDC layer’s settings: ${error.message})`);
  }
}

if (format === 'glb') {
  if (ok('GLB structure', () => 'valid')) describeGltf(parseGlb(bytes).json);
} else if (format === 'gltf') {
  describeGltf(parseGltfText(bytes));
} else if (format === 'usdz') {
  const entries = [];
  try {
    unzipSync(bytes, { filter: (f) => (entries.push(f), false) });
  } catch {
    /* reported by the checks below */
  }
  say(`Archive: ${entries.length} entries, ${mb(entries.reduce((n, f) => n + f.originalSize, 0))} unpacked`);
  const byType = {};
  for (const e of entries) {
    const ext = (e.name.split('.').pop() ?? '').toLowerCase();
    byType[ext] = (byType[ext] ?? 0) + 1;
  }
  say(`  by type: ${Object.entries(byType).map(([k, n]) => `.${k} ×${n}`).join(', ')}`);
  say(`  first entry (must be the model): ${entries[0]?.name ?? '(none)'}; compressed entries: ${entries.filter((e) => e.compression !== 0).length}`);
  for (const e of entries.filter((x) => /\.(png|jpe?g|exr|avif|heic)$/i.test(x.name)).slice(0, 12)) say(`  texture ${e.name.split('/').pop()}: ${mb(e.originalSize)}${/\.(exr|heic)$/i.test(e.name) ? ' (browsers can’t show this kind)' : ''}`);
  if (ok('Roomination’s checks', () => `root layer ${inspectUsdz(bytes).root}`)) {
    const { files, root } = inspectUsdz(bytes);
    await describeUsd(files[root], root);
  }
} else if (format === 'usdc' || format === 'usda') {
  await describeUsd(bytes, basename(file));
}
console.log(lines.join('\n'));
console.log('\nThis report has no pictures, shapes or file contents: it’s safe to share.');
