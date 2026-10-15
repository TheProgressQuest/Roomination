import { Suspense, lazy, useId, useRef, useState, type Dispatch, type KeyboardEvent, type ReactNode } from 'react';
import type { CatalogueItem } from '../catalogue/items';
import type { Conflict } from '../model/conflicts';
import { FEATURE_LABELS } from '../model/features';
import type { FeatureKind, Project } from '../model/types';
import { cmToInput, formatLength, inputToCm, inputUnitLabel } from '../model/units';
import { asRectangle, outlineSegments, roomArea, wallLabel, wallSegments } from '../model/walls';
import { PURPOSE_LABELS, guessPurpose } from '../optimizer/semantics';
import type { EditorAction } from '../state/editor';
import type { Preferences } from '../state/preferences';
import type { Selection } from '../state/selection';
import { FeatureButtons, FurnitureButtons, StairButtons, StructureButtons, type FurniturePreset } from './AddCatalog';
import { SnapOptions } from './DrawingBar';
import { BoardSettings, FloorSettings } from './AppearanceSettings';
import { ChecksList } from './ChecksList';
import { FengShuiPanel } from './FengShuiPanel';
import { CustomFurniturePanel } from './library/LibraryPanel';
import type { FurnitureTemplate } from '../storage/projectFile';
import { Icon, type IconName } from './Icon';
import { NumberField } from './NumberField';
import { SegmentedControl } from './SegmentedControl';

/** The furniture catalogue loads the first time the Furnish tab shows it. */
const CatalogueBrowser = lazy(() => import('../catalogue/CatalogueBrowser'));

interface ToolsPanelProps {
  project: Project;
  selection: Selection;
  conflicts: Conflict[];
  dispatch: Dispatch<EditorAction>;
  preferences: Preferences;
  onPreferences: (changes: Partial<Preferences>) => void;
  onAddFurniture: (preset: FurniturePreset) => void;
  /** Adds a custom or library piece. */
  onPlaceTemplate: (template: FurnitureTemplate) => void;
  onAddCatalogueItem: (item: CatalogueItem) => void;
  touch: boolean;
  onAddFeature: (kind: FeatureKind) => void;
  onAddStairs: (shape: 'straight' | 'L' | 'U' | 'custom') => void;
  onStartDrawing: (mode: 'drawRoom' | 'drawWall') => void;
  onSelect: (selection: Selection) => void;
  onOptimize: () => void;
  /** Tablet layout: lets the panel fold away to give the plan more room. */
  onCollapse?: () => void;
  /** While a layout is previewed, the panel can't be used (it would change the real project). */
  inert?: boolean;
}

export type ToolsTab = 'build' | 'furnish' | 'design' | 'optimize';

/** The four steps of planning a room, each with its simple controls open and the rest folded. */
const TABS: { id: ToolsTab; label: string; icon: IconName }[] = [
  { id: 'build', label: 'Build', icon: 'wall' },
  { id: 'furnish', label: 'Furnish', icon: 'plus' },
  { id: 'design', label: 'Design', icon: 'palette' },
  { id: 'optimize', label: 'Optimize', icon: 'sparkle' },
];

const TAB_KEY = 'roomination.toolsTab';

/** The last tab used on this device (a convenience only; Build if unknown or unavailable). */
function savedTab(): ToolsTab {
  try {
    const value = localStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.id === value) ? (value as ToolsTab) : 'build';
  } catch {
    return 'build';
  }
}

export function ToolsPanel(props: ToolsPanelProps) {
  const { project, selection, conflicts, dispatch } = props;
  const { room, units } = project;
  const unit = inputUnitLabel(units);
  const rect = asRectangle(room);
  const selectObject = (id: string) => props.onSelect({ kind: 'object', id });
  const warningIds = new Set(conflicts.filter((c) => !c.accepted).flatMap((c) => [c.itemId, c.otherId]));
  const openChecks = conflicts.filter((c) => !c.accepted).length;

  const [tab, setTab] = useState<ToolsTab>(savedTab);
  const tabsId = useId();
  const tabRefs = useRef<Partial<Record<ToolsTab, HTMLButtonElement | null>>>({});
  function choose(next: ToolsTab, focus = false) {
    setTab(next);
    if (focus) tabRefs.current[next]?.focus();
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // Storage blocked: the tab just isn't remembered.
    }
  }
  /** Arrow keys, Home and End move between tabs (the ARIA tabs pattern). */
  function onTabKey(e: KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === tab);
    const to = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i - 1 + TABS.length) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    choose(TABS[to].id, true);
  }

  return (
    <aside className="panel tools-panel" aria-label="Room and furniture tools" inert={props.inert}>
      <div className="tools-head">
        <div className="tools-tabs" role="tablist" aria-label="Tools" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`${tabsId}-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`${tabsId}-panel`}
              tabIndex={tab === t.id ? 0 : -1}
              className={tab === t.id ? 'is-active' : ''}
              onClick={() => choose(t.id)}
            >
              <Icon name={t.icon} size={16} />
              <span>{t.label}</span>
              {t.id === 'furnish' && openChecks > 0 && (
                <span className="tab-badge">
                  {openChecks}
                  <span className="visually-hidden"> to check</span>
                </span>
              )}
            </button>
          ))}
        </div>
        {props.onCollapse && (
          <button type="button" className="icon-button small" onClick={props.onCollapse} aria-label="Hide tools panel">
            <Icon name="panelLeft" />
          </button>
        )}
      </div>

      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`} className="tools-tab-panel">
        {tab === 'build' && (
          <>
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

            <Collapsible title="Doors, windows & features" defaultOpen>
              <FeatureButtons onAdd={props.onAddFeature} />
            </Collapsible>

            <Collapsible title="Stairs">
              <StairButtons onAdd={props.onAddStairs} />
            </Collapsible>

            <Collapsible title="Walls, features and stairs in this room" defaultOpen>
              <StructureList project={project} selection={selection} warningIds={warningIds} onSelect={props.onSelect} />
            </Collapsible>
          </>
        )}

        {tab === 'furnish' && (
          <>
            <Collapsible title="Furniture catalogue" defaultOpen>
              <Suspense fallback={<p className="hint">Loading the catalogue…</p>}>
                <CatalogueBrowser units={units} touch={props.touch} onAdd={props.onAddCatalogueItem} />
              </Suspense>
            </Collapsible>

            <Collapsible title="Quick add" defaultOpen={false}>
              <FurnitureButtons onAdd={props.onAddFurniture} />
            </Collapsible>

            <Collapsible title="Custom furniture & library" defaultOpen>
              <CustomFurniturePanel units={units} onPlace={props.onPlaceTemplate} />
            </Collapsible>

            <Collapsible title={`Checks${openChecks > 0 ? ` (${openChecks})` : ''}`} defaultOpen>
              <ChecksList project={project} conflicts={conflicts} onSelect={selectObject} />
            </Collapsible>

            <Collapsible title="Furniture in this room" defaultOpen>
              {project.furniture.length === 0 ? (
                <p className="hint">Nothing here yet. Add a piece above.</p>
              ) : (
                <ul className="object-list furniture-list">
                  {project.furniture.map((item) => (
                    <ObjectRow key={item.id} id={item.id} selected={isSelected(selection, 'object', item.id)} warning={warningIds.has(item.id)} onSelect={selectObject}>
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
          </>
        )}

        {tab === 'design' && (
          <>
            <Collapsible title="Presentation plan" defaultOpen>
              <PresentationSettings preferences={props.preferences} onPreferences={props.onPreferences} />
            </Collapsible>
            <Collapsible title="Floor & walls" defaultOpen>
              <FloorSettings project={project} dispatch={dispatch} />
            </Collapsible>
            <Collapsible title="Board & display" defaultOpen>
              <BoardSettings preferences={props.preferences} onPreferences={props.onPreferences} />
            </Collapsible>
            <p className="hint panel-note">Your floor, wall and furniture colours are your own: the light and dark themes never change them. The 3D view has its own options in its corner.</p>
          </>
        )}

        {tab === 'optimize' && (
          <>
            <Collapsible title="Find better layouts" defaultOpen>
              <p className="hint">
                Roomination tries many arrangements on this device and suggests a few, each explained and compared with your layout. Nothing changes until you apply
                one, and applying can be undone.
              </p>
              <p className="hint">
                Room treated as: <strong>{PURPOSE_LABELS[project.optimizer.purpose ?? guessPurpose(project)]}</strong>
                {project.optimizer.purpose ? '' : ' (guessed from the furniture; you can change it)'}
              </p>
              <button type="button" className="primary" onClick={props.onOptimize}>
                <Icon name="sparkle" size={16} /> Optimize layout…
              </button>
            </Collapsible>
            <Collapsible title="Feng Shui / Harmony (optional)" defaultOpen>
              <FengShuiPanel project={project} dispatch={dispatch} />
            </Collapsible>
          </>
        )}
      </div>

      <p className="panel-footer">
        Made by The Progress Quest · Your rooms stay on this device.
        <span className="app-version">
          Version {__APP_VERSION__} · {__BUILD_DATE__}
        </span>
      </p>
    </aside>
  );
}

const isSelected = (selection: Selection, kind: 'object' | 'wall', id: string) => selection?.kind === kind && selection.id === id;

const PRESENTATION_OPTIONS: { key: keyof Preferences['presentation']; label: string }[] = [
  { key: 'labels', label: 'Furniture labels' },
  { key: 'dimensions', label: 'Room dimensions' },
  { key: 'roomLabel', label: 'Room name and size' },
  { key: 'grid', label: 'Measurement grid' },
  { key: 'shadows', label: 'Soft shadows' },
  { key: 'editing', label: 'Editing aids (selection, handles, warnings)' },
];

/** The illustrated plan: on or off, and what it shows. */
function PresentationSettings({ preferences, onPreferences }: { preferences: Preferences; onPreferences: (changes: Partial<Preferences>) => void }) {
  const p = preferences.presentation;
  return (
    <>
      <SegmentedControl
        label="Plan style"
        value={preferences.planStyle}
        options={[
          { value: 'technical', label: 'Technical' },
          { value: 'presentation', label: 'Presentation' },
        ]}
        onChange={(planStyle) => onPreferences({ planStyle })}
      />
      <p className="hint">
        Presentation draws illustrated furniture, materials and soft shadows from the same geometry as the 3D view. Sizes and positions are exactly the same, and
        everything can still be selected and moved.
      </p>
      <fieldset className="option-list" disabled={preferences.planStyle !== 'presentation'}>
        <legend className="visually-hidden">Presentation plan shows</legend>
        {PRESENTATION_OPTIONS.map((o) => (
          <label key={o.key} className="toggle">
            <input type="checkbox" checked={p[o.key]} onChange={(e) => onPreferences({ presentation: { ...p, [o.key]: e.target.checked } })} />
            <span>{o.label}</span>
          </label>
        ))}
      </fieldset>
    </>
  );
}

/** Walls, room features and stairs, for selecting from a list (keyboard and screen readers). */
function StructureList(props: { project: Project; selection: Selection; warningIds: Set<string>; onSelect: (selection: Selection) => void }) {
  const { project, selection, warningIds } = props;
  const selectObject = (id: string) => props.onSelect({ kind: 'object', id });
  return (
    <>
      {project.features.length + project.stairs.length > 0 && (
        <ul className="object-list structure-list">
          {project.stairs.map((s) => (
            <ObjectRow key={s.id} id={s.id} selected={isSelected(selection, 'object', s.id)} warning={warningIds.has(s.id)} onSelect={selectObject}>
              <Icon name="stairs" size={14} />
              <span className="object-name">{s.name}</span>
              <span className="object-meta">Stairs</span>
            </ObjectRow>
          ))}
          {project.features.map((f) => (
            <ObjectRow key={f.id} id={f.id} selected={isSelected(selection, 'object', f.id)} warning={warningIds.has(f.id)} onSelect={selectObject}>
              <Icon name={f.kind} size={14} />
              <span className="object-name">{f.name}</span>
              <span className="object-meta">{FEATURE_LABELS[f.kind]}</span>
            </ObjectRow>
          ))}
        </ul>
      )}
      <h3 className="list-heading">Walls</h3>
      <ul className="object-list wall-list">
        {wallSegments(project.room).map((w) => (
          <ObjectRow key={w.id} id={w.id} selected={isSelected(selection, 'wall', w.id)} warning={warningIds.has(w.chain)} onSelect={(id) => props.onSelect({ kind: 'wall', id })}>
            <Icon name="wall" size={14} />
            <span className="object-name">{wallLabel(project.room, w.id)}</span>
            <span className="object-meta">{formatLength(w.length, project.units)}</span>
          </ObjectRow>
        ))}
      </ul>
    </>
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
