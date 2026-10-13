import type { RGBAImage } from './imageOps';
import type { SegmentMessage } from './segment.worker';

/** Where the bundled model lives on this website (never another server). */
export function modelUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}models/u2netp.onnx`, document.baseURI).href;
}

export interface SegmentRun {
  result: Promise<Uint8Array>;
  cancel: () => void;
}

/**
 * One worker is kept while the photo tools are open, so the model is loaded once and reused
 * for every photo. Cancelling stops the worker at once (the next run starts a fresh one).
 */
let worker: Worker | null = null;
let active: { resolve: (m: Uint8Array) => void; reject: (e: Error) => void; onProgress: (stage: 'download' | 'prepare' | 'run', fraction: number) => void } | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('./segment.worker.ts', import.meta.url), { type: 'module' });
  created.onmessage = (event: MessageEvent<SegmentMessage>) => {
    const message = event.data;
    if (!active) return;
    if (message.type === 'progress') {
      active.onProgress(message.stage, message.fraction);
      return;
    }
    const job = active;
    active = null;
    if (message.type === 'done') job.resolve(message.mask);
    else job.reject(new Error(message.message));
  };
  created.onerror = (event) => {
    const job = active;
    stopSmartRemove();
    job?.reject(new Error(event.message || 'Smart remove couldn’t start in this browser.'));
  };
  worker = created;
  return created;
}

/**
 * Runs "Smart remove". The first run downloads the model and runtime (about 19 MB, from
 * this site; the browser caches them afterwards). One run at a time.
 */
export function smartRemove(image: RGBAImage, onProgress: (stage: 'download' | 'prepare' | 'run', fraction: number) => void): SegmentRun {
  if (active) active.reject(new Error('Cancelled'));
  const result = new Promise<Uint8Array>((resolve, reject) => {
    active = { resolve, reject, onProgress };
  });
  getWorker().postMessage({ image, modelUrl: modelUrl() });
  return {
    result,
    cancel: () => {
      const job = active;
      stopSmartRemove();
      job?.reject(new Error('Cancelled'));
    },
  };
}

/** Stops the worker and frees the model (when the photo tools close, or on cancel). */
export function stopSmartRemove() {
  worker?.terminate();
  worker = null;
  active = null;
}
