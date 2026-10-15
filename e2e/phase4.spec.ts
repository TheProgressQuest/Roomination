import { expect, test, type Page } from '@playwright/test';
import { exportProject, mapper, openApp, props, saveAndReload, tools, toolsTab } from './helpers';

/**
 * Phase 4: tabbed navigation, the TPQ look, Feng Shui and the Bagua overlay, and the
 * optimizer's modes, weights and before/after comparison.
 */

const optimizer = (page: Page) => page.getByRole('dialog', { name: 'Optimize layout' });

/** Average colour of a small patch of the plan canvas around a screen point. */
async function canvasColour(page: Page, x: number, y: number) {
  const box = (await page.locator('.floor-plan').boundingBox())!;
  return page.evaluate(
    ({ x, y, box }) => {
      const canvas = document.querySelector('.floor-plan canvas') as HTMLCanvasElement;
      const ratio = canvas.width / canvas.clientWidth;
      const data = canvas.getContext('2d')!.getImageData(Math.round((x - box.x) * ratio) - 3, Math.round((y - box.y) * ratio) - 3, 6, 6).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
      return sum.map((v) => v / (data.length / 4));
    },
    { x, y, box },
  );
}

test.describe('Tabs', () => {
  test('Build, Furnish, Design and Optimize work with the keyboard and are remembered', async ({ page }) => {
    const errors = await openApp(page);
    const tabs = tools(page).getByRole('tablist', { name: 'Tools' });
    await expect(tabs.getByRole('tab')).toHaveCount(4);
    const build = tabs.getByRole('tab', { name: 'Build' });
    await expect(build).toHaveAttribute('aria-selected', 'true');
    await expect(tools(page).getByRole('tabpanel')).toContainText('Walls');

    // Arrow keys move along the tabs (and wrap); only the chosen tab is in the tab order.
    await build.focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: /^Furnish/ })).toBeFocused();
    await expect(tabs.getByRole('tab', { name: /^Furnish/ })).toHaveAttribute('aria-selected', 'true');
    await expect(tools(page).getByRole('tabpanel')).toContainText('Furniture catalogue');
    await page.keyboard.press('End');
    await expect(tabs.getByRole('tab', { name: 'Optimize' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(build).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.getByRole('tab', { name: 'Optimize' })).toBeFocused();
    await expect(tabs.locator('[role=tab][tabindex="0"]')).toHaveCount(1);

    // The Design tab keeps the board and floor controls.
    await toolsTab(page, 'Design');
    await expect(tools(page).getByRole('radiogroup', { name: 'Board style' })).toBeVisible();
    await expect(tools(page).getByRole('radiogroup', { name: 'Floor surface' })).toBeVisible();
    await page.reload();
    await page.waitForSelector('.floor-plan canvas');
    await expect(tools(page).getByRole('tab', { name: 'Design' })).toHaveAttribute('aria-selected', 'true');
    expect(errors).toEqual([]);
  });

  test('the brand colour marks the active tab and the 2D/3D switch, and the theme never changes room colours', async ({ page }) => {
    await openApp(page);
    const active = await tools(page).getByRole('tab', { name: 'Build' }).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(active).toBe('rgb(31, 43, 214)');
    const view = await page.getByRole('radio', { name: '2D Plan' }).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(view).toBe('rgb(31, 43, 214)');
    const before = await exportProject(page);
    await page.getByRole('radio', { name: 'Dark theme' }).click();
    expect(await exportProject(page)).toEqual(before);
    const dark = await tools(page).getByRole('tab', { name: 'Build' }).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(dark).toBe('rgb(141, 149, 255)');
  });
});

test.describe('Feng Shui and the Bagua map', () => {
  test('is off until switched on; the entrance Bagua tints the floor without blocking furniture', async ({ page }) => {
    const errors = await openApp(page);
    await toolsTab(page, 'Optimize');
    const panel = tools(page).getByRole('tabpanel');
    await expect(panel.getByLabel('Show the Bagua map on the plan')).toHaveCount(0);
    await panel.getByLabel('Use Feng Shui (optional)').check();
    await expect(panel).toContainText('makes no claims about luck, health or wealth');

    // An empty patch of floor (between the armchair and the rug) before and after.
    const m = await mapper(page);
    const spot = m.at(150, 120);
    const plain = await canvasColour(page, spot.x, spot.y);
    await panel.getByLabel('Show the Bagua map on the plan').check();
    await expect.poll(async () => {
      const tinted = await canvasColour(page, spot.x, spot.y);
      return Math.abs(tinted[2] - plain[2]) + Math.abs(tinted[0] - plain[0]);
    }).toBeGreaterThan(3);
    await panel.getByText('What the Bagua areas mean').click();
    await expect(panel.locator('.bagua-legend dt')).toHaveCount(9);
    await expect(panel.locator('.bagua-legend')).toContainText('Career & life path');

    // The overlay never captures the pointer: furniture is still picked and dragged.
    const sofa = m.at(240, 330);
    await page.mouse.click(sofa.x, sofa.y);
    await expect(props(page).getByLabel('Name', { exact: true })).toHaveValue('Sofa');

    // Saved with the project.
    await saveAndReload(page);
    const saved = await exportProject(page);
    expect(saved.fengShui).toMatchObject({ enabled: true, showBagua: true, method: 'entrance' });
    expect(errors).toEqual([]);
  });

  test('the compass method needs a typed bearing, never a guess', async ({ page }) => {
    await openApp(page);
    await toolsTab(page, 'Optimize');
    const panel = tools(page).getByRole('tabpanel');
    await panel.getByLabel('Use Feng Shui (optional)').check();
    await panel.getByRole('radio', { name: 'Compass (classical)' }).click();
    await expect(panel).toContainText('Roomination never guesses it');
    await expect(panel.locator('.bagua-legend')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Top is east' }).click();
    await expect(panel).toContainText('The top of the plan faces E (90°)');
    await expect(panel.locator('.bagua-legend')).toHaveCount(1);
    await panel.getByLabel('Top of the plan faces (compass bearing)').fill('200');
    await panel.getByLabel('Top of the plan faces (compass bearing)').press('Enter');
    await expect(panel).toContainText('faces S (200°)');
  });
});

test.describe('Optimizer modes and comparison', () => {
  test('custom weights always add up to 100%, and Feng Shui mode explains itself as interpretive', async ({ page }) => {
    const errors = await openApp(page);
    await page.getByRole('button', { name: 'Optimize layout' }).first().click();
    const dialog = optimizer(page);
    await expect(dialog.getByLabel('Room is mainly a…')).toContainText('Living room (guessed from the furniture)');
    // The sample already relates the sofa to the TV; the armchair's pairing is assumed.
    await expect(dialog.locator('.assumed-list')).toContainText('Armchair faces TV console');

    await dialog.getByRole('radio', { name: /^Custom/ }).check();
    const weights = dialog.locator('.custom-weights');
    await weights.getByLabel('Function').fill('80');
    const total = async () => {
      const values = await weights.locator('output').allTextContents();
      return values.reduce((s, v) => s + Number.parseInt(v, 10), 0);
    };
    expect(await total()).toBe(100);
    await expect(weights.getByLabel('Feng Shui')).toHaveCount(0);

    // Switch Feng Shui on inside the dialog; now it can be weighted, and its mode chosen.
    await dialog.locator('.feng-shui-section summary').click();
    await dialog.getByLabel('Use Feng Shui (optional)').check();
    await expect(weights.getByLabel('Feng Shui')).toBeVisible();
    await weights.getByLabel('Feng Shui').fill('30');
    expect(await total()).toBe(100);
    await dialog.getByRole('radio', { name: /^Feng Shui/ }).check();

    await dialog.getByRole('button', { name: 'Find layouts' }).click();
    await expect(dialog.getByRole('button', { name: 'Find layouts again' })).toBeVisible({ timeout: 60_000 });
    const card = dialog.locator('.suggestion-card:not(.is-current)').first();
    await expect(card.locator('.score-summary')).toContainText('Feng Shui*');
    const table = card.locator('.comparison table');
    await expect(table).toContainText('Overlapping furniture');
    await expect(table).toContainText('Doors blocked or swung into');
    await expect(table).toContainText('Feng Shui (interpretive preference)');
    await expect(card.locator('.result-list.is-improvement')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

for (const width of [320, 375, 430, 768, 1024, 1440]) {
  const touch = width < 1100;
  test.describe(`Phase 4 at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 500 ? 780 : 900 }, hasTouch: touch, isMobile: touch && width < 500 });

    test('every tab fits without sideways scrolling; tabs and the 2D/3D switch stay reachable', async ({ page }) => {
      const errors = await openApp(page);
      if (width >= 768 && width < 1100 && (await page.locator('.tools-rail').count())) await page.getByRole('button', { name: 'Show tools panel' }).click();
      await expect(page.getByRole('radio', { name: '2D Plan' })).toBeVisible();
      await expect(page.getByRole('radio', { name: '3D View' })).toBeVisible();
      for (const name of ['Build', 'Furnish', 'Design', 'Optimize'] as const) {
        await toolsTab(page, name);
        const overflow = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const offenders = [...document.querySelectorAll('body *')].filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.right > vw + 1 && !el.closest('dialog');
          });
          return { scroll: document.documentElement.scrollWidth > vw, offenders: offenders.slice(0, 3).map((el) => el.className || el.tagName) };
        });
        expect(overflow, name).toEqual({ scroll: false, offenders: [] });
        if (touch) {
          const tab = (await tools(page).getByRole('tab', { name: new RegExp(`^${name}`) }).boundingBox())!;
          expect(tab.height).toBeGreaterThanOrEqual(44);
        }
      }
      expect(errors).toEqual([]);
    });

    test('the optimizer and Shape Builder fit the screen', async ({ page }) => {
      await openApp(page);
      await page.getByRole('button', { name: /Optimize/ }).first().click();
      const fits = () =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('dialog[open]')].every((d) => {
            const r = d.getBoundingClientRect();
            return r.left >= -1 && r.right <= innerWidth + 1 && d.scrollWidth <= d.clientWidth + 1;
          }),
        );
      await expect(optimizer(page)).toBeVisible();
      expect(await fits()).toBe(true);
      await optimizer(page).getByRole('button', { name: 'Close' }).click();
      if (width < 1100) {
        await page.getByRole('button', { name: 'Add', exact: true }).click();
        await page.getByRole('dialog', { name: 'Add to the room' }).getByRole('button', { name: 'Shape Builder' }).click();
      } else {
        await toolsTab(page, 'Furnish');
        await tools(page).getByRole('button', { name: 'Shape Builder' }).click();
      }
      await expect(page.getByRole('dialog', { name: 'Shape Builder' })).toBeVisible();
      expect(await fits()).toBe(true);
      await expect(page.getByRole('dialog', { name: 'Shape Builder' }).getByRole('button', { name: 'Use this shape' })).toBeInViewport();
    });
  });
}
