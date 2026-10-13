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
 * Runs "Smart remove" in its own worker. The first run downloads the model and runtime
 * (about 19 MB, from this site) — the browser caches them afterwards. Cancel stops at once.
 */
export function smartRemove(image: RGBAImage, onProgress: (stage: 'download' | 'prepare' | 'run', fraction: number) => void): SegmentRun {
  const worker = new Worker(new URL('./segment.worker.ts', import.meta.url), { type: 'module' });
  let settle: { resolve: (m: Uint8Array) => void; reject: (e: Error) => void };
  const result = new Promise<Uint8Array>((resolve, reject) => {
    settle = { resolve, reject };
  });
  worker.onmessage = (event: MessageEvent<SegmentMessage>) => {
    const message = event.data;
    if (message.type === 'progress') onProgress(message.stage, message.fraction);
    else {
      worker.terminate();
      if (message.type === 'done') settle.resolve(message.mask);
      else settle.reject(new Error(message.message));
    }
  };
  worker.onerror = (event) => {
    worker.terminate();
    settle.reject(new Error(event.message || 'Smart remove couldn’t start in this browser.'));
  };
  worker.postMessage({ image, modelUrl: modelUrl() });
  return {
    result,
    cancel: () => {
      worker.terminate();
      settle.reject(new Error('Cancelled'));
    },
  };
}
