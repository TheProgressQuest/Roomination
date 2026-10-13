import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { pointInPolygon } from '../src/model/polygon';
import { ROOMS_3D } from '../src/scene3d/testRooms';
import type { Project } from '../src/model/types';
import type {} from '../src/scene3d/diagnostics';
import { serializeProject } from '../src/storage/projectFile';
import { exportProject, importProject, openApp, props, selectInList, tools } from './helpers';

/**
 * The 3D view. Headless Chromium renders WebGL in software (SwiftShader), so these tests
 * check correctness and behaviour; frame rates here say nothing about real devices.
 */

const view = (page: Page, name: '2D Plan' | '3D View') => page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name });
const panel3d = (page: Page) => page.getByRole('region', { name: '3D view' });

type ScreenPoint = { x: number; y: number };

async function open3D(page: Page) {
  await view(page, '3D View').click();
  await expect(panel3d(page).locator('canvas')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => stats(page).then((s) => s?.framesRendered ?? 0), { timeout: 20_000 }).toBeGreaterThan(0);
}

const stats = (page: Page) => page.evaluate(() => window.__roomination3D?.stats() ?? null);
const project = (page: Page, p: ScreenPoint, height = 0) => page.evaluate(([point, h]) => window.__roomination3D!.projectPoint(point, h), [p, height] as const);
const onScreen = (page: Page, id: string) => page.evaluate((i) => window.__roomination3D!.pointOnScreen(i), id);

async function load(page: Page, info: { outputPath: (name: string) => string }, room: Project, name: string) {
  const file = info.outputPath(`${name}.json`);
  writeFileSync(file, serializeProject(room));
  await importProject(page, file);
}

/** Waits for a camera transition to finish and its last frame to be drawn. */
async function settled(page: Page) {
  await expect.poll(async () => (await stats(page))?.animating, { timeout: 10_000 }).toBe(false);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test.describe('3D view', () => {
  test('loads Three.js only when the 3D view is first opened', async ({ page }) => {
    await openApp(page);
    const scripts = () => page.evaluate(() => performance.getEntriesByType('resource').filter((r) => /\.(js|ts)(\?|$)/.test(r.name)).length);
    const before = await scripts();
    expect(await page.evaluate(() => 'THREE' in window || window.__roomination3D !== undefined)).toBe(false);
    await open3D(page);
    expect(await scripts()).toBeGreaterThan(before);
  });

  test('switches instantly and keeps the selection, the project and undo history', async ({ page }) => {
    const errors = await openApp(page);
    await selectInList(page, 'Sofa');
    await props(page).getByRole('button', { name: /Rotate/ }).first().click();
    const before = await exportProject(page);
    await open3D(page);
    await expect(panel3d(page).locator('.view3d-selected')).toContainText('Sofa');
    await expect(props(page)).toContainText('Sofa');
    await view(page, '2D Plan').click();
    await expect(page.locator('.floor-plan canvas').first()).toBeVisible();
    expect(await page.evaluate(() => window.__roomination3D)).toBeUndefined();
    expect(await exportProject(page)).toEqual(before);
    // Undo still undoes the rotation made before switching views.
    await page.getByRole('button', { name: 'Undo' }).click();
    expect((await exportProject(page)).furniture.find((f: { name: string }) => f.name === 'Sofa').rotation).not.toBe(before.furniture.find((f: { name: string }) => f.name === 'Sofa').rotation);
    expect(errors).toEqual([]);
  });

  test('clicking furniture in 3D selects the same piece in 2D, and clicking empty space clears it', async ({ page }) => {
    await openApp(page);
    const saved = await exportProject(page);
    const tv = saved.furniture.find((f: { name: string }) => f.name === 'TV console');
    await open3D(page);
    await page.getByRole('radio', { name: 'Top-down' }).click();
    await settled(page);
    const canvas = (await panel3d(page).locator('canvas').boundingBox())!;
    const point = (await onScreen(page, tv.id))!;
    await page.mouse.click(canvas.x + point.x, canvas.y + point.y);
    await expect(props(page)).toContainText('TV console');
    await expect(panel3d(page).locator('.view3d-selected')).toContainText('1.6 m × 40 cm × 55 cm high');
    await page.mouse.click(canvas.x + 8, canvas.y + 8);
    await expect(panel3d(page).locator('.view3d-selected')).toHaveCount(0);
    // And selecting in the list highlights in 3D.
    await selectInList(page, 'Armchair');
    await expect(panel3d(page).locator('.view3d-selected')).toContainText('Armchair');
  });

  test('updates live when the plan changes, with no separate 3D state', async ({ page }) => {
    await openApp(page);
    const saved = await exportProject(page);
    const sofa = saved.furniture.find((f: { name: string }) => f.name === 'Sofa');
    await open3D(page);
    await page.getByRole('radio', { name: 'Top-down' }).click();
    await settled(page);
    await selectInList(page, 'Sofa');
    const before = (await onScreen(page, sofa.id))!;
    // Nudge 10 cm left with the keyboard (an edit made through the normal 2D editor).
    await page.locator('body').press('Shift+ArrowLeft');
    await expect.poll(async () => (await onScreen(page, sofa.id))!.x).toBeLessThan(before.x - 3);
    // Ceiling height changes the walls, never the plan's dimensions.
    const outline = (await exportProject(page)).room.outline;
    await tools(page).getByLabel('Ceiling').fill('300');
    await tools(page).getByLabel('Ceiling').press('Enter');
    const after = await exportProject(page);
    expect(after.room.height).toBe(300);
    expect(after.room.outline).toEqual(outline);
  });

  test('top-down view keeps the room’s true proportions', async ({ page }) => {
    await openApp(page);
    await open3D(page);
    await page.getByRole('radio', { name: 'Top-down' }).click();
    await settled(page);
    const a = await project(page, { x: 0, y: 0 });
    const b = await project(page, { x: 480, y: 0 });
    const c = await project(page, { x: 0, y: 380 });
    // Perspective is very slight from straight above; the plan's 480 × 380 ratio holds within 1%.
    const ratio = Math.hypot(b.x - a.x, b.y - a.y) / Math.hypot(c.x - a.x, c.y - a.y);
    expect(Math.abs(ratio - 480 / 380)).toBeLessThan(0.0127);
    // North stays up and nothing is mirrored: x grows to the right, y downwards.
    expect(b.x).toBeGreaterThan(a.x);
    expect(c.y).toBeGreaterThan(a.y);
  });

  test('dollhouse view hides the walls facing the camera; "Show all walls" brings them back', async ({ page }) => {
    await openApp(page);
    await open3D(page);
    const visible = () => page.evaluate(() => window.__roomination3D!.visibleWalls());
    await page.getByRole('radio', { name: 'Dollhouse view' }).click();
    await expect.poll(visible).toBeLessThan(4);
    await page.getByRole('radio', { name: 'Show all walls' }).click();
    await expect.poll(visible).toBe(4);
  });

  test('camera presets, zoom and fit all respond', async ({ page }) => {
    await openApp(page);
    await open3D(page);
    for (const name of ['Eye level', 'Top-down', 'Isometric']) {
      const frames = (await stats(page))!.framesRendered;
      await page.getByRole('radio', { name }).click();
      await expect.poll(async () => (await stats(page))!.framesRendered).toBeGreaterThan(frames);
      await settled(page);
    }
    // Zoom in twice, out once, then fit (which has to move back out).
    for (const name of ['Zoom in', 'Zoom in', 'Zoom out', 'Fit room in view']) {
      const frames = (await stats(page))!.framesRendered;
      await page.getByRole('button', { name }).click();
      await expect.poll(async () => (await stats(page))!.framesRendered).toBeGreaterThan(frames);
    }
  });

  test('the hint can be dismissed and stays dismissed', async ({ page }) => {
    await openApp(page);
    await open3D(page);
    await expect(page.locator('.view3d-hint')).toContainText('Drag to orbit');
    await page.getByRole('button', { name: 'Got it' }).click();
    await page.reload();
    await page.waitForSelector('.floor-plan canvas');
    await open3D(page);
    await expect(page.locator('.view3d-hint')).toHaveCount(0);
  });

  test('wall colour is saved with the project and can be undone', async ({ page }) => {
    await openApp(page);
    await tools(page).locator('summary', { hasText: 'Floor & walls' }).click();
    await tools(page).getByLabel('Wall colour (3D)').fill('#336699');
    expect((await exportProject(page)).room.wallColor).toBe('#336699');
    await page.getByRole('button', { name: 'Undo' }).click();
    expect((await exportProject(page)).room.wallColor).not.toBe('#336699');
  });

  test('leaving and re-entering 3D repeatedly releases everything cleanly', async ({ page }) => {
    const errors = await openApp(page);
    for (let i = 0; i < 4; i++) {
      await open3D(page);
      await view(page, '2D Plan').click();
      await expect(panel3d(page)).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });

  test('a right-click (pan) never changes the selection', async ({ page }) => {
    await openApp(page);
    const saved = await exportProject(page);
    const sofa = saved.furniture.find((f: { name: string }) => f.name === 'Sofa');
    await open3D(page);
    await page.getByRole('radio', { name: 'Top-down' }).click();
    await settled(page);
    const canvas = (await panel3d(page).locator('canvas').boundingBox())!;
    const point = (await onScreen(page, sofa.id))!;
    await page.mouse.click(canvas.x + point.x, canvas.y + point.y, { button: 'right' });
    await expect(panel3d(page).locator('.view3d-selected')).toHaveCount(0);
    await page.mouse.click(canvas.x + point.x, canvas.y + point.y);
    await expect(panel3d(page).locator('.view3d-selected')).toContainText('Sofa');
  });

  test('eye level stands inside the room, even in a U-shaped room', async ({ page }, info) => {
    await openApp(page);
    const room = ROOMS_3D.uShaped();
    await load(page, info, room, 'u-eye');
    await open3D(page);
    await page.getByRole('radio', { name: 'Eye level' }).click();
    await settled(page);
    const camera = await page.evaluate(() => window.__roomination3D!.cameraPosition());
    expect(pointInPolygon(camera, room.room.outline)).toBe(true);
    expect(camera.height).toBeCloseTo(160, 0);
  });

  test('if the 3D code can’t be downloaded, the rest of the app keeps working', async ({ page }) => {
    const errors = await openApp(page);
    await page.route(/View3D/, (route) => route.abort());
    await view(page, '3D View').click();
    await expect(panel3d(page).getByRole('alert')).toContainText('couldn’t be opened');
    await panel3d(page).getByRole('button', { name: 'Back to 2D plan' }).click();
    await expect(page.locator('.floor-plan canvas').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    // The failed download is reported in the console; nothing else went wrong.
    expect(errors.filter((e) => !/View3D|dynamically imported module|Failed to fetch|net::ERR/i.test(e))).toEqual([]);
  });

  test('explains when WebGL is unavailable and returns to 2D', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type.startsWith('webgl')) return null;
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await openApp(page);
    await view(page, '3D View').click();
    await expect(panel3d(page).getByRole('alert')).toContainText('needs WebGL');
    await panel3d(page).getByRole('button', { name: 'Back to 2D plan' }).click();
    await expect(page.locator('.floor-plan canvas').first()).toBeVisible();
  });
});

test.describe('3D rooms', () => {
  for (const [name, make] of Object.entries(ROOMS_3D)) {
    test(`renders ${name}`, async ({ page }, info) => {
      const errors = await openApp(page);
      const room = make();
      await load(page, info, room, name);
      await open3D(page);
      await settled(page);
      const s = (await stats(page))!;
      expect(s.drawCalls).toBeGreaterThan(2);
      expect(s.triangles).toBeGreaterThan(100);
      // Every piece of furniture is on screen in the default view.
      const canvas = (await panel3d(page).locator('canvas').boundingBox())!;
      for (const item of room.furniture) {
        const p = (await onScreen(page, item.id))!;
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(canvas.width);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(canvas.height);
      }
      await info.attach(`${name}.png`, { body: await panel3d(page).screenshot(), contentType: 'image/png' });
      expect(errors).toEqual([]);
    });
  }

  test('renders an optimized layout exactly where the optimizer put it', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Optimize layout' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Optimize layout' });
    await dialog.getByRole('button', { name: 'Find layouts' }).click();
    await expect(dialog.getByRole('button', { name: 'Find layouts again' })).toBeVisible({ timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Apply layout' }).first().click();
    const applied = await exportProject(page);
    await open3D(page);
    await page.getByRole('radio', { name: 'Top-down' }).click();
    await settled(page);
    for (const item of applied.furniture.filter((f: { category: string }) => f.category !== 'floorCovering')) {
      const piece = (await onScreen(page, item.id))!;
      const expected = await project(page, { x: item.x, y: item.y }, item.height / 2);
      expect(Math.hypot(piece.x - expected.x, piece.y - expected.y)).toBeLessThan(0.5);
    }
  });
});

for (const width of [320, 375, 430, 768, 1024, 1440]) {
  const touch = width < 1100;
  test.describe(`3D at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 500 ? 780 : 900 }, hasTouch: touch, isMobile: touch && width < 500 });

    test('fits the screen, keeps controls reachable, and owns touches inside the canvas only', async ({ page }) => {
      const errors = await openApp(page);
      await open3D(page);
      const overflow = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const offenders = [...document.querySelectorAll('body *')].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > vw + 1 && !el.closest('dialog');
        });
        return { scroll: document.documentElement.scrollWidth > vw, offenders: offenders.slice(0, 3).map((el) => el.className || el.tagName) };
      });
      expect(overflow).toEqual({ scroll: false, offenders: [] });
      const canvas = (await panel3d(page).locator('canvas').boundingBox())!;
      expect(canvas.height).toBeGreaterThan(220);
      await expect(panel3d(page).locator('canvas')).toHaveCSS('touch-action', 'none');
      // Every control is fully on screen and, on touch screens, at least 44 px tall.
      for (const control of await page.locator('.view3d-toolbar button, .view3d-toolbar .chip-toggle span, .view3d-camera-buttons button, .view-switch button').all()) {
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        if (touch) expect(box.height).toBeGreaterThanOrEqual(44);
      }
      // The drawing buffer is capped (pixel ratio ≤ 2).
      expect((await stats(page))!.pixelRatio).toBeLessThanOrEqual(2);
      expect(errors).toEqual([]);
    });

    if (!touch) return;

    test('tapping furniture selects it and Edit opens the properties modal; the page still scrolls outside the canvas', async ({ page }) => {
      await openApp(page);
      const saved = await exportProject(page);
      const sofa = saved.furniture.find((f: { name: string }) => f.name === 'Sofa');
      await open3D(page);
      await page.getByRole('button', { name: 'Got it' }).click();
      await page.getByRole('radio', { name: 'Top-down' }).click();
      await settled(page);
      const canvas = (await panel3d(page).locator('canvas').boundingBox())!;
      const point = (await onScreen(page, sofa.id))!;
      await page.touchscreen.tap(canvas.x + point.x, canvas.y + point.y);
      await expect(page.locator('.selection-name')).toHaveText('Sofa');
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Edit Sofa' })).toBeVisible();
      await page.keyboard.press('Escape');
      if (width < 768) {
        // Phones stack the tools below the view: scrolling over them still scrolls the page.
        await page.locator('.tools-panel').first().hover();
        await page.mouse.wheel(0, 400);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      }
    });
  });
}
