/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import type { RGBAImage } from './imageOps';
import type { ModelFile } from './areaSelectModel';
import { ModelFetchError, obtainModelFile, openModelCache } from './modelFetch';
import { candidateMasks, decoderPoints, encoderInput, type Candidate, type PromptPoint } from './sam';

/**
 * "Select an area": MobileSAM run by onnxruntime-web on WebAssembly in this worker, so the page
 * stays responsive. The model files come from this website, are checked against their SHA-256
 * and kept in the browser's Cache Storage; photos and masks never leave the device.
 */

// The engine's files are bundled with the site (no CDN); single-threaded, as GitHub Pages can't
// send the headers multi-threaded WebAssembly needs.
ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
ort.env.wasm.numThreads = 1;

export type AreaRequest =
  | { type: 'load'; id: number; files: { encoder: ModelFile & { url: string }; decoder: ModelFile & { url: string } } }
  | { type: 'embed'; id: number; key: string; image: RGBAImage }
  | { type: 'segment'; id: number; key: string; points: PromptPoint[]; width: number; height: number };

export type FailureKind = 'download' | 'integrity' | 'memory' | 'other';

export type AreaReply =
  | { type: 'progress'; id: number; loaded: number; total: number }
  | { type: 'loaded'; id: number; fromCache: boolean; ms: number }
  | { type: 'embedded'; id: number; ms: number }
  | { type: 'masks'; id: number; candidates: Candidate[]; ms: number }
  | { type: 'error'; id: number; kind: FailureKind; message: string };

let encoder: ort.InferenceSession | null = null;
let decoder: ort.InferenceSession | null = null;
/** Recent photos' embeddings (a few, so switching back is instant). */
const embeddings = new Map<string, ort.Tensor>();
const KEEP = 3;

const post = (reply: AreaReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(reply, transfer);

class Failure extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
  ) {
    super(message);
  }
}

const obtain = async (file: ModelFile & { url: string }, onProgress: (loaded: number) => void) => obtainModelFile(file, fetch, await openModelCache(), onProgress);

self.onmessage = async (event: MessageEvent<AreaRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'load') {
      const t = performance.now();
      const total = request.files.encoder.bytes + request.files.decoder.bytes;
      let done = 0;
      let cached = true;
      const fetchOne = async (file: ModelFile & { url: string }) => {
        const { bytes, fromCache } = await obtain(file, (loaded) => post({ type: 'progress', id: request.id, loaded: done + loaded, total }));
        done += file.bytes;
        cached &&= fromCache;
        return bytes;
      };
      const encoderBytes = await fetchOne(request.files.encoder);
      const decoderBytes = await fetchOne(request.files.decoder);
      encoder ??= await ort.InferenceSession.create(encoderBytes, { executionProviders: ['wasm'] });
      decoder ??= await ort.InferenceSession.create(decoderBytes, { executionProviders: ['wasm'] });
      post({ type: 'loaded', id: request.id, fromCache: cached, ms: performance.now() - t });
      return;
    }
    if (!encoder || !decoder) throw new Failure('other', 'The model isn’t loaded.');
    if (request.type === 'embed') {
      const t = performance.now();
      if (!embeddings.has(request.key)) {
        const input = encoderInput(request.image);
        const out = await encoder.run({ input_image: new ort.Tensor('float32', input.data, [input.height, input.width, 3]) });
        embeddings.set(request.key, out.image_embeddings);
        while (embeddings.size > KEEP) embeddings.delete(embeddings.keys().next().value!);
      }
      post({ type: 'embedded', id: request.id, ms: performance.now() - t });
      return;
    }
    const embedding = embeddings.get(request.key);
    if (!embedding) throw new Failure('other', 'This photo hasn’t been read yet.');
    const t = performance.now();
    const { coords, labels, count } = decoderPoints(request.points, request.width, request.height);
    const out = await decoder.run({
      image_embeddings: embedding,
      point_coords: new ort.Tensor('float32', coords, [1, count, 2]),
      point_labels: new ort.Tensor('float32', labels, [1, count]),
      mask_input: new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
      has_mask_input: new ort.Tensor('float32', new Float32Array([0]), [1]),
      // Only the low-resolution masks are used; the full-size output is kept small.
      orig_im_size: new ort.Tensor('float32', new Float32Array([256, 256]), [2]),
    });
    const candidates = candidateMasks(out.low_res_masks.data as Float32Array, out.iou_predictions.data as Float32Array, request.width, request.height);
    post({ type: 'masks', id: request.id, candidates, ms: performance.now() - t }, candidates.map((c) => c.mask.buffer));
  } catch (error) {
    const kind: FailureKind = error instanceof Failure || error instanceof ModelFetchError ? error.kind : /memory|allocation|OOM|out of bounds/i.test(String(error)) ? 'memory' : 'other';
    post({ type: 'error', id: request.id, kind, message: error instanceof Error ? error.message : String(error) });
  }
};
