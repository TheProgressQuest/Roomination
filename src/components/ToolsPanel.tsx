import type { Dispatch, ReactNode } from 'react';
import type { Conflict } from '../model/conflicts';
import { FEATURE_LABELS } from '../model/features';
import type { FeatureKind, Project } from '../model/types';
import { cmToInput, formatLength, inputToCm, inputUnitLabel } from '../model/units';
import { asRectangle, outlineSegments, roomArea, wallLabel, wallSegments } from '../model/walls';
import type { EditorAction } from '../state/editor';
import type { Preferences } from '../state/preferences';
import type { Selection } from '../state/selection';
import { FeatureButtons, FurnitureButtons, StairButtons, StructureButtons, type FurniturePreset } from './AddCatalog';
import { SnapOptions } from './DrawingBar';
import { BoardSettings, FloorSettings } from './AppearanceSettings';
import { ChecksList } from './ChecksList';
import { Icon } from './Icon';
import { NumberField } from './NumberField';
import { SegmentedControl } from './SegmentedControl';

interface ToolsPanelProps {
  project: Project;
  selection: Selection;
  conflicts: Conflict[];
  dispatch: Dispatch<EditorAction>;
  preferences: Preferences;
  onPreferences: (changes: Partial<Preferences>) => void;
  onAddFurniture: (preset: FurniturePreset) => void;
  onAddFeature: (kind: FeatureKind) => void;
  onAddStairs: (shape: 'straight' | 'L' | 'U' | 'custom') => void;
  onStartDrawing: (mode: 'drawRoom' | 'drawWall') => void;
  onSelect: (selection: Selection) => void;
  /** Tablet layout: lets the panel fold away to give the plan more room. */
  onCollapse?: () => void;
  /** While a layout is previewed, the panel can't be used (it would change the real project). */
  inert?: boolean;
}

export function ToolsPanel(props: ToolsPanelProps) {
  const { project, selection, conflicts, dispatch } = props;
  const { room, units } = project;
  const unit = inputUnitLabel(units);
  const rect = asRectangle(room);
  const isSelected = (kind: 'object' | 'wall', id: string) => selection?.kind === kind && selection.id === id;
  const selectObject = (id: string) => props.onSelect({ kind: 'object', id });
  const warningIds = new Set(conflicts.filter((c) => !c.accepted).flatMap((c) => [c.itemId, c.otherId]));
  const openChecks = conflicts.filter((c) => !c.accepted).length;

  return (
    <aside className="panel tools-panel" aria-label="Room and furniture tools" inert={props.inert}>
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
        {rect ? (
          <div className="field-grid">
            <NumberField label="Width" suffix={unit} min={0} value={cmToInput(rect.width, units)} onCommit={(v) => dispatch({ type: 'room/resize', width: inputToCm(v, units), length: rect.length })} />
            <NumberField label="Length" suffix={unit} min={0} value={cmToInput(rect.length, units)} onCommit={(v) => dispatch({ type: 'room/resize', width: rect.width, length: inputToCm(v, units) })} />
            <NumberField label="Ceiling" suffix={unit} min={0} value={cmToInput(room.height, units)} onCommit={(v) => dispatch({ type: 'room/setHeight', height: inputToCm(v, units) })} />
          </div>
        ) : (
          <div className="field-grid">
            <NumberField label="Ceiling" suffix={unit} min={0} value={cmToInput(room.height, units)} onCommit={(v) => dispatch({ type: 'room/setHeight', height: inputToCm(v, units) })} />
          </div>
        )}
        <p className="hint">
          {rect ? `${formatLength(rect.width, units)} × ${formatLength(rect.length, units)}` : `Custom shape · ${room.outline.length} walls`} · {formatArea(roomArea(room), units)}
          {!rect && ' — edit it wall by wall.'}
        </p>
      </Collapsible>

      <Collapsible title="Walls" defaultOpen>
        <StructureButtons onDraw={props.onStartDrawing} />
        <button type="button" className="secondary" onClick={() => props.onSelect({ kind: 'wall', id: outlineSegments(room)[0].id })}>
          <Icon name="wall" size={16} /> Edit walls & corners
        </button>
        <p className="hint">Select any wall to change its length, angle or thickness, or drag its corners. Doors and windows move with their walls.</p>
        <SnapOptions snap={props.preferences.snap} onSnap={(snap) => props.onPreferences({ snap })} units={units} />
      </Collapsible>

      <Collapsible title="Stairs" defaultOpen>
        <StairButtons onAdd={props.onAddStairs} />
      </Collapsible>

      <Collapsible title="Room features" defaultOpen>
        <FeatureButtons onAdd={props.onAddFeature} />
      </Collapsible>

      <Collapsible title="Add furniture" defaultOpen>
        <FurnitureButtons onAdd={props.onAddFurniture} />
      </Collapsible>

      <Collapsible title={`Checks${openChecks > 0 ? ` (${openChecks})` : ''}`} defaultOpen>
        <ChecksList project={project} conflicts={conflicts} onSelect={selectObject} />
      </Collapsible>

      <Collapsible title="In this room" defaultOpen>
        {project.furniture.length + project.features.length + project.stairs.length === 0 ? (
          <p className="hint">Nothing here yet. Add a room feature or a piece of furniture above.</p>
        ) : (
          <ul className="object-list">
            {project.stairs.map((s) => (
              <ObjectRow key={s.id} id={s.id} selected={isSelected('object', s.id)} warning={warningIds.has(s.id)} onSelect={selectObject}>
                <Icon name="stairs" size={14} />
                <span className="object-name">{s.name}</span>
                <span className="object-meta">Stairs</span>
              </ObjectRow>
            ))}
            {project.features.map((f) => (
              <ObjectRow key={f.id} id={f.id} selected={isSelected('object', f.id)} warning={warningIds.has(f.id)} onSelect={selectObject}>
                <Icon name={f.kind} size={14} />
                <span className="object-name">{f.name}</span>
                <span className="object-meta">{FEATURE_LABELS[f.kind]}</span>
              </ObjectRow>
            ))}
            {project.furniture.map((item) => (
              <ObjectRow key={item.id} id={item.id} selected={isSelected('object', item.id)} warning={warningIds.has(item.id)} onSelect={selectObject}>
                <span className={`preset-swatch ${item.category === 'floorCovering' ? 'is-rug' : ''}`} style={{ background: item.color }} aria-hidden="true" />
                <span className="object-name">{item.name}</span>
                <span className="object-meta">
                  {formatLength(item.width, units)} × {formatLength(item.depth, units)}
                </span>
              </ObjectRow>
            ))}
          </ul>
        )}
        <h3 className="list-heading">Walls</h3>
        <ul className="object-list">
          {wallSegments(room).map((w) => (
            <ObjectRow key={w.id} id={w.id} selected={isSelected('wall', w.id)} warning={warningIds.has(w.chain)} onSelect={(id) => props.onSelect({ kind: 'wall', id })}>
              <Icon name="wall" size={14} />
              <span className="object-name">{wallLabel(room, w.id)}</span>
              <span className="object-meta">{formatLength(w.length, units)}</span>
            </ObjectRow>
          ))}
        </ul>
      </Collapsible>

      <Collapsible title="Floor & walls">
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

function formatArea(areaCm2: number, units: Project['units']): string {
  const squareMetres = areaCm2 / 10_000;
  if (units === 'metric') return `${squareMetres.toFixed(1)} m²`;
  return `${Math.round(squareMetres * 10.7639)} sq ft`;
}
