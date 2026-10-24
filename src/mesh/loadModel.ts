import { Box3, Euler, Group, LoadingManager, Material, Matrix4, Mesh, Object3D, Quaternion, Texture, Vector3, type BufferGeometry } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { USDLoader } from 'three/examples/jsm/loaders/USDLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { detectFormat, inspectGltf, inspectUsdz, MAX_IMPORT_BYTES, MAX_STORED_MODEL_BYTES, MAX_TRIANGLES, HEAVY_TRIANGLES, ModelFileError, parseGlb, parseGltfText, unsupportedReason, type ModelFormat } from './inspect';
import type { MeshModel } from '../model/types';

/**
 * Reading 3D model files (Import 3D model) and keeping them as one compact GLB. Loaded on
 * demand (this pulls in Three.js's glTF and USD loaders).
 *
 * Every reference inside a model is resolved only to the files the person chose (or data
 * embedded in the file). Anything else resolves to nothing, so nothing is ever fetched.
 */

export interface LoadedModel {
  scene: Group;
  format: ModelFormat;
  name: string;
  triangles: number;
  warnings: string[];
}

/** Texture size kept when a model is stored: Full (computers) or Light (phones). */
export const TEXTURE_SIZES = { full: 2048, light: 1024 } as const;

const fail = (message: string): never => {
  throw new ModelFileError(message);
};

/** Paths as a model writes them ("textures/a.jpg", "./a.jpg"), compared by name, ignoring case. */
const key = (path: string) => decodeURIComponent(path).replace(/^\.\//, '').toLowerCase();
const base = (path: string) => key(path).split('/').pop() ?? '';

/**
 * Reads a model from the chosen files: one model file (GLB, glTF, USDZ, USDC or USDA) and,
 * for a .gltf or loose USD, the files it needs (.bin, textures). Throws ModelFileError with a
 * plain reason when it can't.
 */
export async function readModelFiles(files: File[]): Promise<LoadedModel> {
  if (files.length === 0) fail('Choose a 3D model file.');
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_IMPORT_BYTES) fail(`These files are ${Math.round(total / 1e6)} MB; Roomination imports up to ${MAX_IMPORT_BYTES / 1024 / 1024} MB. Export a lighter version from your scanning app.`);
  // The model file: the first one whose bytes are a model.
  const heads = await Promise.all(files.map(async (f) => ({ file: f, format: detectFormat(new Uint8Array(await f.slice(0, 64).arrayBuffer())) })));
  const main = heads.find((h) => h.format && !(h.format === 'gltf' && !/\.gltf$/i.test(h.file.name))) ?? null;
  if (!main) {
    const reason = files.map((f) => unsupportedReason(f.name)).find(Boolean);
    return fail(reason ?? 'None of these files is a 3D model Roomination can read (GLB, glTF or USDZ).');
  }
  const format = main.format!;
  const bytes = new Uint8Array(await main.file.arrayBuffer());
  const others = files.filter((f) => f !== main.file);
  const warnings: string[] = [];

  // Blob URLs for the other chosen files, by path and by bare name.
  const urls = new Map<string, string>();
  const made: string[] = [];
  for (const f of others) {
    const url = URL.createObjectURL(f);
    made.push(url);
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    urls.set(key(path), url);
    urls.set(base(path), url);
  }
  const manager = new LoadingManager();
  const blocked: string[] = [];
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    const found = urls.get(key(url)) ?? urls.get(base(url));
    if (found) return found;
    blocked.push(url);
    // Resolves to nothing: never a request to the web or the app's own server.
    return 'data:,';
  });

  try {
    let scene: Group;
    if (format === 'glb' || format === 'gltf') {
      const json = format === 'glb' ? parseGlb(bytes).json : parseGltfText(bytes);
      const summary = inspectGltf(json, format);
      warnings.push(...summary.warnings);
      const missing = summary.needs.filter((n) => !urls.has(key(n)) && !urls.has(base(n)));
      if (missing.length) fail(`This model needs ${missing.length === 1 ? 'another file' : `${missing.length} more files`} (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}). Choose them together with the .${format} file (select all the files in its folder).`);
      const loader = new GLTFLoader(manager);
      const data = format === 'glb' ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : new TextDecoder().decode(bytes);
      const gltf = await loader.parseAsync(data as ArrayBuffer, '');
      scene = gltf.scene;
    } else {
      if (format === 'usdz') inspectUsdz(bytes);
      else warnings.push('A loose USD file was chosen: textures only appear if you choose their files too. A USDZ includes them.');
      const loader = new USDLoader(manager);
      scene = await new Promise<Group>((resolve, reject) => {
        const input = format === 'usda' ? new TextDecoder().decode(bytes) : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        try {
          loader.parse(input as ArrayBuffer, '', (group: Group) => resolve(group), (error: unknown) => reject(error));
        } catch (error) {
          reject(error);
        }
      });
    }
    if (blocked.length) warnings.push(`${blocked.length} texture${blocked.length === 1 ? ' wasn’t' : 's weren’t'} found in the file${files.length > 1 ? 's' : ''} you chose (or ${blocked.length === 1 ? 'is a kind' : 'are kinds'} browsers can’t show, such as EXR), so ${blocked.length === 1 ? 'it was' : 'they were'} left out.`);
    scene.updateMatrixWorld(true);
    const triangles = countSceneTriangles(scene);
    if (triangles === 0) fail('This model has no surfaces to show.');
    if (triangles > MAX_TRIANGLES) fail(`This model has ${triangles.toLocaleString('en')} triangles, more than the ${MAX_TRIANGLES.toLocaleString('en')} Roomination accepts. Export a lighter version from your scanning app.`);
    if (triangles > HEAVY_TRIANGLES && !warnings.some((w) => w.includes('heavy'))) warnings.push(`It has ${triangles.toLocaleString('en')} triangles: fine on a computer, but heavy for phones.`);
    return { scene, format, name: main.file.name.replace(/\.[^.]+$/, ''), triangles, warnings };
  } catch (error) {
    if (error instanceof ModelFileError) throw error;
    throw new ModelFileError(`This ${format.toUpperCase()} file couldn’t be read${error instanceof Error && error.message ? ` (${error.message.slice(0, 120)})` : ''}. Try exporting it again, as GLB if your app offers it.`);
  } finally {
    // Textures have decoded by now (loaders wait for them); the object URLs aren't needed.
    setTimeout(() => made.forEach((u) => URL.revokeObjectURL(u)), 30_000);
  }
}

export function countSceneTriangles(root: Object3D): number {
  let total = 0;
  root.traverse((o) => {
    const g = (o as Mesh).isMesh ? ((o as Mesh).geometry as BufferGeometry) : null;
    if (!g) return;
    const count = g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0);
    total += Math.floor(count / 3);
  });
  return total;
}

/** The rotation that sets a model upright and facing front (see MeshModel.turn). */
export function turnQuaternion(turn: MeshModel['turn']): Quaternion {
  const r = Math.PI / 180;
  return new Quaternion().setFromEuler(new Euler(turn.x * r, -turn.y * r, turn.z * r, 'YXZ'));
}

/** The model's size after turning (cm: width across, depth front to back, height up). */
export function turnedSize(root: Object3D, turn: MeshModel['turn']): { width: number; depth: number; height: number } {
  const box = turnedBox(root, turn);
  const size = box.getSize(new Vector3());
  const cm = (v: number) => Math.round(v * 1000) / 10;
  return { width: cm(size.x), depth: cm(size.z), height: cm(size.y) };
}

/** Bounding box of the model's meshes after turning (model units: metres). */
export function turnedBox(root: Object3D, turn: MeshModel['turn']): Box3 {
  root.updateWorldMatrix(true, true);
  // Relative to the model itself, wherever it's attached (a preview adds it to its own scene).
  const outside = root.parent ? root.parent.matrixWorld.clone().invert() : new Matrix4();
  const rotate = new Matrix4().makeRotationFromQuaternion(turnQuaternion(turn)).multiply(outside);
  const box = new Box3();
  const point = new Vector3();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    const m = rotate.clone().multiply(mesh.matrixWorld);
    // Every vertex (exact, unlike transformed boxes): a model is at most a million triangles.
    for (let i = 0; i < position.count; i++) box.expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(m));
  });
  return box;
}

/**
 * The model as one GLB, ready to store: geometry, materials and textures (scaled down to
 * `maxTextureSize`; JPEG unless the texture needs transparency).
 */
export async function toStoredGlb(scene: Object3D, maxTextureSize: number): Promise<Uint8Array> {
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as (Material & Record<string, unknown>)[]) {
      const seeThrough = material.transparent || (material.alphaTest as number) > 0;
      for (const [slot, value] of Object.entries(material)) {
        if (!(value instanceof Texture)) continue;
        // A texture that never loaded (missing from the files, or EXR) has no picture to save.
        const image = value.image as { width?: number } | null | undefined;
        if (!image || !(Number(image.width) > 0)) {
          (material as Record<string, unknown>)[slot] = null;
          material.needsUpdate = true;
          continue;
        }
        value.userData.mimeType = seeThrough && slot === 'map' ? 'image/png' : 'image/jpeg';
      }
    }
  });
  const result = await new GLTFExporter().parseAsync(scene, { binary: true, maxTextureSize, onlyVisible: true });
  if (!(result instanceof ArrayBuffer)) fail('The model couldn’t be saved.');
  const glb = new Uint8Array(result as ArrayBuffer);
  if (glb.byteLength > MAX_STORED_MODEL_BYTES) fail(`Saved, this model is ${Math.round(glb.byteLength / 1e6)} MB, more than the ${MAX_STORED_MODEL_BYTES / 1024 / 1024} MB Roomination keeps. Choose “Light” textures, or export a lighter version.`);
  return glb;
}

/** A stored model (a GLB from Roomination's own store), ready to draw. */
export async function parseStoredGlb(bytes: ArrayBuffer): Promise<Group> {
  inspectGltf(parseGlb(new Uint8Array(bytes)).json, 'glb');
  const manager = new LoadingManager();
  // A stored model is self-contained; any other reference resolves to nothing.
  manager.setURLModifier((url) => (url.startsWith('data:') || url.startsWith('blob:') ? url : 'data:,'));
  const gltf = await new GLTFLoader(manager).parseAsync(bytes, '');
  return gltf.scene;
}

/** Frees a loaded model's geometry, materials and textures. */
export function disposeModel(root: Object3D) {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as (Material & Record<string, unknown>)[]) {
      for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
      material.dispose();
    }
  });
}

