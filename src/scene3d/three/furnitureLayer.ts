import {
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  EdgesGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  ShapeUtils,
  Vector2,
  Vector3,
  BoxGeometry,
  Box3,
  RepeatWrapping,
  Texture,
  type Intersection,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { boundingBox, signedArea2, type Polygon } from '../../model/polygon';
import type { SurfaceFinish } from '../../model/types';
import type { Ring } from '../../model/shape';
import type { SurfaceKind } from '../../render/materials';
import { getAsset, loadAssetImage } from '../../storage/assets';

/** Triangles of imported 3D models drawn at each quality (Low suits phones). */
const MODEL_BUDGET: Record<PartDetail, number> = { low: 150_000, medium: 600_000, high: 1_500_000 };
import { photoModelMesh } from '../../model/photoModel';
import { CM_PER_SCENE_UNIT, type SceneFurniture } from '../model';
import { lookKey, type FurnitureMaterials, type SurfaceLook } from './furnitureMaterials';
import { lightHex } from '../../render/lightColour';
import { partGeometry, partMatrix, withMetreUVs, type PartDetail } from './partGeometry';

/**
 * All furniture in the 3D view.
 *
 * - Every piece is built from its parts (render/furnitureParts): rounded cushions, legs,
 *   pillows, shelves and books, leaves… Parts are drawn as one BatchedMesh per surface
 *   material, so a room full of furniture is a handful of draw calls; part geometry is
 *   cached and shared between identical pieces.
 * - Drawn shapes and photo-textured pieces are extruded from their real footprint — the
 *   same outline the plan and collision checks use. Photos go on the top, front-facing and
 *   side-facing surfaces.
 * - A soft contact shadow sits under each piece, so furniture rests on the floor even
 *   without shadow maps.
 */

/** Selection: the brand's Savage Ultramarine. */
const HIGHLIGHT = new Color('#1f2bd6');
const UP = new Vector3(0, 1, 0);
const m = (cm: number) => cm / CM_PER_SCENE_UNIT;
/** Parts too small to need shadow-map shadows of their own. */
const SHADOWLESS_ROLES = new Set(['book', 'handle', 'leaf', 'soil', 'pillow', 'throw', 'duvet', 'screen', 'drawer', 'door']);
/** Contact shadows float just above rugs (which are at most 1.5 cm thick). */
const CONTACT_HEIGHT = m(1.6);

/** Material slots of an extruded piece's geometry groups. */
const enum Surface {
  Body = 0,
  Top = 1,
  Front = 2,
  Side = 3,
}

interface BatchedPiece {
  mesh: BatchedMesh;
  ids: number[];
  colors: Color[];
}

interface PieceRecord {
  footprint: SceneFurniture;
  batched: BatchedPiece[];
  extruded: Mesh | null;
  /** Materials owned by this piece (extruded pieces), disposed with it. Their textures are cached separately. */
  owned: MeshStandardMaterial[];
}


/** Something kept between rebuilds, and the rebuild that last used it. */
interface Cached<T> {
  value: T;
  generation: number;
}

interface PlacedPart {
  owner: string;
  geometry: string;
  matrix: Matrix4;
  color: Color;
}

export class FurnitureLayer {
  readonly group = new Group();
  /** How many shapes are drawn (used to limit shadows on touch devices). */
  partCount = 0;
  /** Draw calls used by furniture (for diagnostics). */
  batches = 0;
  /** Photo textures still loading (an image export waits for them). */
  pendingPhotos = 0;
  /** Imported 3D models: loaded ones (by asset id), ones loading, and ones that couldn't be read. */
  private models = new Map<string, Cached<{ root: Group; dispose(): void }>>();
  private loadingModels = new Map<string, Promise<{ root: Group; dispose(): void } | null>>();
  private failedModels = new Set<string>();
  /** Model boxes after turning (metres), by asset and turn. */
  private modelBoxes = new Map<string, Box3>();
  /** Triangles of imported models drawn in the last build, and pieces shown as boxes instead. */
  modelTriangles = 0;
  modelFallbacks = 0;
  private readonly pieces = new Map<string, PieceRecord>();
  private readonly batchOwners = new Map<BatchedMesh, string[]>();
  private contactShadows: InstancedMesh | null = null;
  private readonly contactMaterial: MeshBasicMaterial;
  private readonly contactPlane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private outline: LineSegments | null = null;
  private selectedId: string | null = null;
  private detail: PartDetail = 'medium';
  /** Bumped on every rebuild, so photos that finish loading late don't land on stale meshes. */
  private generation = 0;
  /**
   * Part and extruded geometry and photo textures survive rebuilds: moving one piece doesn't
   * re-make every other piece's geometry or re-upload its photos. Anything a rebuild didn't
   * use is freed.
   */
  private readonly geometries = new Map<string, Cached<BufferGeometry>>();
  private readonly photos = new Map<string, Cached<CanvasTexture>>();
  /** Repeating photo textures on individual parts. */
  private readonly repeats = new Map<string, Cached<Texture>>();

  constructor(
    private readonly materials: FurnitureMaterials,
    /** Called when a photo texture finishes loading, so the view can redraw. */
    private readonly onChange: () => void,
  ) {
    this.contactMaterial = new MeshBasicMaterial({ map: contactShadowTexture(), color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
  }

  /** Geometry detail (rounded-edge and curve segments). Takes effect on the next build. */
  setDetail(detail: PartDetail) {
    if (detail === this.detail) return;
    this.detail = detail;
    for (const entry of this.geometries.values()) entry.value.dispose();
    this.geometries.clear();
  }

  setContactShadows(on: boolean) {
    if (this.contactShadows) this.contactShadows.visible = on;
    this.contactMaterial.visible = on;
  }

  build(furniture: SceneFurniture[]) {
    this.clear();
    const generation = this.generation;
    const bySurface = new Map<string, { surface: SurfaceKind; finish: SurfaceFinish; look: SurfaceLook; casts: boolean; parts: PlacedPart[] }>();
    let parts = 0;
    let modelTriangles = 0;
    let fallbacks = 0;
    for (const piece of furniture) {
      this.pieces.set(piece.id, { footprint: piece, batched: [], extruded: null, owned: [] });
      if (piece.extruded) this.addExtruded(piece, generation);
      if (piece.photoModel) this.addPhotoModel(piece, generation);
      if (piece.mesh) {
        // Imported 3D models share a triangle budget for this quality; beyond it (or if a model
        // can't be read) a piece shows a plain box at its measured size.
        const fits = !this.failedModels.has(piece.mesh.assetId) && modelTriangles + piece.mesh.triangles <= MODEL_BUDGET[this.detail];
        if (fits) {
          modelTriangles += piece.mesh.triangles;
          this.addMeshModel(piece, generation);
        } else {
          this.addModelFallback(piece);
          fallbacks++;
        }
      }
      const placement = new Matrix4().compose(new Vector3(m(piece.x), m(piece.elevation), m(piece.y)), new Quaternion().setFromAxisAngle(UP, (-piece.rotation * Math.PI) / 180), new Vector3(1, 1, 1));
      for (const part of piece.parts) {
        if (part.photo) {
          // A part with its own photo texture (a worktop, cabinet doors): drawn on its own, at its
          // exact size, so the texture keeps its real scale and the piece keeps its detail.
          this.addPhotoPart(piece, part, placement, generation);
          parts++;
          continue;
        }
        const geometry = partGeometry(part, this.detail);
        this.cached(this.geometries, geometry.key, generation, geometry.make);
        // Small details don't cast shadow-map shadows (their contact shadow is enough), which
        // keeps the shadow pass cheap in rooms full of books and leaves.
        const casts = !SHADOWLESS_ROLES.has(part.role);
        const finish = part.finish ?? piece.finish;
        const look: SurfaceLook = { pattern: part.pattern, scale: part.textureScale, roughness: part.roughness, ...(part.glow ? { glow: lightHex(piece.light?.kelvin ?? 3000) } : {}) };
        const key = `${part.surface}|${finish}|${lookKey(look)}|${casts}`;
        const group = bySurface.get(key) ?? { surface: part.surface, finish, look, casts, parts: [] };
        group.parts.push({ owner: piece.id, geometry: geometry.key, matrix: placement.clone().multiply(partMatrix(part, geometry.scale)), color: new Color(part.color) });
        bySurface.set(key, group);
        parts++;
      }
    }
    for (const group of bySurface.values()) this.addBatch(group.surface, group.finish, group.look, group.casts, group.parts);
    this.addContactShadows(furniture);
    this.partCount = parts + furniture.filter((f) => f.extruded || f.photoModel || f.mesh).length;
    this.batches = bySurface.size + furniture.filter((f) => f.extruded || f.photoModel || f.mesh).length;
    this.modelTriangles = modelTriangles;
    this.modelFallbacks = fallbacks;
    this.applySelection();
    // Free shapes and photos that nothing in this rebuild used. (Photos still loading are
    // claimed when they arrive, so they're kept until the following rebuild.)
    for (const cache of [this.geometries, this.photos, this.repeats, this.models] as Map<string, Cached<{ dispose(): void }>>[]) {
      for (const [key, entry] of cache) {
        if (entry.generation < generation) {
          entry.value.dispose();
          cache.delete(key);
        }
      }
    }
  }

  setSelection(id: string | null) {
    this.selectedId = id;
    this.applySelection();
  }

  /** Meshes a click can land on. */
  hitTargets(): Object3D[] {
    return this.group.children.filter((c) => (c instanceof Mesh || c instanceof BatchedMesh) && c !== this.contactShadows);
  }

  /** The furniture id a ray hit belongs to, or null. */
  ownerOf(hit: Intersection): string | null {
    if (hit.object instanceof BatchedMesh && hit.batchId !== undefined) return this.batchOwners.get(hit.object)?.[hit.batchId] ?? null;
    return (hit.object.userData.furnitureId as string | undefined) ?? null;
  }

  footprintOf(id: string): SceneFurniture | undefined {
    return this.pieces.get(id)?.footprint;
  }

  /** Removes every mesh. Cached geometry and photos stay for the next rebuild. */
  clear() {
    this.generation++;
    this.removeOutline();
    // Owned materials' textures are shared (material details) or cached (photos): not freed here.
    for (const record of this.pieces.values()) for (const material of record.owned) material.dispose();
    for (const mesh of this.batchOwners.keys()) mesh.dispose();
    this.contactShadows?.dispose();
    this.contactShadows = null;
    this.group.clear();
    this.pieces.clear();
    this.batchOwners.clear();
    this.partCount = 0;
    this.batches = 0;
  }

  dispose() {
    this.clear();
    for (const cache of [this.geometries, this.photos, this.repeats, this.models] as Map<string, Cached<{ dispose(): void }>>[]) {
      for (const entry of cache.values()) entry.value.dispose();
      cache.clear();
    }
    this.contactMaterial.map?.dispose();
    this.contactMaterial.dispose();
    this.contactPlane.dispose();
  }

  // ---------------------------------------------------------------------------

  private addBatch(surface: SurfaceKind, finish: SurfaceFinish, look: SurfaceLook, casts: boolean, parts: PlacedPart[]) {
    if (parts.length === 0) return;
    const unique = [...new Set(parts.map((p) => p.geometry))];
    let vertices = 0;
    let indices = 0;
    for (const key of unique) {
      const g = this.geometries.get(key)!.value;
      vertices += g.getAttribute('position').count;
      indices += g.index!.count;
    }
    const mesh = new BatchedMesh(parts.length, vertices, indices, this.materials.get(surface, finish, '#ffffff', look));
    const ids = new Map(unique.map((key) => [key, mesh.addGeometry(this.geometries.get(key)!.value)]));
    const owners: string[] = [];
    for (const part of parts) {
      const id = mesh.addInstance(ids.get(part.geometry)!);
      mesh.setMatrixAt(id, part.matrix);
      mesh.setColorAt(id, part.color);
      owners[id] = part.owner;
      const record = this.pieces.get(part.owner)!;
      let entry = record.batched.find((b) => b.mesh === mesh);
      if (!entry) {
        entry = { mesh, ids: [], colors: [] };
        record.batched.push(entry);
      }
      entry.ids.push(id);
      entry.colors.push(part.color);
    }
    // Glass is see-through; small details are covered by contact shadows.
    mesh.castShadow = casts && surface !== 'glass' && surface !== 'sheer';
    mesh.receiveShadow = true;
    mesh.name = `furniture:${surface}`;
    this.batchOwners.set(mesh, owners);
    this.group.add(mesh);
  }

  /** A soft, blurred shadow under every solid piece, the size of its footprint. */
  private addContactShadows(furniture: SceneFurniture[]) {
    // Raised and wall-mounted pieces don't touch the floor, so they get no contact shadow there.
    // …except things resting on a surface (bottles on a worktop): their shadow is on that surface.
    const solid = furniture.filter((f) => f.height > 2 && (f.elevation < 1 || f.resting));
    if (solid.length === 0) return;
    const mesh = new InstancedMesh(this.contactPlane, this.contactMaterial, solid.length);
    solid.forEach((f, i) => {
      // A little wider than the piece; bigger pieces get a slightly wider spread.
      // Small things (a bottle) get a tight shadow, not one wider than themselves.
      const size = Math.max(f.width, f.depth);
      const spread = Math.min(6 + Math.min(14, size * 0.06), size * 0.35);
      const matrix = new Matrix4().compose(
        new Vector3(m(f.x), CONTACT_HEIGHT + m(f.resting ? f.elevation : 0), m(f.y)),
        new Quaternion().setFromAxisAngle(UP, (-f.rotation * Math.PI) / 180),
        new Vector3(m(f.width + spread * 2), 1, m(f.depth + spread * 2)),
      );
      mesh.setMatrixAt(i, matrix);
    });
    mesh.renderOrder = -1;
    mesh.name = 'furniture:contact-shadows';
    mesh.visible = this.contactMaterial.visible;
    this.contactShadows = mesh;
    this.group.add(mesh);
  }

  private addExtruded(piece: SceneFurniture, generation: number) {
    const { rings, bottom, height, color } = piece.extruded!;
    const textures = piece.textures;
    const outlineKey = rings.map((r) => [r.outer, ...r.holes].map((poly) => poly.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(';')).join('|')).join('/');
    const key = `extruded|${outlineKey}|${bottom}|${height}|${Object.keys(textures).sort().join(',')}`;
    const geometry = this.cached(this.geometries, key, generation, () => extrudedGeometry(rings, height, textures, 1, bottom));
    const body = this.materials.create(piece.material, piece.finish, color);
    const surfaces: MeshStandardMaterial[] = [body, body, body, body];
    const owned = [body];
    for (const [slot, id] of [
      [Surface.Top, textures.top],
      [Surface.Front, textures.front],
      [Surface.Side, textures.side],
    ] as const) {
      if (!id) continue;
      // Starts as the plain body colour; the photo replaces it once loaded.
      const material = this.materials.create(piece.material === 'glass' ? 'custom' : piece.material, piece.finish, color);
      material.map = null;
      surfaces[slot] = material;
      owned.push(material);
      const photoKey = `${id}|${color}`;
      const show = (texture: CanvasTexture) => {
        material.map = texture;
        material.color.set('#ffffff');
        material.needsUpdate = true;
      };
      const ready = this.photos.get(photoKey);
      if (ready) {
        ready.generation = generation;
        show(ready.value);
        continue;
      }
      this.pendingPhotos++;
      loadAssetImage(id)
        .then((image) => {
          if (!image || generation !== this.generation) return;
          show(this.cached(this.photos, photoKey, generation, () => photoTexture(image, color)));
          this.onChange();
        })
        .finally(() => this.pendingPhotos--);
    }
    const mesh = new Mesh(geometry, surfaces);
    mesh.position.copy(new Vector3(m(piece.x), m(piece.elevation), m(piece.y)));
    mesh.quaternion.setFromAxisAngle(UP, (-piece.rotation * Math.PI) / 180);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.furnitureId = piece.id;
    mesh.name = `furniture:${piece.id}`;
    const record = this.pieces.get(piece.id)!;
    record.extruded = mesh;
    record.owned = owned;
    this.group.add(mesh);
  }

  /**
   * A piece rebuilt from photos (Reconstruct): its surface from the photos' outlines, inside the
   * measured box, with each photo projected onto the surfaces that face its view.
   */
  private addPhotoModel(piece: SceneFurniture, generation: number) {
    const model = piece.photoModel!;
    const size = { width: piece.width, depth: piece.depth, height: piece.height };
    const views = [model.front, model.side, model.top];
    const key = `hull|${size.width}|${size.depth}|${size.height}|${views.map((v) => (v ? `${v.silhouette.cols}x${v.silhouette.rows}:${v.silhouette.bits}` : '-')).join('|')}`;
    const geometry = this.cached(this.geometries, key, generation, () => {
      const g = new BufferGeometry();
      const hull = photoModelMesh(model, size);
      if (!hull) return g;
      // cm → scene units; the hull is already in the piece's frame (y up, z towards its front).
      const positions = hull.positions.map((v) => m(v));
      g.setAttribute('position', new BufferAttribute(positions, 3));
      g.setAttribute('normal', new BufferAttribute(hull.normals, 3));
      g.setAttribute('uv', new BufferAttribute(hull.uvs, 2));
      g.setIndex(new BufferAttribute(hull.index, 1));
      for (const group of hull.groups) g.addGroup(group.start, group.count, group.slot);
      g.computeBoundingSphere();
      return g;
    });
    // Surfaces no photo faces (curved shoulders, the back) are usually the side's material, so
    // they take the side's colour, else the front's (a top is often a different part: a lid).
    const plainColour = (model.side ?? model.front ?? model.top)!.color;
    const surface = piece.material === 'glass' || piece.material === 'sheer' ? 'custom' : piece.material;
    const plain = this.materials.create(surface, piece.finish, plainColour);
    const owned = [plain];
    const slots: MeshStandardMaterial[] = [plain, plain, plain, plain];
    views.forEach((view, slot) => {
      if (!view) return;
      // Starts as the view's average colour; the photo replaces it once loaded.
      const material = this.materials.create(surface, piece.finish, view.color);
      material.map = null;
      slots[slot] = material;
      owned.push(material);
      const photoKey = `${view.assetId}|${view.color}`;
      const show = (texture: CanvasTexture) => {
        material.map = texture;
        material.color.set('#ffffff');
        material.needsUpdate = true;
      };
      const ready = this.photos.get(photoKey);
      if (ready) {
        ready.generation = generation;
        show(ready.value);
        return;
      }
      this.pendingPhotos++;
      loadAssetImage(view.assetId)
        .then((image) => {
          if (!image || generation !== this.generation) return;
          show(this.cached(this.photos, photoKey, generation, () => photoTexture(image, view.color)));
          this.onChange();
        })
        .finally(() => this.pendingPhotos--);
    });
    const mesh = new Mesh(geometry, slots);
    mesh.position.copy(new Vector3(m(piece.x), m(piece.elevation), m(piece.y)));
    mesh.quaternion.setFromAxisAngle(UP, (-piece.rotation * Math.PI) / 180);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.furnitureId = piece.id;
    mesh.name = `furniture:${piece.id}`;
    const record = this.pieces.get(piece.id)!;
    record.extruded = mesh;
    record.owned = owned;
    this.group.add(mesh);
  }

  /** An imported 3D model, fitted to the piece's measured box (loaded once, then shared). */
  private addMeshModel(piece: SceneFurniture, generation: number) {
    const id = piece.mesh!.assetId;
    const ready = this.models.get(id);
    if (ready) {
      ready.generation = generation;
      void this.placeModel(piece, ready.value.root, generation);
      return;
    }
    this.pendingPhotos++;
    this.loadModel(id)
      .then((loaded) => {
        if (!loaded) {
          this.failedModels.add(id);
          if (generation === this.generation) this.addModelFallback(piece);
          this.onChange();
          return;
        }
        const entry = this.cached(this.models, id, generation, () => loaded);
        if (entry !== loaded) loaded.dispose();
        if (generation !== this.generation) return;
        void this.placeModel(piece, entry.root, generation).then(() => this.onChange());
      })
      .finally(() => this.pendingPhotos--);
  }

  private loadModel(id: string): Promise<{ root: Group; dispose(): void } | null> {
    const loading = this.loadingModels.get(id);
    if (loading) return loading;
    const promise = (async () => {
      try {
        const asset = await getAsset(id);
        if (!asset) return null;
        const { parseStoredGlb, disposeModel } = await import('../../mesh/loadModel');
        const root = await parseStoredGlb(await asset.blob.arrayBuffer());
        root.updateMatrixWorld(true);
        return { root, dispose: () => disposeModel(root) };
      } catch {
        return null;
      } finally {
        this.loadingModels.delete(id);
      }
    })();
    this.loadingModels.set(id, promise);
    return promise;
  }

  /** Adds the model's meshes for one piece: turned upright, then scaled to its box. */
  private async placeModel(piece: SceneFurniture, root: Group, generation: number) {
    const model = piece.mesh!;
    const boxKey = `${model.assetId}|${model.turn.x}|${model.turn.y}|${model.turn.z}`;
    let box = this.modelBoxes.get(boxKey);
    const { turnedBox, turnQuaternion } = await import('../../mesh/loadModel');
    if (!box) {
      box = turnedBox(root, model.turn);
      this.modelBoxes.set(boxKey, box);
    }
    // A newer build has replaced this one while the loader module arrived: it places its own.
    if (generation !== this.generation || !this.pieces.has(piece.id)) return;
    const size = box.getSize(new Vector3());
    const scale = new Vector3(m(piece.width) / Math.max(size.x, 1e-6), m(piece.height) / Math.max(size.y, 1e-6), m(piece.depth) / Math.max(size.z, 1e-6));
    const placement = new Matrix4().compose(new Vector3(m(piece.x), m(piece.elevation), m(piece.y)), new Quaternion().setFromAxisAngle(UP, (-piece.rotation * Math.PI) / 180), new Vector3(1, 1, 1));
    const centre = box.getCenter(new Vector3());
    const fit = placement
      .multiply(new Matrix4().makeScale(scale.x, scale.y, scale.z))
      .multiply(new Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z))
      .multiply(new Matrix4().makeRotationFromQuaternion(turnQuaternion(model.turn)));
    root.traverse((o) => {
      const source = o as Mesh;
      if (!source.isMesh) return;
      const mesh = new Mesh(source.geometry, source.material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(fit.clone().multiply(source.matrixWorld));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.furnitureId = piece.id;
      mesh.name = `furniture:${piece.id}`;
      this.group.add(mesh);
    });
  }

  /** A plain box at the piece's measured size, for a model that's over budget or unreadable. */
  private addModelFallback(piece: SceneFurniture) {
    const record = this.pieces.get(piece.id);
    if (!record) return;
    const geometry = this.cached(this.geometries, 'model-fallback-box', this.generation, () => new BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
    const material = this.materials.create('custom', 'matte', '#b9b2a6');
    record.owned.push(material);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(m(piece.x), m(piece.elevation), m(piece.y));
    mesh.quaternion.setFromAxisAngle(UP, (-piece.rotation * Math.PI) / 180);
    mesh.scale.set(m(piece.width), m(piece.height), m(piece.depth));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.furnitureId = piece.id;
    mesh.name = `furniture:${piece.id}`;
    this.group.add(mesh);
  }

  private addPhotoPart(piece: SceneFurniture, part: SceneFurniture['parts'][number], placement: Matrix4, generation: number) {
    const photo = part.photo!;
    const exact = part.shape === 'rounded';
    const key = exact ? `photo-box|${part.width}|${part.height}|${part.depth}` : partGeometry(part, this.detail).key;
    const scale = exact ? new Vector3(1, 1, 1) : partGeometry(part, this.detail).scale;
    const geometry = this.cached(this.geometries, key, generation, exact ? () => withMetreUVs(new BoxGeometry(m(part.width), m(part.height), m(part.depth))) : partGeometry(part, this.detail).make);
    const surface = part.surface;
    const material = this.materials.create(surface, part.finish ?? piece.finish, part.color, { roughness: photo.roughness ?? part.roughness });
    const record = this.pieces.get(piece.id)!;
    record.owned.push(material);
    const mesh = new Mesh(geometry, material);
    mesh.applyMatrix4(placement.clone().multiply(partMatrix(part, scale)));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.furnitureId = piece.id;
    mesh.name = `furniture:${piece.id}:photo-part`;
    this.group.add(mesh);
    const textureKey = `${photo.assetId}|${photo.widthCm}|${photo.heightCm}`;
    const show = (texture: Texture) => {
      material.map = texture;
      material.color.set('#ffffff');
      material.needsUpdate = true;
    };
    const ready = this.repeats.get(textureKey);
    if (ready) {
      ready.generation = generation;
      show(ready.value);
      return;
    }
    this.pendingPhotos++;
    loadAssetImage(photo.assetId)
      .then((image) => {
        if (!image || generation !== this.generation) return;
        show(
          this.cached(this.repeats, textureKey, generation, () => {
            const t = new Texture(image);
            t.wrapS = t.wrapT = RepeatWrapping;
            t.colorSpace = SRGBColorSpace;
            t.repeat.set(100 / photo.widthCm, 100 / photo.heightCm);
            t.needsUpdate = true;
            return t;
          }),
        );
        this.onChange();
      })
      .finally(() => this.pendingPhotos--);
  }

  /** A value from a cache (made if missing), marked as used by this rebuild. */
  private cached<T>(cache: Map<string, Cached<T>>, key: string, generation: number, make: () => T): T {
    const hit = cache.get(key);
    if (hit) {
      hit.generation = generation;
      return hit.value;
    }
    const value = make();
    cache.set(key, { value, generation });
    return value;
  }

  private applySelection() {
    for (const [id, record] of this.pieces) {
      const selected = id === this.selectedId;
      for (const { mesh, ids, colors } of record.batched) ids.forEach((instance, i) => mesh.setColorAt(instance, selected ? colors[i].clone().lerp(HIGHLIGHT, 0.35) : colors[i]));
      for (const material of record.owned) material.emissive.copy(selected ? HIGHLIGHT : new Color(0)).multiplyScalar(selected ? 0.25 : 0);
    }
    this.removeOutline();
    const record = this.selectedId ? this.pieces.get(this.selectedId) : undefined;
    if (!record) return;
    const f = record.footprint;
    const rings: Ring[] = f.extruded?.rings ?? [{ outer: rectangle(f.width, f.depth), holes: [] }];
    // Outline the selected piece's real shape (not its bounding box), slightly enlarged.
    const solid = extrudedGeometry(rings.map((r) => ({ outer: inflate(r.outer, 1), holes: r.holes })), Math.max(f.height, 1) + 0.5, {}, 1);
    const edges = new EdgesGeometry(solid, 25);
    solid.dispose();
    const outline = new LineSegments(edges, new LineBasicMaterial({ color: HIGHLIGHT, depthTest: false, transparent: true, opacity: 0.9 }));
    outline.renderOrder = 10;
    outline.position.set(m(f.x), m(f.elevation), m(f.y));
    outline.quaternion.setFromAxisAngle(UP, (-f.rotation * Math.PI) / 180);
    this.outline = outline;
    this.group.add(outline);
  }

  private removeOutline() {
    if (!this.outline) return;
    this.group.remove(this.outline);
    this.outline.geometry.dispose();
    (this.outline.material as LineBasicMaterial).dispose();
    this.outline = null;
  }
}

/** A soft rounded-rectangle shadow, darkest in the middle and fading to nothing at the edges. */
function contactShadowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.filter = 'blur(14px)';
  ctx.fillStyle = '#ffffff';
  const inset = 26;
  ctx.beginPath();
  ctx.roundRect(inset, inset, size - inset * 2, size - inset * 2, 14);
  ctx.fill();
  const texture = new CanvasTexture(canvas);
  // The shape is white on transparent; the material colours it black and the alpha shapes it.
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function rectangle(width: number, depth: number): Polygon {
  return [
    { x: -width / 2, y: -depth / 2 },
    { x: width / 2, y: -depth / 2 },
    { x: width / 2, y: depth / 2 },
    { x: -width / 2, y: depth / 2 },
  ];
}

/** Pushes every corner outwards from the centre by about `cm` (for the selection outline). */
function inflate(poly: Polygon, cm: number): Polygon {
  return poly.map((p) => {
    const len = Math.hypot(p.x, p.y) || 1;
    return { x: p.x + (p.x / len) * cm, y: p.y + (p.y / len) * cm };
  });
}

/**
 * A footprint (local cm) extruded to `height`, in local metres with the piece's origin at
 * (0, 0, 0). Each part is filled with its holes left open; hole walls face into the hole.
 * Faces are grouped by surface so photos can go on the top, front-facing and side-facing
 * faces; texture coordinates span each photo across the whole piece (photo surfaces) or
 * repeat in metres (material detail elsewhere).
 */
export function extrudedGeometry(rings: Ring[], height: number, textures: SceneFurniture['textures'], repeatsPerMetre: number, bottom = 0): BufferGeometry {
  const cw = (poly: Polygon) => (signedArea2(poly) >= 0 ? poly : [...poly].reverse());
  const box = boundingBox(rings.flatMap((r) => r.outer));
  const w = Math.max(box.maxX - box.minX, 1e-6);
  const d = Math.max(box.maxY - box.minY, 1e-6);
  const positions: number[] = [];
  const uvs: number[] = [];
  const groups: { surface: Surface; start: number; count: number }[] = [];
  const add = (surface: Surface, verts: { p: [number, number, number]; uv: [number, number] }[]) => {
    const last = groups.at(-1);
    const start = positions.length / 3;
    if (last && last.surface === surface && last.start + last.count === start) last.count += verts.length;
    else groups.push({ surface, start, count: verts.length });
    for (const v of verts) {
      positions.push(v.p[0], v.p[1], v.p[2]);
      uvs.push(v.uv[0], v.uv[1]);
    }
  };
  const at = (x: number, y: number, z: number): [number, number, number] => [m(x), m(z), m(y)];

  let along = 0;
  /** Walls along one loop. A clockwise loop faces outwards; a hole traced the other way faces into the hole. */
  const walls = (loop: Polygon, outer: boolean) => {
    loop.forEach((a, i) => {
      const b = loop[(i + 1) % loop.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-9) return;
      // The face's outward normal is (dy, −dx) / length for this direction of travel.
      const nx = (b.y - a.y) / len;
      const ny = -(b.x - a.x) / len;
      let surface = Surface.Body;
      let ua: number;
      let ub: number;
      if (outer && textures.front && ny > 0.5) {
        surface = Surface.Front;
        // Seen from the front, +x is to the viewer's right.
        [ua, ub] = [(a.x - box.minX) / w, (b.x - box.minX) / w];
      } else if (outer && textures.side && Math.abs(nx) > 0.5) {
        surface = Surface.Side;
        // Seen from the right (+x) side, the back (min y) is on the viewer's right; mirrored on the left.
        [ua, ub] = nx > 0 ? [(box.maxY - a.y) / d, (box.maxY - b.y) / d] : [(a.y - box.minY) / d, (b.y - box.minY) / d];
      } else {
        [ua, ub] = [m(along) * repeatsPerMetre, m(along + len) * repeatsPerMetre];
      }
      const top = surface === Surface.Body ? m(height - bottom) * repeatsPerMetre : 1;
      const a0 = { p: at(a.x, a.y, bottom), uv: [ua, 0] as [number, number] };
      const b0 = { p: at(b.x, b.y, bottom), uv: [ub, 0] as [number, number] };
      const b1 = { p: at(b.x, b.y, height), uv: [ub, top] as [number, number] };
      const a1 = { p: at(a.x, a.y, height), uv: [ua, top] as [number, number] };
      add(surface, [a0, b1, b0, a0, a1, b1]);
      along += len;
    });
  };

  for (const ring of rings) {
    const outer = cw(ring.outer);
    const holes = ring.holes.map((h) => [...cw(h)].reverse());
    const all = [outer, ...holes].flat();
    // Top (facing up) and bottom (facing down). Clockwise-on-screen triangles face down in Three.
    const triangles = ShapeUtils.triangulateShape(
      outer.map((p) => new Vector2(p.x, p.y)),
      holes.map((h) => h.map((p) => new Vector2(p.x, p.y))),
    );
    for (const [i, j, k] of triangles) {
      const tri = [all[i], all[j], all[k]];
      const down = signedArea2(tri) > 0 ? tri : [tri[0], tri[2], tri[1]];
      const up = [down[0], down[2], down[1]];
      add(
        textures.top ? Surface.Top : Surface.Body,
        up.map((p) => ({
          p: at(p.x, p.y, height),
          // Photo: the whole top photo across the piece, back (min y) at the top of the image.
          uv: textures.top ? [(p.x - box.minX) / w, 1 - (p.y - box.minY) / d] : [m(p.x) * repeatsPerMetre, m(p.y) * repeatsPerMetre],
        })),
      );
      add(Surface.Body, down.map((p) => ({ p: at(p.x, p.y, bottom), uv: [0, 0] })));
    }
    walls(outer, true);
    for (const hole of holes) walls(hole, false);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.computeVertexNormals();
  for (const g of groups) geometry.addGroup(g.start, g.count, g.surface);
  return geometry;
}

/** A photo laid over the piece's colour, so transparent (background-removed) areas show the colour. */
function photoTexture(image: HTMLImageElement, color: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
