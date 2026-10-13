import { expect, test } from '@playwright/test';
import { mapper, objectRows, openApp, settle, type RoomBox } from './helpers';

const WIDTHS = [320, 375, 430, 768, 1024, 1440];
const DRAWING_VIEW: RoomBox = { minX: 0, minY: 0, maxX: 480, maxY: 380, wall: 96, wallLabels: true };

for (const width of WIDTHS) {
  const touch = width < 1100;
  test.describe(`${width}px wide`, () => {
    test.use({ viewport: { width, height: width < 500 ? 780 : 900 }, hasTouch: touch, isMobile: touch && width < 500 });

    test('fits the screen with no horizontal scrolling and gives the plan most of the width', async ({ page }) => {
      const errors = await openApp(page);
      const overflow = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const offenders = [...document.querySelectorAll('body *')].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > vw + 1 && !el.closest('dialog');
        });
        return { scroll: document.documentElement.scrollWidth > vw, offenders: offenders.slice(0, 3).map((el) => el.className || el.tagName) };
      });
      expect(overflow).toEqual({ scroll: false, offenders: [] });
      const plan = (await page.locator('.canvas-panel').boundingBox())!;
      expect(plan.width).toBeGreaterThanOrEqual(width >= 1100 ? width * 0.5 : width >= 768 ? width * 0.55 : width - 24);
      await expect(page.locator('.properties-panel')).toHaveCount(width >= 1100 ? 1 : 0);
      expect(errors).toEqual([]);
    });

    if (!touch) return;

    test('tap to select, Edit opens a modal that fits; double-tap is a shortcut', async ({ page }) => {
      await openApp(page);
      const m = await mapper(page);
      const sofa = m.at(240, 330);
      await page.touchscreen.tap(sofa.x, sofa.y);
      await expect(page.locator('.selection-name')).toHaveText('Sofa');
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Edit Sofa' });
      await expect(dialog).toBeVisible();
      const fits = await page.evaluate(() => {
        const r = document.querySelector('dialog[open]')!.getBoundingClientRect();
        return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      });
      expect(fits).toBe(true);
      await expect(dialog.getByLabel('Width', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await page.touchscreen.tap(sofa.x, sofa.y);
      await page.waitForTimeout(60);
      await page.touchscreen.tap(sofa.x, sofa.y);
      await expect(page.locator('dialog[open]')).toHaveCount(1);
    });

    test('swiping over the unselected plan scrolls the page; a selected item can be dragged', async ({ page }) => {
      await openApp(page);
      await expect(page.locator('.floor-plan')).toHaveCSS('touch-action', 'pan-y');
      const m = await mapper(page);
      const sofa = m.at(240, 330);
      await page.touchscreen.tap(sofa.x, sofa.y);
      await expect(page.locator('.floor-plan')).toHaveCSS('touch-action', 'none');
      const cdp = await page.context().newCDPSession(page);
      const touchEvent = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      await touchEvent('touchStart', sofa.x, sofa.y);
      for (let i = 1; i <= 10; i++) await touchEvent('touchMove', sofa.x - i * 4, sofa.y);
      await touchEvent('touchEnd', 0, 0);
      await page.waitForTimeout(150);
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      const x = Number(await page.getByRole('dialog').getByLabel('From left', { exact: true }).inputValue());
      expect(Math.abs(x - (240 - 40 / m.scale))).toBeLessThan(3);
    });

    test('walls can be drawn by touch from the Add sheet', async ({ page }) => {
      await openApp(page);
      await page.locator('.selection-bar').getByRole('button', { name: 'Add' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Draw room shape' }).click();
      const bar = page.locator('.drawing-bar');
      await expect(bar).toBeVisible();
      const barBox = (await bar.boundingBox())!;
      expect(barBox.x + barBox.width).toBeLessThanOrEqual(width);
      await settle(page);
      const m = await mapper(page, DRAWING_VIEW);
      for (const [x, y] of [[0, 0], [400, 0], [400, 300], [0, 300]]) {
        const p = m.at(x, y);
        await page.touchscreen.tap(p.x, p.y);
        await page.waitForTimeout(60);
      }
      await expect(bar).toContainText('4 corners placed');
      await bar.getByRole('button', { name: 'Close room' }).click();
      await expect(bar).toHaveCount(0);
      // The room was redrawn: open the walls list and check its four walls.
      await expect(page.locator('.tools-panel .object-list').nth(1).locator('li')).toHaveCount(4);
    });

    test('stairs can be added and edited in the modal', async ({ page }) => {
      await openApp(page);
      await page.locator('.selection-bar').getByRole('button', { name: 'Add' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'U-shaped stairs' }).click();
      await expect(page.locator('.selection-name')).toHaveText('Stairs');
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Edit Stairs' });
      await expect(dialog.locator('.section-list > li')).toHaveCount(4);
      await dialog.getByRole('button', { name: 'Add flight' }).click();
      await expect(dialog.locator('.section-list > li')).toHaveCount(5);
      await dialog.getByRole('button', { name: 'Close' }).click();
      await expect(objectRows(page).filter({ hasText: 'Stairs' })).toHaveCount(1);
    });
  });
}
