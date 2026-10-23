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
  const sz = height / t.height;
  return {
    ...t,
    width,
    depth,
    height,
    ...(t.shape ? { shape: scaleShape(t.shape, sx, sy) } : {}),
    ...(t.components?.length ? { components: scaleComponents(t.components, sx, sy, sz) } : {}),
  };
}
