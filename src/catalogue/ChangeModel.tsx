import { useId, useMemo, useState } from 'react';
import type { Furniture } from '../model/types';
import { fitTemplate } from './fit';
import { CATALOGUE, CATEGORY_LABELS, type CatalogueCategory } from './items';

/**
 * Shows a piece as a different catalogue model (a scanned "dresser" as a bathroom vanity)
 * without changing its size, position, turn or height above the floor. Loaded only when used.
 */
export default function ChangeModel({ item, onApply, onCancel }: { item: Furniture; onApply: (changes: Partial<Furniture>) => void; onCancel: () => void }) {
  const selectId = useId();
  const [choice, setChoice] = useState('');
  const groups = useMemo(() => {
    const map = new Map<CatalogueCategory, typeof CATALOGUE>();
    for (const c of CATALOGUE) map.set(c.category, [...(map.get(c.category) ?? []), c]);
    return [...map.entries()];
  }, []);

  function apply() {
    const picked = CATALOGUE.find((c) => c.id === choice);
    if (!picked) return;
    const t = fitTemplate(picked.make(), item);
    onApply({
      name: t.name,
      kind: t.kind,
      category: t.category,
      color: t.color,
      texture: t.texture,
      appearance: t.appearance,
      // Explicitly cleared when the new model has none, so nothing of the old one is left behind.
      components: t.components,
      shape: t.shape,
      // A light fitting brings its light; anything else has none.
      light: t.light,
    });
  }

  return (
    <div className="stack change-model">
      <div className="field">
        <label htmlFor={selectId}>New model</label>
        <select id={selectId} value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Choose a model…</option>
          {groups.map(([category, items]) => (
            <optgroup key={category} label={CATEGORY_LABELS[category]}>
              {items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <p className="hint">Keeps this piece’s size, position, turn and height above the floor (and any scanned measurements); only its look changes. Undo brings the old model back.</p>
      <div className="button-row">
        <button type="button" className="secondary small" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary small" disabled={!choice} onClick={apply}>
          Use this model
        </button>
      </div>
    </div>
  );
}
