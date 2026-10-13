import type { UnitSystem } from './types';

/**
 * Conversion between the internal unit (cm) and what the user sees.
 * Conversions happen only at the edge of the UI; the model always stays in cm.
 */

export const CM_PER_INCH = 2.54;

/** Short label for input fields. Imperial inputs are entered in inches. */
export function inputUnitLabel(units: UnitSystem): string {
  return units === 'metric' ? 'cm' : 'in';
}

/** Converts cm into the number shown in an input field. */
export function cmToInput(cm: number, units: UnitSystem): number {
  const value = units === 'metric' ? cm : cm / CM_PER_INCH;
  return Math.round(value * 10) / 10;
}

/** Converts a number typed into an input field back into cm. */
export function inputToCm(value: number, units: UnitSystem): number {
  return units === 'metric' ? value : value * CM_PER_INCH;
}

/** Human-friendly label, e.g. "3.6 m", "85 cm", or "11′ 10″". */
export function formatLength(cm: number, units: UnitSystem): string {
  if (units === 'metric') {
    if (cm >= 100) return `${trimZeros((cm / 100).toFixed(2))} m`;
    return `${trimZeros(cm.toFixed(1))} cm`;
  }
  const totalInches = Math.round(cm / CM_PER_INCH);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  if (feet === 0) return `${inches}″`;
  return inches === 0 ? `${feet}′` : `${feet}′ ${inches}″`;
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/**
 * Grid spacing in cm, chosen so lines are neither cramped nor sparse at the
 * current zoom. Metric snaps to 10 cm / 50 cm / 1 m steps; imperial to 6 in / 1 ft.
 */
export function gridSpacing(units: UnitSystem, pixelsPerCm: number): { minor: number; major: number } {
  const minimumMinorPx = 8;
  const steps =
    units === 'metric'
      ? [
          { minor: 10, major: 100 },
          { minor: 50, major: 100 },
          { minor: 100, major: 500 },
          { minor: 500, major: 1000 },
        ]
      : [
          { minor: 6 * CM_PER_INCH, major: 12 * CM_PER_INCH },
          { minor: 12 * CM_PER_INCH, major: 60 * CM_PER_INCH },
          { minor: 60 * CM_PER_INCH, major: 120 * CM_PER_INCH },
          { minor: 120 * CM_PER_INCH, major: 600 * CM_PER_INCH },
        ];
  return steps.find((s) => s.minor * pixelsPerCm >= minimumMinorPx) ?? steps[steps.length - 1];
}
