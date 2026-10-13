import { optimize, type OptimizeInput, type OptimizeResult } from './optimize';

/**
 * Runs the optimizer off the main thread so the interface stays responsive.
 * Messages out: { type: 'progress', done, total } … then { type: 'result', result }.
 * Cancelling simply terminates the worker; nothing in the user's project is touched.
 */

export type WorkerMessage = { type: 'progress'; done: number; total: number } | { type: 'result'; result: OptimizeResult } | { type: 'error'; message: string };

const scope = self as unknown as { postMessage: (message: WorkerMessage) => void; onmessage: ((event: MessageEvent<OptimizeInput>) => void) | null };

scope.onmessage = (event) => {
  try {
    const result = optimize(event.data, (done, total) => scope.postMessage({ type: 'progress', done, total }));
    scope.postMessage({ type: 'result', result });
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'The optimizer stopped unexpectedly.' });
  }
};
