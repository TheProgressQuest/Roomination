import { useId } from 'react';
import { FURNITURE_COLORS } from '../model/sample';
import type { Furniture, UnitSystem } from '../model/types';
import { cmToInput, inputToCm, inputUnitLabel } from '../model/units';
import { Icon } from './Icon';
import { NumberField } from './NumberField';

interface PropertiesPanelProps {
  item: Furniture | null;
  units: UnitSystem;
  onChange: (changes: Partial<Furniture>) => void;
  onDelete: () => void;
}

export function PropertiesPanel({ item, units, onChange, onDelete }: PropertiesPanelProps) {
  const nameId = useId();
  const unit = inputUnitLabel(units);

  if (!item) {
    return (
      <aside className="panel properties-panel" aria-label="Selected object properties">
        <section className="panel-section empty-state">
          <div className="empty-illustration" aria-hidden="true">🛋️</div>
          <h2>Nothing selected</h2>
          <p className="hint">
            Tap a piece of furniture on the plan, or pick one from the furniture list, to edit its size,
            position and rotation.
          </p>
          <ul className="shortcut-list">
            <li><kbd>Drag</kbd> move a piece</li>
            <li><kbd>Arrow keys</kbd> nudge 1 cm (Shift: 10 cm)</li>
            <li><kbd>R</kbd> rotate 90°</li>
            <li><kbd>Delete</kbd> remove</li>
            <li><kbd>Ctrl/⌘ Z</kbd> undo · <kbd>Shift</kbd> redo</li>
          </ul>
        </section>
      </aside>
    );
  }

  const length = (cm: number) => cmToInput(cm, units);
  const toCm = (value: number) => inputToCm(value, units);

  return (
    <aside className="panel properties-panel" aria-label="Selected object properties">
      <section className="panel-section">
        <h2>Furniture</h2>
        <div className="field">
          <label htmlFor={nameId}>Name</label>
          <input
            id={nameId}
            // Remount when the piece or its saved name changes (e.g. after undo).
            key={`${item.id}:${item.name}`}
            type="text"
            defaultValue={item.name}
            maxLength={60}
            onBlur={(e) => onChange({ name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </div>
      </section>

      <section className="panel-section">
        <h3>Size</h3>
        <div className="field-grid">
          <NumberField label="Width" suffix={unit} min={0} value={length(item.width)} onCommit={(v) => onChange({ width: toCm(v) })} />
          <NumberField label="Depth" suffix={unit} min={0} value={length(item.depth)} onCommit={(v) => onChange({ depth: toCm(v) })} />
          <NumberField label="Height" suffix={unit} min={0} value={length(item.height)} onCommit={(v) => onChange({ height: toCm(v) })} />
        </div>
      </section>

      <section className="panel-section">
        <h3>Position</h3>
        <p className="hint">Centre of the piece, measured from the top-left corner of the room.</p>
        <div className="field-grid two">
          <NumberField label="From left" suffix={unit} value={length(item.x)} onCommit={(v) => onChange({ x: toCm(v) })} />
          <NumberField label="From top" suffix={unit} value={length(item.y)} onCommit={(v) => onChange({ y: toCm(v) })} />
        </div>
      </section>

      <section className="panel-section">
        <h3>Rotation</h3>
        <div className="rotation-row">
          <NumberField
            label="Angle"
            suffix="°"
            value={Math.round(item.rotation * 10) / 10}
            onCommit={(v) => onChange({ rotation: v })}
          />
          <div className="button-row tight">
            <button type="button" className="icon-button" aria-label="Rotate 90° anticlockwise" onClick={() => onChange({ rotation: item.rotation - 90 })}>
              <Icon name="rotateLeft" />
            </button>
            <button type="button" className="icon-button" aria-label="Rotate 90° clockwise" onClick={() => onChange({ rotation: item.rotation + 90 })}>
              <Icon name="rotateRight" />
            </button>
          </div>
        </div>
      </section>

      <section className="panel-section">
        <h3>Colour</h3>
        <div className="swatch-row" role="radiogroup" aria-label="Colour">
          {FURNITURE_COLORS.map(({ name, value }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={item.color === value}
              aria-label={name}
              title={name}
              className={`swatch ${item.color === value ? 'is-active' : ''}`}
              style={{ background: value }}
              onClick={() => onChange({ color: value })}
            />
          ))}
        </div>
      </section>

      <section className="panel-section">
        <button type="button" className="danger" onClick={onDelete}>
          Delete {item.name}
        </button>
      </section>
    </aside>
  );
}
