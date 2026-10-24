/**
 * Asks the app to save the open project at once, instead of after the usual short delay:
 * before work that may make a phone end the page (see App.tsx, which listens for it).
 */
export const SAVE_NOW_EVENT = 'roomination:save-now';

export function requestSaveNow() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SAVE_NOW_EVENT));
}
