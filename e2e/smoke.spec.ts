import { expect, test } from '@playwright/test';
import type {} from '../src/scene3d/diagnostics';
import { strToU8, zipSync } from 'fflate';
import { SAMPLE_STUDIO, sampleToRoomPlan } from '../src/scan/samples';
import { syntheticGlb } from '../src/mesh/synthetic';
import { exportProject, fromPhotosOrScan, lightweight3D, openApp, props, toolsTab, tools } from './helpers';

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
    await cat.getByRole('button', { name: /^Add Toilet,/ }).click();
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

  test('Decorate: a bottle added with a vanity selected sits on its worktop and moves with it', async ({ page }) => {
    const errors = await openApp(page);
    await toolsTab(page, 'Furnish');
    const cat = tools(page).locator('.catalogue');
    await cat.getByLabel('Search the catalogue').fill('vanity');
    await cat.getByRole('button', { name: /^Add Vanity, drop-in basin\b/ }).click();
    await cat.getByLabel('Search the catalogue').fill('pump bottle');
    await cat.getByRole('button', { name: /^Add Pump bottle\b/ }).click();
    await expect(page.getByText(/Put “Pump bottle” on/)).toBeVisible();
    // The vanity is still selected: move it, and the bottle goes along.
    const props = page.locator('.properties-panel');
    await props.getByLabel('From left', { exact: true }).fill('150');
    await props.getByLabel('From left', { exact: true }).press('Enter');
    const project = await exportProject(page);
    type Piece = { id: string; name: string; x: number; elevation?: number; restsOn?: string };
    const pieces = project.furniture as Piece[];
    const vanity = pieces.find((f) => f.name.startsWith('Vanity'))!;
    const bottle = pieces.find((f) => f.name === 'Pump bottle')!;
    expect(bottle.restsOn).toBe(vanity.id);
    expect(bottle.elevation).toBe(81);
    expect(Math.abs(bottle.x - 150)).toBeLessThan(45);
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

  test('Reconstruct: an object rebuilt from a photo keeps its measured size and saves its outline', async ({ page }) => {
    const errors = await openApp(page);
    await toolsTab(page, 'Furnish');
    const cat = tools(page).locator('.catalogue');
    await cat.getByLabel('Search the catalogue').fill('lidded box');
    await cat.getByRole('button', { name: /^Add Lidded box\b/ }).click();
    // A synthetic photo: a brown object with a rounded top on a pale wall, where the default corners sit.
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 400;
      c.height = 300;
      const g = c.getContext('2d')!;
      g.fillStyle = '#e6e3dc';
      g.fillRect(0, 0, 400, 300);
      g.fillStyle = '#7a4a2a';
      g.beginPath();
      g.moveTo(90, 260);
      g.lineTo(90, 200);
      g.quadraticCurveTo(200, 140, 310, 200);
      g.lineTo(310, 260);
      g.closePath();
      g.fill();
      return c.toDataURL('image/png').split(',')[1];
    });
    // The new piece is selected: its Photos & scans → Rebuild shape from photos opens the tool for it.
    await props(page).getByRole('button', { name: /^Rebuild shape from photos/ }).click();
    const panel = page.getByRole('complementary', { name: 'Photos for Lidded box' });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), panel.getByRole('button', { name: /Add a photo/ }).click()]);
    await chooser.setFiles({ name: 'object.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await expect(panel.getByRole('radio', { name: 'Rebuild shape' })).toHaveAttribute('aria-checked', 'true');
    // Tap the wall in the preview's top-left corner to trim it.
    const preview = panel.locator('.rebuild-preview canvas');
    await preview.scrollIntoViewIfNeeded();
    const box = (await preview.boundingBox())!;
    // The lidded box's front is 25 × 10 cm: drawn 280 × 112 inside the 280 × 200 preview.
    await page.mouse.click(box.x + (3 / 280) * box.width, box.y + ((44 + 3) / 200) * box.height);
    await panel.getByRole('button', { name: 'Use as the front view' }).click();
    await expect(panel.getByText('Views used')).toBeVisible();
    const project = await exportProject(page);
    const piece = (project.furniture as { name: string; width: number; height: number; photoModel?: { front?: { silhouette: { bits: string } } } }[]).find((f) => f.name === 'Lidded box')!;
    expect(piece).toMatchObject({ width: 25, height: 10 });
    const bits = atob(piece.photoModel!.front!.silhouette.bits);
    // The trimmed corner is outside the outline; the middle is inside.
    expect(bits.charCodeAt(0) & 1).toBe(0);
    expect([...bits].some((ch) => ch.charCodeAt(0) === 255)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('Import 3D model: a synthetic scan lying on its side is stood up, sized and added locally', async ({ page, baseURL }) => {
    const errors = await openApp(page);
    const origin = new URL(baseURL!).origin;
    const outside: string[] = [];
    page.on('request', (r) => {
      const url = r.url();
      if (!url.startsWith('data:') && !url.startsWith('blob:') && new URL(url).origin !== origin) outside.push(url);
    });
    await toolsTab(page, 'Furnish');
    await fromPhotosOrScan(page, tools(page), 'scan');
    const dialog = page.getByRole('dialog', { name: 'Import a 3D model' });
    // A 30 × 35 × 19 cm textured box, lying on its back (19 cm high, 35 cm deep).
    const glb = Buffer.from(syntheticGlb({ w: 0.3, h: 0.19, d: 0.35 }));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), dialog.getByRole('button', { name: /Choose model file/ }).click()]);
    await chooser.setFiles({ name: 'radio-scan.glb', mimeType: 'model/gltf-binary', buffer: glb });
    await expect(dialog.getByText(/GLB · 12 triangles · as modelled 30 cm wide, 35 cm deep, 19 cm high/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Tip forward 90°' }).click();
    await expect(dialog.getByText(/as modelled 30 cm wide, 19 cm deep, 35 cm high/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Add to room' }).click();
    await expect(dialog).toBeHidden();
    const project = await exportProject(page);
    type Piece = { name: string; width: number; depth: number; height: number; category: string; mesh?: { assetId: string; turn: { x: number }; triangles: number } };
    const piece = (project.furniture as Piece[]).find((f) => f.mesh)!;
    expect(piece).toMatchObject({ name: 'Radio scan', width: 30, depth: 19, height: 35, category: 'decoration' });
    expect(piece.mesh).toMatchObject({ turn: { x: 90 }, triangles: 12 });
    // Drawn in 3D from the stored model.
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: '3D View' }).click();
    await expect.poll(() => page.evaluate(() => window.__roomination3D?.stats().modelTriangles ?? 0), { timeout: 20000 }).toBe(12);
    expect(outside).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('Photos & scans and Create furniture: one selector for the look, the last method remembered', async ({ page }) => {
    const errors = await openApp(page);
    await toolsTab(page, 'Furnish');
    // A piece with a 3D scan (synthetic box).
    await fromPhotosOrScan(page, tools(page), 'scan');
    const dialog = page.getByRole('dialog', { name: 'Import a 3D model' });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), dialog.getByRole('button', { name: /Choose model file/ }).click()]);
    await chooser.setFiles({ name: 'radio-scan.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(syntheticGlb()) });
    await dialog.getByRole('button', { name: 'Add to room' }).click();
    await expect(dialog).toBeHidden();
    // Shown in 3D: the scan is shown; a photo rebuild doesn't exist yet, and says so.
    const shown = props(page).getByRole('radiogroup', { name: 'Shown in 3D' });
    await expect(shown.getByRole('radio', { name: '3D scan' })).toHaveAttribute('aria-checked', 'true');
    await expect(shown.getByRole('radio', { name: 'Photo rebuild' })).toHaveAttribute('aria-disabled', 'true');
    await expect(props(page).getByText(/Photo rebuild: not made yet/)).toBeVisible();
    // Tapping an unavailable look changes nothing (forced: Playwright won't tap a disabled control).
    await shown.getByRole('radio', { name: 'Photo rebuild' }).click({ force: true });
    await expect(shown.getByRole('radio', { name: '3D scan' })).toHaveAttribute('aria-checked', 'true');
    // Switching to the standard model keeps the scan (just not shown).
    await shown.getByRole('radio', { name: 'Standard model' }).click();
    const project = await exportProject(page);
    const piece = (project.furniture as { name: string; mesh?: { off?: boolean; assetId: string } }[]).find((f) => f.mesh)!;
    expect(piece.mesh).toMatchObject({ off: true });
    expect(piece.mesh!.assetId).toMatch(/^[0-9a-f]{64}$/);
    // Create furniture: start with Combine shapes, cancel, and it's preselected next time.
    await page.keyboard.press('Escape');
    await toolsTab(page, 'Furnish');
    await tools(page).getByRole('button', { name: 'Create furniture…' }).click();
    const create = page.getByRole('dialog', { name: 'Create furniture', exact: true });
    await create.getByRole('radio', { name: /^Combine shapes/ }).check();
    await create.getByRole('button', { name: 'Start combining shapes' }).click();
    await expect(page.getByRole('dialog', { name: 'Combine shapes', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await tools(page).getByRole('button', { name: 'Create furniture…' }).click();
    await expect(create.getByRole('radio', { name: /^Combine shapes/ })).toBeChecked();
    await expect(create.getByText('Used last')).toBeVisible();
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
