import { hasPhotoModel } from './photoModel';
import type { Furniture } from './types';

/**
 * Which appearance the 3D view shows for a piece (Photos & scans → Shown in 3D):
 *  - standard: its own model (components, shape, colours, photos on its surfaces);
 *  - rebuild: the photo rebuild (shape from photographed outlines);
 *  - scan: an imported 3D scan.
 *
 * Nothing new is stored: the choice is the existing `off` flags of the photo rebuild and the
 * 3D scan (a scan, when shown, takes precedence over a rebuild). Switching never removes
 * anything, so every look stays available, in Undo, saved projects, My Library and exports,
 * and projects saved before this selector existed read the same way.
 */
export type ShownLook = 'standard' | 'rebuild' | 'scan';

export const SHOWN_LOOK_LABELS: Record<ShownLook, string> = {
  standard: 'Standard model',
  rebuild: 'Photo rebuild',
  scan: '3D scan',
};

type Looks = Pick<Furniture, 'mesh' | 'photoModel'>;

/** The looks this piece has (the standard model always exists). */
export function availableLooks(item: Looks): Record<ShownLook, boolean> {
  return { standard: true, rebuild: hasPhotoModel(item.photoModel), scan: !!item.mesh };
}

/** What the 3D view draws now (the same precedence the renderer uses). */
export function shownLook(item: Looks): ShownLook {
  if (item.mesh && !item.mesh.off) return 'scan';
  if (item.photoModel && !item.photoModel.off && hasPhotoModel(item.photoModel)) return 'rebuild';
  return 'standard';
}

/** The changes that show `look` (or nothing, if the piece doesn't have it). Nothing is removed. */
export function withShownLook(item: Looks, look: ShownLook): Partial<Furniture> {
  if (!availableLooks(item)[look]) return {};
  const changes: Partial<Furniture> = {};
  if (item.mesh) changes.mesh = look === 'scan' ? withoutOff(item.mesh) : { ...item.mesh, off: true };
  // The rebuild is hidden only when the standard model is chosen (under a shown scan it doesn't
  // draw anyway, and keeping it on means hiding the scan later shows the rebuild, as before).
  if (item.photoModel) changes.photoModel = look === 'standard' ? { ...item.photoModel, off: true } : withoutOff(item.photoModel);
  return changes;
}

function withoutOff<T extends { off?: boolean }>(value: T): T {
  const { off: _off, ...rest } = value;
  return rest as T;
}
