import type { RGBAImage } from './imageOps';
import { AREA_MODEL, MODEL_CACHE } from './areaSelectModel';
import type { AreaReply, AreaRequest, FailureKind } from './areaSelect.worker';
import type { Candidate, PromptPoint } from './sam';

/**
 * Talks to the "Select an area" worker. One worker at a time; the model stays loaded while it
 * lives. `cancel()` stops it at once (a download, or a photo being read), and the next request
 * starts a fresh one.
 */

export class AreaSelectError extends Error {
  constructor(
    readonly kind: FailureKind | 'cancelled' | 'unsupported',
    message: string,
  ) {
    super(message);
  }
}

/** Why this browser can't run it, or null if it can (WebAssembly with SIMD, and workers). */
export function unsupportedReason(): string | null {
  if (typeof Worker === 'undefined') return 'This browser can’t run background tasks (Web Workers).';
  if (typeof WebAssembly !== 'object') return 'This browser can’t run WebAssembly.';
  // A tiny module using a SIMD instruction (as the engine needs): Safari 16.4+, Chrome 91+, Firefox 89+.
  const simd = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
  try {
    if (!WebAssembly.validate(simd)) return 'This browser’s WebAssembly is too old (no SIMD). Update it, or tap a point instead.';
  } catch {
    return 'This browser can’t run WebAssembly.';
  }
  return null;
}

const fileUrl = (path: string) => new URL(`${import.meta.env.BASE_URL}${path}`, document.baseURI).href;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (reply: AreaReply) => void; reject: (error: AreaSelectError) => void; onProgress?: (loaded: number, total: number) => void }>();
let loaded = false;

function getWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('./areaSelect.worker.ts', import.meta.url), { type: 'module' });
  created.onmessage = (event: MessageEvent<AreaReply>) => {
    const reply = event.data;
    const job = pending.get(reply.id);
    if (!job) return;
    if (reply.type === 'progress') {
      job.onProgress?.(reply.loaded, reply.total);
      return;
    }
    pending.delete(reply.id);
    if (reply.type === 'error') job.reject(new AreaSelectError(reply.kind, reply.message));
    else job.resolve(reply);
  };
  created.onerror = (event) => {
    const message = event.message || 'Area selection couldn’t start in this browser.';
    stop();
    failAll(new AreaSelectError(/memory/i.test(message) ? 'memory' : 'other', message));
  };
  worker = created;
  return created;
}

function failAll(error: AreaSelectError) {
  for (const job of pending.values()) job.reject(error);
  pending.clear();
}

function stop() {
  worker?.terminate();
  worker = null;
  loaded = false;
}

function send<T extends AreaReply['type']>(request: Omit<AreaRequest, 'id'>, onProgress?: (loaded: number, total: number) => void, transfer: Transferable[] = []): Promise<Extract<AreaReply, { type: T }>> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (reply: AreaReply) => void, reject, onProgress });
    getWorker().postMessage({ ...request, id }, transfer);
  });
}

/** Downloads (or takes from the cache) and checks the model, and starts the engine. */
export async function loadAreaModel(onProgress: (loaded: number, total: number) => void): Promise<{ fromCache: boolean; ms: number }> {
  const reason = unsupportedReason();
  if (reason) throw new AreaSelectError('unsupported', reason);
  const files = { encoder: { ...AREA_MODEL.encoder, url: fileUrl(AREA_MODEL.encoder.path) }, decoder: { ...AREA_MODEL.decoder, url: fileUrl(AREA_MODEL.decoder.path) } };
  const reply = await send<'loaded'>({ type: 'load', files } as Omit<AreaRequest, 'id'>, onProgress);
  loaded = true;
  return { fromCache: reply.fromCache, ms: reply.ms };
}

export const isAreaModelLoaded = () => loaded;

/** Reads a photo (the slow step, once per photo: a few seconds). */
export async function embedPhoto(key: string, image: RGBAImage): Promise<number> {
  const reply = await send<'embedded'>({ type: 'embed', key, image } as Omit<AreaRequest, 'id'>);
  return reply.ms;
}

/** The candidate areas for these taps on a photo already read (quick). */
export async function segmentPhoto(key: string, points: PromptPoint[], width: number, height: number): Promise<{ candidates: Candidate[]; ms: number }> {
  const reply = await send<'masks'>({ type: 'segment', key, points, width, height } as Omit<AreaRequest, 'id'>);
  return { candidates: reply.candidates, ms: reply.ms };
}

/** Stops whatever is running (and frees the model's memory). */
export function cancelAreaSelect() {
  stop();
  failAll(new AreaSelectError('cancelled', 'Cancelled.'));
}

/** Whether the model is already downloaded and kept in this browser. */
export async function isAreaModelDownloaded(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open(MODEL_CACHE);
    return !!(await cache.match(fileUrl(AREA_MODEL.encoder.path))) && !!(await cache.match(fileUrl(AREA_MODEL.decoder.path)));
  } catch {
    return false;
  }
}

/** Turns the feature off: stops the worker and deletes the downloaded model from this browser. */
export async function removeAreaModel(): Promise<void> {
  cancelAreaSelect();
  try {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(MODEL_CACHE);
    await cache.delete(fileUrl(AREA_MODEL.encoder.path));
    await cache.delete(fileUrl(AREA_MODEL.decoder.path));
  } catch {
    /* nothing kept, or storage blocked: nothing to delete */
  }
}
