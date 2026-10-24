import { devices, expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { exportProject, openApp, selectInList } from './helpers';
import { makePng } from './png';
import { syntheticRoomPhoto } from './syntheticPhoto';

/**
 * "Select an area" (Match my room → Pick colour → Selecting an area): the real on-device model
 * (MobileSAM, WebAssembly) on a SYNTHETIC photo whose true colours are known. Nothing leaves the
 * app's own origin.
 */

const photo = syntheticRoomPhoto();
const png = makePng(photo.width, photo.height, (x, y) => {
  const i = (y * photo.width + x) * 4;
  return [photo.data[i], photo.data[i + 1], photo.data[i + 2], 255];
});

const lab = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(lin);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const deltaE = (a: string, b: string) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

function watchOutside(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const outside: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith('data:') && !url.startsWith('blob:') && new URL(url).origin !== origin) outside.push(url);
  });
  return outside;
}

/** Opens Match my room (for the room, or for a selected piece) with the synthetic photo. */
async function openWithPhoto(page: Page, piece?: string) {
  if (piece) await selectInList(page, piece);
  await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: '3D View' }).click();
  // Phones keep Match my room under the 3D view's Options.
  const match = page.getByRole('button', { name: 'Match my room' });
  if (!(await match.isVisible())) await page.getByRole('button', { name: 'Options' }).click();
  await match.click();
  let panel = page.getByRole('complementary', { name: 'Match my room' });
  if (piece) {
    await panel.getByRole('button', { name: `Photos for ${piece}` }).click();
    panel = page.getByRole('complementary', { name: `Photos for ${piece}` });
  }
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), panel.getByRole('button', { name: /Add (a )?photo/ }).click()]);
  await chooser.setFiles({ name: 'synthetic-room.png', mimeType: 'image/png', buffer: png });
  await expect(panel.locator('canvas.match-photo')).toBeVisible();
  if (piece) await panel.getByRole('radio', { name: 'Pick colour' }).click();
  return panel;
}

async function turnOn(panel: ReturnType<Page['getByRole']>) {
  await panel.getByRole('radio', { name: 'Selecting an area (AI)' }).click();
  await expect(panel.getByText(/downloads 19 MB \(the model\) and up to 14 MB \(the engine/)).toBeVisible();
  const started = Date.now();
  await panel.getByRole('button', { name: 'Download and turn on' }).click();
  await expect(panel.getByText('Tap the middle of the object or surface.')).toBeVisible({ timeout: 60_000 });
  return Date.now() - started;
}

/** Taps the photo at a point given in the photo's pixels. */
async function tapPhoto(panel: ReturnType<Page['getByRole']>, p: { x: number; y: number }) {
  const canvas = panel.locator('canvas.match-photo');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const position = { x: (p.x * box.width) / photo.width, y: (p.y * box.height) / photo.height };
  if (await canvas.page().evaluate(() => matchMedia('(pointer: coarse)').matches)) await canvas.tap({ position });
  else await canvas.click({ position });
}

async function suggested(panel: ReturnType<Page['getByRole']>) {
  const card = panel.getByLabel('Suggested colour');
  await expect(card).toBeVisible({ timeout: 30_000 });
  return (await card.locator('code').last().textContent())!;
}

test.describe('Select an area', () => {
  test.setTimeout(120_000);

  test('a sofa: tap, measured colour, apply, undo', async ({ page, baseURL }, info) => {
    const errors = await openApp(page);
    const outside = watchOutside(page, baseURL!);
    const panel = await openWithPhoto(page, 'Sofa');
    const before = (await exportProject(page)).furniture.find((f: { name: string }) => f.name === 'Sofa')!.color;
    const loadMs = await turnOn(panel);
    const t = Date.now();
    await tapPhoto(panel, photo.taps.sofa);
    const hex = await suggested(panel);
    const selectMs = Date.now() - t;
    info.annotations.push({ type: 'timing', description: `load ${loadMs} ms (download + start), first tap ${selectMs} ms (read photo + select)` });
    expect(deltaE(hex, photo.colours.sofa)).toBeLessThan(4);
    await panel.getByRole('button', { name: 'Apply colour' }).click();
    const sofa = (await exportProject(page)).furniture.find((f: { name: string }) => f.name === 'Sofa')!;
    expect(sofa.color).toBe(hex);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await exportProject(page)).furniture.find((f: { name: string }) => f.name === 'Sofa')!.color).toBe(before);
    expect(outside).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a wall (rejected, then applied) and a floor with a photo texture (asks first, keeps it)', async ({ page }) => {
    const errors = await openApp(page);
    const panel = await openWithPhoto(page);
    // Give the floor a photo texture first (the manual tool, unchanged).
    await panel.getByRole('radio', { name: 'Cut texture' }).click();
    await panel.getByLabel('Apply to').selectOption('floor');
    await panel.getByRole('button', { name: 'Apply texture' }).click();
    await expect.poll(async () => !!(await exportProject(page)).room.floor.photo).toBe(true);
    await panel.getByRole('radio', { name: 'Pick colour' }).click();
    await turnOn(panel);

    await tapPhoto(panel, photo.taps.wall);
    await suggested(panel);
    await panel.getByRole('button', { name: 'Reject' }).click();
    await expect(panel.getByLabel('Suggested colour')).toBeHidden();
    await tapPhoto(panel, photo.taps.wall);
    const wall = await suggested(panel);
    expect(deltaE(wall, photo.colours.wall)).toBeLessThan(4);
    await panel.getByLabel('Apply to').selectOption('walls');
    await panel.getByRole('button', { name: 'Apply colour' }).click();
    expect((await exportProject(page)).room.wallColor).toBe(wall);

    // A new selection for the floor: reset, then tap it.
    await panel.getByRole('button', { name: 'Reject' }).click();
    await tapPhoto(panel, photo.taps.floor);
    const floor = await suggested(panel);
    expect(deltaE(floor, photo.colours.floor)).toBeLessThan(5);
    const floorBefore = (await exportProject(page)).room.floor.color;
    await panel.getByLabel('Apply to').selectOption('floor');
    await panel.getByRole('button', { name: 'Apply colour' }).click();
    await expect(panel.getByRole('alert')).toContainText('texture from a photo, which stays');
    expect((await exportProject(page)).room.floor.color).toBe(floorBefore);
    await panel.getByRole('button', { name: 'Apply anyway' }).click();
    const after = await exportProject(page);
    expect(after.room.floor.color).toBe(floor);
    expect(after.room.floor.photo).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('repeated use: add, leave out, larger and smaller, undo a tap, another photo', async ({ page }) => {
    const errors = await openApp(page);
    const panel = await openWithPhoto(page);
    await turnOn(panel);
    await tapPhoto(panel, photo.taps.sofa);
    await suggested(panel);
    await panel.getByRole('radio', { name: 'Leave out' }).click();
    await tapPhoto(panel, { x: photo.width * 0.6, y: photo.height * 0.6 }); // the red throw
    await suggested(panel);
    await panel.getByRole('button', { name: 'Undo last tap' }).click();
    await suggested(panel);
    const larger = panel.getByRole('button', { name: 'Larger area' });
    if (await larger.isEnabled()) await larger.click();
    await suggested(panel);
    // A second photo starts a new selection.
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), panel.getByRole('button', { name: /Add (a )?photo/ }).click()]);
    await chooser.setFiles({ name: 'second.png', mimeType: 'image/png', buffer: makePng(320, 240, (x) => [90 + (x % 50), 120, 160, 255]) });
    await expect(panel.getByLabel('Suggested colour')).toBeHidden();
    await expect(panel.getByText('Tap the middle of the object or surface.')).toBeVisible({ timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test('closing frees the model; reopening takes it from the browser, not the network', async ({ page }) => {
    const errors = await openApp(page);
    let downloads = 0;
    page.on('request', (r) => r.url().endsWith('/models/mobilesam/encoder.onnx') && downloads++);
    let panel = await openWithPhoto(page);
    await turnOn(panel);
    await page.getByRole('button', { name: 'Close Match my room' }).click();
    await page.getByRole('button', { name: 'Match my room' }).click();
    panel = page.getByRole('complementary', { name: 'Match my room' });
    await panel.getByRole('radio', { name: 'Selecting an area (AI)' }).click();
    // Turned on before: no download prompt, back on by itself.
    await expect(panel.getByText('Tap the middle of the object or surface.')).toBeVisible({ timeout: 60_000 });
    await tapPhoto(panel, photo.taps.wall);
    await suggested(panel);
    expect(downloads).toBe(1);
    // Turning it off deletes the kept model; turning on again downloads it.
    await panel.getByRole('button', { name: 'Turn off and delete the downloaded model' }).click();
    await expect(panel.getByRole('button', { name: 'Download and turn on' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a failed download explains itself, and tapping a point still works', async ({ page }) => {
    const errors = await openApp(page);
    await page.route('**/models/mobilesam/encoder.onnx', (route) => route.abort('internetdisconnected'));
    const panel = await openWithPhoto(page);
    await panel.getByRole('radio', { name: 'Selecting an area (AI)' }).click();
    await panel.getByRole('button', { name: 'Download and turn on' }).click();
    await expect(panel.getByRole('alert')).toContainText('couldn’t be downloaded');
    await expect(panel.getByRole('button', { name: 'Try again' })).toBeVisible();
    await panel.getByRole('radio', { name: 'Tapping a point' }).click();
    await tapPhoto(panel, photo.taps.wall);
    await expect(panel.locator('.match-picked code')).toHaveText(/^#[0-9a-f]{6}$/);
    expect(errors.filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(e))).toEqual([]);
  });

  test('a file that isn’t the expected model is refused', async ({ page }) => {
    await openApp(page);
    await page.route('**/models/mobilesam/decoder.onnx', (route) => route.fulfill({ status: 200, body: Buffer.alloc(4_742_230, 7) }));
    const panel = await openWithPhoto(page);
    await panel.getByRole('radio', { name: 'Selecting an area (AI)' }).click();
    await panel.getByRole('button', { name: 'Download and turn on' }).click();
    await expect(panel.getByRole('alert')).toContainText('wasn’t the expected file');
  });

  test('cancelling a download stops it', async ({ page }) => {
    await openApp(page);
    await page.route('**/models/mobilesam/encoder.onnx', async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.continue().catch(() => undefined);
    });
    const panel = await openWithPhoto(page);
    await panel.getByRole('radio', { name: 'Selecting an area (AI)' }).click();
    await panel.getByRole('button', { name: 'Download and turn on' }).click();
    await expect(panel.getByText(/Downloading the model/)).toBeVisible();
    await panel.getByRole('button', { name: 'Cancel' }).click();
    await expect(panel.getByRole('button', { name: 'Download and turn on' })).toBeVisible();
    await expect(panel.getByRole('alert')).toHaveCount(0);
  });

  test('running out of memory is explained, and tapping a point still works', async ({ page }) => {
    // Simulates the worker failing to read the photo for lack of memory (as a small phone might).
    await page.addInitScript(() => {
      const Real = window.Worker;
      window.Worker = class extends Real {
        set onmessage(handler: ((e: MessageEvent) => void) | null) {
          super.onmessage = (e: MessageEvent) =>
            handler?.(e.data?.type === 'embedded' ? new MessageEvent('message', { data: { type: 'error', id: e.data.id, kind: 'memory', message: 'Aborted(OOM)' } }) : e);
        }
        get onmessage() {
          return super.onmessage;
        }
      } as typeof Worker;
    });
    const errors = await openApp(page);
    const panel = await openWithPhoto(page);
    await panel.getByRole('radio', { name: 'Selecting an area (AI)' }).click();
    await panel.getByRole('button', { name: 'Download and turn on' }).click();
    await expect(panel.getByRole('alert')).toContainText('ran out of memory', { timeout: 60_000 });
    await panel.getByRole('radio', { name: 'Tapping a point' }).click();
    await tapPhoto(panel, photo.taps.wall);
    await expect(panel.locator('.match-picked code')).toHaveText(/^#[0-9a-f]{6}$/);
    expect(errors).toEqual([]);
  });

  test('after the page stopped mid-read (as Safari does when memory runs out), it waits; after two, it’s off here', async ({ page }) => {
    // Turned on before, and a heavy step was running when the previous page ended.
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('roomination.areaSelect', 'on');
      localStorage.setItem('roomination.areaSelect.busy', String(Date.now() - 5000));
    });
    const errors = await openApp(page);
    let panel = await openWithPhoto(page);
    await panel.getByRole('radio', { name: 'Selecting an area (AI)' }).click();
    await expect(panel.getByText(/Last time, the page stopped/)).toBeVisible();
    await expect(panel.getByRole('button', { name: /Turn on|Download and turn on/ })).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(panel.getByText('Tap the middle of the object or surface.')).toHaveCount(0); // didn't start by itself
    // A second stop: off on this device, with the manual tools unaffected.
    await page.evaluate(() => localStorage.setItem('roomination.areaSelect.busy', String(Date.now() - 5000)));
    await page.reload();
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: '3D View' }).click();
    await page.getByRole('button', { name: 'Match my room' }).click();
    panel = page.getByRole('complementary', { name: 'Match my room' });
    await panel.getByRole('radio', { name: 'Selecting an area (AI)' }).click();
    await expect(panel.getByText(/stopped this page 2 times on this device/)).toBeVisible();
    await panel.getByRole('radio', { name: 'Tapping a point' }).click();
    await tapPhoto(panel, photo.taps.wall);
    await expect(panel.locator('.match-picked code')).toHaveText(/^#[0-9a-f]{6}$/);
    // "Try anyway" works, and a completed read clears the record.
    await panel.getByRole('radio', { name: 'Selecting an area (AI)' }).click();
    await panel.getByRole('button', { name: 'Try anyway' }).click();
    await expect(panel.getByText('Tap the middle of the object or surface.')).toBeVisible({ timeout: 60_000 });
    expect(await page.evaluate(() => localStorage.getItem('roomination.areaSelect.stops'))).toBeNull();
    expect(errors).toEqual([]);
  });

  test('a page reloaded in the middle of reading a photo keeps the project, and the safeguard notices', async ({ page }) => {
    const errors = await openApp(page);
    const panel = await openWithPhoto(page);
    await turnOn(panel);
    // Another photo starts a read; reload while it runs.
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), panel.getByRole('button', { name: /Add (a )?photo/ }).click()]);
    await chooser.setFiles({ name: 'second.png', mimeType: 'image/png', buffer: makePng(800, 600, (x, y) => [x % 255, y % 255, 120, 255]) });
    await expect(panel.getByText(/Reading this photo/)).toBeVisible();
    await page.reload();
    const project = await exportProject(page);
    expect(project.referencePhotos).toHaveLength(2);
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: '3D View' }).click();
    await page.getByRole('button', { name: 'Match my room' }).click();
    const again = page.getByRole('complementary', { name: 'Match my room' });
    await again.getByRole('radio', { name: 'Selecting an area (AI)' }).click();
    await expect(again.getByText(/Last time, the page stopped/)).toBeVisible();
    await again.getByRole('button', { name: 'Turn on' }).click();
    await expect(again.getByText('Tap the middle of the object or surface.')).toBeVisible({ timeout: 60_000 });
    expect(errors).toEqual([]);
  });

  test('if the worker dies mid-read, it says so, point picking works, and the next tap starts it again', async ({ page }) => {
    // Simulates the browser stopping the worker (once) while it reads a photo.
    await page.addInitScript(() => {
      const Real = window.Worker;
      let crashed = false;
      window.Worker = class extends Real {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        postMessage(message: any, transfer?: any) {
          if (message?.type === 'embed' && !crashed) {
            crashed = true;
            setTimeout(() => this.dispatchEvent(new ErrorEvent('error', { message: 'Worker stopped' })), 50);
            return;
          }
          super.postMessage(message, transfer ?? []);
        }
        set onerror(handler: ((e: ErrorEvent) => void) | null) {
          this.addEventListener('error', (e) => handler?.(e as ErrorEvent));
        }
      } as typeof Worker;
    });
    const errors = await openApp(page);
    const panel = await openWithPhoto(page);
    await panel.getByRole('radio', { name: 'Selecting an area (AI)' }).click();
    await panel.getByRole('button', { name: 'Download and turn on' }).click();
    await expect(panel.getByRole('alert')).toContainText('Area selection stopped', { timeout: 60_000 });
    await panel.getByRole('radio', { name: 'Tapping a point' }).click();
    await tapPhoto(panel, photo.taps.wall);
    await expect(panel.locator('.match-picked code')).toHaveText(/^#[0-9a-f]{6}$/);
    // Back to "Turn on" (not retried by itself); turning on again works.
    await panel.getByRole('radio', { name: 'Selecting an area (AI)' }).click();
    await panel.getByRole('button', { name: 'Turn on' }).click();
    await expect(panel.getByText('Tap the middle of the object or surface.')).toBeVisible({ timeout: 60_000 });
    await tapPhoto(panel, photo.taps.sofa);
    await suggested(panel);
    expect(errors).toEqual([]);
  });

  test('HEIC photos: opened where the browser can decode them, explained where it can’t, and exported', async ({ page, browserName }) => {
    const errors = await openApp(page);
    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: '3D View' }).click();
    await page.getByRole('button', { name: 'Match my room' }).click();
    const panel = page.getByRole('complementary', { name: 'Match my room' });
    const heic = readFileSync('e2e/fixtures/synthetic-room.heic');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), panel.getByRole('button', { name: /Add (a )?photo/ }).click()]);
    await chooser.setFiles({ name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: heic });
    const decoded = await panel.locator('canvas.match-photo').waitFor({ timeout: 10_000 }).then(() => true, () => false);
    if (browserName !== 'webkit') {
      // Chrome and Firefox can't decode HEIC: a clear message, nothing stored.
      expect(decoded).toBe(false);
      await expect(panel.getByText(/can’t open HEIC photos/)).toBeVisible();
      return;
    }
    expect(decoded).toBe(true);
    // Stored converted (upright, at most 1600 px) and carried by the exported project.
    const [download] = await Promise.all([page.waitForEvent('download'), (async () => {
      await page.getByRole('button', { name: /^Projects/ }).click();
      await page.getByRole('button', { name: 'Export file' }).click();
    })()]);
    const files = unzipSync(new Uint8Array(readFileSync((await download.path())!)));
    const assets = Object.keys(files).filter((f) => f.startsWith('assets/'));
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatch(/\.(png|webp|jpe?g)$/);
    expect(errors).toEqual([]);
  });

  test('a browser without the WebAssembly it needs is told so', async ({ page }) => {
    await page.addInitScript(() => {
      WebAssembly.validate = () => false;
    });
    await openApp(page);
    const panel = await openWithPhoto(page);
    await panel.getByRole('radio', { name: 'Selecting an area (AI)' }).click();
    await expect(panel.getByText(/too old \(no SIMD\)/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Download and turn on' })).toHaveCount(0);
  });
});

test.describe('Select an area on an iPhone-sized screen (Chromium emulation, not a real iPhone)', () => {
  test.setTimeout(120_000);
  const { defaultBrowserType: _browser, ...iPhone } = devices['iPhone 15'];
  test.use(iPhone);

  test('a wall: tap, measured colour, apply, undo', async ({ page }, info) => {
    const errors = await openApp(page);
    const panel = await openWithPhoto(page);
    const loadMs = await turnOn(panel);
    const before = (await exportProject(page)).room.wallColor;
    const t = Date.now();
    await tapPhoto(panel, photo.taps.wall);
    const hex = await suggested(panel);
    info.annotations.push({ type: 'timing', description: `load ${loadMs} ms, first tap ${Date.now() - t} ms` });
    expect(deltaE(hex, photo.colours.wall)).toBeLessThan(4);
    await panel.getByLabel('Apply to').selectOption('walls');
    await panel.getByRole('button', { name: 'Apply colour' }).click();
    expect((await exportProject(page)).room.wallColor).toBe(hex);
    await page.getByRole('button', { name: 'Undo' }).first().click();
    await expect.poll(async () => (await exportProject(page)).room.wallColor).toBe(before);
    expect(errors).toEqual([]);
  });
});
