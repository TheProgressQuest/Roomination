import { expect, test, type Page } from '@playwright/test';
import { banner, exportProject, mapper, num, openApp, props, saveAndReload, selectInList, setNum, settle, toast, tools, wallRows, type RoomBox } from './helpers';

/** While drawing, the view adds a 20% margin around the room so you can draw beyond it. */
const DRAWING_VIEW: RoomBox = { minX: 0, minY: 0, maxX: 480, maxY: 380, wall: 96, wallLabels: true };
/** With a wall selected, corner handles and per-wall lengths show. */
const EDITING_VIEW: RoomBox = { minX: 0, minY: 0, maxX: 480, maxY: 380, wall: 12, wallLabels: true };

async function clickAt(page: Page, x: number, y: number, view = DRAWING_VIEW) {
  const m = await mapper(page, view);
  const p = m.at(x, y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(60);
}

const roomHint = (page: Page) => tools(page).locator('.collapsible').first().locator('.hint').first();
const drawingBar = (page: Page) => page.locator('.drawing-bar');

test.describe('Draw Walls', () => {
  test('draws an L-shaped room by clicking corners and closing on the first one', async ({ page }) => {
    const errors = await openApp(page);
    await tools(page).getByRole('button', { name: 'Draw room shape' }).click();
    await expect(drawingBar(page)).toBeVisible();
    await settle(page);
    for (const [x, y] of [[0, 0], [400, 0], [400, 200], [200, 200], [200, 300], [0, 300]]) await clickAt(page, x, y);
    await expect(drawingBar(page)).toContainText('6 corners placed');
    await clickAt(page, 0, 0); // tap the first corner to close the room
    await expect(drawingBar(page)).toHaveCount(0);
    await expect(roomHint(page)).toContainText('Custom shape · 6 walls · 10.0 m²');
    const project = await exportProject(page);
    expect(project.room.outline.map((n: { x: number; y: number }) => [n.x, n.y])).toEqual([[0, 0], [400, 0], [400, 200], [200, 200], [200, 300], [0, 300]]);
    // Every item now sits inside the L (the bookshelf was moved in from x = 455).
    for (const item of project.furniture) expect(item.x + Math.min(item.width, item.depth) / 2).toBeLessThanOrEqual(400 + 1e-6);
    // No feature was lost: they were re-attached to the nearest new walls.
    expect(project.features).toHaveLength(8);
    await saveAndReload(page);
    await expect(roomHint(page)).toContainText('6 walls');
    expect(errors).toEqual([]);
  });

  test('draws a room with typed lengths and angles only (no pointer needed)', async ({ page }) => {
    await openApp(page);
    await tools(page).getByRole('button', { name: 'Draw room shape' }).click();
    const bar = drawingBar(page);
    await bar.getByLabel('Start X').fill('0');
    await bar.getByLabel('Start Y').fill('0');
    await bar.getByRole('button', { name: 'Place start' }).click();
    for (const [length, angle] of [[400, 0], [300, 90], [400, 180]]) {
      await bar.getByLabel('Wall length').fill(String(length));
      await bar.getByLabel('Angle', { exact: true }).fill(String(angle));
      await bar.getByLabel('Angle', { exact: true }).press('Enter');
    }
    await expect(bar).toContainText('4 corners placed');
    await bar.getByRole('button', { name: 'Close room' }).click();
    await expect(roomHint(page)).toContainText('4 m × 3 m');
  });

  test('refuses walls that cross, explains why and keeps the drawing', async ({ page }) => {
    await openApp(page);
    await tools(page).getByRole('button', { name: 'Draw room shape' }).click();
    const bar = drawingBar(page);
    await bar.getByRole('button', { name: 'Place start' }).click();
    for (const [length, angle] of [[400, 0], [400, 135], [400, 0]]) {
      await bar.getByLabel('Wall length').fill(String(length));
      await bar.getByLabel('Angle', { exact: true }).fill(String(angle));
      await bar.getByRole('button', { name: 'Add wall' }).click();
    }
    await bar.getByRole('button', { name: 'Close room' }).click();
    await expect(toast(page)).toContainText('would cross each other');
    await expect(bar).toContainText('4 corners placed');
    await bar.getByRole('button', { name: 'Undo last point' }).click();
    await expect(bar).toContainText('3 corners placed');
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
  });

  test('edits a wall’s exact length and thickness; attached windows follow and short walls are refused', async ({ page }) => {
    await openApp(page);
    await wallRows(page).filter({ hasText: 'Wall 2' }).getByRole('button').click();
    const p = props(page);
    await expect(p.locator('.editor-title')).toHaveText('Wall 2');
    await setNum(p, 'Length', 300);
    expect(await num(p, 'Length')).toBe(300);
    await setNum(p, 'Thickness', 20);
    expect(await num(p, 'Thickness')).toBe(20);
    await setNum(p, 'Length', 60);
    await expect(toast(page)).toContainText('needs 100 cm of wall');
    expect(await num(p, 'Length')).toBe(300);
    // The side window is still on Wall 2, which is now 3 m long.
    await selectInList(page, 'Side window');
    await expect(p.getByLabel('Wall', { exact: true }).locator('option:checked')).toContainText('Wall 2 · 3 m');
    // Undo / redo step through the wall edits.
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(wallRows(page).filter({ hasText: 'Wall 2' })).toContainText('3.8 m');
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect(wallRows(page).filter({ hasText: 'Wall 2' })).toContainText('3 m');
  });

  test('dragging a corner reshapes the room; connected walls and attached features follow', async ({ page }) => {
    await openApp(page);
    await tools(page).getByRole('button', { name: 'Edit walls & corners' }).click();
    await settle(page);
    const m = await mapper(page, EDITING_VIEW);
    await page.mouse.move(m.at(480, 380).x, m.at(480, 380).y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(m.at(480, 380).x + i * 4, m.at(480, 380).y);
    await page.mouse.up();
    await page.waitForTimeout(100);
    const project = await exportProject(page);
    const corner = project.room.outline[2];
    expect(corner.x).toBeCloseTo(480 + 40 / m.scale, -1); // moved right, give or take grid snapping
    expect(corner.y).toBe(380);
    const sideWindow = project.features.find((f: { name: string }) => f.name === 'Side window');
    expect(sideWindow.placement.wallId).toBe(project.room.outline[1].id); // still on the (now slanted) right wall
    await expect(roomHint(page)).toContainText('Custom shape · 4 walls');
  });

  test('adds a corner, pulls it out into an alcove, then removes it; merges straight walls', async ({ page }) => {
    await openApp(page);
    await wallRows(page).filter({ hasText: 'Wall 1' }).getByRole('button').click();
    await props(page).getByRole('button', { name: 'Add corner in the middle' }).click();
    await expect(wallRows(page)).toHaveCount(5);
    await settle(page);
    // The new corner sits at (240, 0); drag it up to make an alcove.
    const m = await mapper(page, EDITING_VIEW);
    await page.mouse.move(m.at(240, 0).x, m.at(240, 0).y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(m.at(240, 0).x, m.at(240, 0).y - i * 3);
    await page.mouse.up();
    await page.waitForTimeout(100);
    await expect(props(page)).toContainText('Corner');
    expect(await num(props(page), 'Y')).toBeLessThan(-10);
    await props(page).getByRole('button', { name: 'Remove corner (joins the two walls)' }).click();
    await expect(wallRows(page)).toHaveCount(4);
    // Split then merge straight back.
    await wallRows(page).filter({ hasText: 'Wall 1' }).getByRole('button').click();
    await props(page).getByRole('button', { name: 'Add corner in the middle' }).click();
    await wallRows(page).filter({ hasText: 'Wall 1' }).getByRole('button').click();
    await props(page).getByRole('button', { name: 'Merge with next wall' }).click();
    await expect(wallRows(page)).toHaveCount(4);
  });

  test('keyboard: corners can be positioned by typing', async ({ page }) => {
    await openApp(page);
    await wallRows(page).filter({ hasText: 'Wall 3' }).getByRole('button').focus();
    await page.keyboard.press('Enter');
    await setNum(props(page), 'X', 500);
    await expect(wallRows(page).filter({ hasText: 'Wall 2' })).not.toContainText('3.8 m');
  });

  test('adds a freestanding interior wall, warns about furniture in it, and deletes it', async ({ page }) => {
    await openApp(page);
    await tools(page).getByRole('button', { name: 'Interior wall' }).click();
    await settle(page);
    await clickAt(page, 80, 60);
    await clickAt(page, 80, 250); // runs through the armchair (x 30–110)
    await drawingBar(page).getByRole('button', { name: 'Finish wall' }).click();
    await expect(wallRows(page).filter({ hasText: 'Interior wall 1' })).toHaveCount(1);
    await expect(banner(page)).toContainText('an interior wall');
    await props(page).getByRole('button', { name: 'Delete this interior wall' }).click();
    await expect(wallRows(page).filter({ hasText: 'Interior wall' })).toHaveCount(0);
  });

  test('tapping the same spot twice while drawing adds only one corner', async ({ page }) => {
    await openApp(page);
    await tools(page).getByRole('button', { name: 'Draw room shape' }).click();
    await settle(page);
    await clickAt(page, 100, 100);
    await clickAt(page, 300, 100);
    await clickAt(page, 300, 100);
    await expect(drawingBar(page)).toContainText('2 corners placed');
  });
});
