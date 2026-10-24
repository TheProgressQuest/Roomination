import { scaleComponents } from '../model/components';
import { MIN_FURNITURE_SIZE } from '../model/geometry';
import { scaleShape } from '../model/shape';
import type { FurnitureTemplate } from '../storage/projectFile';

/**
 * A catalogue piece stretched to a given size (its drawn outline and components stretch with
 * it). Used to show a scanned or existing piece as a different model without changing its
 * measured width, depth or height.
 */
export function fitTemplate(t: FurnitureTemplate, size: { width: number; depth: number; height: number }): FurnitureTemplate {
  const width = Math.max(MIN_FURNITURE_SIZE, size.width);
  const depth = Math.max(MIN_FURNITURE_SIZE, size.depth);
  const height = Math.max(1, size.height);
  const sx = width / t.width;
  const sy = depth / t.depth;
  const body = bodyTop(t);
  // The measured height is the body's (a vanity's worktop, a cistern's lid): small details above
  // it (taps, a vessel basin, a flush button) keep their real size and stand on top, as a
  // scanner's box leaves them out.
  const sz = height / (body ?? t.height);
  const components = t.components?.length ? scaleComponents(t.components, sx, sy, sz) : undefined;
  if (components && body !== null) {
    t.components!.forEach((c, i) => {
      if (c.parentId || c.type !== 'detail' || c.z < body - 1) return;
      components[i] = { ...components[i], z: Math.round((c.z - body + height) * 100) / 100, height: c.height };
    });
  }
  return {
    ...t,
    width,
    depth,
    height,
    ...(t.shape ? { shape: scaleShape(t.shape, sx, sy) } : {}),
    ...(components ? { components } : {}),
  };
}

/**
 * Where a component-built piece's body ends: the top of its highest part that isn't a small
 * detail, when details stand above it (else null: the whole piece is the body).
 */
function bodyTop(t: FurnitureTemplate): number | null {
  const parts = (t.components ?? []).filter((c) => !c.parentId && c.type !== 'group');
  const body = Math.max(...parts.filter((c) => c.type !== 'detail').map((c) => c.z + c.height));
  if (!Number.isFinite(body) || body <= 0 || body >= t.height - 0.5) return null;
  return body;
}
