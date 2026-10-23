import { expect, test, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { SAMPLE_BEDROOM, SAMPLE_LIVING, SAMPLE_STUDIO, sampleToRoomPlan } from '../src/scan/samples';
import { exportProject, lightweight3D, openApp, saveAndReload } from './helpers';

/**
 * Importing a LiDAR room scan: choose a file, review and correct it, create a new project.
 * Every scan here is SYNTHETIC (generated from src/scan/samples.ts); no real scan is used.
 */

type Piece = { id: string; name: string; kind: string; x: number; y: number; width: number; depth: number; height: number };
type Feature = { kind: string; width: number; height: number; elevation: number; doorType?: string };
type Exported = { name: string; room: { height: number; outline: { x: number; y: number }[] }; furniture: Piece[]; features: Feature[] };

const json = (name: string, data: unknown) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
const dialog = (page: Page) => page.getByRole('dialog', { name: /room scan|scanned room/i });

/** Records every request that leaves the app's own origin. */
function watchRequests(page: Page) {
  const outside: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (new URL(url).origin !== new URL(page.url() || 'http://localhost').origin) outside.push(url);
  });
  return outside;
}

async function openImporter(page: Page) {
  await page.getByRole('button', { name: /^Projects/ }).click();
  await page.getByRole('button', { name: 'Import room scan…' }).click();
  await expect(dialog(page)).toBeVisible();
}

async function chooseFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), dialog(page).getByRole('button', { name: 'Choose scan file…' }).click()]);
  await chooser.setFiles(file);
}

function sideLengths(outline: { x: number; y: number }[]) {
  return outline.map((p, i) => Math.round(Math.hypot(outline[(i + 1) % outline.length].x - p.x, outline[(i + 1) % outline.length].y - p.y) * 10) / 10).sort((a, b) => a - b);
}

test.beforeEach(async ({ page }) => lightweight3D(page));

test('imports a RoomPlan JSON scan as a new project, with the measured sizes and the person’s corrections', async ({ page }) => {
  const errors = await openApp(page);
  const outside = watchRequests(page);
  const before = await exportProject(page);

  await openImporter(page);
  await chooseFile(page, json('Room.json', sampleToRoomPlan(SAMPLE_BEDROOM)));
  const review = dialog(page);
  await expect(review.getByRole('heading', { name: 'Review the scanned room' })).toBeVisible();
  await expect(review.getByRole('img', { name: /Preview of the room: 4 walls, 2 doors and windows/ })).toBeVisible();
  // Measured values are shown exactly.
  await expect(review.getByText('Measured: 420 cm').first()).toBeVisible();

  // Corrections: a different name and ceiling; leave out the low-confidence chair; resize the bed.
  await review.getByLabel('Project name').fill('Guest bedroom');
  await review.getByLabel('Ceiling height').fill('255');
  await review.getByLabel('Ceiling height').press('Enter');
  await review.getByRole('radio', { name: /^Furniture/ }).click();
  const chair = review.locator('.scan-card', { hasText: 'Chair' }).filter({ hasText: 'Low confidence' });
  await expect(chair).toHaveClass(/is-low/);
  await chair.getByRole('checkbox').uncheck();
  const bed = review.locator('.scan-card', { hasText: /Scanner\s*Bed/ });
  await expect(bed.getByLabel('Shown as')).toHaveValue('bed-queen');
  await bed.getByLabel('Width').fill('170');
  await bed.getByLabel('Width').press('Enter');
  await expect(bed.getByText('Reset to the measured size')).toBeVisible();
  await expect(bed.getByText(/Bed in the bedroom, 160 cm × 205 cm/)).toBeVisible();

  await review.getByRole('button', { name: 'Create new project' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('.toast')).toContainText('Created “Guest bedroom” from your scan');

  const p = (await exportProject(page)) as Exported;
  expect(p.name).toBe('Guest bedroom');
  expect(p.room.height).toBe(255);
  expect(sideLengths(p.room.outline)).toEqual([360, 360, 420, 420]);
  expect(p.furniture.find((f) => f.kind === 'bed')).toMatchObject({ width: 170, depth: 205, height: 55 });
  expect(p.furniture.some((f) => f.kind === 'chair')).toBe(false);
  expect(p.features.find((f) => f.kind === 'window')).toMatchObject({ width: 140, height: 120, elevation: 95 });

  // The project that was open before is still there, unchanged.
  await page.getByRole('button', { name: /^Projects/ }).click();
  await expect(page.locator('.project-list')).toContainText(before.name);
  await expect(page.locator('.project-list')).toContainText('Guest bedroom');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  // It's an ordinary saved project.
  await saveAndReload(page);
  await expect(page.getByRole('button', { name: /^Projects/ })).toContainText('Guest bedroom');

  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});

test('reads only the geometry from a 3D Model Anything room ZIP', async ({ page }) => {
  const errors = await openApp(page);
  const outside = watchRequests(page);
  const filler = (n: number, v: number) => new Uint8Array(n).fill(v);
  const zip = zipSync({
    'Living/manifest.json': strToU8(JSON.stringify({ format: 'house-capture/5' })),
    'Living/rooms/room-1.json': strToU8(JSON.stringify(sampleToRoomPlan(SAMPLE_LIVING))),
    'Living/rooms/room-1-data.json': strToU8('{}'),
    'Living/photos/0001.jpg': filler(4000, 0xd8),
    'Living/photos/0002.jpg': filler(4000, 0xd9),
    'Living/photos/0003.jpg': filler(4000, 0xda),
    'Living/depth/00001.f16z': filler(2000, 1),
    'Living/mesh/room-1.ply': filler(3000, 2),
    'Living/worldmap.arworldmap': filler(1000, 3),
  });
  await openImporter(page);
  await chooseFile(page, { name: 'living.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  const review = dialog(page);
  await expect(review.getByText(/Not opened: 3 photos, 1 depth frame, 1 3D model, an AR world map and 1 raw capture file/)).toBeVisible();
  await expect(review.getByText(/3D Model Anything scan/)).toBeVisible();

  // The scan's world is turned a quarter turn; turning it back keeps every length.
  await review.getByRole('button', { name: 'Turn right' }).click();
  await review.getByRole('radio', { name: /^Openings/ }).click();
  await expect(review.locator('.scan-card', { hasText: 'Doorway (no door)' })).toBeVisible();
  await review.getByRole('button', { name: 'Create new project' }).click();
  await expect(dialog(page)).toBeHidden();

  const p = (await exportProject(page)) as Exported;
  expect(sideLengths(p.room.outline)).toEqual([220, 240, 300, 380, 520, 620]);
  expect(p.features.filter((f) => f.doorType === 'opening')).toHaveLength(1);
  // A table in the area the scan labelled "dining room" is a dining table.
  expect(p.furniture.find((f) => /Dining table/.test(f.name))).toBeTruthy();
  expect(outside).toEqual([]);
  expect(errors).toEqual([]);
});

test('explains files it can’t use, and creates nothing', async ({ page }) => {
  const errors = await openApp(page);
  await openImporter(page);
  const review = dialog(page);

  await chooseFile(page, { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"walls": [1, 2') });
  await expect(review.getByRole('alert')).toContainText('isn’t valid JSON');

  await chooseFile(page, { name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(300, 7)]) });
  await expect(review.getByRole('alert')).toContainText('damaged');

  await chooseFile(page, json('project.json', { schemaVersion: 7, room: {}, name: 'x' }));
  await expect(review.getByRole('alert')).toContainText('Roomination project');

  await chooseFile(page, { name: 'huge.json', mimeType: 'application/json', buffer: Buffer.alloc(26 * 1024 * 1024, 0x20) });
  await expect(review.getByRole('alert')).toContainText('too large');

  await review.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: /^Projects/ }).click();
  await expect(page.locator('.project-list li')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a scan missing a wall is closed with a marked wall the person can check', async ({ page }) => {
  const errors = await openApp(page);
  await openImporter(page);
  await chooseFile(page, json('incomplete.json', sampleToRoomPlan({ ...SAMPLE_BEDROOM, openings: [], walls: { ...SAMPLE_BEDROOM.walls, missing: [1] } })));
  const review = dialog(page);
  await expect(review.getByText('Added to close a gap')).toBeVisible();
  await review.getByRole('radio', { name: /^Check/ }).click();
  await expect(review.getByText(/The scan missed part of a wall/)).toBeVisible();
  await expect(review.getByText(/found no doors or windows/)).toBeVisible();

  // Add the door the scan missed.
  await review.getByRole('radio', { name: /^Openings/ }).click();
  await review.getByText('Add a door, window or doorway the scan missed').click();
  await review.getByRole('button', { name: 'Add door' }).click();
  await expect(review.locator('.scan-card', { hasText: 'Door (added)' })).toBeVisible();
  await review.getByRole('button', { name: 'Create new project' }).click();
  const p = (await exportProject(page)) as Exported;
  expect(p.features.filter((f) => f.kind === 'door')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test.describe('scanned rooms in the rest of the app', { tag: '@3d' }, () => {
  test('a synthetic sample becomes a project that works in Presentation and 3D', async ({ page }) => {
    const errors = await openApp(page);
    const outside = watchRequests(page);
    await openImporter(page);
    await dialog(page).getByRole('button', { name: 'Angled studio' }).click();
    await expect(dialog(page).getByText(/Turns the plan 23°/)).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Create new project' }).click();
    await expect(dialog(page)).toBeHidden();

    await page.getByRole('radio', { name: 'Presentation' }).click();
    await expect(page.locator('.floor-plan canvas').first()).toBeVisible();
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: '3D View' }).click();
    const panel = page.getByRole('region', { name: '3D view' });
    await expect(panel.locator('canvas, [role=alert]').first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => page.evaluate(() => window.__roomination3D?.stats()?.framesRendered ?? 0), { timeout: 20_000 }).toBeGreaterThan(0);

    const p = (await exportProject(page)) as Exported;
    expect(sideLengths(p.room.outline)).toEqual([410, 410, 560, 560]);
    expect(p.furniture.filter((f) => f.kind === 'fixture').length).toBeGreaterThanOrEqual(5);
    expect(outside).toEqual([]);
    expect(errors).toEqual([]);
  });
});

for (const { width, height, label } of [
  { width: 390, height: 844, label: 'phone' },
  { width: 820, height: 1180, label: 'tablet' },
]) {
  test.describe(`on a ${label}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: width < 500 });

    test('the review fits the screen and can create the project', async ({ page }) => {
      const errors = await openApp(page);
      await openImporter(page);
      await dialog(page).getByRole('button', { name: 'L-shaped living room' }).click();
      const review = dialog(page);
      await expect(review.getByRole('img', { name: /Preview of the room/ })).toBeVisible();
      // Nothing wider than the screen.
      const overflow = await page.evaluate(() => [...document.querySelectorAll('.scan-dialog *')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).length);
      expect(overflow).toBe(0);
      await review.getByRole('radio', { name: /^Furniture/ }).click();
      await expect(review.locator('.scan-card').first()).toBeVisible();
      const create = review.getByRole('button', { name: 'Create new project' });
      await expect(create).toBeInViewport();
      await create.click();
      await expect(dialog(page)).toBeHidden();
      expect(errors).toEqual([]);
    });
  });
}
