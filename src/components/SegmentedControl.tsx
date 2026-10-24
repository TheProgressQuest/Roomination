import { useId } from 'react';

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  /** `disabled` options are shown (so it's clear they exist) but can't be chosen; `hint` says why. */
  options: { value: T; label: string; disabled?: boolean; hint?: string }[];
  onChange: (value: T) => void;
  /** Hide the visible label (it is still announced to screen readers). */
  hideLabel?: boolean;
}

/** A small set of mutually exclusive choices, e.g. "Swing: In / Out". */
export function SegmentedControl<T extends string>({ label, value, options, onChange, hideLabel }: SegmentedControlProps<T>) {
  const labelId = useId();
  return (
    <div className="field">
      <span id={labelId} className={hideLabel ? 'visually-hidden' : 'field-label'}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={labelId}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            aria-disabled={option.disabled || undefined}
            title={option.hint}
            className={value === option.value ? 'is-active' : ''}
            onClick={() => !option.disabled && onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
