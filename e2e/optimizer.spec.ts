import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { serializeProject } from '../src/storage/projectFile';
import { lShapedStudio, overcrowded } from '../src/optimizer/testRooms';
import { exportProject, objectRows, openApp, props, saveAndReload, selectInList, tools } from './helpers';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Optimize layout' });

async function findLayouts(page: Page) {
  await page.getByRole('button', { name: 'Optimize layout' }).first().click();
  await dialog(page).getByRole('button', { name: 'Find layouts' }).click();
  await expect(dialog(page).getByRole('button', { name: 'Find layouts again' })).toBeVisible({ timeout: 60_000 });
}

async function importProject(page: Page, file: string) {
  await page.getByRole('button', { name: /^Projects/ }).click();
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles(file);
  await expect(page.getByRole('dialog').locator('.import-message')).toContainText('Imported');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
}

test.describe('Optimize Layout', () => {
  test('finds distinct, explained suggestions without touching the current layout', async ({ page }) => {
    const errors = await openApp(page);
    const before = await exportProject(page);
    await findLayouts(page);
    const cards = dialog(page).locator('.suggestion-card:not(.is-current)');
    await expect(cards).toHaveCount(3);
    for (const card of await cards.all()) {
      await expect(card.locator('.score-summary')).toContainText('Overall');
      await expect(card.locator('.result-list.is-improvement li').first()).toBeVisible();
      await card.locator('.score-breakdown summary').click();
      await expect(card.locator('.score-breakdown tbody tr').first()).toBeVisible();
    }
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    expect(await exportProject(page)).toEqual(before); // nothing changed until Apply
    expect(errors).toEqual([]);
  });

  test('preview is read-only and leaves the layout unchanged; apply is one undo step', async ({ page }) => {
    await openApp(page);
    const before = await exportProject(page);
    await findLayouts(page);
    await dialog(page).getByRole('button', { name: 'Preview on plan' }).first().click();
    await expect(page.locator('.preview-bar')).toContainText('Previewing Layout A');
    await expect(page.locator('.floor-plan')).toBeVisible();
    await page.locator('.preview-bar').getByRole('button', { name: 'Exit preview' }).click();
    expect(await exportProject(page)).toEqual(before);

    await page.getByRole('button', { name: 'Optimize layout' }).first().click();
    await dialog(page).getByRole('button', { name: 'Apply layout' }).first().click();
    await expect(page.locator('.toast')).toContainText('Applied Layout A');
    const after = await exportProject(page);
    expect(after.furniture).not.toEqual(before.furniture);
    // Only positions and rotations changed.
    const strip = (items: { x: number; y: number; rotation: number }[]) => items.map(({ x: _x, y: _y, rotation: _r, ...rest }) => rest);
    expect(strip(after.furniture)).toEqual(strip(before.furniture));
    await page.getByRole('button', { name: 'Undo' }).click();
    expect((await exportProject(page)).furniture).toEqual(before.furniture);
  });

  test('while previewing, Undo and the panels are paused so the preview can’t drift', async ({ page }) => {
    await openApp(page);
    await selectInList(page, 'Plant');
    await props(page).getByLabel('From left', { exact: true }).fill('300');
    await props(page).getByLabel('From left', { exact: true }).press('Enter');
    await findLayouts(page);
    await dialog(page).getByRole('button', { name: 'Preview on plan' }).first().click();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await expect(tools(page)).toHaveAttribute('inert', '');
    await page.locator('.preview-bar').getByRole('button', { name: 'Exit preview' }).click();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  });

  test('switching projects clears suggestions made for the previous one', async ({ page }) => {
    await openApp(page);
    await findLayouts(page);
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: /^Projects/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Empty room' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Optimize layout' }).first().click();
    await expect(dialog(page).locator('.suggestion-card')).toHaveCount(0);
  });

  test('a suggestion can be saved as a layout, survives reload, and be applied later', async ({ page }) => {
    await openApp(page);
    await findLayouts(page);
    await dialog(page).getByRole('button', { name: 'Save as layout' }).nth(1).click();
    await expect(dialog(page).getByRole('region', { name: 'Saved layouts' })).toContainText('Layout B');
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await saveAndReload(page);
    await page.getByRole('button', { name: 'Optimize layout' }).first().click();
    const saved = dialog(page).getByRole('region', { name: 'Saved layouts' });
    await expect(saved).toContainText('Layout B');
    await saved.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('.toast')).toContainText('Applied Layout B');
  });

  test('can be cancelled while running; the layout is unchanged', async ({ page }) => {
    await openApp(page);
    const before = await exportProject(page);
    await page.getByRole('button', { name: 'Optimize layout' }).first().click();
    await dialog(page).getByRole('radiogroup', { name: 'Effort' }).getByRole('radio', { name: 'Thorough' }).click();
    await dialog(page).getByRole('button', { name: 'Find layouts' }).click();
    await expect(dialog(page).locator('progress')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page).getByRole('button', { name: 'Find layouts' })).toBeVisible();
    await expect(dialog(page).locator('.suggestion-card')).toHaveCount(0);
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    // (The chosen effort is remembered with the project, so compare the furniture.)
    expect((await exportProject(page)).furniture).toEqual(before.furniture);
  });

  test('the same seed gives the same suggestions', async ({ page }) => {
    await openApp(page);
    await findLayouts(page);
    const first = await dialog(page).locator('.suggestion-card:not(.is-current) .score-summary').allTextContents();
    await dialog(page).getByRole('button', { name: 'Find layouts again' }).click();
    await expect(dialog(page).getByRole('button', { name: 'Find layouts again' })).toBeVisible({ timeout: 60_000 });
    expect(await dialog(page).locator('.suggestion-card:not(.is-current) .score-summary').allTextContents()).toEqual(first);
  });

  test('locked pieces show a lock, cannot be dragged, and are never moved by suggestions', async ({ page }) => {
    await openApp(page);
    await selectInList(page, 'Sofa');
    await props(page).getByRole('checkbox', { name: 'Lock position' }).check();
    await expect(props(page).getByRole('checkbox', { name: 'Position locked' })).toBeChecked();
    await expect(props(page).getByLabel('From left', { exact: true })).toBeDisabled();
    const sofaBefore = (await exportProject(page)).furniture.find((f: { name: string }) => f.name === 'Sofa');
    await findLayouts(page);
    await expect(dialog(page).getByRole('button', { name: 'Unlock Sofa' })).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Apply layout' }).first().click();
    const sofaAfter = (await exportProject(page)).furniture.find((f: { name: string }) => f.name === 'Sofa');
    expect(sofaAfter).toEqual(sofaBefore);
  });

  test('relationships can be added and removed from a piece’s properties', async ({ page }) => {
    await openApp(page);
    await selectInList(page, 'Armchair');
    const p = props(page);
    await p.getByLabel('Armchair…').selectOption({ label: 'Faces…' });
    await p.getByLabel('Other piece').selectOption({ label: 'TV console' });
    await p.getByRole('button', { name: 'Link' }).click();
    await expect(p.locator('.relationship-list')).toContainText('Armchair faces TV console');
    await p.getByRole('button', { name: 'Remove: Armchair faces TV console' }).click();
    await expect(p.locator('.relationship-list')).toHaveCount(0);
    await p.getByLabel('What it is').selectOption({ label: 'Desk' });
    await p.getByLabel('Near an outlet').check();
    expect((await exportProject(page)).furniture.find((f: { name: string }) => f.name === 'Armchair')).toMatchObject({ kind: 'desk', preferences: ['nearOutlet'] });
  });

  test('an overcrowded room is explained instead of faked', async ({ page }, info) => {
    await openApp(page);
    const file = info.outputPath('overcrowded.json');
    writeFileSync(file, serializeProject(overcrowded()));
    await importProject(page, file);
    await findLayouts(page);
    await expect(dialog(page)).toContainText('No arrangement was found');
    await expect(dialog(page).locator('.suggestion-card')).toHaveCount(0);
  });

  test('an L-shaped studio gets suggestions inside its real outline', async ({ page }, info) => {
    await openApp(page);
    const file = info.outputPath('studio.json');
    writeFileSync(file, serializeProject(lShapedStudio()));
    await importProject(page, file);
    await findLayouts(page);
    await dialog(page).getByRole('button', { name: 'Apply layout' }).first().click();
    const project = await exportProject(page);
    for (const f of project.furniture) {
      const halfDiagonal = Math.hypot(f.width, f.depth) / 2;
      // Nothing's centre sits deep inside the missing corner (x > 340, y > 280).
      expect(f.x > 340 + halfDiagonal && f.y > 280 + halfDiagonal).toBe(false);
    }
    await expect(objectRows(page)).not.toHaveCount(0);
  });
});

for (const width of [320, 375, 430, 768, 1024, 1440]) {
  test.describe(`Optimize Layout at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 500 ? 780 : 900 }, hasTouch: width < 1100, isMobile: width < 500 });

    test('dialog fits, scrolls, and Apply / Cancel are reachable', async ({ page }) => {
      await openApp(page);
      await page.getByRole('button', { name: 'Optimize layout' }).first().click();
      const box = (await dialog(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await dialog(page).getByRole('button', { name: 'Find layouts' }).click();
      await expect(dialog(page).getByRole('button', { name: 'Find layouts again' })).toBeVisible({ timeout: 60_000 });
      const apply = dialog(page).getByRole('button', { name: 'Apply layout' }).first();
      await apply.scrollIntoViewIfNeeded();
      await expect(apply).toBeInViewport();
      const overflow = await page.evaluate(() => {
        const d = document.querySelector('dialog[open]')!;
        return [...d.querySelectorAll('*')].some((el) => {
          const r = el.getBoundingClientRect();
          const dr = d.getBoundingClientRect();
          return r.width > 0 && r.right > dr.right + 1;
        });
      });
      expect(overflow).toBe(false);
      await apply.click();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await expect(tools(page)).toBeAttached();
    });
  });
}
