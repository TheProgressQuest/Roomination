import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../model/types';
import { startOptimization, type OptimizationRun } from '../optimizer/client';
import type { OptimizeResult } from '../optimizer/optimize';

export type OptimizerRunState =
  | { phase: 'idle' }
  | { phase: 'running'; done: number; total: number }
  | { phase: 'done'; result: OptimizeResult; basis: Project }
  | { phase: 'failed'; message: string };

/**
 * Owns one optimization run at a time (in a Web Worker). Results remember the project
 * they were computed for, so the UI can tell when they've gone out of date.
 */
export function useOptimizer() {
  const [state, setState] = useState<OptimizerRunState>({ phase: 'idle' });
  const run = useRef<OptimizationRun | null>(null);

  const start = useCallback((project: Project, movableIds: string[]) => {
    run.current?.cancel();
    setState({ phase: 'running', done: 0, total: 1 });
    const current = startOptimization({ project, settings: project.optimizer, movableIds }, (done, total) => {
      if (run.current === current) setState({ phase: 'running', done, total });
    });
    run.current = current;
    current.result.then(
      (result) => {
        if (run.current !== current) return;
        run.current = null;
        setState(result.status === 'cancelled' ? { phase: 'idle' } : { phase: 'done', result, basis: project });
      },
      (error: Error) => {
        if (run.current !== current) return;
        run.current = null;
        setState({ phase: 'failed', message: error.message });
      },
    );
  }, []);

  const cancel = useCallback(() => {
    run.current?.cancel();
  }, []);

  const reset = useCallback(() => {
    run.current?.cancel();
    run.current = null;
    setState({ phase: 'idle' });
  }, []);

  // Stop any run if the app unmounts (e.g. switching projects reloads the page state).
  useEffect(() => () => run.current?.cancel(), []);

  return { state, start, cancel, reset };
}

/** True when the room or furniture changed after the suggestions were computed. */
export function isStale(basis: Project, now: Project): boolean {
  return basis.furniture !== now.furniture || basis.room !== now.room || basis.features !== now.features || basis.stairs !== now.stairs || basis.relationships !== now.relationships;
}
