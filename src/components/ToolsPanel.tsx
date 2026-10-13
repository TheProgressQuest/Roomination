import type { Dispatch, ReactNode } from 'react';
import type { Conflict } from '../model/conflicts';
import { FEATURE_LABELS } from '../model/features';
import type { FeatureKind, Project, Room } from '../model/types';
import { cmToInput, formatLength, inputToCm, inputUnitLabel } from '../model/units';
import type { EditorAction } from '../state/editor';
import type { Preferences } from '../state/preferences';
import { FeatureButtons, FurnitureButtons, type FurniturePreset } from './AddCatalog';
import { BoardSettings, FloorSettings } from './AppearanceSettings';
import { ChecksList } from './ChecksList';
import { Icon } from './Icon';
import { NumberField } from './NumberField';
import { SegmentedControl } from './SegmentedControl';

interface ToolsPanelProps {
  project: Project;
  selectedId: string | null;
  conflicts: Conflict[];
  dispatch: Dispatch<EditorAction>;
  preferences: Preferences;
  onPreferences: (changes: Partial<Preferences>) => void;
  onAddFurniture: (preset: FurniturePreset) => void;
  onAddFeature: (kind: FeatureKind) => void;
  onSelect: (id: string) => void;
  /** Tablet layout: lets the panel fold away to give the plan more room. */
  onCollapse?: () => void;
}

export function ToolsPanel(props: ToolsPanelProps) {
  const { project, selectedId, conflicts, dispatch } = props;
  const { room, units } = project;
  const unit = inputUnitLabel(units);
  const resize = (changes: Partial<Room>) => dispatch({ type: 'room/resize', room: changes });
  const warningIds = new Set(conflicts.filter((c) => !c.accepted).flatMap((c) => [c.itemId, c.otherId]));
  const openChecks = conflicts.filter((c) => !c.accepted).length;

  return (
    <aside className="panel tools-panel" aria-label="Room and furniture tools">
      {props.onCollapse && (
        <div className="panel-toolbar">
          <button type="button" className="icon-button" onClick={props.onCollapse} aria-label="Hide tools panel">
            <Icon name="panelLeft" />
          </button>
        </div>
      )}

      <Collapsible title="Room" defaultOpen>
        <SegmentedControl
          label="Units"
          hideLabel
          value={units}
          options={[
            { value: 'metric', label: 'cm' },
            { value: 'imperial', label: 'ft / in' },
          ]}
          onChange={(value) => dispatch({ type: 'units/set', units: value })}
        />
        <div className="field-grid">
          <NumberField label="Width" suffix={unit} min={0} value={cmToInput(room.width, units)} onCommit={(v) => resize({ width: inputToCm(v, units) })} />
          <NumberField label="Length" suffix={unit} min={0} value={cmToInput(room.length, units)} onCommit={(v) => resize({ length: inputToCm(v, units) })} />
          <NumberField label="Ceiling" suffix={unit} min={0} value={cmToInput(room.height, units)} onCommit={(v) => resize({ height: inputToCm(v, units) })} />
        </div>
        <p className="hint">
          {formatLength(room.width, units)} × {formatLength(room.length, units)} · {formatArea(room, units)}
        </p>
      </Collapsible>

      <Collapsible title="Room features" defaultOpen>
        <FeatureButtons onAdd={props.onAddFeature} />
      </Collapsible>

      <Collapsible title="Add furniture" defaultOpen>
        <FurnitureButtons onAdd={props.onAddFurniture} />
      </Collapsible>

      <Collapsible title={`Checks${openChecks > 0 ? ` (${openChecks})` : ''}`} defaultOpen>
        <ChecksList project={project} conflicts={conflicts} onSelect={props.onSelect} />
      </Collapsible>

      <Collapsible title="In this room" defaultOpen>
        {project.furniture.length + project.features.length === 0 ? (
          <p className="hint">Nothing here yet. Add a room feature or a piece of furniture above.</p>
        ) : (
          <ul className="object-list">
            {project.features.map((f) => (
              <ObjectRow key={f.id} id={f.id} selected={f.id === selectedId} warning={warningIds.has(f.id)} onSelect={props.onSelect}>
                <Icon name={f.kind} size={14} />
                <span className="object-name">{f.name}</span>
                <span className="object-meta">{FEATURE_LABELS[f.kind]}</span>
              </ObjectRow>
            ))}
            {project.furniture.map((item) => (
              <ObjectRow key={item.id} id={item.id} selected={item.id === selectedId} warning={warningIds.has(item.id)} onSelect={props.onSelect}>
                <span className={`preset-swatch ${item.category === 'floorCovering' ? 'is-rug' : ''}`} style={{ background: item.color }} aria-hidden="true" />
                <span className="object-name">{item.name}</span>
                <span className="object-meta">
                  {formatLength(item.width, units)} × {formatLength(item.depth, units)}
                </span>
              </ObjectRow>
            ))}
          </ul>
        )}
      </Collapsible>

      <Collapsible title="Floor">
        <FloorSettings project={project} dispatch={dispatch} />
      </Collapsible>

      <Collapsible title="Board & display">
        <BoardSettings preferences={props.preferences} onPreferences={props.onPreferences} />
      </Collapsible>

      <p className="panel-footer">
        Made by The Progress Quest · Your rooms stay on this device.
      </p>
    </aside>
  );
}

function Collapsible({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="panel-section collapsible" open={defaultOpen}>
      <summary>
        <h2>{title}</h2>
      </summary>
      <div className="stack">{children}</div>
    </details>
  );
}

function ObjectRow(props: { id: string; selected: boolean; warning: boolean; onSelect: (id: string) => void; children: ReactNode }) {
  return (
    <li>
      <button type="button" aria-pressed={props.selected} className={props.selected ? 'is-selected' : ''} onClick={() => props.onSelect(props.id)}>
        {props.children}
        {props.warning && (
          <span className="row-warning" title="Has an overlap">
            <Icon name="warning" size={14} />
            <span className="visually-hidden">Has an overlap</span>
          </span>
        )}
      </button>
    </li>
  );
}

function formatArea(room: Room, units: Project['units']): string {
  const squareMetres = (room.width * room.length) / 10_000;
  if (units === 'metric') return `${squareMetres.toFixed(1)} m²`;
  return `${Math.round(squareMetres * 10.7639)} sq ft`;
}
