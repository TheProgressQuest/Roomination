import type { OptimizeInput, OptimizeResult } from './optimize';
import type { WorkerMessage } from './worker';

export interface OptimizationRun {
  result: Promise<OptimizeResult>;
  /** Stops immediately. The promise then resolves with status "cancelled". */
  cancel: () => void;
}

/** Starts the optimizer in a Web Worker (bundled with the app — nothing is sent anywhere). */
export function startOptimization(input: OptimizeInput, onProgress: (done: number, total: number) => void): OptimizationRun {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let settle: (result: OptimizeResult) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const result = new Promise<OptimizeResult>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    if (message.type === 'progress') onProgress(message.done, message.total);
    else {
      worker.terminate();
      if (message.type === 'result') settle(message.result);
      else fail(new Error(message.message));
    }
  };
  worker.onerror = (event) => {
    worker.terminate();
    fail(new Error(event.message || 'The optimizer could not start.'));
  };
  worker.postMessage(input);
  return {
    result,
    cancel: () => {
      worker.terminate();
      settle({
        status: 'cancelled',
        message: 'Optimization was cancelled. Your layout hasn’t changed.',
        baseline: { scores: { overall: 0, functional: 0, aesthetic: 0, preferences: null, components: [] }, warnings: [], valid: true },
        suggestions: [],
        unmet: [],
        seed: input.settings.seed,
        algorithmVersion: 0,
      });
    },
  };
}
