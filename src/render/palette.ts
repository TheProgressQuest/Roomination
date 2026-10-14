import type { ResolvedTheme } from '../state/preferences';

/**
 * Colours used when drawing the floor plan canvas. (The HTML interface uses CSS
 * variables instead; the canvas can't read those, so it gets this object.)
 *
 * Furniture and floor colours are the user's own and never change with the theme.
 */
export interface CanvasPalette {
  wall: string;
  /** Measurement labels drawn on the board around the room. */
  label: string;
  gridMinor: string;
  gridMajor: string;
  selection: string;
  /** Unaccepted conflicts. */
  warning: string;
  warningFill: string;
  /** Overlaps the user accepted: still marked, but calmer. */
  accepted: string;
  /** Lines of architectural symbols drawn on the floor (door leaves, outlines…). */
  feature: string;
  /** Marks drawn inside a symbol's light fill (e.g. the slots of an outlet). */
  featureInk: string;
  featureFill: string;
  windowGlass: string;
  /** Ceiling items are drawn translucent and dashed so they read as "above". */
  ceiling: string;
  clearanceFill: string;
  clearanceStroke: string;
  shadow: string;
  /** The Bagua overlay: alternating translucent tints, its dashed lines and its labels. */
  baguaFillA: string;
  baguaFillB: string;
  baguaLine: string;
  baguaInk: string;
}

const LIGHT: CanvasPalette = {
  wall: '#141a24',
  label: '#4d5a6b',
  gridMinor: 'rgba(52, 81, 97, 0.13)',
  gridMajor: 'rgba(52, 81, 97, 0.26)',
  selection: '#1f2bd6',
  warning: '#c2410c',
  warningFill: 'rgba(220, 70, 30, 0.22)',
  accepted: '#b7791f',
  feature: '#4a5568',
  featureInk: '#3b4556',
  featureFill: '#e7ebf0',
  windowGlass: '#cfe6f5',
  ceiling: '#5b6ea8',
  clearanceFill: 'rgba(74, 85, 104, 0.08)',
  clearanceStroke: 'rgba(74, 85, 104, 0.45)',
  shadow: '#141a24',
  baguaFillA: 'rgba(31, 43, 214, 0.07)',
  baguaFillB: 'rgba(31, 43, 214, 0.13)',
  baguaLine: 'rgba(31, 43, 214, 0.45)',
  baguaInk: '#1a2499',
};

const DARK: CanvasPalette = {
  wall: '#d5dbe6',
  label: '#a9b4c6',
  gridMinor: 'rgba(52, 81, 97, 0.16)',
  gridMajor: 'rgba(52, 81, 97, 0.32)',
  selection: '#8d95ff',
  warning: '#ff6b3d',
  warningFill: 'rgba(255, 107, 61, 0.28)',
  accepted: '#f2b84b',
  feature: '#3b4556',
  featureInk: '#3b4556',
  featureFill: '#dfe5ee',
  windowGlass: '#9fd0f0',
  ceiling: '#8fa3e8',
  clearanceFill: 'rgba(143, 163, 232, 0.10)',
  clearanceStroke: 'rgba(160, 175, 230, 0.6)',
  shadow: '#000000',
  baguaFillA: 'rgba(31, 43, 214, 0.07)',
  baguaFillB: 'rgba(31, 43, 214, 0.13)',
  baguaLine: 'rgba(31, 43, 214, 0.45)',
  baguaInk: '#1a2499',
};

/** Lines drawn on a dark floor (e.g. dark walnut) switch to light ink so they stay visible. */
const ON_DARK_FLOOR: Partial<CanvasPalette> = {
  feature: '#e8edf5',
  gridMinor: 'rgba(255, 255, 255, 0.10)',
  gridMajor: 'rgba(255, 255, 255, 0.22)',
  clearanceFill: 'rgba(255, 255, 255, 0.10)',
  clearanceStroke: 'rgba(255, 255, 255, 0.6)',
  ceiling: '#b4c2f5',
  baguaFillA: 'rgba(160, 172, 255, 0.10)',
  baguaFillB: 'rgba(160, 172, 255, 0.18)',
  baguaLine: 'rgba(190, 198, 255, 0.6)',
  baguaInk: '#e3e7ff',
};

const ON_LIGHT_FLOOR: Partial<CanvasPalette> = {
  feature: LIGHT.feature,
  gridMinor: LIGHT.gridMinor,
  gridMajor: LIGHT.gridMajor,
  clearanceFill: LIGHT.clearanceFill,
  clearanceStroke: LIGHT.clearanceStroke,
  ceiling: LIGHT.ceiling,
  baguaFillA: LIGHT.baguaFillA,
  baguaFillB: LIGHT.baguaFillB,
  baguaLine: LIGHT.baguaLine,
  baguaInk: LIGHT.baguaInk,
};

export function canvasPalette(theme: ResolvedTheme, boardIsDark: boolean, floorColor: string): CanvasPalette {
  const base = theme === 'dark' ? DARK : LIGHT;
  return {
    ...base,
    // Labels and walls sit on the board, so they must contrast with the board itself.
    label: boardIsDark ? DARK.label : LIGHT.label,
    wall: boardIsDark ? DARK.wall : LIGHT.wall,
    // Symbols, grid and zones sit on the floor, so they follow the floor's brightness.
    ...(luminance(floorColor) < 0.18 ? ON_DARK_FLOOR : ON_LIGHT_FLOOR),
  };
}

/** Relative luminance (0 = black, 1 = white) of a #rrggbb colour. */
export function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Dark or light text, whichever reads better on `background`. */
export function readableText(background: string): string {
  return luminance(background) > 0.33 ? '#2b2420' : '#fffaf2';
}

/** Lightens (amount > 0) or darkens (amount < 0) a #rrggbb colour. */
export function shade(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value.slice(0, 6);
  const channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  const target = amount > 0 ? 255 : 0;
  const mixed = channels.map((c) => Math.round(c + (target - c) * Math.abs(amount)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
