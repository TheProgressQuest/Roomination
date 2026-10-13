/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import type { RGBAImage } from './imageOps';

/**
 * "Smart remove": finds the main object in a photo with U²-Net-p (Apache-2.0), run by
 * onnxruntime-web on WebAssembly inside this worker. The model and the runtime are files
 * of this website; the photo never leaves the device.
 */

// The runtime's files are bundled with the site (no CDN). Single-threaded: GitHub Pages
// can't send the headers multi-threaded WebAssembly needs.
ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
ort.env.wasm.numThreads = 1;

const SIZE = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let session: ort.InferenceSession | null = null;

export type SegmentMessage =
  | { type: 'progress'; stage: 'download' | 'prepare' | 'run'; fraction: number }
  | { type: 'done'; mask: Uint8Array }
  | { type: 'error'; message: string };

const post = (message: SegmentMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<{ image: RGBAImage; modelUrl: string }>) => {
  try {
    const { image, modelUrl } = event.data;
    if (!session) {
      const model = await download(modelUrl);
      post({ type: 'progress', stage: 'prepare', fraction: 0 });
      session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
    }
    post({ type: 'progress', stage: 'run', fraction: 0 });
    const input = new ort.Tensor('float32', toInput(image), [1, 3, SIZE, SIZE]);
    const output = await session.run({ [session.inputNames[0]]: input });
    const saliency = output[session.outputNames[0]].data as Float32Array;
    const mask = toMask(saliency, image.width, image.height);
    post({ type: 'done', mask }, [mask.buffer]);
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

/** Fetches the model from this site, reporting progress. */
async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`The model couldn’t be downloaded (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || 4_574_861;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    post({ type: 'progress', stage: 'download', fraction: Math.min(1, received / total) });
  }
  const model = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    model.set(chunk, offset);
    offset += chunk.length;
  }
  return model;
}

/** Resizes to 320 × 320 (bilinear) and normalises into planar RGB, as the network expects. */
function toInput(image: RGBAImage): Float32Array {
  const out = new Float32Array(3 * SIZE * SIZE);
  const { width: w, height: h, data } = image;
  for (let y = 0; y < SIZE; y++) {
    const sy = Math.min(h - 1, ((y + 0.5) * h) / SIZE - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = Math.max(0, sy - y0);
    for (let x = 0; x < SIZE; x++) {
      const sx = Math.min(w - 1, ((x + 0.5) * w) / SIZE - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = Math.max(0, sx - x0);
      for (let c = 0; c < 3; c++) {
        const a = data[(y0 * w + x0) * 4 + c] * (1 - fx) + data[(y0 * w + x1) * 4 + c] * fx;
        const b = data[(y1 * w + x0) * 4 + c] * (1 - fx) + data[(y1 * w + x1) * 4 + c] * fx;
        out[c * SIZE * SIZE + y * SIZE + x] = ((a * (1 - fy) + b * fy) / 255 - MEAN[c]) / STD[c];
      }
    }
  }
  return out;
}

/** Stretches the 320 × 320 saliency map to 0–255 and scales it back up to the photo's size. */
function toMask(saliency: Float32Array, width: number, height: number): Uint8Array {
  let min = Infinity;
  let max = -Infinity;
  for (const v of saliency) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(SIZE - 1, ((y + 0.5) * SIZE) / height - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(SIZE - 1, y0 + 1);
    const fy = Math.max(0, sy - y0);
    for (let x = 0; x < width; x++) {
      const sx = Math.min(SIZE - 1, ((x + 0.5) * SIZE) / width - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(SIZE - 1, x0 + 1);
      const fx = Math.max(0, sx - x0);
      const a = saliency[y0 * SIZE + x0] * (1 - fx) + saliency[y0 * SIZE + x1] * fx;
      const b = saliency[y1 * SIZE + x0] * (1 - fx) + saliency[y1 * SIZE + x1] * fx;
      mask[y * width + x] = Math.round((((a * (1 - fy) + b * fy) - min) / range) * 255);
    }
  }
  return mask;
}
