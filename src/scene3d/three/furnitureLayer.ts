import {
  BoxGeometry,
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
  Quaternion,
  SRGBColorSpace,
  ShapeUtils,
  Vector2,
  Vector3,
  type Intersection,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { boundingBox, signedArea2, type Polygon } from '../../model/polygon';
import type { MaterialKind } from '../../model/types';
import type { Ring } from '../../model/shape';
import { loadAssetImage } from '../../storage/assets';
import { CM_PER_SCENE_UNIT, toScene, type Block, type SceneFurniture } from '../model';
import type { FurnitureMaterials } from './furnitureMaterials';

/**
 * All furniture in the 3D view.
 *
 * - Standard pieces are boxes arranged per type, drawn as one instanced mesh per material
 *   (a handful of draw calls however many pieces there are).
 * - Drawn shapes and photo-textured pieces are extruded from their real footprint — the
 *   same outline the plan and collision checks use — into one mesh each. Photos are mapped
 *   onto the top, front-facing and side-facing surfaces.
 */

/** Selection: the brand's Savage Ultramarine. */
const HIGHLIGHT = new Color('#1f2bd6');
const UP = new Vector3(0, 1, 0);
const m = (cm: number) => cm / CM_PER_SCENE_UNIT;

/** Material slots of an extruded piece's geometry groups. */
const enum Surface {
  Body = 0,
  Top = 1,
  Front = 2,
  Side = 3,
}

interface InstancedPiece {
  mesh: InstancedMesh;
  start: number;
  colors: Color[];
}

interface PieceRecord {
  footprint: SceneFurniture;
  instanced: InstancedPiece[];
  extruded: Mesh | null;
  /** Materials owned by this piece (extruded pieces), disposed with it. Their textures are cached separately. */
  owned: MeshStandardMaterial[];
}

/** Something kept between rebuilds, and the rebuild that last used it. */
interface Cached<T> {
  value: T;
  generation: number;
}

export class FurnitureLayer {
  readonly group = new Group();
  /** How many shapes are drawn (used to limit shadows on touch devices). */
  partCount = 0;
  private readonly pieces = new Map<string, PieceRecord>();
  private readonly instanceOwners = new Map<InstancedMesh, string[]>();
  private outline: LineSegments | null = null;
  private selectedId: string | null = null;
  /** Bumped on every rebuild, so photos that finish loading late don't land on stale meshes. */
  private generation = 0;
  /**
   * Extruded shapes and photo textures survive rebuilds: moving one piece doesn't re-make
   * every other piece's mesh or re-upload its photos. Anything a rebuild didn't use is freed.
   */
  private readonly geometries = new Map<string, Cached<BufferGeometry>>();
  private readonly photos = new Map<string, Cached<CanvasTexture>>();

  constructor(
    private readonly unitBox: BoxGeometry,
    private readonly materials: FurnitureMaterials,
    /** Called when a photo texture finishes loading, so the view can redraw. */
    private readonly onChange: () => void,
  ) {}

  build(furniture: SceneFurniture[]) {
    this.clear();
    const generation = this.generation;
    // Group the boxes of standard pieces by material: one instanced mesh each.
    const byMaterial = new Map<string, { kind: MaterialKind | null; finish: SceneFurniture['finish']; pieces: SceneFurniture[] }>();
    for (const piece of furniture) {
      this.pieces.set(piece.id, { footprint: piece, instanced: [], extruded: null, owned: [] });
      if (piece.extruded) {
        this.addExtruded(piece, generation);
        continue;
      }
      const key = `${piece.material ?? 'default'}|${piece.finish}`;
      const group = byMaterial.get(key) ?? { kind: piece.material, finish: piece.finish, pieces: [] };
      group.pieces.push(piece);
      byMaterial.set(key, group);
    }
    for (const { kind, finish, pieces } of byMaterial.values()) this.addInstanced(kind, finish, pieces);
    this.partCount = furniture.reduce((sum, f) => sum + Math.max(1, f.parts.length), 0);
    this.applySelection();
    // Free shapes and photos that nothing in this rebuild used. (Photos still loading are
    // claimed when they arrive, so they're kept until the following rebuild.)
    for (const cache of [this.geometries, this.photos] as Map<string, Cached<{ dispose(): void }>>[]) {
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
    return this.group.children.filter((c) => c instanceof Mesh);
  }

  /** The furniture id a ray hit belongs to, or null. */
  ownerOf(hit: Intersection): string | null {
    if (hit.object instanceof InstancedMesh && hit.instanceId !== undefined) return this.instanceOwners.get(hit.object)?.[hit.instanceId] ?? null;
    return (hit.object.userData.furnitureId as string | undefined) ?? null;
  }

  footprintOf(id: string): SceneFurniture | undefined {
    return this.pieces.get(id)?.footprint;
  }

  /** Removes every mesh. Cached shapes and photos stay for the next rebuild. */
  clear() {
    this.generation++;
    this.removeOutline();
    // Owned materials' textures are shared (material details) or cached (photos): not freed here.
    for (const record of this.pieces.values()) for (const material of record.owned) material.dispose();
    for (const mesh of this.instanceOwners.keys()) mesh.dispose();
    this.group.clear();
    this.pieces.clear();
    this.instanceOwners.clear();
    this.partCount = 0;
  }

  dispose() {
    this.clear();
    for (const cache of [this.geometries, this.photos] as Map<string, Cached<{ dispose(): void }>>[]) {
      for (const entry of cache.values()) entry.value.dispose();
      cache.clear();
    }
  }

  // ---------------------------------------------------------------------------

  private addInstanced(kind: MaterialKind | null, finish: SceneFurniture['finish'], pieces: SceneFurniture[]) {
    const count = pieces.reduce((sum, p) => sum + p.parts.length, 0);
    if (count === 0) return;
    const mesh = new InstancedMesh(this.unitBox, this.materials.get(kind, finish), count);
    const owners: string[] = [];
    let index = 0;
    for (const piece of pieces) {
      const colors: Color[] = [];
      for (const part of piece.parts) {
        mesh.setMatrixAt(index + colors.length, blockMatrix(part));
        const color = new Color(part.color);
        mesh.setColorAt(index + colors.length, color);
        colors.push(color);
        owners.push(piece.id);
      }
      this.pieces.get(piece.id)!.instanced.push({ mesh, start: index, colors });
      index += colors.length;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.name = `furniture:${kind ?? 'default'}`;
    this.instanceOwners.set(mesh, owners);
    this.group.add(mesh);
  }

  private addExtruded(piece: SceneFurniture, generation: number) {
    const { rings, height, color } = piece.extruded!;
    const textures = piece.textures;
    const repeats = this.materials.repeatsFor(piece.material, 1);
    const outlineKey = rings.map((r) => [r.outer, ...r.holes].map((poly) => poly.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(';')).join('|')).join('/');
    const key = `${outlineKey}|${height}|${repeats}|${Object.keys(textures).sort().join(',')}`;
    const geometry = this.cached(this.geometries, key, generation, () => extrudedGeometry(rings, height, textures, repeats));
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
      const material = this.materials.create(piece.material === 'glass' ? null : piece.material, piece.finish, color);
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
      loadAssetImage(id).then((image) => {
        if (!image || generation !== this.generation) return;
        show(this.cached(this.photos, photoKey, generation, () => photoTexture(image, color)));
        this.onChange();
      });
    }
    const mesh = new Mesh(geometry, surfaces);
    mesh.position.copy(new Vector3(m(piece.x), 0, m(piece.y)));
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
      for (const { mesh, start, colors } of record.instanced) {
        colors.forEach((color, i) => mesh.setColorAt(start + i, selected ? color.clone().lerp(HIGHLIGHT, 0.35) : color));
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
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
    outline.position.set(m(f.x), 0, m(f.y));
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

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Position, turn and size the unit box to fill a block. */
export function blockMatrix(b: Block): Matrix4 {
  const centre = toScene(b, b.z + b.height / 2);
  const turn = new Quaternion().setFromAxisAngle(UP, (-b.rotation * Math.PI) / 180);
  return new Matrix4().compose(new Vector3(centre.x, centre.y, centre.z), turn, new Vector3(m(b.width), m(Math.max(b.height, 0.01)), m(b.depth)));
}

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
export function extrudedGeometry(rings: Ring[], height: number, textures: SceneFurniture['textures'], repeatsPerMetre: number): BufferGeometry {
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
      const top = surface === Surface.Body ? m(height) * repeatsPerMetre : 1;
      const a0 = { p: at(a.x, a.y, 0), uv: [ua, 0] as [number, number] };
      const b0 = { p: at(b.x, b.y, 0), uv: [ub, 0] as [number, number] };
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
      add(Surface.Body, down.map((p) => ({ p: at(p.x, p.y, 0), uv: [0, 0] })));
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
