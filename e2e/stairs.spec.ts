import { expect, test, type Page } from '@playwright/test';
import { banner, exportProject, num, openApp, props, radio, saveAndReload, selectInList, setNum, structureRows, tools, toolsTab } from './helpers';

const badge = (page: Page) => props(page).locator('.kind-badge');
const sections = (page: Page) => props(page).locator('.section-list > li');

async function addStairs(page: Page, label: string) {
  await toolsTab(page, 'Build');
  const button = tools(page).getByRole('button', { name: label });
  if (!(await button.isVisible())) await tools(page).locator('summary', { hasText: 'Stairs' }).first().click();
  await button.click();
}

test.describe('Add Stairs', () => {
  test('adds straight, L-shaped, U-shaped and custom staircases', async ({ page }) => {
    const errors = await openApp(page);
    const expected: [string, string, number][] = [
      ['Straight stairs', 'Straight', 1],
      ['L-shaped stairs', 'L-shaped', 3],
      ['U-shaped stairs', 'U-shaped', 4],
      ['Custom stairs', 'Custom', 3],
    ];
    for (const [button, shape, count] of expected) {
      await addStairs(page, button);
      await expect(badge(page)).toContainText(`Staircase · ${shape}`);
      await expect(sections(page)).toHaveCount(count);
    }
    const project = await exportProject(page);
    expect(project.stairs).toHaveLength(4);
    expect(errors).toEqual([]);
  });

  test('edits direction, turning side, width, rise and individual sections', async ({ page }) => {
    await openApp(page);
    await addStairs(page, 'L-shaped stairs');
    const p = props(page);
    await radio(p, 'Direction', 'Goes down').click();
    await expect(radio(p, 'Direction', 'Goes down')).toHaveAttribute('aria-checked', 'true');
    await radio(p, 'Turns', 'Left').click();
    await expect(badge(page)).toContainText('L-shaped');
    await setNum(p, 'Width', 100);
    await setNum(p, 'Total rise', 280);
    await expect(p).toContainText('14 steps · about 20 cm per step');
    // Edit the first flight on its own.
    await setNum(sections(page).first(), 'Steps', 9);
    await expect(p).toContainText('16 steps');
    await p.getByRole('button', { name: 'Add flight' }).click();
    await expect(sections(page)).toHaveCount(4);
    await expect(badge(page)).toContainText('Custom');
    await p.getByRole('button', { name: 'Remove section 4' }).click();
    await expect(badge(page)).toContainText('L-shaped');
    const [stair] = (await exportProject(page)).stairs;
    expect(stair.direction).toBe('down');
    expect(stair.sections[1]).toMatchObject({ kind: 'landing', turn: 'left', width: 100 });
    expect(stair.sections[0].steps).toBe(9);
  });

  test('an impossible custom layout shows a warning instead of failing', async ({ page }) => {
    const errors = await openApp(page);
    await addStairs(page, 'L-shaped stairs');
    const p = props(page);
    for (const add of ['Add landing', 'Add flight', 'Add landing', 'Add flight']) await p.getByRole('button', { name: add }).click();
    await expect(sections(page)).toHaveCount(7);
    // Make the last flight long enough to run back over the first one.
    await setNum(sections(page).last(), 'Length', 250);
    await expect(p.locator('.problem-list')).toContainText('overlap, so this staircase couldn’t be built as drawn');
    expect(errors).toEqual([]);
  });

  test('rotates, moves, and is kept inside the room', async ({ page }) => {
    await openApp(page);
    await addStairs(page, 'Straight stairs');
    const p = props(page);
    await page.keyboard.press('r');
    expect(await num(p, 'Angle')).toBe(90);
    await setNum(p, 'From left', 9999);
    expect(await num(p, 'From left')).toBeLessThanOrEqual(480 - 45);
  });

  test('furniture on the stairs warns, can be allowed, and undo/reload work', async ({ page }) => {
    await openApp(page);
    await addStairs(page, 'Straight stairs');
    const [stair] = (await exportProject(page)).stairs;
    await selectInList(page, 'Plant');
    await setNum(props(page), 'From left', stair.x);
    await setNum(props(page), 'From top', stair.y);
    await expect(banner(page)).toContainText('Plant blocks Stairs');
    await banner(page).getByRole('button', { name: 'Allow overlap' }).click();
    await saveAndReload(page);
    await toolsTab(page, 'Build');
    await expect(structureRows(page).filter({ hasText: 'Stairs' })).toHaveCount(1);
    await selectInList(page, 'Stairs');
    await expect(props(page).locator('.conflict-list')).toContainText('Overlap allowed by you');
    await expect(props(page).locator('.conflict-list')).toContainText('doesn’t check building codes');
    await props(page).getByRole('button', { name: 'Delete Stairs' }).click();
    await expect(structureRows(page).filter({ hasText: 'Stairs' })).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(structureRows(page).filter({ hasText: 'Stairs' })).toHaveCount(1);
  });
});
