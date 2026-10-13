import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import {
  banner,
  checksText,
  drag,
  exportProject,
  mapper,
  num,
  objectRows,
  openApp,
  props,
  radio,
  saveAndReload,
  selectInList,
  setNum,
  toast,
  tools,
} from './helpers';

test.describe('Phase 1 & 2 features still work', () => {
  test('the sample room loads without overlaps or errors', async ({ page }) => {
    const errors = await openApp(page);
    await expect(objectRows(page)).toHaveCount(15); // 7 items + 8 features
    expect(await checksText(page)).toMatch(/No overlaps/);
    expect(errors).toEqual([]);
  });

  test('furniture is kept inside the walls, rotates, nudges, deletes and undoes', async ({ page }) => {
    await openApp(page);
    const m = await mapper(page);
    const p = props(page);
    await drag(page, m.at(240, 220), { x: m.at(240, 220).x + 2000, y: m.at(240, 220).y });
    expect(await num(p, 'From left')).toBe(425); // 480 − 110/2
    await page.locator('.object-list button.is-selected').focus();
    await page.keyboard.press('ArrowUp');
    expect(await num(p, 'From top')).toBe(219);
    await selectInList(page, 'TV console');
    await page.keyboard.press('r');
    expect(await num(p, 'Angle')).toBe(90);
    expect(await num(p, 'From top')).toBe(80); // pushed inside after rotating at the wall
    const count = await objectRows(page).count();
    await page.keyboard.press('Delete');
    await expect(objectRows(page)).toHaveCount(count - 1);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(objectRows(page)).toHaveCount(count);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(objectRows(page)).toHaveCount(count - 1);
  });

  test('overlaps prompt once; move back, allow, and per-pair overrides survive reload', async ({ page }) => {
    await openApp(page);
    const m = await mapper(page);
    await drag(page, m.at(70, 200), m.at(200, 220));
    await expect(banner(page)).toContainText('Armchair overlaps Coffee table.');
    await banner(page).getByRole('button', { name: 'Move it back' }).click();
    expect(await num(props(page), 'From left')).toBe(70);
    await drag(page, m.at(70, 200), m.at(200, 220));
    await banner(page).getByRole('button', { name: 'Allow overlap' }).click();
    expect(await checksText(page)).toMatch(/Allowed by you \(1\)/);
    await saveAndReload(page);
    expect(await checksText(page)).toMatch(/Allowed by you \(1\)/);
    // A different pair still warns.
    const m2 = await mapper(page);
    await drag(page, m2.at(445, 330), m2.at(330, 330));
    await expect(banner(page)).toContainText('Plant overlaps Sofa.');
  });

  test('a partly covered vent reports coverage and accepts an override', async ({ page }) => {
    await openApp(page);
    await selectInList(page, 'Plant');
    await setNum(props(page), 'From left', 411.5);
    await setNum(props(page), 'From top', 240);
    await expect(banner(page)).toContainText('Plant covers about 20% of Floor vent.');
    await props(page).getByRole('button', { name: 'Allow overlap for this item' }).click();
    await expect(props(page).locator('.conflict-list')).toContainText('Overlap allowed by you');
    await expect(props(page).locator('.conflict-list')).toContainText('doesn’t make it safe');
    await saveAndReload(page);
    expect(await checksText(page)).toMatch(/Allowed by you \(1\)/);
  });

  test('doors snap to walls, swing in or out, and refuse to overlap windows', async ({ page }) => {
    await openApp(page);
    await tools(page).getByRole('button', { name: 'Door', exact: true }).click();
    const p = props(page);
    await expect(p.getByLabel('Wall', { exact: true })).toHaveValue(/.+/);
    await expect(p.getByLabel('Wall', { exact: true }).locator('option:checked')).toContainText('Wall 3'); // the bottom wall
    await expect(banner(page)).toContainText('Sofa is in the swing path of Door');
    await setNum(p, 'Width', 100);
    expect(await num(p, 'Width')).toBe(100);
    await radio(p, 'Opens', 'Outwards').click();
    await expect(p.locator('.conflict-list')).toContainText('walkway');
    await radio(p, 'Opens', 'Into room').click();
    await radio(p, 'Hinge side (facing the door from inside)', 'Right').click();
    await expect(radio(p, 'Hinge side (facing the door from inside)', 'Right')).toHaveAttribute('aria-checked', 'true');
    // Move it onto the top wall, right over the existing window: refused.
    const topWall = await p.getByLabel('Wall', { exact: true }).locator('option', { hasText: 'Wall 1' }).getAttribute('value');
    await p.getByLabel('Wall', { exact: true }).selectOption(topWall!);
    await setNum(p, 'Centre from the wall’s start', 90);
    await expect(toast(page)).toContainText('overlap');
  });

  test('windows slide along a wall and hop to another wall when dragged', async ({ page }) => {
    await openApp(page);
    await tools(page).getByRole('button', { name: 'Window', exact: true }).click();
    const p = props(page);
    const start = await num(p, 'Centre from the wall’s start');
    const m = await mapper(page);
    const grab = { x: m.ox + start * m.scale, y: m.oy - 4 };
    await drag(page, grab, { x: grab.x + 80, y: grab.y + 6 });
    expect(Math.abs((await num(p, 'Centre from the wall’s start')) - (start + 80 / m.scale))).toBeLessThan(2);
    const moved = await num(p, 'Centre from the wall’s start');
    await drag(page, { x: m.ox + moved * m.scale, y: m.oy - 4 }, m.at(4, 150), 20);
    await expect(p.getByLabel('Wall', { exact: true }).locator('option:checked')).toContainText('Wall 4');
  });

  test('rugs sit under furniture without warnings', async ({ page }) => {
    await openApp(page);
    await tools(page).getByRole('button', { name: 'Rug', exact: true }).click();
    await expect(banner(page)).toHaveCount(0);
    expect(await checksText(page)).toMatch(/No overlaps/);
  });

  test('themes switch and persist without changing the project', async ({ page }) => {
    await openApp(page);
    const before = JSON.stringify(await exportProject(page));
    await page.getByRole('radio', { name: 'Dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(JSON.stringify(await exportProject(page))).toBe(before);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('radio', { name: 'Light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('tile grout stays aligned to room coordinates at different window sizes', async ({ page }) => {
    await openApp(page);
    await tools(page).locator('summary', { hasText: 'Floor' }).click();
    await radio(tools(page), 'Floor surface', 'Ceramic tile').click();
    await tools(page).locator('summary', { hasText: 'Board & display' }).click();
    await tools(page).getByLabel('Measurement grid on the floor').uncheck();
    const contrast = async () => {
      const m = await mapper(page);
      const box = (await page.locator('.floor-plan').boundingBox())!;
      return page.evaluate(({ m, box }) => {
        const canvas = document.querySelector('.floor-plan canvas') as HTMLCanvasElement;
        const ctx = canvas.getContext('2d')!;
        const ratio = canvas.width / canvas.clientWidth;
        const lum = (x: number, y: number) => {
          const [r, g, b] = ctx.getImageData(Math.round((x - box.x) * ratio), Math.round((y - box.y) * ratio), 1, 1).data;
          return 0.3 * r + 0.59 * g + 0.11 * b;
        };
        const darkest = (cx: number, cy: number) => Math.min(...[-2, -1, 0, 1, 2].map((d) => lum(m.ox + cx * m.scale + d, m.oy + cy * m.scale)));
        return { grout: Math.max(darkest(150, 165), darkest(330, 165)), tile: Math.min(darkest(165, 165), darkest(315, 165)) };
      }, { m: { ox: m.ox, oy: m.oy, scale: m.scale }, box });
    };
    const wide = await contrast();
    expect(wide.grout).toBeLessThan(wide.tile - 8);
    await page.setViewportSize({ width: 1180, height: 760 });
    await page.waitForTimeout(300);
    const narrow = await contrast();
    expect(narrow.grout).toBeLessThan(narrow.tile - 8);
  });

  test('projects: export, import, duplicate, rename, delete with confirmation, bad files', async ({ page }, info) => {
    await openApp(page);
    const dialog = page.getByRole('dialog');
    await page.getByRole('button', { name: /^Projects/ }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export file' }).click()]);
    expect(download.suggestedFilename()).toMatch(/roomination\.json$/);
    const file = info.outputPath('export.json');
    await download.saveAs(file);
    await dialog.getByRole('button', { name: 'Duplicate as a new layout' }).click();
    await expect(page.getByRole('button', { name: /^Projects/ })).toContainText('(copy)');
    await dialog.getByLabel('Name').fill('Studio Layout B');
    await dialog.getByLabel('Name').press('Enter');
    await expect(page.getByRole('button', { name: /^Projects/ })).toContainText('Studio Layout B');
    await dialog.locator('input[type=file]').setInputFiles(file);
    await expect(dialog.locator('.import-message')).toContainText('Imported “Sample living room (2)”');
    const bad = info.outputPath('bad.json');
    writeFileSync(bad, '{"schemaVersion": 3, "name": "x", "room": {"outline": []}}');
    await dialog.locator('input[type=file]').setInputFiles(bad);
    await expect(dialog.locator('.import-message.is-error')).toBeVisible();
    await dialog.locator('.project-list > li', { hasText: 'Studio Layout B' }).getByRole('button', { name: /Delete/ }).click();
    await expect(dialog.getByText('This can’t be undone')).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete forever' }).click();
    await expect(dialog.locator('.project-list > li')).toHaveCount(2);
  });

  test('Phase 1 and Phase 2 saves still open after the upgrade', async ({ page }) => {
    await openApp(page);
    await page.evaluate(async () => {
      localStorage.removeItem('roomination.activeProjectId');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('roomination');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise((resolve) => {
        const tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').clear();
        // Exactly what Phase 2 stored: a rectangle and a door on the named 'left' wall.
        tx.objectStore('projects').put({
          id: 'current',
          savedAt: Date.now(),
          project: {
            schemaVersion: 2,
            name: 'My Phase 2 room',
            units: 'metric',
            room: { width: 400, length: 350, height: 250 },
            furniture: [{ id: 'x', name: 'Desk', category: 'furniture', x: 100, y: 100, width: 120, depth: 60, height: 75, rotation: 0, color: '#c9a7d8', texture: 'plain' }],
            features: [{ id: 'd', kind: 'door', name: 'Door', placement: { type: 'wall', wall: 'left', offset: 250 }, width: 80, depth: 0, height: 205, elevation: 0, clearance: 50, doorType: 'hinged', swing: 'in', hinge: 'left' }],
            acceptedOverlaps: [],
          },
        });
        tx.oncomplete = resolve;
      });
      db.close();
    });
    await page.reload();
    await page.waitForSelector('.floor-plan canvas');
    await expect(page.getByRole('button', { name: /^Projects/ })).toContainText('My Phase 2 room');
    await selectInList(page, 'Door');
    await expect(props(page).getByLabel('Wall', { exact: true }).locator('option:checked')).toContainText('Wall 4'); // the left wall
    expect(await num(props(page), 'Centre from the wall’s start')).toBe(100); // 350 − 250
  });
});
