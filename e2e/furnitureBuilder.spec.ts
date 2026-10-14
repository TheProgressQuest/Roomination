import { expect, test, type Page } from '@playwright/test';
import type {} from '../src/scene3d/diagnostics';
import { exportProject, lightweight3D, mapper, openApp, props, saveAndReload, selectInList, toolsTab, tools } from './helpers';

/**
 * The Advanced Furniture Builder: pieces built from components (base, backrests, arms,
 * cushions, pillows, legs…). The footprint still decides collisions; components decide how
 * the piece looks in the presentation plan and in 3D.
 */

const builder = (page: Page) => page.getByRole('dialog', { name: /Advanced Furniture Builder|Components of/ });

async function openNewBuilder(page: Page) {
  await toolsTab(page, 'Furnish');
  await tools(page).getByRole('button', { name: 'Build from components' }).click();
  await expect(builder(page)).toBeVisible();
}

type Piece = { name: string; x: number; y: number; width: number; depth: number; height: number; shape?: { points: unknown[] }; components?: { name: string; z: number; type: string; shape: string }[] };
const find = async (page: Page, name: string): Promise<Piece | undefined> => (await exportProject(page)).furniture.find((f: Piece) => f.name === name);

/** Luminance spread over a grid of points inside a box on the plan (how much shading there is). */
async function shadingSpread(page: Page, box: { x0: number; y0: number; x1: number; y1: number }) {
  return page.evaluate((box) => {
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('.floor-plan canvas')];
    const plan = document.querySelector('.floor-plan')!.getBoundingClientRect();
    const ratio = canvases[0].width / canvases[0].clientWidth;
    const merged = document.createElement('canvas');
    merged.width = canvases[0].width;
    merged.height = canvases[0].height;
    const ctx = merged.getContext('2d')!;
    for (const c of canvases) ctx.drawImage(c, 0, 0);
    const values: number[] = [];
    for (let i = 0; i <= 16; i++) {
      for (let j = 0; j <= 8; j++) {
        const x = Math.round((box.x0 + ((box.x1 - box.x0) * i) / 16 - plan.x) * ratio);
        const y = Math.round((box.y0 + ((box.y1 - box.y0) * j) / 8 - plan.y) * ratio);
        const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
        values.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      }
    }
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  }, box);
}

test.beforeEach(async ({ page }) => lightweight3D(page));

test('builds an angled-back loveseat from a template; it saves, undoes and reloads with its components', async ({ page }) => {
  const errors = await openApp(page);
  await openNewBuilder(page);
  const dialog = builder(page);
  await dialog.getByRole('button', { name: /Angled-back loveseat/ }).click();
  const list = dialog.getByRole('list', { name: 'Components' });
  for (const name of ['Base', 'Backrest 1', 'Backrest 2', 'Armrest 1', 'Seat cushion', 'Pillow']) await expect(list.getByRole('button', { name: new RegExp(`^${name}`) }).first()).toBeVisible();
  // Edges are numbered on the top view, and nothing sticks out of the footprint.
  await expect(dialog.locator('.fb-edge-label')).toHaveCount(5);
  await expect(dialog.locator('.fb-warning')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Add to room' }).click();
  await expect(dialog).toBeHidden();

  const piece = (await find(page, 'Angled-back loveseat'))!;
  expect(piece.shape!.points).toHaveLength(5);
  expect(piece.components!.length).toBeGreaterThanOrEqual(10);
  expect(piece.components!.filter((c) => c.type === 'backrest')).toHaveLength(2);
  // Height comes from the tallest component.
  expect(piece.height).toBeGreaterThan(65);
  expect(piece.height).toBeLessThanOrEqual(74.5);

  // One undo removes it, redo brings it back.
  await page.keyboard.press('ControlOrMeta+z');
  expect(await find(page, 'Angled-back loveseat')).toBeUndefined();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect((await find(page, 'Angled-back loveseat'))?.components?.length).toBe(piece.components!.length);

  await saveAndReload(page);
  expect((await find(page, 'Angled-back loveseat'))?.components).toEqual(piece.components);
  expect(errors).toEqual([]);
});

test('builds a template onto an existing piece’s own footprint, and edits components precisely', async ({ page }) => {
  const errors = await openApp(page);
  await selectInList(page, 'Sofa');
  await props(page).getByRole('button', { name: 'Build from components' }).click();
  const dialog = builder(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/Use this piece’s footprint and height/)).toBeChecked();
  await dialog.getByRole('button', { name: /^Standard sofa/ }).click();

  // Select a cushion and set its height above the floor exactly.
  const list = dialog.getByRole('list', { name: 'Components' });
  await list.getByRole('button', { name: /^Seat cushion 1/ }).click();
  const height = dialog.getByLabel('Height above floor', { exact: true });
  await height.fill('41');
  await height.press('Enter');
  await expect(height).toHaveValue('41');

  // Duplicate, then undo inside the builder.
  const count = await list.locator('li').count();
  await dialog.getByRole('button', { name: 'Duplicate' }).click();
  await expect(list.locator('li')).toHaveCount(count + 1);
  await dialog.getByRole('button', { name: 'Undo' }).click();
  await expect(list.locator('li')).toHaveCount(count);

  // A locked component can't be deleted.
  await list.getByRole('button', { name: /^Seat cushion 1/ }).click();
  await list.getByRole('button', { name: /^Lock Seat cushion 1/ }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog.getByRole('status').first()).toContainText('locked');
  await expect(list.locator('li')).toHaveCount(count);

  // Group the two arms; moving the group would move both.
  await list.getByRole('button', { name: /^Armrest 1/ }).click();
  await list.getByRole('button', { name: /^Armrest 2/ }).click({ modifiers: ['Shift'] });
  await dialog.getByRole('button', { name: 'Group', exact: true }).click();
  await expect(list.getByRole('button', { name: /^Group/ })).toBeVisible();

  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
  const sofa = (await find(page, 'Sofa'))!;
  // The person's measurements are kept: the sample sofa is 220 × 90.
  expect({ width: sofa.width, depth: sofa.depth }).toEqual({ width: 220, depth: 90 });
  expect(sofa.components!.find((c) => c.name === 'Seat cushion 1')!.z).toBe(41);
  expect(sofa.components!.some((c) => c.type === 'group')).toBe(true);
  expect(errors).toEqual([]);
});

test('warns when a component reaches outside the footprint, and grows the footprint only when asked', async ({ page }) => {
  const errors = await openApp(page);
  await openNewBuilder(page);
  const dialog = builder(page);
  await dialog.getByRole('button', { name: 'Templates' }).click();
  await dialog.getByLabel('Add a component').selectOption('custom');
  const across = dialog.getByLabel('Across (x)', { exact: true });
  await across.fill('100');
  await across.press('Enter');
  const warning = dialog.locator('.fb-warning');
  await expect(warning).toContainText('outside the footprint');
  // Nothing changes until the person chooses to grow it.
  await expect(dialog.locator('.fb-summary')).toContainText('1.6 m × 90 cm');
  await warning.getByRole('button', { name: 'Grow the footprint to fit' }).click();
  await expect(warning).toHaveCount(0);
  await expect(dialog.locator('.fb-summary')).toContainText('2.3 m');
  await dialog.getByRole('button', { name: 'Add to room' }).click();
  const piece = (await find(page, 'Custom piece'))!;
  expect(piece.width).toBe(230);
  expect(errors).toEqual([]);
});

test('the presentation plan shades the component piece; the technical plan shows its exact footprint', async ({ page }, info) => {
  const errors = await openApp(page);
  // Alone in an empty room, so nothing else is drawn over it.
  await page.getByRole('button', { name: /^Projects/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Empty room' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await page.waitForSelector('.floor-plan canvas');
  await openNewBuilder(page);
  await builder(page).getByRole('button', { name: /Deep-seat loveseat/ }).click();
  await builder(page).getByRole('button', { name: 'Add to room' }).click();
  const piece = (await find(page, 'Deep-seat loveseat'))!;
  // The empty room: 400 × 350 cm.
  const m = await mapper(page, { minX: 0, minY: 0, maxX: 400, maxY: 350, wall: 12 });
  // The back of the piece (its backrest and the top of the seat), away from the name label.
  const a = m.at(piece.x - piece.width / 2 + 4, piece.y - piece.depth / 2 + 3);
  const b = m.at(piece.x + piece.width / 2 - 4, piece.y - piece.depth / 2 + piece.depth * 0.35);
  const box = { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  const technical = await shadingSpread(page, box);
  await page.getByRole('radio', { name: 'Presentation' }).click();
  await expect.poll(() => shadingSpread(page, box)).toBeGreaterThan(technical + 2);
  await info.attach('component-loveseat-presentation.png', { body: await page.locator('.canvas-panel').screenshot(), contentType: 'image/png' });
  // Collisions use the footprint: it's still exactly the size it was.
  expect((await find(page, 'Deep-seat loveseat'))!.width).toBe(piece.width);
  expect(errors).toEqual([]);
});

for (const [width, height] of [
  [375, 780],
  [768, 1000],
]) {
  test.describe(`Builder at ${width}px`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: width < 500 });

    test('fits the screen, switches views, and keeps Save reachable', async ({ page }) => {
      const errors = await openApp(page);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByRole('dialog', { name: 'Add to the room' }).getByRole('button', { name: 'Build from components' }).click();
      const dialog = builder(page);
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: /^Loveseat/ }).click();
      const overflow = await page.evaluate(() => document.querySelector('dialog[open]')!.scrollWidth > window.innerWidth + 1);
      expect(overflow).toBe(false);
      await expect(dialog.locator('.fb-top .fb-stage')).toBeVisible();
      await dialog.getByRole('radio', { name: 'Front' }).click();
      await expect(dialog.locator('.fb-front .fb-stage')).toBeVisible();
      await expect(dialog.locator('.fb-top .fb-stage')).toBeHidden();
      await dialog.getByRole('button', { name: 'Add to room' }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole('button', { name: 'Add to room' })).toBeInViewport();
      expect(errors).toEqual([]);
    });
  });
}

test('component furniture renders in the 3D view and in the builder’s 3D preview', { tag: '@3d' }, async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await openApp(page);
  await openNewBuilder(page);
  const dialog = builder(page);
  await dialog.getByRole('button', { name: /Angled-back loveseat/ }).click();
  await dialog.getByRole('button', { name: 'Show 3D preview' }).click();
  await expect(dialog.locator('.fb-preview3d canvas')).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Add to room' }).click();
  await expect(page.locator('canvas.room-3d-canvas')).toHaveCount(0);
  await page.getByRole('radio', { name: '3D View' }).click();
  await expect.poll(() => page.evaluate(() => window.__roomination3D?.stats().framesRendered ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
