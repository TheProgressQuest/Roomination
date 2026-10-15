import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import type {} from '../src/scene3d/diagnostics';
import { exportProject, importProject, lightweight3D, openApp, props, saveAndReload, selectInList, setNum, tools, toolsTab } from './helpers';
import { loveseatPhoto } from './png';

/**
 * Custom furniture end to end: draw → exact dimensions → corners and curves → library →
 * place → rotate → collisions → 3D → photos → export with photos → import → reload.
 */

const studio = (page: Page, name = 'Draw custom furniture') => page.getByRole('dialog', { name });

/** Clicks a point given in the studio drawing's own centimetres. */
async function clickAtCm(page: Page, dialog: Locator, x: number, y: number) {
  const svg = dialog.locator('.shape-canvas-svg');
  const point = await svg.evaluate((el, [cx, cy]) => {
    const p = new DOMPoint(cx, cy).matrixTransform((el as SVGSVGElement).getScreenCTM()!);
    return { x: p.x, y: p.y };
  }, [x, y] as const);
  await page.mouse.click(point.x, point.y);
}

/** Records every request, so tests can prove nothing leaves this site. */
function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

function expectOnlyThisSite(urls: string[], page: Page) {
  const origin = new URL(page.url()).origin;
  const external = urls.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
  expect(external).toEqual([]);
}

test.beforeEach(async ({ page }) => lightweight3D(page));

test.describe('Draw custom furniture', () => {
  test('draw an irregular loveseat with exact dimensions, curve an edge, save to the library and place it', async ({ page }) => {
    const errors = await openApp(page);
    const requests = recordRequests(page);
    await toolsTab(page, 'Furnish');
    await tools(page).getByRole('button', { name: 'Draw custom furniture' }).click();
    const dialog = studio(page);
    await expect(dialog).toBeVisible();

    // Start from the angled loveseat and make it exactly 200 × 95 cm.
    await dialog.getByLabel('Start from a shape').selectOption('angledLoveseat');
    await dialog.getByLabel('Name').fill('My loveseat');
    await dialog.getByLabel('Width', { exact: true }).fill('200');
    await dialog.getByLabel('Width', { exact: true }).press('Enter');
    await dialog.getByLabel('Depth', { exact: true }).fill('95');
    await dialog.getByLabel('Depth', { exact: true }).press('Enter');
    await expect(dialog.getByLabel('Width', { exact: true })).toHaveValue('200');
    await expect(dialog.getByLabel('Depth', { exact: true })).toHaveValue('95');

    // Corner 3 (front-right): move it precisely, then curve the back edge (edge 1).
    await dialog.locator('.corner-list').getByRole('button', { name: /Corner 1/ }).click();
    await dialog.getByRole('button', { name: 'Edit the edge after this corner' }).click();
    await dialog.getByRole('button', { name: 'Make curved' }).click();
    await expect(dialog.getByLabel('Length (along the curve)')).toBeVisible();
    await expect(dialog.locator('.curve-handle')).toHaveCount(2);

    // Undo and redo the curve.
    await dialog.getByRole('button', { name: 'Undo' }).click();
    await expect(dialog.locator('.curve-handle')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Redo' }).click();
    await expect(dialog.locator('.curve-handle')).toHaveCount(2);

    await dialog.getByLabel('Height').fill('82');
    await dialog.getByLabel('Height').press('Enter');
    await dialog.getByLabel('Material').selectOption('fabric');
    await dialog.getByLabel('Also save to my furniture library').check();
    await dialog.getByRole('button', { name: 'Add to room' }).click();
    await expect(dialog).toHaveCount(0);

    // It's in the room, selected, with its real outline; and in the library as a custom piece.
    await expect(props(page).getByLabel('Name')).toHaveValue('My loveseat');
    await expect(props(page).locator('.origin-badge')).toHaveText('Custom');
    const library = tools(page).locator('.library-list');
    await expect(library).toContainText('My loveseat');
    await expect(library.locator('.origin-badge')).toHaveText('Custom');
    const saved = (await exportProject(page)).furniture.find((f: { name: string }) => f.name === 'My loveseat');
    expect(saved.shape.points.length).toBe(4);
    expect(saved.shape.points.some((p: { c1?: unknown }) => p.c1)).toBe(true);
    expect(saved).toMatchObject({ height: 82, appearance: { material: 'fabric' } });
    expect(saved.width).toBeGreaterThanOrEqual(199.9);

    // Move it onto the sofa: the true outline is checked, and the overlap explained.
    await setNum(props(page), 'From left', 240);
    await setNum(props(page), 'From top', 330);
    await expect(page.locator('.conflict-banner')).toContainText(/My loveseat overlaps Sofa|Sofa overlaps My loveseat/);

    // Rotating keeps the shape rigid: still the same width and depth.
    await props(page).getByRole('button', { name: 'Rotate 90° clockwise' }).click();
    const turned = (await exportProject(page)).furniture.find((f: { name: string }) => f.name === 'My loveseat');
    expect(turned.rotation).toBe(90);
    expect(turned.shape).toEqual(saved.shape);

    // The library item places a new copy in any project.
    await library.getByRole('button', { name: 'Add My loveseat to the room' }).click();
    expect((await exportProject(page)).furniture.filter((f: { name: string }) => f.name === 'My loveseat')).toHaveLength(2);

    // Survives a reload.
    await saveAndReload(page);
    const reloaded = (await exportProject(page)).furniture.filter((f: { name: string }) => f.name === 'My loveseat');
    expect(reloaded[0].shape).toEqual(saved.shape);
    expectOnlyThisSite(requests, page);
    expect(errors).toEqual([]);
  });

  test('draws a new outline corner by corner, and refuses one that crosses itself', async ({ page }) => {
    await openApp(page);
    await toolsTab(page, 'Furnish');
    await tools(page).getByRole('button', { name: 'Draw custom furniture' }).click();
    const dialog = studio(page);
    for (const [x, y] of [
      [-60, -40],
      [60, -40],
      [-60, 40],
      [60, 40],
    ]) {
      await clickAtCm(page, dialog, x, y);
    }
    await dialog.getByRole('button', { name: 'Close shape' }).click();
    await expect(dialog.getByRole('status').first()).toContainText('crosses itself');
    await dialog.getByRole('button', { name: 'Add to room' }).click();
    await expect(dialog).toBeVisible();

    // Fix it numerically: corner 3 to the bottom-right, corner 4 to the bottom-left.
    await dialog.locator('.corner-list').getByRole('button', { name: /Corner 3/ }).click();
    await dialog.getByLabel('Across (x)').fill('60');
    await dialog.getByLabel('Across (x)').press('Enter');
    await dialog.locator('.corner-list').getByRole('button', { name: /Corner 4/ }).click();
    await dialog.getByLabel('Across (x)').fill('-60');
    await dialog.getByLabel('Across (x)').press('Enter');
    await expect(dialog.getByRole('status').first()).not.toContainText('crosses itself');
    await dialog.getByRole('button', { name: 'Add to room' }).click();
    await expect(dialog).toHaveCount(0);
    const piece = (await exportProject(page)).furniture.at(-1);
    // Corners placed by clicking land within one 1 cm snap step of their target.
    expect(Math.abs(piece.width - 120)).toBeLessThanOrEqual(1);
    expect(Math.abs(piece.depth - 80)).toBeLessThanOrEqual(1);
  });

  test('a refused change keeps the studio open with everything drawn; a look-only change keeps a standard piece standard', async ({ page }) => {
    await openApp(page);
    await selectInList(page, 'Sofa');
    await props(page).getByRole('button', { name: 'Edit shape & look' }).click();
    const dialog = studio(page, 'Edit Sofa');
    // Far too wide for the 4.8 m room: refused, and the studio stays open with the drawing.
    await dialog.getByLabel('Width', { exact: true }).fill('900');
    await dialog.getByLabel('Width', { exact: true }).press('Enter');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog.getByRole('status').first()).toContainText(/wouldn.t fit/);
    await expect(dialog.getByLabel('Width', { exact: true })).toHaveValue('900');
    // Undo the stretch and change only the material: the sofa stays a standard piece.
    await dialog.getByRole('button', { name: 'Undo' }).click();
    await dialog.getByLabel('Material').selectOption('leather');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(props(page).locator('.origin-badge')).toHaveText('Standard');
    const sofa = (await exportProject(page)).furniture.find((f: { name: string }) => f.name === 'Sofa');
    expect(sofa.shape).toBeUndefined();
    expect(sofa.appearance).toMatchObject({ material: 'leather' });
  });

  test('custom pieces appear in 3D with the same footprint and can be selected there', { tag: '@3d' }, async ({ page }) => {
    await openApp(page);
    await toolsTab(page, 'Furnish');
    await tools(page).getByRole('button', { name: 'Draw custom furniture' }).click();
    const dialog = studio(page);
    await dialog.getByLabel('Start from a shape').selectOption('lDesk');
    await dialog.getByLabel('Name').fill('Studio desk');
    await dialog.getByRole('button', { name: 'Add to room' }).click();
    const desk = (await exportProject(page)).furniture.find((f: { name: string }) => f.name === 'Studio desk');
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: '3D View' }).click();
    await expect.poll(() => page.evaluate(() => window.__roomination3D?.stats().framesRendered ?? 0)).toBeGreaterThan(0);
    await page.getByRole('radio', { name: 'Top-down' }).click();
    await expect.poll(() => page.evaluate(() => window.__roomination3D!.stats().animating)).toBe(false);
    // Deselect, then click the desk's arm (inside its true outline) in 3D.
    await page.locator('body').press('Escape');
    const canvas = (await page.getByRole('region', { name: '3D view' }).locator('canvas').boundingBox())!;
    const arm = await page.evaluate(([x, y, h]) => window.__roomination3D!.projectPoint({ x, y }, h), [desk.x + 50, desk.y + 40, desk.height] as const);
    await page.mouse.click(canvas.x + arm.x, canvas.y + arm.y);
    await expect(props(page).getByLabel('Name')).toHaveValue('Studio desk');
  });
});

test.describe('Create furniture from photos', () => {
  test('photo → background removed → traced at a real scale → placed with its photo → exported and imported with the photo', { tag: '@3d' }, async ({ page }, info) => {
    const errors = await openApp(page);
    const requests = recordRequests(page);
    const photo = info.outputPath('loveseat-top.png');
    writeFileSync(photo, loveseatPhoto());

    await toolsTab(page, 'Furnish');
    await tools(page).getByRole('button', { name: 'Create from photos' }).click();
    const workshop = page.getByRole('dialog', { name: 'Photos of your furniture' });
    await expect(workshop).toContainText('front, the side and above');
    await workshop.locator('#photo-top').setInputFiles(photo);
    await expect(workshop.getByRole('img', { name: 'From above photo' })).toBeVisible();

    // Edit: remove the plain floor by colour.
    await workshop.getByRole('button', { name: 'Edit' }).click();
    const editor = page.getByRole('dialog', { name: /Edit photo/ });
    await editor.getByRole('button', { name: 'Remove background by colour' }).click();
    await expect(editor.getByRole('button', { name: 'Done' })).toBeEnabled();
    await editor.getByRole('button', { name: 'Done' }).click();
    await workshop.getByRole('button', { name: 'Use this photo' }).click();

    // Back in the studio: the photo is listed, used for the top, and shown for tracing.
    const dialog = studio(page, 'Create furniture from photos');
    await expect(dialog.locator('.photo-row')).toHaveCount(1);
    await expect(dialog.getByRole('checkbox', { name: 'Top' })).toBeChecked();
    await expect(dialog.locator('.shape-canvas-svg image')).toHaveCount(1);

    // Scale: the photo's furniture is 300 px wide; say it's really 180 cm.
    await dialog.getByRole('button', { name: 'Set scale from a known length' }).click();
    // At the starting 0.2 cm per pixel, pixel (50, 100) is at (-30, -10) cm and (350, 100) at (30, -10).
    await clickAtCm(page, dialog, -30, -10);
    await clickAtCm(page, dialog, 30, -10);
    await dialog.getByLabel('Real distance').fill('180');
    await dialog.getByLabel('Real distance').press('Enter');
    await dialog.getByRole('button', { name: 'Set scale', exact: true }).click();
    await dialog.getByRole('button', { name: 'Trace outline automatically' }).click();
    await expect(dialog.getByRole('status').first()).toContainText('traced');
    // 300 × 200 px at 0.6 cm/px = 180 × 120 cm, with the L-shaped cut-out kept.
    expect(Number(await dialog.getByLabel('Width', { exact: true }).inputValue())).toBeCloseTo(180, -0.5);
    expect(Number(await dialog.getByLabel('Depth', { exact: true }).inputValue())).toBeCloseTo(120, -0.5);
    await expect(dialog.locator('.corner-list li')).toHaveCount(6);

    await dialog.getByLabel('Name').fill('Photo loveseat');
    await dialog.getByRole('button', { name: 'Add to room' }).click();
    await expect(props(page).locator('.origin-badge')).toHaveText('Photo-assisted');

    // The photo reaches 3D too (no errors while loading it as a texture).
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: '3D View' }).click();
    await expect.poll(() => page.evaluate(() => window.__roomination3D?.stats().framesRendered ?? 0)).toBeGreaterThan(0);
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: '2D Plan' }).click();

    // Export: a ZIP with the project and the photo.
    await page.getByRole('button', { name: /^Projects/ }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export file' }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.roomination\.zip$/);
    const zip = info.outputPath('export.roomination.zip');
    await download.saveAs(zip);
    expect(readFileSync(zip).subarray(0, 2).toString()).toBe('PK');
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

    // Import it back as a new project: the photo comes with it.
    await importProject(page, zip);
    const imported = (await exportProject(page)).furniture.find((f: { name: string }) => f.name === 'Photo loveseat');
    expect(imported.appearance.textures.top).toMatch(/^[0-9a-f]{64}$/);
    expect(imported.shape.points).toHaveLength(6);

    // And after a reload.
    await saveAndReload(page);
    await selectInList(page, 'Photo loveseat');
    await expect(props(page).locator('.origin-badge')).toHaveText('Photo-assisted');
    expectOnlyThisSite(requests, page);
    expect(errors).toEqual([]);
  });

  test('explains when browser storage is full instead of losing the photo silently', async ({ page }, info) => {
    await page.addInitScript(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
        if (this.name === 'assets') throw new DOMException('Quota exceeded', 'QuotaExceededError');
        return put.apply(this, args);
      };
    });
    await openApp(page);
    const photo = info.outputPath('photo.png');
    writeFileSync(photo, loveseatPhoto());
    await toolsTab(page, 'Furnish');
    await tools(page).getByRole('button', { name: 'Create from photos' }).click();
    const workshop = page.getByRole('dialog', { name: 'Photos of your furniture' });
    await workshop.locator('#photo-front').setInputFiles(photo);
    await workshop.getByRole('button', { name: 'Use this photo' }).click();
    await expect(workshop.getByRole('alert')).toContainText('enough browser storage');
    await expect(workshop.getByRole('img', { name: 'Front photo' })).toBeVisible();
  });

  test('refuses files that aren’t photos', async ({ page }, info) => {
    await openApp(page);
    const fake = info.outputPath('not-a-photo.png');
    writeFileSync(fake, '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    await toolsTab(page, 'Furnish');
    await tools(page).getByRole('button', { name: 'Create from photos' }).click();
    const workshop = page.getByRole('dialog', { name: 'Photos of your furniture' });
    await workshop.locator('#photo-front').setInputFiles(fake);
    await expect(workshop.getByRole('alert')).toContainText('isn’t a photo');
  });

  test('smart remove runs on this device, downloading only this site’s own model', { tag: '@3d' }, async ({ page }, info) => {
    test.slow();
    await openApp(page);
    const requests = recordRequests(page);
    const photo = info.outputPath('photo.png');
    writeFileSync(photo, loveseatPhoto());
    await toolsTab(page, 'Furnish');
    await tools(page).getByRole('button', { name: 'Create from photos' }).click();
    const workshop = page.getByRole('dialog', { name: 'Photos of your furniture' });
    await workshop.locator('#photo-front').setInputFiles(photo);
    await workshop.getByRole('button', { name: 'Edit' }).click();
    const editor = page.getByRole('dialog', { name: /Edit photo/ });
    await editor.getByRole('button', { name: 'Smart remove (on device)' }).click();
    await expect(editor.locator('.studio-status')).toContainText('Background removed on this device', { timeout: 90_000 });
    expect(requests.some((u) => u.endsWith('/models/u2netp.onnx'))).toBe(true);
    expect(requests.some((u) => /ort-wasm-simd-threaded.*\.wasm/.test(u))).toBe(true);
    expectOnlyThisSite(requests, page);
    // The furniture is kept, the floor removed: the corner of the photo is now transparent.
    const alpha = await editor.locator('.photo-canvas').evaluate((el) => {
      const ctx = (el as HTMLCanvasElement).getContext('2d')!;
      return { corner: ctx.getImageData(5, 5, 1, 1).data[3], middle: ctx.getImageData(120, 100, 1, 1).data[3] };
    });
    expect(alpha.corner).toBeLessThan(128);
    expect(alpha.middle).toBeGreaterThan(128);
  });
});

test.describe('Studio on phones', () => {
  test.use({ viewport: { width: 375, height: 780 }, hasTouch: true, isMobile: true });

  test('fits the screen, draws with taps, and keeps Save and Cancel reachable', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('dialog', { name: 'Add to the room' }).getByRole('button', { name: 'Draw custom furniture' }).click();
    const dialog = studio(page);
    await expect(dialog).toBeVisible();
    const overflow = await page.evaluate(() => document.querySelector('dialog[open]')!.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    const svg = (await dialog.locator('.shape-canvas-svg').boundingBox())!;
    for (const [fx, fy] of [
      [0.3, 0.3],
      [0.7, 0.3],
      [0.7, 0.7],
      [0.3, 0.7],
    ]) {
      await page.touchscreen.tap(svg.x + svg.width * fx, svg.y + svg.height * fy);
    }
    await dialog.getByRole('button', { name: 'Close shape' }).click();
    for (const name of ['Cancel', 'Add to room']) {
      const box = (await dialog.getByRole('button', { name }).boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(780);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await dialog.getByRole('button', { name: 'Add to room' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.selection-name')).toHaveText('Custom piece');
  });
});

for (const width of [320, 375, 430, 768, 1024, 1440]) {
  const touch = width < 1100;
  test.describe(`Furniture studio at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 500 ? 780 : 900 }, hasTouch: touch, isMobile: touch && width < 500 });

    test('studio and photo editor fit without sideways scrolling, with reachable controls', async ({ page }, info) => {
      const errors = await openApp(page);
      if (width < 1100) {
        await page.getByRole('button', { name: 'Add', exact: true }).click();
        await page.getByRole('dialog', { name: 'Add to the room' }).getByRole('button', { name: 'Draw custom furniture' }).click();
      } else {
        await toolsTab(page, 'Furnish');
    await tools(page).getByRole('button', { name: 'Draw custom furniture' }).click();
      }
      const dialog = studio(page);
      await dialog.getByLabel('Start from a shape').selectOption('curvedSofa');
      const fits = async () =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('dialog[open]')].every((d) => {
            const r = d.getBoundingClientRect();
            const body = d.querySelector<HTMLElement>('.dialog-body')!;
            return r.left >= -1 && r.right <= window.innerWidth + 1 && body.scrollWidth <= body.clientWidth + 1;
          }),
        );
      expect(await fits()).toBe(true);
      expect((await dialog.locator('.shape-canvas-svg').boundingBox())!.height).toBeGreaterThan(200);
      for (const name of ['Cancel', 'Add to room']) await expect(dialog.getByRole('button', { name })).toBeInViewport();

      // The photo editor too.
      const photo = info.outputPath('p.png');
      writeFileSync(photo, loveseatPhoto());
      await dialog.getByRole('button', { name: 'Add photos' }).click();
      const workshop = page.getByRole('dialog', { name: 'Photos of your furniture' });
      await workshop.locator('#photo-side').setInputFiles(photo);
      await workshop.getByRole('button', { name: 'Edit' }).click();
      const editor = page.getByRole('dialog', { name: /Edit photo/ });
      await expect(editor.getByRole('img', { name: /photo being edited/ })).toBeVisible();
      expect(await fits()).toBe(true);
      await expect(editor.getByRole('button', { name: 'Done' })).toBeInViewport();
      expect(errors).toEqual([]);
    });
  });
}
