import { expect, test } from '@playwright/test';
import type {} from '../src/scene3d/diagnostics';
import { strToU8, zipSync } from 'fflate';
import { SAMPLE_STUDIO, sampleToRoomPlan } from '../src/scan/samples';
import { exportProject, lightweight3D, openApp, toolsTab, tools } from './helpers';

/**
 * Smoke tests: one short end-to-end pass through each main workflow, for the prototype loop
 * (`npm run test:smoke`, a minute or so). They don't replace the full suite, which still gates
 * every release. Add one here for each new workflow.
 */

test.describe('smoke', { tag: '@smoke' }, () => {
  test.beforeEach(async ({ page }) => lightweight3D(page));

  test('the app opens on the sample room without errors or outside requests', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const outside: string[] = [];
    page.on('request', (r) => {
      const url = r.url();
      if (!url.startsWith('data:') && !url.startsWith('blob:') && new URL(url).origin !== origin) outside.push(url);
    });
    const errors = await openApp(page);
    await expect(page.getByRole('button', { name: /^Projects/ })).toBeVisible();
    expect(outside).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a catalogue piece can be added and saved', async ({ page }) => {
    const errors = await openApp(page);
    await toolsTab(page, 'Furnish');
    const cat = tools(page).locator('.catalogue');
    await cat.getByLabel('Search the catalogue').fill('toilet');
    await cat.getByRole('button', { name: /^Add Toilet\b/ }).click();
    const project = await exportProject(page);
    expect((project.furniture as { name: string }[]).some((f) => f.name === 'Toilet')).toBe(true);
    expect(errors).toEqual([]);
  });

  test('a sample room scan imports into a new project with its measured size', async ({ page }) => {
    const errors = await openApp(page);
    await page.getByRole('button', { name: /^Projects/ }).click();
    await page.getByRole('button', { name: /^Import room scan…/ }).click();
    const dialog = page.getByRole('dialog', { name: /room scan|scanned room/i });
    await dialog.getByRole('button', { name: 'Bedroom' }).click();
    await dialog.getByRole('button', { name: 'Create new project' }).click();
    await expect(dialog).toBeHidden();
    const project = await exportProject(page);
    const xs = (project.room.outline as { x: number; y: number }[]).map((n) => n.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(420);
    expect(errors).toEqual([]);
  });

  test('a RoomSheet package (synthetic) imports through the file picker', async ({ page }) => {
    const errors = await openApp(page);
    const zip = zipSync({
      'Studio/captured-room.json': strToU8(JSON.stringify(sampleToRoomPlan(SAMPLE_STUDIO))),
      'Studio/metadata.json': strToU8('{}'),
      'Studio/room-mesh.usdz': new Uint8Array(100),
    });
    await page.getByRole('button', { name: /^Projects/ }).click();
    await page.getByRole('button', { name: /^Import room scan…/ }).click();
    const dialog = page.getByRole('dialog', { name: /room scan|scanned room/i });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), dialog.getByRole('button', { name: 'Choose scan file…' }).click()]);
    await chooser.setFiles({ name: 'Studio.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
    await expect(dialog.getByText(/RoomSheet package/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Create new project' }).click();
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('a wall mirror hangs on a wall at its height, and keeps it when edited', async ({ page }) => {
    const errors = await openApp(page);
    await toolsTab(page, 'Furnish');
    const cat = tools(page).locator('.catalogue');
    await cat.getByLabel('Search the catalogue').fill('mirror');
    await cat.getByRole('button', { name: /^Add Wall mirror\b/ }).click();
    const props = page.locator('.properties-panel');
    await props.getByLabel('From left', { exact: true }).fill('100');
    await props.getByLabel('From left', { exact: true }).press('Enter');
    await props.getByRole('button', { name: 'Mount on nearest wall' }).click();
    const project = await exportProject(page);
    const mirror = (project.furniture as { name: string; x: number; elevation?: number }[]).find((f) => f.name === 'Wall mirror')!;
    expect(mirror).toMatchObject({ x: 100, elevation: 110 });
    expect(errors).toEqual([]);
  });

  test('Match my room: a photo’s colour goes onto the walls, locally', async ({ page, baseURL }) => {
    const errors = await openApp(page);
    const origin = new URL(baseURL!).origin;
    const outside: string[] = [];
    page.on('request', (r) => {
      const url = r.url();
      if (!url.startsWith('data:') && !url.startsWith('blob:') && new URL(url).origin !== origin) outside.push(url);
    });
    // A synthetic photo: one flat colour.
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 200;
      c.height = 150;
      const g = c.getContext('2d')!;
      g.fillStyle = '#8ea393';
      g.fillRect(0, 0, 200, 150);
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: '3D View' }).click();
    await page.getByRole('button', { name: 'Match my room' }).click();
    const panel = page.getByRole('complementary', { name: 'Match my room' });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), panel.getByRole('button', { name: /Add a photo/ }).click()]);
    await chooser.setFiles({ name: 'room.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    const photo = panel.locator('canvas.match-photo');
    await photo.click({ position: { x: 40, y: 40 } });
    await panel.getByLabel('Apply to').selectOption('walls');
    await panel.getByRole('button', { name: 'Apply colour' }).click();
    const project = await exportProject(page);
    expect(project.room.wallColor).toBe('#8ea393');
    expect(project.referencePhotos).toHaveLength(1);

    // Line the camera up with the photo and save the view.
    await page.getByRole('button', { name: /^Projects/ }).isVisible();
    await panel.getByRole('radio', { name: 'Line up camera' }).click();
    await expect(page.locator('.view3d-overlay')).toBeVisible();
    await panel.getByLabel('Save this view as').fill('From the door');
    await panel.getByRole('button', { name: 'Save view' }).click();
    const withView = await exportProject(page);
    expect(withView.cameraViews).toHaveLength(1);
    expect(outside).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the 3D view starts and draws', async ({ page }) => {
    const errors = await openApp(page);
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: '3D View' }).click();
    const panel = page.getByRole('region', { name: '3D view' });
    await expect(panel.locator('canvas, [role=alert]').first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => page.evaluate(() => window.__roomination3D?.stats()?.framesRendered ?? 0), { timeout: 20_000 }).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});
