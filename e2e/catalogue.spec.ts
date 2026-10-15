import { expect, test, type Page } from '@playwright/test';
import { exportProject, lightweight3D, mapper, openApp, saveAndReload, toolsTab, tools } from './helpers';

/**
 * The furniture catalogue: ready-made pieces found by search or room, added with a click or
 * by dragging onto the plan, drawn locally (no downloads), and saved like any other piece.
 */

const catalogue = (page: Page) => tools(page).locator('.catalogue');
type Piece = { name: string; kind: string; x: number; y: number; width: number; depth: number; components?: unknown[] };

test.beforeEach(async ({ page }) => lightweight3D(page));

test('searches and filters by room, and adds a fixture with a click', async ({ page }) => {
  const errors = await openApp(page);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await toolsTab(page, 'Furnish');
  const cat = catalogue(page);
  await expect(cat.locator('.catalogue-card').first()).toBeVisible();
  const total = await cat.locator('.catalogue-card').count();
  expect(total).toBeGreaterThanOrEqual(130);

  await cat.getByRole('radio', { name: 'Bathroom', exact: true }).click();
  await expect(cat.getByRole('radio', { name: 'Bathroom', exact: true })).toHaveAttribute('aria-checked', 'true');
  const bathroom = await cat.locator('.catalogue-card').count();
  expect(bathroom).toBeGreaterThan(5);
  expect(bathroom).toBeLessThan(total);

  await cat.getByRole('radio', { name: 'All', exact: true }).click();
  await cat.getByLabel('Search the catalogue').fill('toilet');
  await expect(cat.locator('.catalogue-card')).toHaveCount(2);
  // Pictures are drawn on this device.
  await expect(cat.locator('.catalogue-card img').first()).toHaveAttribute('src', /^data:image\/png/);
  await cat.getByRole('button', { name: /^Add Toilet\b/ }).click();
  const toilet = ((await exportProject(page)).furniture as Piece[]).find((f) => f.name === 'Toilet')!;
  expect(toilet).toMatchObject({ kind: 'fixture', width: 38, depth: 68 });
  expect(toilet.components!.length).toBeGreaterThan(3);

  await cat.getByLabel('Search the catalogue').fill('nothing like this');
  await expect(cat.getByRole('status')).toContainText('Nothing matches');
  // Nothing was fetched from anywhere but the app itself.
  const origin = new URL(page.url()).origin;
  expect(requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('drags a piece from the catalogue onto the plan where it is dropped', async ({ page }) => {
  const errors = await openApp(page);
  await toolsTab(page, 'Furnish');
  const cat = catalogue(page);
  await cat.getByLabel('Search the catalogue').fill('hot tub');
  const card = cat.getByRole('button', { name: /^Add Hot tub\b/ });
  await expect(card).toBeVisible();
  const m = await mapper(page);
  const target = m.at(330, 250);
  await card.dragTo(page.locator('.floor-plan'), { targetPosition: { x: target.x - (await page.locator('.floor-plan').boundingBox())!.x, y: target.y - (await page.locator('.floor-plan').boundingBox())!.y } });
  const tub = ((await exportProject(page)).furniture as Piece[]).find((f) => f.name === 'Hot tub')!;
  expect(tub).toBeTruthy();
  // Dropped where it was let go (kept fully inside the room).
  expect(Math.abs(tub.x - 330)).toBeLessThan(80);
  expect(Math.abs(tub.y - 250)).toBeLessThan(80);
  await saveAndReload(page);
  expect(((await exportProject(page)).furniture as Piece[]).some((f) => f.name === 'Hot tub')).toBe(true);
  expect(errors).toEqual([]);
});

test.describe('Catalogue on a phone', () => {
  test.use({ viewport: { width: 375, height: 780 }, hasTouch: true, isMobile: true });

  test('the Add sheet offers the catalogue; a tap adds the piece', async ({ page }) => {
    const errors = await openApp(page);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Add to the room' });
    const cat = sheet.locator('.catalogue');
    await expect(cat.locator('.catalogue-card').first()).toBeVisible();
    await expect(cat.getByRole('status')).toContainText('Tap one to add it');
    const overflow = await page.evaluate(() => document.querySelector('dialog[open]')!.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
    await cat.getByLabel('Search the catalogue').fill('washing machine');
    await cat.getByRole('button', { name: /^Add Washing machine\b/ }).click();
    await expect(sheet).toBeHidden();
    expect(((await exportProject(page)).furniture as Piece[]).some((f) => f.name === 'Washing machine')).toBe(true);
    expect(errors).toEqual([]);
  });
});
