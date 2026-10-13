/// <reference lib="webworker" />
import { growMask, maskByEdgeColour, softenMask, warpPerspective } from './imageOps';
import type { PhotoTask, PhotoTaskResult } from './photoClient';

/**
 * Runs the heavier photo operations off the main thread so the page never freezes.
 * Everything stays in this browser tab; nothing is sent anywhere.
 */
self.onmessage = (event: MessageEvent<{ id: number; task: PhotoTask }>) => {
  const { id, task } = event.data;
  try {
    const result = run(task);
    const transfer = 'image' in result ? [result.image.data.buffer] : [result.mask.buffer];
    (self as unknown as Worker).postMessage({ id, result }, transfer);
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};

function run(task: PhotoTask): PhotoTaskResult {
  switch (task.kind) {
    case 'edgeColour':
      return { mask: maskByEdgeColour(task.image, task.tolerance) };
    case 'grow':
      return { mask: growMask(task.mask, task.width, task.height, task.radius) };
    case 'soften':
      return { mask: softenMask(task.mask, task.width, task.height, task.radius) };
    case 'warp':
      return { image: warpPerspective(task.image, task.corners, task.width, task.height) };
  }
}
