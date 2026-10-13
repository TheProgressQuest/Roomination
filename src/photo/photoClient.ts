import type { Point } from '../model/types';
import type { RGBAImage } from './imageOps';

/** Work handed to the photo worker (see photo.worker.ts). */
export type PhotoTask =
  | { kind: 'edgeColour'; image: RGBAImage; tolerance: number }
  | { kind: 'grow' | 'soften'; mask: Uint8Array; width: number; height: number; radius: number }
  | { kind: 'warp'; image: RGBAImage; corners: [Point, Point, Point, Point]; width: number; height: number };

export type PhotoTaskResult = { mask: Uint8Array } | { image: RGBAImage };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (r: PhotoTaskResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./photo.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; result?: PhotoTaskResult; error?: string }>) => {
    const job = pending.get(event.data.id);
    if (!job) return;
    pending.delete(event.data.id);
    if (event.data.error) job.reject(new Error(event.data.error));
    else job.resolve(event.data.result!);
  };
  return worker;
}

/** Runs a photo operation in the background worker. Inputs are copied, so callers keep theirs. */
export function runPhotoTask(task: PhotoTask): Promise<PhotoTaskResult> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, task });
  });
}

/** Stops the worker (e.g. when the photo tools close). Pending work is abandoned. */
export function stopPhotoWorker() {
  worker?.terminate();
  worker = null;
  for (const job of pending.values()) job.reject(new Error('Cancelled'));
  pending.clear();
}

export async function edgeColourMask(image: RGBAImage, tolerance: number): Promise<Uint8Array> {
  return ((await runPhotoTask({ kind: 'edgeColour', image, tolerance })) as { mask: Uint8Array }).mask;
}

export async function adjustMask(kind: 'grow' | 'soften', mask: Uint8Array, width: number, height: number, radius: number): Promise<Uint8Array> {
  return ((await runPhotoTask({ kind, mask, width, height, radius })) as { mask: Uint8Array }).mask;
}

export async function straighten(image: RGBAImage, corners: [Point, Point, Point, Point], width: number, height: number): Promise<RGBAImage> {
  return ((await runPhotoTask({ kind: 'warp', image, corners, width, height })) as { image: RGBAImage }).image;
}
