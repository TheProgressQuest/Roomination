import { requestSaveNow } from '../state/saveNow';

/**
 * A safeguard for "Select an area" on devices short of memory. If iPhone Safari runs out of
 * memory while the model loads or reads a photo, it reloads the page; the feature is remembered
 * as on, so opening Match my room again would load it again, and could stop the page again.
 *
 * So the slow, memory-hungry steps leave a marker while they run. A marker still there when a
 * later page starts means the page ended during one of them (most likely a memory stop; also a
 * tab closed at that moment). After one, the feature waits to be turned on again; after two,
 * it's switched off on this device. The room planner, and picking colours by tapping a point,
 * are never affected. Stored in this browser only; any storage failure just disables the guard.
 */

const BUSY = 'roomination.areaSelect.busy';
const STOPS = 'roomination.areaSelect.stops';
/** A marker older than this when the page started isn't counted (it's from long ago). */
const WINDOW_MS = 10 * 60 * 1000;
export const STOPS_TO_DISABLE = 2;

let checked: number | null = null;

/** Marks the start of loading the model or reading a photo, saving the project first. */
export function beginHeavyWork() {
  requestSaveNow();
  try {
    localStorage.setItem(BUSY, String(Date.now()));
  } catch {
    /* storage blocked: no guard */
  }
}

/** Marks its end (finished, failed or cancelled: the page survived it). */
export function endHeavyWork() {
  try {
    localStorage.removeItem(BUSY);
  } catch {
    /* storage blocked: no guard */
  }
}

/** Unexplained stops so far on this device (checked once per page). */
export function unexplainedStops(now = performance.timeOrigin): number {
  if (checked !== null) return checked;
  try {
    let stops = Number(localStorage.getItem(STOPS)) || 0;
    const busy = Number(localStorage.getItem(BUSY));
    if (busy && busy <= now && now - busy < WINDOW_MS) {
      stops++;
      localStorage.setItem(STOPS, String(stops));
    }
    localStorage.removeItem(BUSY);
    checked = stops;
  } catch {
    checked = 0;
  }
  return checked;
}

/** A photo was read to the end: the device copes, so earlier stops are forgotten. */
export function clearStops() {
  checked = 0;
  try {
    localStorage.removeItem(STOPS);
  } catch {
    /* storage blocked */
  }
}

/** For tests: forget what this page already checked. */
export function resetGuardForTests() {
  checked = null;
}
