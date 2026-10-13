import { useId, useState } from 'react';

interface NumberFieldProps {
  label: string;
  /** The value as shown to the user (already converted to display units). */
  value: number;
  /** Unit suffix shown inside the field, e.g. "cm" or "°". */
  suffix?: string;
  step?: number;
  min?: number;
  /** Called with the parsed number when the user presses Enter or leaves the field. */
  onCommit: (value: number) => void;
}

/**
 * A number input that keeps a draft while the user is typing and only commits on
 * Enter or blur, so each edit becomes one undo step. Escape discards the draft.
 * When not editing it always shows the real value, so drags, undo and rejected
 * edits are reflected immediately.
 */
export function NumberField({ label, value, suffix, step = 1, min, onCommit }: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft === null) return;
    const parsed = Number.parseFloat(draft.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed);
    setDraft(null);
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-input">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          value={draft ?? String(value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setDraft(null);
          }}
        />
        {suffix && <span className="field-suffix" aria-hidden="true">{suffix}</span>}
      </div>
    </div>
  );
}
