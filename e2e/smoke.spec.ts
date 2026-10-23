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

  test('the 3D view starts and draws', async ({ page }) => {
    const errors = await openApp(page);
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: '3D View' }).click();
    const panel = page.getByRole('region', { name: '3D view' });
    await expect(panel.locator('canvas, [role=alert]').first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => page.evaluate(() => window.__roomination3D?.stats()?.framesRendered ?? 0), { timeout: 20_000 }).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});
