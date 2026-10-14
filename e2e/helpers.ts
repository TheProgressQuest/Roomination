import { expect, type Locator, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

/** Loads the app and waits for the floor plan. Collects console errors for later checks. */
export async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('./');
  await page.waitForSelector('.floor-plan canvas');
  await page.waitForTimeout(150);
  return errors;
}

export interface RoomBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Thickest outer wall, in cm (the view leaves this much margin). */
  wall?: number;
  /** True while per-wall length labels show (drawing, a wall selected, irregular rooms). */
  wallLabels?: boolean;
}

/** The sample room: 480 × 380 cm with 12 cm walls. */
export const SAMPLE_ROOM: RoomBox = { minX: 0, minY: 0, maxX: 480, maxY: 380, wall: 12 };

/** Mirrors the app's viewport maths, so tests can aim at real-world positions (cm). */
export async function mapper(page: Page, room: RoomBox = SAMPLE_ROOM) {
  const box = (await page.locator('.floor-plan').boundingBox())!;
  const wall = room.wall ?? 12;
  const bounds = { minX: room.minX - wall, minY: room.minY - wall, maxX: room.maxX + wall, maxY: room.maxY + wall };
  const pad = Math.min(56, Math.max(36, box.width * 0.08)) + (room.wallLabels ? 18 : 0);
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const scale = Math.min((box.width - pad * 2) / spanX, (box.height - pad * 2) / spanY);
  const ox = box.x + (box.width - spanX * scale) / 2 - bounds.minX * scale;
  const oy = box.y + (box.height - spanY * scale) / 2 - bounds.minY * scale;
  return { scale, ox, oy, at: (x: number, y: number) => ({ x: ox + x * scale, y: oy + y * scale }) };
}

export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 14) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  await page.mouse.up();
  await page.waitForTimeout(80);
}

export const props = (page: Page) => page.locator('.properties-panel');
export const tools = (page: Page) => page.locator('.tools-panel');
export const banner = (page: Page) => page.locator('.conflict-banner');
export const toast = (page: Page) => page.locator('.toast');

export async function num(scope: Locator, label: string): Promise<number> {
  return Number(await scope.getByLabel(label, { exact: true }).inputValue());
}

export async function setNum(scope: Locator, label: string, value: number) {
  const field = scope.getByLabel(label, { exact: true });
  await field.fill(String(value));
  await field.press('Enter');
}

export const radio = (scope: Locator, group: string, option: string) =>
  scope.getByRole('radiogroup', { name: group }).getByRole('radio', { name: option, exact: true });

export type ToolsTabName = 'Build' | 'Furnish' | 'Design' | 'Optimize';

/** Opens a tab of the tools panel (Build, Furnish, Design, Optimize). */
export async function toolsTab(page: Page, name: ToolsTabName) {
  // The Furnish tab's name also says how many checks are open ("Furnish 2 to check").
  const tab = tools(page).getByRole('tab', { name: new RegExp(`^${name}`) });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** Furniture listed in the Furnish tab (open it first). */
export const furnitureRows = (page: Page) => tools(page).locator('.furniture-list li');
/** Features and stairs listed in the Build tab (open it first). */
export const structureRows = (page: Page) => tools(page).locator('.structure-list li');
/** Walls listed in the Build tab (open it first). */
export const wallRows = (page: Page) => tools(page).locator('.wall-list li');

/** Selects something by name from the tools lists (furniture first, then features, stairs and walls). */
export async function selectInList(page: Page, name: string) {
  for (const tab of ['Furnish', 'Build'] as const) {
    await toolsTab(page, tab);
    const button = tools(page).locator('.object-list').getByRole('button', { name: new RegExp(`^${name}`) }).first();
    if ((await button.count()) > 0) {
      await button.click();
      return;
    }
  }
  throw new Error(`Nothing called ${name} in the tools lists`);
}

/** The room checks summary (in the Furnish tab). */
export async function checksText(page: Page): Promise<string> {
  await toolsTab(page, 'Furnish');
  return (await tools(page).locator('.checks, .checks-clear').first().textContent()) ?? '';
}

/** Downloads the project via Export and returns the parsed project (from JSON or ZIP). */
export async function exportProject(page: Page) {
  await page.getByRole('button', { name: /^Projects/ }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export file' }).click()]);
  const bytes = await (await import('node:fs/promises')).readFile((await download.path())!);
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  // Projects with photos download as a ZIP (project.json plus the photos).
  const text = bytes.subarray(0, 2).toString() === 'PK' ? strFromU8(unzipSync(new Uint8Array(bytes))['project.json']) : bytes.toString('utf8');
  return JSON.parse(text).project;
}

/** Waits for autosave, then reloads. */
export async function saveAndReload(page: Page) {
  await expect(page.locator('.save-status.is-saved')).toBeVisible();
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('.floor-plan canvas');
}

/**
 * Waits until the plan has stopped resizing (e.g. after the drawing bar appears above it),
 * so positions computed by `mapper` match what's on screen.
 */
export async function settle(page: Page) {
  let previous = '';
  for (let i = 0; i < 20; i++) {
    const box = JSON.stringify(await page.locator('.floor-plan').boundingBox());
    if (box === previous) return;
    previous = box;
    await page.waitForTimeout(50);
  }
}

/** Imports a project file through the Projects dialog (it becomes the open project). */
export async function importProject(page: Page, file: string) {
  await page.getByRole('button', { name: /^Projects/ }).click();
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles(file);
  await expect(page.getByRole('dialog').locator('.import-message')).toContainText('Imported');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
}

/**
 * Starts the 3D view without shadows unless a test changes it. Software WebGL (used in CI)
 * spends most of its time on shadow passes, so this keeps the 3D tests fast. Existing
 * preferences (e.g. after a reload) are left alone.
 */
export async function lightweight3D(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('roomination.preferences')) {
      localStorage.setItem('roomination.preferences', JSON.stringify({ view3d: { shadows: false } }));
    }
  });
}
