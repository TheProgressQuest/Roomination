import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Display preferences: how the app looks on this device, never part of a project.
 * Stored in localStorage; changing them can never alter room geometry.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';
export type BoardStyle = 'solid' | 'dots' | 'squares' | 'graph' | 'drafting';

export interface BoardPreferences {
  style: BoardStyle;
  /** null = follow the theme's default board colour. */
  color: string | null;
  showGrid: boolean;
  /** Board grid spacing in screen pixels (purely decorative). */
  spacing: number;
  /** 0–1 */
  opacity: number;
}

export interface Preferences {
  theme: ThemePreference;
  board: BoardPreferences;
  /** The real-world measurement grid drawn on the room floor. */
  showMeasurementGrid: boolean;
  /** Shaded keep-clear zones around doors, vents, outlets, … */
  showClearances: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  board: { style: 'dots', color: null, showGrid: true, spacing: 18, opacity: 0.5 },
  showMeasurementGrid: true,
  showClearances: true,
};

const STORAGE_KEY = 'roomination.preferences';
const BOARD_STYLES: BoardStyle[] = ['solid', 'dots', 'squares', 'graph', 'drafting'];

function readPreferences(): Preferences {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFERENCES;
    const board = typeof raw.board === 'object' && raw.board !== null ? raw.board : {};
    const d = DEFAULT_PREFERENCES;
    return {
      theme: ['light', 'dark', 'system'].includes(raw.theme) ? raw.theme : d.theme,
      board: {
        style: BOARD_STYLES.includes(board.style) ? board.style : d.board.style,
        color: typeof board.color === 'string' && /^#[0-9a-f]{6}$/i.test(board.color) ? board.color : null,
        showGrid: typeof board.showGrid === 'boolean' ? board.showGrid : d.board.showGrid,
        spacing: inRange(board.spacing, 8, 64) ? board.spacing : d.board.spacing,
        opacity: inRange(board.opacity, 0, 1) ? board.opacity : d.board.opacity,
      },
      showMeasurementGrid: typeof raw.showMeasurementGrid === 'boolean' ? raw.showMeasurementGrid : d.showMeasurementGrid,
      showClearances: typeof raw.showClearances === 'boolean' ? raw.showClearances : d.showClearances,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function usePreferences(): [Preferences, (changes: Partial<Preferences>) => void] {
  const [preferences, setPreferences] = useState(readPreferences);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Storage blocked: preferences just won't persist.
    }
  }, [preferences]);

  const update = useCallback((changes: Partial<Preferences>) => setPreferences((p) => ({ ...p, ...changes })), []);
  return [preferences, update];
}

/** Resolves "system" against the OS setting and applies the theme to the page. */
export function useResolvedTheme(preference: ThemePreference): ResolvedTheme {
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const theme: ResolvedTheme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1c1916' : '#fbf4ea');
  }, [theme]);
  return theme;
}

/** True while a CSS media query matches; updates live (e.g. on rotation or resize). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
