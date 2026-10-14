import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, Euler, ExtrudeGeometry, Matrix4, Quaternion, Shape, SphereGeometry, Vector2, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { FurniturePart } from '../../render/furnitureParts';
import { CM_PER_SCENE_UNIT } from '../model';

/**
 * Geometry for furniture parts, cached and shared between pieces.
 *
 * - Rounded boxes and leaves are built at their exact size (so corners stay round instead
 *   of being stretched); sizes are rounded to 0.5 cm so similar parts share one geometry.
 * - Cylinders, cones and ellipsoids are unit shapes scaled into place.
 *
 * Every geometry is indexed with position, normal and uv (what BatchedMesh needs), and its
 * UVs are box-projected in metres so detail textures keep their real-world scale.
 */

export type PartDetail = 'low' | 'medium' | 'high';

const m = (cm: number) => cm / CM_PER_SCENE_UNIT;
const q = (cm: number) => Math.max(0.5, Math.round(cm * 2) / 2);

interface GeometryKey {
  key: string;
  /** Scale applied by the instance matrix (1,1,1 for exact-size geometry). */
  scale: Vector3;
  make: () => BufferGeometry;
}

/** Which shared geometry a part uses, and how its instance matrix must scale it. */
export function partGeometry(part: FurniturePart, detail: PartDetail): GeometryKey {
  // Detail is spent where it shows: two rounding segments read as smooth upholstery even close up.
  const segments = detail === 'high' ? 2 : 1;
  const radial = detail === 'high' ? 20 : detail === 'medium' ? 14 : 8;
  switch (part.shape) {
    case 'rounded': {
      // Rounding under ~6 mm can't be seen: such parts (books, shelves, thin panels) share one
      // scaled box, so a room full of furniture needs only a few distinct geometries.
      if ((part.radius ?? 0) < 0.6 || detail === 'low') return { key: 'box', scale: unitScale(part), make: () => withMetreUVs(new BoxGeometry(1, 1, 1)) };
      const [w, h, d] = [q(part.width), q(part.height), q(part.depth)];
      const r = Math.min(part.radius ?? 0, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01);
      const radius = Math.max(0, Math.round(r * 4) / 4);
      return {
        key: `rounded|${w}|${h}|${d}|${radius}|${segments}`,
        scale: new Vector3(m(part.width) / m(w), m(part.height) / m(h), m(part.depth) / m(d)),
        make: () => withMetreUVs(radius > 0.1 ? new RoundedBoxGeometry(m(w), m(h), m(d), segments, m(radius)) : new RoundedBoxGeometry(m(w), m(h), m(d), 1, 0.0001)),
      };
    }
    case 'cylinder':
      return { key: `cylinder|${radial}`, scale: unitScale(part), make: () => withMetreUVs(new CylinderGeometry(0.5, 0.5, 1, radial)) };
    case 'cone': {
      const taper = Math.round((part.taper ?? 0.8) * 20) / 20;
      const top = taper >= 1 ? 0.5 : 0.5 * taper;
      const bottom = taper >= 1 ? 0.5 / taper : 0.5;
      return { key: `cone|${taper}|${radial}`, scale: unitScale(part), make: () => withMetreUVs(new CylinderGeometry(top, bottom, 1, radial)) };
    }
    case 'ellipsoid':
      return { key: `ellipsoid|${radial}`, scale: unitScale(part), make: () => withMetreUVs(new SphereGeometry(0.5, radial, Math.round(radial * 0.6))) };
    case 'leaf': {
      // Leaves vary a lot; sizes rounded to 1–2 cm share geometry (the matrix makes up the rest).
      const [w, len, t] = [Math.max(1, Math.round(part.width)), Math.max(2, Math.round(part.depth / 2) * 2), Math.max(0.5, Math.round(part.height * 2) / 2)];
      return { key: `leaf|${w}|${len}|${t}|${segments}`, scale: new Vector3(m(part.width) / m(w), m(part.height) / m(t), m(part.depth) / m(len)), make: () => leafGeometry(m(w), m(len), m(t), segments) };
    }
    case 'prism': {
      // Exact size (outlines vary too much to share by scaling); rounded to 0.5 mm.
      const outline = (part.outline ?? []).map((p) => ({ x: Math.round(p.x * 20) / 20, y: Math.round(p.y * 20) / 20 }));
      const h = Math.round(part.height * 20) / 20;
      const chamfer = part.bevel === 'chamfer';
      const r = detail === 'low' ? 0 : Math.round(Math.min(part.radius ?? 0, h / 2 - 0.01) * 20) / 20;
      const bevelSegments = chamfer ? 1 : detail === 'high' ? 3 : 2;
      return {
        key: `prism|${outline.map((p) => `${p.x},${p.y}`).join(';')}|${h}|${r}|${r > 0 ? bevelSegments : 0}`,
        scale: new Vector3(1, 1, 1),
        make: () => prismGeometry(outline, h, r, bevelSegments),
      };
    }
  }
}

/**
 * An upright extrusion of a plan outline (cm), centred on its height, with edges rounded or
 * bevelled by `radius` without growing past the outline (Three's bevel offset pulls it in).
 */
export function prismGeometry(outline: { x: number; y: number }[], height: number, radius: number, bevelSegments: number): BufferGeometry {
  // Plan y becomes 3D z after the turn below, which flips it; pre-flip so the result matches.
  const shape = new Shape(outline.map((p) => new Vector2(m(p.x), -m(p.y))));
  const bevel = radius > 0.05;
  const r = m(radius);
  const geometry = new ExtrudeGeometry(shape, {
    depth: Math.max(m(height) - (bevel ? 2 * r : 0), m(0.05)),
    bevelEnabled: bevel,
    bevelThickness: r,
    bevelSize: r,
    bevelOffset: -r,
    bevelSegments,
    curveSegments: 1,
  });
  geometry.clearGroups();
  // Extruded along +z from −r (bevel) to depth + r; stand it up (+y) and centre it.
  geometry.translate(0, 0, bevel ? r : 0);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -m(height) / 2, 0);
  return withMetreUVs(geometry);
}

const unitScale = (p: FurniturePart) => new Vector3(m(p.width), m(p.height), m(p.depth));

/**
 * Where a part sits inside its piece: its centre, turned by yaw and tilted, then scaled.
 * Plan x → 3D x, plan y → 3D z, height → 3D y. Plan turns are clockwise, so negative about y.
 */
export function partMatrix(part: FurniturePart, scale: Vector3): Matrix4 {
  const position = new Vector3(m(part.x), m(part.z + part.height / 2), m(part.y));
  const rotation = new Quaternion().setFromEuler(new Euler(-((part.tilt ?? 0) * Math.PI) / 180, -((part.yaw ?? 0) * Math.PI) / 180, 0, 'YXZ'));
  return new Matrix4().compose(position, rotation, scale);
}

/** Replaces a geometry's UVs with a box projection in metres (so textures keep their real scale). */
function withMetreUVs(geometry: BufferGeometry): BufferGeometry {
  const indexed = geometry.index ? geometry : indexify(geometry);
  const pos = indexed.getAttribute('position');
  const normal = indexed.getAttribute('normal');
  indexed.computeBoundingBox();
  const size = new Vector3();
  indexed.boundingBox!.getSize(size);
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const [nx, ny, nz] = [Math.abs(normal.getX(i)), Math.abs(normal.getY(i)), Math.abs(normal.getZ(i))];
    const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    // Project onto the plane the surface mostly faces, with u (the grain direction of wood and
    // brushed metal) along that face's longer side, as on real panels and boards.
    const [u, v] =
      ny >= nx && ny >= nz ? (size.z > size.x ? [z, x] : [x, z]) : nx >= nz ? (size.y > size.z ? [y, z] : [z, y]) : size.y > size.x ? [y, x] : [x, y];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  indexed.setAttribute('uv', new BufferAttribute(uv, 2));
  return indexed;
}

function indexify(geometry: BufferGeometry): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  const index = new Uint32Array(count);
  for (let i = 0; i < count; i++) index[i] = i;
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}

/**
 * A leaf blade: pointed at both ends, widest a little before the middle, gently arched
 * along its length and cupped across it. Lies along +z (the plan's +y), centred, within
 * width × thickness × length.
 */
export function leafGeometry(width: number, length: number, thickness: number, segments: number): BufferGeometry {
  const rows = 4 + segments * 3;
  const cols = 1 + segments;
  const positions: number[] = [];
  const indices: number[] = [];
  const arch = thickness * 0.45;
  for (let side = 0; side < 2; side++) {
    // Top face, then bottom face (slightly lower), both spanning the blade.
    const offset = side === 0 ? thickness * 0.15 : -thickness * 0.15;
    const start = positions.length / 3;
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const half = (width / 2) * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.85);
      const z = (t - 0.5) * length;
      const y = arch * Math.sin(Math.PI * t) - arch / 2 + offset;
      for (let c = 0; c <= cols; c++) {
        const s = (c / cols) * 2 - 1;
        // Cupped: the edges sit a little lower than the midrib.
        positions.push(s * half, y - Math.abs(s) * thickness * 0.3, z);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = start + r * (cols + 1) + c;
        const b = a + cols + 1;
        if (side === 0) indices.push(a, b, a + 1, a + 1, b, b + 1);
        else indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return withMetreUVs(geometry);
}
