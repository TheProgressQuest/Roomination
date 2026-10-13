import { createId } from '../model/sample';
import type { Furniture } from '../model/types';
import { db } from './db';
import { parseFurnitureTemplate, type FurnitureTemplate } from './projectFile';

/**
 * The furniture library: pieces saved for reuse in any project on this device
 * ("My loveseat", "Studio desk"). Items are validated every time they're read, exactly
 * like furniture in a project file.
 */

export interface LibraryItem {
  id: string;
  savedAt: number;
  template: FurnitureTemplate;
}

export type FurnitureOrigin = 'standard' | 'custom' | 'photo';

export const ORIGIN_LABELS: Record<FurnitureOrigin, string> = {
  standard: 'Standard',
  custom: 'Custom',
  photo: 'Photo-assisted',
};

/** Photo-assisted if it carries photos, custom if it has a drawn outline, otherwise standard. */
export function furnitureOrigin(item: Pick<Furniture, 'shape' | 'appearance'>): FurnitureOrigin {
  const a = item.appearance;
  if (a && ((a.photos?.length ?? 0) > 0 || Object.keys(a.textures ?? {}).length > 0)) return 'photo';
  return item.shape ? 'custom' : 'standard';
}

/** The parts of a piece worth saving: everything except where it stands and its links. */
export function toTemplate(item: Furniture): FurnitureTemplate {
  const { id: _id, x: _x, y: _y, rotation: _r, locked: _l, preferences: _p, ...template } = item;
  return template;
}

/** Library items, most recently saved first. Unreadable records are skipped (never deleted). */
export async function listLibraryRecords(): Promise<LibraryItem[]> {
  const records = await db.library.orderBy('savedAt').reverse().toArray();
  return records.flatMap((record) => {
    const template = parseFurnitureTemplate(record.item);
    return template ? [{ id: record.id, savedAt: record.savedAt, template }] : [];
  });
}

export async function saveToLibrary(template: FurnitureTemplate, id = createId()): Promise<LibraryItem> {
  const savedAt = Date.now();
  await db.library.put({ id, savedAt, item: template });
  return { id, savedAt, template };
}

export async function duplicateLibraryItem(item: LibraryItem, existingNames: string[]): Promise<LibraryItem> {
  let name = `${item.template.name} copy`;
  for (let n = 2; existingNames.includes(name); n++) name = `${item.template.name} copy ${n}`;
  return saveToLibrary({ ...item.template, name });
}

/** Removes the item. Its photos stay (other projects may use them) until a confirmed clean-up. */
export async function deleteLibraryItem(id: string): Promise<void> {
  await db.library.delete(id);
}
