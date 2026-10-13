import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { stressProject } from '../src/scene3d/testRooms';
import { serializeProject } from '../src/storage/projectFile';
import { importProject, openApp } from './helpers';

/**
 * Performance of the 3D view on a deliberately heavy project: 40 walls, 150 pieces of
 * furniture, 4 doors, 5 windows and 3 staircases. The numbers are logged (and attached
 * to the report) every run; the limits are generous because CI renders in software.
 */
test('3D performance with a stress project', { tag: '@3d' }, async ({ page }, info) => {
  test.setTimeout(120_000);
  await openApp(page);
  const file = info.outputPath('stress.json');
  writeFileSync(file, serializeProject(stressProject()));
  await importProject(page, file);

  const started = Date.now();
  await page.getByRole('radio', { name: '3D View' }).click();
  await page.waitForFunction(() => (window.__roomination3D?.stats().framesRendered ?? 0) > 0, null, { timeout: 60_000 });
  const loadMs = Date.now() - started;
  await page.waitForFunction(() => !window.__roomination3D!.stats().animating);

  // Orbit by dragging across the canvas, and count the frames actually drawn.
  const canvas = (await page.locator('.view3d-panel canvas').boundingBox())!;
  const cx = canvas.x + canvas.width / 2;
  const cy = canvas.y + canvas.height / 2;
  const before = await page.evaluate(() => window.__roomination3D!.stats());
  const orbitStart = Date.now();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 120; i++) await page.mouse.move(cx + Math.sin(i / 10) * 200, cy + Math.cos(i / 15) * 60);
  await page.mouse.up();
  const seconds = (Date.now() - orbitStart) / 1000;
  const after = await page.evaluate(() => window.__roomination3D!.stats());
  const heapMB = await page.evaluate(() => ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e6);

  const result = {
    loadMs,
    buildMs: Number(after.buildMs.toFixed(1)),
    orbitFps: Number(((after.framesRendered - before.framesRendered) / seconds).toFixed(1)),
    drawCalls: after.drawCalls,
    triangles: after.triangles,
    gpuGeometries: after.geometries,
    gpuTextures: after.textures,
    heapMB: Number(heapMB.toFixed(1)),
  };
  console.log(`[${info.project.name}] 3D stress:`, JSON.stringify(result));
  await info.attach('stress-results.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });

  expect(result.buildMs).toBeLessThan(100);
  expect(result.drawCalls).toBeLessThan(120);
  expect(result.orbitFps).toBeGreaterThan(5);

  // Leaving 3D frees the GPU resources and the diagnostics hook.
  await page.getByRole('radio', { name: '2D Plan' }).click();
  expect(await page.evaluate(() => window.__roomination3D)).toBeUndefined();
});
