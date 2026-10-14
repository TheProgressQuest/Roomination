import { describe, expect, it } from 'vitest';
import { rebalance } from './OptimizerDialog';

describe('custom weights', () => {
  const all = ['functional', 'aesthetic', 'fengShui'] as const;
  it('always add up to 100, sharing the difference in proportion', () => {
    const w = rebalance({ functional: 50, aesthetic: 25, fengShui: 25 }, 'functional', 70, [...all]);
    expect(w).toEqual({ functional: 70, aesthetic: 15, fengShui: 15 });
    const x = rebalance({ functional: 60, aesthetic: 40, fengShui: 0 }, 'fengShui', 20, [...all]);
    expect(x.functional + x.aesthetic + x.fengShui).toBe(100);
    expect(x).toEqual({ functional: 48, aesthetic: 32, fengShui: 20 });
  });

  it('splits evenly when the others were all zero, and leaves an unused weight alone', () => {
    expect(rebalance({ functional: 100, aesthetic: 0, fengShui: 0 }, 'functional', 40, [...all])).toEqual({ functional: 40, aesthetic: 30, fengShui: 30 });
    expect(rebalance({ functional: 50, aesthetic: 50, fengShui: 33 }, 'aesthetic', 80, ['functional', 'aesthetic'])).toEqual({ functional: 20, aesthetic: 80, fengShui: 33 });
  });
});
