import { beforeEach, describe, expect, it } from 'vitest';
import { beginHeavyWork, clearStops, endHeavyWork, resetGuardForTests, STOPS_TO_DISABLE, unexplainedStops } from './areaSelectGuard';

/** A page "load" at `at` ms: the guard checks once per page. */
const newPage = (at: number) => {
  resetGuardForTests();
  return unexplainedStops(at);
};

describe('the safeguard against memory stops', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    } as Storage;
    resetGuardForTests();
  });

  it('counts a page that ended while the model was loading or reading', () => {
    beginHeavyWork(); // ... and the page is reloaded before endHeavyWork()
    const stops = newPage(Date.now() + 1000);
    expect(stops).toBe(1);
    // Checked once per page; the marker is cleared.
    expect(unexplainedStops(Date.now() + 2000)).toBe(1);
    expect(newPage(Date.now() + 3000)).toBe(1);
  });

  it('doesn’t count work that finished, failed or was cancelled', () => {
    beginHeavyWork();
    endHeavyWork();
    expect(newPage(Date.now() + 1000)).toBe(0);
  });

  it('switches off after repeated stops, and forgets them after a photo is read', () => {
    beginHeavyWork();
    newPage(Date.now() + 1000);
    beginHeavyWork();
    expect(newPage(Date.now() + 2000)).toBe(STOPS_TO_DISABLE);
    clearStops();
    expect(newPage(Date.now() + 3000)).toBe(0);
  });

  it('ignores a marker from long ago, or from after the page started', () => {
    beginHeavyWork();
    expect(newPage(Date.now() + 60 * 60 * 1000)).toBe(0);
    beginHeavyWork();
    expect(newPage(Date.now() - 1000)).toBe(0);
  });

  it('does nothing when storage is blocked', () => {
    globalThis.localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(() => beginHeavyWork()).not.toThrow();
    expect(newPage(Date.now())).toBe(0);
  });
});
