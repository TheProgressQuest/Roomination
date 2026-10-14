import { expect, test, type Locator, type Page } from '@playwright/test';
import { exportProject, lightweight3D, openApp, props, saveAndReload, selectInList, tools, toolsTab } from './helpers';

/**
 * The Shape Builder end to end: basic shapes → exact sizes → cut a hole → save → the hole is
 * kept in the saved file and after reloading → reopen the recipe and change it.
 */

const builder = (page: Page) => page.getByRole('dialog', { name: 'Shape Builder' });
const selectedPanel = (dialog: Locator) => dialog.getByRole('region', { name: 'Selected shape' });

async function setField(scope: Locator, label: string, value: number) {
  const input = scope.getByLabel(label, { exact: true });
  await input.fill(String(value));
  await input.press('Enter');
}

test.beforeEach(async ({ page }) => lightweight3D(page));

test('build a ring table from a square with a square cut out, then reopen and change it', async ({ page }) => {
  const errors = await openApp(page);
  await toolsTab(page, 'Furnish');
  await tools(page).getByRole('button', { name: 'Shape Builder' }).click();
  const dialog = builder(page);
  await expect(dialog).toBeVisible();

  // It starts with a rectangle, chosen. Make it exactly 160 × 160.
  await expect(dialog.locator('.builder-tree').getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'true');
  await setField(selectedPanel(dialog), 'Width', 160);
  await setField(selectedPanel(dialog), 'Depth', 160);

  // Add a square in the middle, 60 cm.
  await dialog.getByRole('button', { name: 'Square' }).click();
  await setField(selectedPanel(dialog), 'Width', 60);
  await setField(selectedPanel(dialog), 'Across (x)', 0);
  await setField(selectedPanel(dialog), 'Front–back (y)', 0);
  await setField(selectedPanel(dialog), 'Across (x)', await centreOf(dialog, 'Rectangle', 'Across (x)'));
  await setField(selectedPanel(dialog), 'Front–back (y)', await centreOf(dialog, 'Rectangle', 'Front–back (y)'));

  // Choose both (tick boxes work on touch screens too) and cut the square out.
  await dialog.getByRole('checkbox', { name: 'Also choose Rectangle' }).check();
  await dialog.getByRole('button', { name: 'Cut out' }).click();
  await expect(dialog.locator('.builder-summary')).toContainText('1.6 m × 1.6 m');
  await expect(dialog.locator('.builder-summary')).toContainText('1 hole');
  await expect(dialog.locator('.builder-summary')).toContainText('2.20 m²');

  // Separate and undo work.
  await dialog.getByRole('button', { name: 'Separate' }).click();
  await expect(dialog.locator('.builder-summary')).not.toContainText('hole');
  await dialog.getByRole('button', { name: 'Undo' }).click();
  await expect(dialog.locator('.builder-summary')).toContainText('1 hole');

  await dialog.getByRole('button', { name: 'Use this shape' }).click();
  const studio = page.getByRole('dialog', { name: 'Build furniture from shapes' });
  await expect(studio).toBeVisible();
  await studio.getByLabel('Name').fill('Ring table');
  await studio.getByRole('button', { name: 'Add to room' }).click();
  await expect(studio).toBeHidden();

  const saved = (await exportProject(page)).furniture.find((f: { name: string }) => f.name === 'Ring table');
  expect(saved.width).toBe(160);
  expect(saved.shape.holes).toHaveLength(1);
  expect(saved.shape.source[0].type).toBe('subtract');

  // After reloading, the recipe reopens in the builder and can be changed.
  await saveAndReload(page);
  await selectInList(page, 'Ring table');
  await props(page).getByRole('button', { name: 'Shape Builder' }).click();
  await expect(builder(page)).toBeVisible();
  await expect(builder(page).locator('.builder-tree').getByRole('button', { name: 'Cut out (2)' })).toBeVisible();
  await builder(page).locator('.builder-tree').getByRole('button', { name: 'Square' }).click();
  await setField(selectedPanel(builder(page)), 'Width', 80);
  await expect(builder(page).locator('.builder-summary')).toContainText('1.92 m²');
  await builder(page).getByRole('button', { name: 'Use this shape' }).click();
  await page.getByRole('dialog', { name: /Edit Ring table/ }).getByRole('button', { name: 'Save changes' }).click();
  const changed = (await exportProject(page)).furniture.find((f: { name: string }) => f.name === 'Ring table');
  expect(changed.shape.holes).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('group separate parts, merge overlapping ones, and drag and turn with the keyboard', async ({ page }) => {
  const errors = await openApp(page);
  await toolsTab(page, 'Furnish');
  await tools(page).getByRole('button', { name: 'Shape Builder' }).click();
  const dialog = builder(page);
  await dialog.getByRole('button', { name: 'Circle' }).click();
  await setField(selectedPanel(dialog), 'Across (x)', 200);

  // Two parts that don't touch: two separate parts in the result.
  await expect(dialog.locator('.builder-summary')).toContainText('2 separate parts');

  // Keyboard: nudge the circle 10 cm left with Shift+arrow, turn the rectangle 15°.
  const canvas = dialog.locator('.shape-canvas-svg');
  const before = Number(await selectedPanel(dialog).getByLabel('Across (x)', { exact: true }).inputValue());
  await canvas.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(selectedPanel(dialog).getByLabel('Across (x)', { exact: true })).toHaveValue(String(before - 10));
  await dialog.locator('.builder-tree').getByRole('button', { name: 'Rectangle' }).click();
  await canvas.focus();
  await page.keyboard.press(']');
  await expect(selectedPanel(dialog).getByLabel('Angle', { exact: true })).toHaveValue('15');

  // Drag the circle onto the rectangle with the mouse, then merge them into one outline.
  const circle = dialog.locator('.builder-part').nth(1);
  const target = dialog.locator('.builder-part').nth(0);
  const from = (await circle.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width * 0.8, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(dialog.locator('.builder-summary')).not.toContainText('separate parts');
  await dialog.getByRole('checkbox', { name: 'Also choose Rectangle' }).check();
  await dialog.getByRole('button', { name: 'Merge' }).click();
  await expect(dialog.locator('.builder-tree').getByRole('button', { name: 'Merged (2)' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Use this shape' }).click();
  await expect(page.getByRole('dialog', { name: 'Build furniture from shapes' })).toBeVisible();
  expect(errors).toEqual([]);
});

/** Reads a field of another part (by choosing it in the list), then re-chooses the square. */
async function centreOf(dialog: Locator, part: string, label: string): Promise<number> {
  const tree = dialog.locator('.builder-tree');
  await tree.getByRole('button', { name: part, exact: true }).click();
  const value = Number(await selectedPanel(dialog).getByLabel(label, { exact: true }).inputValue());
  await tree.getByRole('button', { name: 'Square', exact: true }).click();
  return value;
}
