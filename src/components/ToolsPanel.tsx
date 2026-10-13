import type { Furniture, Project, Room, UnitSystem } from '../model/types';
import { cmToInput, formatLength, inputToCm, inputUnitLabel } from '../model/units';
import { NumberField } from './NumberField';

/** Quick-add shapes. All are simple rectangles in Phase 1; sizes in cm. */
export const FURNITURE_PRESETS: Pick<Furniture, 'name' | 'width' | 'depth' | 'height' | 'color'>[] = [
  { name: 'Rectangle', width: 80, depth: 50, height: 75, color: '#e9a178' },
  { name: 'Sofa', width: 200, depth: 90, height: 85, color: '#e9a178' },
  { name: 'Bed', width: 160, depth: 200, height: 50, color: '#9bb7d4' },
  { name: 'Table', width: 120, depth: 80, height: 75, color: '#f2c879' },
  { name: 'Desk', width: 120, depth: 60, height: 75, color: '#c9a7d8' },
  { name: 'Chair', width: 50, depth: 50, height: 90, color: '#8fb996' },
];

interface ToolsPanelProps {
  project: Project;
  selectedId: string | null;
  onResizeRoom: (room: Partial<Room>) => void;
  onSetUnits: (units: UnitSystem) => void;
  onAddPreset: (preset: (typeof FURNITURE_PRESETS)[number]) => void;
  onSelect: (id: string) => void;
  onLoadSample: () => void;
  onNewRoom: () => void;
}

export function ToolsPanel({
  project,
  selectedId,
  onResizeRoom,
  onSetUnits,
  onAddPreset,
  onSelect,
  onLoadSample,
  onNewRoom,
}: ToolsPanelProps) {
  const { room, units } = project;
  const unit = inputUnitLabel(units);

  return (
    <aside className="panel tools-panel" aria-label="Room and furniture tools">
      <section className="panel-section">
        <h2>Room</h2>
        <div className="unit-toggle" role="radiogroup" aria-label="Measurement units">
          {(['metric', 'imperial'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={units === option}
              className={units === option ? 'is-active' : ''}
              onClick={() => onSetUnits(option)}
            >
              {option === 'metric' ? 'cm' : 'ft / in'}
            </button>
          ))}
        </div>
        <div className="field-grid">
          <NumberField
            label="Width"
            suffix={unit}
            min={0}
            value={cmToInput(room.width, units)}
            onCommit={(v) => onResizeRoom({ width: inputToCm(v, units) })}
          />
          <NumberField
            label="Length"
            suffix={unit}
            min={0}
            value={cmToInput(room.length, units)}
            onCommit={(v) => onResizeRoom({ length: inputToCm(v, units) })}
          />
          <NumberField
            label="Ceiling"
            suffix={unit}
            min={0}
            value={cmToInput(room.height, units)}
            onCommit={(v) => onResizeRoom({ height: inputToCm(v, units) })}
          />
        </div>
        <p className="hint">
          {formatLength(room.width, units)} × {formatLength(room.length, units)} ·{' '}
          {formatArea(room, units)}
        </p>
      </section>

      <section className="panel-section">
        <h2>Add furniture</h2>
        <div className="preset-grid">
          {FURNITURE_PRESETS.map((preset) => (
            <button key={preset.name} type="button" className="preset" onClick={() => onAddPreset(preset)}>
              <span className="preset-swatch" style={{ background: preset.color }} aria-hidden="true" />
              {preset.name}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h2>In this room</h2>
        {project.furniture.length === 0 ? (
          <p className="hint">Nothing here yet. Add a piece above to get started.</p>
        ) : (
          <ul className="furniture-list">
            {project.furniture.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={item.id === selectedId}
                  className={item.id === selectedId ? 'is-selected' : ''}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="preset-swatch" style={{ background: item.color }} aria-hidden="true" />
                  <span className="furniture-list-name">{item.name}</span>
                  <span className="furniture-list-size">
                    {formatLength(item.width, units)} × {formatLength(item.depth, units)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-section">
        <h2>Project</h2>
        <div className="button-row">
          <button type="button" className="secondary" onClick={onLoadSample}>
            Load sample room
          </button>
          <button type="button" className="secondary" onClick={onNewRoom}>
            Start empty room
          </button>
        </div>
        <p className="hint">Both can be undone.</p>
      </section>
    </aside>
  );
}

function formatArea(room: Room, units: UnitSystem): string {
  const squareMetres = (room.width * room.length) / 10_000;
  if (units === 'metric') return `${squareMetres.toFixed(1)} m²`;
  return `${Math.round(squareMetres * 10.7639)} sq ft`;
}
