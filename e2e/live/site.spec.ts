import { expect, test, type Page } from '@playwright/test';

const LIVE_URL = process.env.LIVE_URL ?? 'https://theprogressquest.github.io/Roomination/';
const EXPECTED_VERSION = process.env.EXPECTED_VERSION?.slice(0, 7);

/**
 * Opens the public site, bypassing cached copies, and (when EXPECTED_VERSION is given) waits
 * until GitHub Pages serves that build — a deploy can take a minute or two to appear.
 */
async function openLatest(page: Page) {
  const deadline = Date.now() + 180_000;
  for (;;) {
    await page.goto(`${LIVE_URL}?check=${Date.now()}`);
    await page.waitForSelector('.floor-plan canvas');
    const label = page.locator('.app-version');
    const footer = (await label.count()) > 0 ? await label.first().textContent() : 'a version without a version label';
    if (!EXPECTED_VERSION || footer?.includes(EXPECTED_VERSION)) return;
    if (Date.now() > deadline) throw new Error(`The site still serves "${footer}", not ${EXPECTED_VERSION}.`);
    await page.waitForTimeout(15_000);
  }
}

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
]) {
  test(`the 2D / 3D switch is visible and works at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openLatest(page);
    const view = page.getByRole('radiogroup', { name: 'View' });
    await expect(view).toBeInViewport();
    await expect(view.getByRole('radio', { name: '2D Plan' })).toHaveAttribute('aria-checked', 'true');
    await view.getByRole('radio', { name: '3D View' }).click();
    await expect(page.getByRole('region', { name: '3D view' }).locator('canvas')).toBeVisible({ timeout: 60_000 });
    await view.getByRole('radio', { name: '2D Plan' }).click();
    await expect(page.locator('.floor-plan canvas').first()).toBeVisible();
  });
}
