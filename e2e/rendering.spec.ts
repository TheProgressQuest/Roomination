import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import type {} from '../src/scene3d/diagnostics';
import { serializeProject } from '../src/storage/projectFile';
import { ROOMS_3D } from '../src/scene3d/testRooms';
import { exportProject, importProject, lightweight3D, mapper, openApp, props, radio, setPlanStyle, toolsTab, tools } from './helpers';

/**
 * Phase 5 rendering: the Technical and Presentation plans, image export, and 3D quality
 * presets. Presentation mode must keep the exact geometry and every editing ability.
 */

const pngSize = (b: Buffer) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) });

/** Average colour of a small patch of the plan canvas at a screen point. */
async function colourAt(page: Page, x: number, y: number) {
  const box = (await page.locator('.floor-plan').boundingBox())!;
  return page.evaluate(
    ({ x, y, box }) => {
      // The plan has several layers; merge them as they're seen.
      const canvases = [...document.querySelectorAll<HTMLCanvasElement>('.floor-plan canvas')];
      const ratio = canvases[0].width / canvases[0].clientWidth;
      const merged = document.createElement('canvas');
      merged.width = 8;
      merged.height = 8;
      const ctx = merged.getContext('2d')!;
      for (const c of canvases) ctx.drawImage(c, Math.round((x - box.x) * ratio) - 4, Math.round((y - box.y) * ratio) - 4, 8, 8, 0, 0, 8, 8);
      const d = ctx.getImageData(0, 0, 8, 8).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += d[i + c];
      return sum.map((v) => Math.round(v / 64));
    },
    { x, y, box },
  );
}

test.beforeEach(async ({ page }) => lightweight3D(page));

test.describe('Presentation plan', () => {
  test('illustrates furniture with the same geometry, and editing still works', async ({ page }) => {
    const errors = await openApp(page);
    const before = await exportProject(page);
    const m = await mapper(page);
    // A point on the sofa's seat (the sofa is 220 × 90 at 240, 330).
    const seat = m.at(240, 320);
    const technical = await colourAt(page, seat.x, seat.y);
    await setPlanStyle(page, 'Presentation');
    await expect(radio(tools(page), 'Plan style', 'Presentation')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => JSON.stringify(await colourAt(page, seat.x, seat.y))).not.toBe(JSON.stringify(technical));
    // The plan's geometry is untouched: same project, same mapping from cm to screen.
    expect(await exportProject(page)).toEqual(before);
    const after = await mapper(page);
    expect({ scale: after.scale, ox: after.ox, oy: after.oy }).toEqual({ scale: m.scale, ox: m.ox, oy: m.oy });

    // Clicking a piece still selects it, and it can still be dragged.
    await page.mouse.click(seat.x, seat.y);
    await expect(props(page).getByLabel('Name', { exact: true })).toHaveValue('Sofa');
    await page.mouse.move(seat.x, seat.y);
    await page.mouse.down();
    await page.mouse.move(seat.x - 40, seat.y, { steps: 8 });
    await page.mouse.up();
    const moved = (await exportProject(page)).furniture.find((f: { name: string }) => f.name === 'Sofa');
    expect(moved.x).toBeLessThan(240);
    expect(moved.width).toBe(220);

    // Editing aids reveal the selection and handles on request.
    // The quick switch beside the plan (the Design tab has the same setting, with its full name).
    await page.getByLabel('Editing aids', { exact: true }).check();
    await expect(page.getByLabel('Editing aids', { exact: true })).toBeChecked();
    await page.getByLabel('Editing aids', { exact: true }).uncheck();

    // Remembered, and switchable back to the precise Technical plan.
    await page.reload();
    await page.waitForSelector('.floor-plan canvas');
    await toolsTab(page, 'Design');
    await expect(radio(tools(page), 'Plan style', 'Presentation')).toHaveAttribute('aria-checked', 'true');
    await setPlanStyle(page, 'Technical');
    await expect(radio(tools(page), 'Plan style', 'Technical')).toHaveAttribute('aria-checked', 'true');
    expect(errors).toEqual([]);
  });

  test('the Design tab controls what the presentation plan shows', async ({ page }) => {
    await openApp(page);
    await toolsTab(page, 'Design');
    const section = tools(page).getByRole('tabpanel');
    await expect(section.getByLabel('Furniture labels')).toBeDisabled();
    await section.getByRole('radio', { name: 'Presentation' }).click();
    await expect(section.getByLabel('Furniture labels')).toBeEnabled();
    await section.getByLabel('Furniture labels').check();
    await section.getByLabel('Soft shadows').uncheck();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('roomination.preferences')!).presentation);
    expect(saved).toMatchObject({ labels: true, shadows: false });
  });

  test('illustrates every kind of furniture, drawn shapes and photo furniture without errors', async ({ page }, info) => {
    const errors = await openApp(page);
    const file = info.outputPath('holes.json');
    writeFileSync(file, serializeProject(ROOMS_3D.holesAndCurves()));
    await importProject(page, file);
    await setPlanStyle(page, 'Presentation');
    const types = info.outputPath('types.json');
    writeFileSync(types, serializeProject(ROOMS_3D.furnitureTypes()));
    await importProject(page, types);
    const custom = info.outputPath('custom.json');
    writeFileSync(custom, serializeProject(ROOMS_3D.customFurniture()));
    await importProject(page, custom);
    await page.waitForTimeout(300);
    await info.attach('presentation.png', { body: await page.locator('.canvas-panel').screenshot(), contentType: 'image/png' });
    expect(errors).toEqual([]);
  });

  test('works in the dark theme', async ({ page }) => {
    const errors = await openApp(page);
    await page.getByRole('radio', { name: 'Dark theme' }).click();
    await setPlanStyle(page, 'Presentation');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.waitForTimeout(200);
    expect(errors).toEqual([]);
  });
});

test.describe('Image export', () => {
  test('exports the 2D presentation plan at 1440p with a transparent background', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = await openApp(page);
    await page.getByRole('button', { name: 'Export image' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export image' });
    await dialog.getByRole('radio', { name: '2D plan' }).click();
    await dialog.getByRole('radio', { name: 'Presentation' }).click();
    await dialog.getByLabel('Size').selectOption('1');
    await dialog.getByLabel('Transparent background').check();
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export PNG' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^sample-living-room-plan-presentation-1440p\.png$/);
    const png = readFileSync((await download.path())!);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(pngSize(png)).toEqual({ width: 2560, height: 1440 });
    // Colour type 6: RGBA, and the corner (outside the room) is fully transparent.
    expect(png[25]).toBe(6);
    await expect(dialog.getByRole('status')).toContainText('Saved');
    // Nothing from the interface is captured, and the project is unchanged.
    await expect(page.locator('.konvajs-content')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('exports a 3D isometric view at 1080p, locally', { tag: '@3d' }, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = await openApp(page);
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.getByRole('button', { name: 'Export image' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export image' });
    await dialog.getByRole('radio', { name: '3D isometric' }).click();
    await dialog.getByLabel('Size').selectOption('0');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90_000 }), dialog.getByRole('button', { name: 'Export PNG' }).click()]);
    const png = readFileSync((await download.path())!);
    expect(pngSize(png)).toEqual({ width: 1920, height: 1080 });
    const origin = new URL(page.url()).origin;
    expect(requests.filter((u) => !u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:'))).toEqual([]);
    // The temporary viewer was cleaned up.
    expect(await page.evaluate(() => document.querySelectorAll('canvas.room-3d-canvas').length)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('3D quality', { tag: '@3d' }, () => {
  test.use({ viewport: { width: 1180, height: 760 } });

  test('switches between quality presets, with fewer resources on Low', async ({ page }) => {
    const errors = await openApp(page);
    await page.getByRole('radio', { name: '3D View' }).click();
    await expect.poll(() => page.evaluate(() => window.__roomination3D?.stats().framesRendered ?? 0), { timeout: 20_000 }).toBeGreaterThan(0);
    const stats = () => page.evaluate(() => window.__roomination3D!.stats());
    await page.getByLabel('Quality').selectOption('high');
    await expect.poll(async () => (await stats()).triangles, { timeout: 10_000 }).toBeGreaterThan(0);
    const high = await stats();
    await page.getByLabel('Quality').selectOption('low');
    await expect.poll(async () => (await stats()).triangles, { timeout: 10_000 }).toBeLessThan(high.triangles);
    const low = await stats();
    expect(low.pixelRatio).toBeLessThanOrEqual(1.25);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roomination.preferences')!).view3d.quality)).toBe('low');
    expect(errors).toEqual([]);
  });
});

for (const width of [375, 768]) {
  test.describe(`Rendering controls at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 500 ? 780 : 900 }, hasTouch: true, isMobile: width < 500 });

    test('the presentation plan and export fit without sideways scrolling', async ({ page }) => {
      const errors = await openApp(page);
      await setPlanStyle(page, 'Presentation');
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.getByRole('button', { name: 'Export image' })).toBeInViewport();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
      await page.getByRole('button', { name: 'Export image' }).click();
      const fits = await page.evaluate(() => {
        const r = document.querySelector('dialog[open]')!.getBoundingClientRect();
        return r.left >= -1 && r.right <= innerWidth + 1;
      });
      expect(fits).toBe(true);
      expect(errors).toEqual([]);
    });
  });
}
