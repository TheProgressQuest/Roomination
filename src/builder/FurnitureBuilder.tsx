import { Suspense, lazy, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { NumberField } from '../components/NumberField';
import { SegmentedControl } from '../components/SegmentedControl';
import {
  COMPONENT_TYPE_LABELS,
  MAX_COMPONENTS,
  componentExtent,
  componentId,
  componentPoints,
  duplicateComponent,
  groupComponents,
  placeComponents,
  removeComponent,
  reorderComponent,
  ungroupComponents,
  withDescendants,
  type PlacedComponent,
} from '../model/components';
import { FURNITURE_KIND_LABELS } from '../model/furnitureKinds';
import { localFootprint, ringsSvgPath } from '../model/shape';
import type {
  ComponentEdgeStyle,
  ComponentShape,
  ComponentType,
  FurnitureComponent,
  FurnitureKind,
  FurnitureShape,
  MaterialKind,
  Point,
  SeamStyle,
  SurfaceFinish,
  UnitSystem,
  UpholsteryPattern,
} from '../model/types';
import { cmToInput, formatLength, inputToCm, inputUnitLabel } from '../model/units';
import { shade } from '../render/palette';
import { centred, curvedOutline, footprintEdges, recomputeComponents } from './componentGeometry';
import { PRESETS, buildPreset, type PresetId } from './furniturePresets';

/**
 * The Advanced Furniture Builder: build a piece from components (base, seat, backrest,
 * arms, cushions, pillows, legs, tops, shelves, doors…) on top of its footprint. Seen from
 * above and from the front, with an optional live 3D preview. Nothing changes in the project
 * until Save, which applies everything as one undoable step.
 *
 * The footprint (drawn in the furniture studio, or width × depth) stays what collisions and
 * the optimizer use. Components that reach outside it are listed, never silently allowed or
 * fixed: the person decides.
 */

const Preview3D = lazy(() => import('./BuilderPreview3D'));

export interface BuilderPiece {
  name: string;
  kind: FurnitureKind;
  color: string;
  material: MaterialKind;
  finish: SurfaceFinish;
  width: number;
  depth: number;
  height: number;
  shape?: FurnitureShape;
  components: FurnitureComponent[];
}

interface Props {
  title: string;
  initial: BuilderPiece;
  units: UnitSystem;
  touch: boolean;
  /** Offer the templates first (a new piece). */
  startWithTemplates?: boolean;
  /** Editing a piece already in the room: templates are built onto its own footprint and height by default. */
  existing?: boolean;
  saveLabel: string;
  /** Applies the result; resolves to a reason if it couldn't be applied (the builder stays open). */
  onSave: (piece: BuilderPiece) => Promise<string | null>;
  onCancel: () => void;
}

const TYPES = (Object.keys(COMPONENT_TYPE_LABELS) as ComponentType[]).filter((t) => t !== 'group');
const SHAPES: { value: ComponentShape; label: string }[] = [
  { value: 'box', label: 'Box (rounded or bevelled)' },
  { value: 'cylinder', label: 'Cylinder / ellipse' },
  { value: 'ellipsoid', label: 'Soft round (pillow)' },
  { value: 'polygon', label: 'Polygon outline' },
  { value: 'curved', label: 'Curved panel' },
  { value: 'edge', label: 'Follows footprint edges' },
  { value: 'footprint', label: 'Fills the footprint' },
];
const MATERIALS: { value: MaterialKind | 'piece'; label: string }[] = [
  { value: 'piece', label: 'Same as the piece' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'cotton', label: 'Cotton' },
  { value: 'linen', label: 'Linen' },
  { value: 'velvet', label: 'Velvet' },
  { value: 'leather', label: 'Leather' },
  { value: 'wood', label: 'Wood' },
  { value: 'metal', label: 'Metal' },
  { value: 'stone', label: 'Stone' },
  { value: 'ceramic', label: 'Ceramic' },
  { value: 'glass', label: 'Glass' },
  { value: 'plastic', label: 'Plastic' },
  { value: 'water', label: 'Water (baths, hot tubs)' },
  { value: 'mirror', label: 'Mirror' },
  { value: 'custom', label: 'Custom (plain)' },
];
const PATTERNS: { value: UpholsteryPattern; label: string }[] = [
  { value: 'plain', label: 'Plain' },
  { value: 'stripes', label: 'Stripes' },
  { value: 'check', label: 'Check' },
  { value: 'herringbone', label: 'Herringbone' },
  { value: 'boucle', label: 'Bouclé' },
];
const SEAMS: { value: SeamStyle; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'piped', label: 'Piped' },
  { value: 'stitched', label: 'Stitched' },
  { value: 'tufted', label: 'Tufted' },
];
const EDGE_STYLES: { value: ComponentEdgeStyle; label: string }[] = [
  { value: 'rounded', label: 'Rounded' },
  { value: 'bevel', label: 'Bevelled' },
  { value: 'square', label: 'Square' },
];
const FINISHES: { value: SurfaceFinish; label: string }[] = [
  { value: 'matte', label: 'Matte' },
  { value: 'satin', label: 'Satin' },
  { value: 'gloss', label: 'Gloss' },
];

/** Sensible starting sizes for a new component of each type, relative to the piece. */
function newComponent(type: ComponentType, piece: BuilderPiece, existing: FurnitureComponent[]): FurnitureComponent {
  const id = componentId(existing);
  const name = COMPONENT_TYPE_LABELS[type];
  const base = { id, name, type, x: 0, y: 0, z: 0, rotation: 0, shape: 'box' as ComponentShape };
  const w = piece.width;
  const d = piece.depth;
  switch (type) {
    case 'leg':
    case 'foot':
      return { ...base, shape: 'cylinder', x: -w / 2 + 8, y: -d / 2 + 8, width: 5, depth: 5, height: type === 'foot' ? 4 : 10, taper: 0.75, material: 'wood', color: '#5b4636' };
    case 'pillow':
      return { ...base, shape: 'ellipsoid', y: -d / 4, z: Math.min(45, piece.height * 0.5), width: 42, depth: 14, height: 36, tilt: 14, material: 'linen', color: '#9aa58a', seams: 'piped' };
    case 'cushion':
    case 'seat':
      return { ...base, width: Math.max(10, w - 10), depth: Math.max(10, d - 10), z: Math.min(38, piece.height * 0.45), height: 12, radius: 5, seams: 'piped' };
    case 'backrest':
    case 'headrest':
      return {
        ...base,
        shape: 'edge',
        width: w,
        depth: 18,
        z: 8,
        height: Math.max(20, piece.height - 8),
        radius: 5,
        edges: { from: 0, to: 0, startTrim: 0, endTrim: 0, inset: 0, thickness: 18, miterStart: false, miterEnd: false },
        seams: 'piped',
      };
    case 'armrest':
      return { ...base, shape: 'edge', width: d, depth: 18, z: 8, height: Math.min(piece.height, 60), radius: 6, edges: { from: 1, to: 1, startTrim: 0, endTrim: 0, inset: 0, thickness: 18, miterStart: false, miterEnd: false }, seams: 'piped' };
    case 'base':
      return { ...base, shape: 'footprint', width: w, depth: d, z: 8, height: 25, inset: 0, radius: 3 };
    case 'tabletop':
      return { ...base, shape: 'footprint', width: w, depth: d, z: Math.max(0, piece.height - 3), height: 3, inset: 0, radius: 0.6 };
    case 'shelf':
      return { ...base, width: Math.max(10, w - 4), depth: Math.max(10, d - 4), z: piece.height / 2, height: 2 };
    case 'drawer':
    case 'door':
      return { ...base, y: d / 2 - 1, width: Math.min(50, w - 4), depth: 1.8, z: 8, height: type === 'drawer' ? 18 : Math.max(20, piece.height - 16), radius: 0.3 };
    case 'support':
      return { ...base, shape: 'cylinder', width: 8, depth: 8, height: Math.max(10, piece.height - 3) };
    default:
      return { ...base, width: Math.min(30, w), depth: Math.min(30, d), height: 10, radius: 1 };
  }
}

type Draft = BuilderPiece;

export default function FurnitureBuilder(props: Props) {
  const { units, touch } = props;
  const toInput = (cm: number) => Math.round(cmToInput(cm, units) * 100) / 100;
  const toCm = (v: number) => inputToCm(v, units);
  const unit = inputUnitLabel(units);

  const start = useMemo<Draft>(() => withComputed(props.initial), [props.initial]);
  const [draft, setDraft] = useState<Draft>(start);
  const [committed, setCommitted] = useState<Draft>(start);
  const [past, setPast] = useState<Draft[]>([]);
  const [future, setFuture] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [view, setView] = useState<'top' | 'front' | '3d'>('top');
  const [show3d, setShow3d] = useState(false);
  const [snap, setSnap] = useState(1);
  const [templatesOpen, setTemplatesOpen] = useState(props.startWithTemplates ?? false);
  const [keepOwn, setKeepOwn] = useState(props.existing ?? false);

  /** Records a finished change as one undo step, recomputing bands and seats from the footprint. */
  function commit(next: Draft, note: string | null = null) {
    const computed = withComputed(next);
    setDraft(computed);
    setPast((p) => [...p.slice(-99), committed]);
    setFuture([]);
    setCommitted(computed);
    setMessage(note);
  }
  const setComponents = (components: FurnitureComponent[], note: string | null = null) => commit({ ...draft, components }, note);
  const updateComponent = (id: string, changes: Partial<FurnitureComponent>) => setComponents(draft.components.map((c) => (c.id === id ? { ...c, ...changes } : c)));

  function undo() {
    const previous = past.at(-1);
    if (!previous) return;
    setPast(past.slice(0, -1));
    setFuture([committed, ...future]);
    setDraft(previous);
    setCommitted(previous);
    setSelected((ids) => ids.filter((id) => previous.components.some((c) => c.id === id)));
  }
  function redo() {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast([...past, committed]);
    setDraft(next);
    setCommitted(next);
    setSelected((ids) => ids.filter((id) => next.components.some((c) => c.id === id)));
  }

  const extent = useMemo(() => componentExtent(draft), [draft]);
  const placed = useMemo(() => placeComponents(draft.components), [draft.components]);
  const primary = draft.components.find((c) => c.id === selected[0]) ?? null;
  const edges = useMemo(() => footprintEdges(draft), [draft]);

  function add(type: ComponentType) {
    if (draft.components.length >= MAX_COMPONENTS) {
      setMessage(`A piece can have up to ${MAX_COMPONENTS} components.`);
      return;
    }
    const c = newComponent(type, draft, draft.components);
    setComponents([...draft.components, c], c.shape === 'edge' ? `${c.name} added along edge 1 of the footprint. Choose which edges it follows below.` : `${c.name} added. Drag it in the views, or type exact values.`);
    setSelected([c.id]);
  }

  function applyPreset(id: PresetId) {
    const keep = keepOwn ? { width: draft.width, depth: draft.depth, height: Math.max(draft.height, 20), shape: draft.shape } : undefined;
    const built = buildPreset(id, keep);
    // Building onto the person's piece keeps its name, colour and material.
    const own = keep ? { name: draft.name, color: draft.color, material: draft.material } : {};
    commit(
      { ...draft, ...built, ...own, finish: draft.finish },
      keep
        ? `Built a ${built.name.toLowerCase()} onto your footprint (${formatLength(keep.width, units)} × ${formatLength(keep.depth, units)}). Seat heights and cushion sizes are typical: adjust them to match.`
        : `Started from “${built.name}”. Every size is a typical one: replace them with your own measurements.`,
    );
    setSelected([]);
    setTemplatesOpen(false);
  }

  function remove(id: string) {
    const c = draft.components.find((k) => k.id === id);
    if (!c) return;
    if (c.locked) {
      setMessage(`“${c.name}” is locked. Unlock it to delete it.`);
      return;
    }
    setComponents(removeComponent(draft.components, id), `Deleted “${c.name}”.`);
    setSelected([]);
  }

  function duplicate(id: string) {
    const { components, copyId } = duplicateComponent(draft.components, id);
    if (!copyId) {
      setMessage(`A piece can have up to ${MAX_COMPONENTS} components.`);
      return;
    }
    setComponents(components, 'Copied. The copy sits 10 cm to the side.');
    setSelected([copyId]);
  }

  function group() {
    const { components, groupId } = groupComponents(draft.components, selected);
    if (!groupId) return;
    setComponents(components, 'Grouped: move or turn the group to move them together.');
    setSelected([groupId]);
  }

  /** Grows a plain (rectangular) footprint to cover every component, keeping it centred. */
  function growFootprint() {
    if (!extent.box || draft.shape) return;
    const width = Math.ceil(Math.max(draft.width, 2 * Math.max(Math.abs(extent.box.minX), Math.abs(extent.box.maxX))));
    const depth = Math.ceil(Math.max(draft.depth, 2 * Math.max(Math.abs(extent.box.minY), Math.abs(extent.box.maxY))));
    commit({ ...draft, width, depth }, `Footprint grown to ${formatLength(width, units)} × ${formatLength(depth, units)}. Collisions and the optimizer use this.`);
  }

  async function save() {
    if (draft.components.length === 0) {
      setMessage('Add at least one component, or start from a template.');
      return;
    }
    const height = Math.max(1, Math.round(extent.top * 10) / 10);
    const refused = await props.onSave({ ...draft, height });
    if (refused) setMessage(refused);
  }

  // Keyboard: undo/redo, nudge, turn, duplicate, delete (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (!primary) return;
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate(primary.id);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!(e.target as HTMLElement)?.closest('.fb-stage, .fb-list')) return;
        e.preventDefault();
        remove(primary.id);
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      const moves: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
      if (moves[e.key] && (e.target as HTMLElement)?.closest('.fb-stage')) {
        e.preventDefault();
        nudge(primary, moves[e.key]);
      }
      if (e.key.toLowerCase() === 'r' && (e.target as HTMLElement)?.closest('.fb-stage') && !primary.locked && movable(primary)) {
        e.preventDefault();
        updateComponent(primary.id, { rotation: (primary.rotation + (e.shiftKey ? -15 : 15) + 360) % 360 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** Moves a component by a plan offset (converted into its parent's frame). */
  function nudge(c: FurnitureComponent, by: Point) {
    if (c.locked) {
      setMessage(`“${c.name}” is locked.`);
      return;
    }
    if (!movable(c)) {
      setMessage(`“${c.name}” follows the footprint. Change its edges, inset or thickness instead.`);
      return;
    }
    const local = toParentFrame(draft.components, c, by);
    updateComponent(c.id, { x: round(c.x + local.x), y: round(c.y + local.y) });
  }

  const overflowHint = extent.overflow.length > 0 && (
    <div className="fb-warning" role="status">
      <Icon name="warning" size={16} />
      <div>
        <p>
          {extent.overflow.length === 1 ? 'One component reaches' : `${extent.overflow.length} components reach`} outside the footprint that collisions and the optimizer use:
        </p>
        <ul>
          {extent.overflow.map((o) => (
            <li key={o.id}>
              <button type="button" className="link-button" onClick={() => setSelected([o.id])}>
                {o.name}
              </button>{' '}
              {o.outside > 0 && `${formatLength(o.outside, units)} outside`}
              {o.outside > 0 && o.below > 0 && ', '}
              {o.below > 0 && `${formatLength(o.below, units)} below the floor`}
            </li>
          ))}
        </ul>
        {!draft.shape ? (
          <button type="button" className="secondary small" onClick={growFootprint}>
            Grow the footprint to fit
          </button>
        ) : (
          <p className="hint">Move the component, or edit the outline (Edit shape & look) so it includes it.</p>
        )}
      </div>
    </div>
  );

  return (
    <Dialog
      open
      title={props.title}
      onClose={props.onCancel}
      className="studio-dialog fb-dialog"
      footer={
        <div className="studio-footer">
          <p className="fb-summary">
            Footprint {formatLength(draft.width, units)} × {formatLength(draft.depth, units)} · height {formatLength(extent.top || draft.height, units)} · {draft.components.length} components
          </p>
          <div className="button-row">
            <button type="button" className="secondary" onClick={props.onCancel}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={() => void save()}>
              {props.saveLabel}
            </button>
          </div>
        </div>
      }
    >
      <div className="studio fb">
        <div className="studio-stage fb-stage-wrap">
          <div className="studio-toolbar" role="toolbar" aria-label="Builder tools">
            <button type="button" className="icon-button small" onClick={undo} disabled={past.length === 0} aria-label="Undo" title="Undo (Ctrl/⌘ Z)">
              <Icon name="undo" />
            </button>
            <button type="button" className="icon-button small" onClick={redo} disabled={future.length === 0} aria-label="Redo" title="Redo">
              <Icon name="redo" />
            </button>
            <button type="button" className={`secondary small ${templatesOpen ? 'is-active' : ''}`} aria-expanded={templatesOpen} onClick={() => setTemplatesOpen(!templatesOpen)}>
              <Icon name="sparkle" size={16} /> Templates
            </button>
            <AddPicker onAdd={add} />
            <div className="fb-view-switch">
              <SegmentedControl
                label="View"
                hideLabel
                value={view}
                options={[
                  { value: 'top', label: 'Top' },
                  { value: 'front', label: 'Front' },
                  { value: '3d', label: '3D' },
                ]}
                onChange={(v) => {
                  setView(v);
                  if (v === '3d') setShow3d(true);
                }}
              />
            </div>
            <label className="studio-select">
              Snap
              <select value={snap} onChange={(e) => setSnap(Number(e.target.value))}>
                <option value={0}>Off</option>
                <option value={1}>1 cm</option>
                <option value={5}>5 cm</option>
              </select>
            </label>
          </div>

          {templatesOpen && (
            <div className="fb-templates" role="group" aria-label="Templates">
              <p className="hint">Start from a template, then change any component. Replacing the current components can be undone.</p>
              <label className="toggle">
                <input type="checkbox" checked={keepOwn} onChange={(e) => setKeepOwn(e.target.checked)} />
                <span>
                  Use this piece’s footprint and height ({formatLength(draft.width, units)} × {formatLength(draft.depth, units)}, {formatLength(draft.height, units)} high)
                </span>
              </label>
              <div className="fb-template-grid">
                {PRESETS.map((p) => (
                  <button key={p.id} type="button" className="fb-template" onClick={() => applyPreset(p.id)}>
                    <strong>{p.label}</strong>
                    <span>{p.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={`fb-views is-${view}`}>
            <TopView
              draft={draft}
              placed={placed}
              selected={selected}
              snap={snap}
              units={units}
              onSelect={(ids) => setSelected(ids)}
              onLive={(components) => setDraft({ ...draft, components })}
              onDone={(components, note) => setComponents(components, note)}
              onRefuse={setMessage}
            />
            <FrontView draft={draft} placed={placed} selected={selected} snap={snap} onSelect={(ids) => setSelected(ids)} onLive={(components) => setDraft({ ...draft, components })} onDone={(components) => setComponents(components)} onRefuse={setMessage} />
            {show3d && (
              <div className="fb-3d">
                <Suspense fallback={<p className="hint">Loading the 3D preview…</p>}>
                  <Preview3D piece={previewPiece(draft, extent.top)} quality={touch ? 'medium' : 'high'} touch={touch} />
                </Suspense>
              </div>
            )}
            {!show3d && view !== '3d' && (
              <button type="button" className="secondary small fb-3d-button" onClick={() => setShow3d(true)}>
                <Icon name="cube" size={16} /> Show 3D preview
              </button>
            )}
          </div>

          <p className={`studio-status ${message ? '' : 'is-quiet'}`} role="status" aria-live="polite">
            {message ?? 'Click a component to select it; drag to move it, drag the round handle to turn it. Arrow keys nudge (Shift: 10 cm), R turns 15°.'}
          </p>
          {overflowHint}
        </div>

        <div className="studio-panel">
          <section className="studio-section">
            <h3>Piece</h3>
            <div className="field">
              <label htmlFor="fb-name">Name</label>
              <input id="fb-name" type="text" value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onBlur={() => commit(draft)} />
            </div>
            <div className="field-grid two">
              <div className="field">
                <label htmlFor="fb-kind">Type</label>
                <select id="fb-kind" value={draft.kind} onChange={(e) => commit({ ...draft, kind: e.target.value as FurnitureKind })}>
                  {(Object.keys(FURNITURE_KIND_LABELS) as FurnitureKind[]).map((k) => (
                    <option key={k} value={k}>
                      {FURNITURE_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="fb-material">Main material</label>
                <select id="fb-material" value={draft.material} onChange={(e) => commit({ ...draft, material: e.target.value as MaterialKind })}>
                  {MATERIALS.filter((m) => m.value !== 'piece').map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="inline-field">
              <label htmlFor="fb-colour">Main colour</label>
              <input id="fb-colour" type="color" value={draft.color.length === 7 ? draft.color : '#e2d9c8'} onChange={(e) => setDraft({ ...draft, color: e.target.value })} onBlur={() => commit(draft)} />
            </div>
            {!draft.shape && (
              <div className="field-grid two">
                <NumberField label="Footprint width" suffix={unit} min={0} value={toInput(draft.width)} onCommit={(v) => v >= 5 && commit({ ...draft, width: toCm(v) })} />
                <NumberField label="Footprint depth" suffix={unit} min={0} value={toInput(draft.depth)} onCommit={(v) => v >= 5 && commit({ ...draft, depth: toCm(v) })} />
              </div>
            )}
            <p className="hint">
              {draft.shape ? 'Drawn footprint: edit its outline with “Edit shape & look”. ' : ''}The footprint is what collisions and the optimizer use. Height comes from the tallest component.
            </p>
          </section>

          <section className="studio-section">
            <h3>Components</h3>
            <ComponentList
              components={draft.components}
              selected={selected}
              onSelect={setSelected}
              onToggle={(id, key) => {
                const c = draft.components.find((k) => k.id === id)!;
                updateComponent(id, { [key]: !c[key] });
              }}
            />
            <div className="button-row fb-list-actions">
              <button type="button" className="secondary small" disabled={!primary} onClick={() => primary && setComponents(reorderComponent(draft.components, primary.id, -1))} aria-label="Move earlier in the list">
                ↑
              </button>
              <button type="button" className="secondary small" disabled={!primary} onClick={() => primary && setComponents(reorderComponent(draft.components, primary.id, 1))} aria-label="Move later in the list">
                ↓
              </button>
              <button type="button" className="secondary small" disabled={!primary} onClick={() => primary && duplicate(primary.id)}>
                <Icon name="copy" size={14} /> Duplicate
              </button>
              <button type="button" className="secondary small" disabled={selected.length < 1 || draft.components.filter((c) => selected.includes(c.id) && !c.parentId).length === 0} onClick={group}>
                Group
              </button>
              {primary?.type === 'group' && (
                <button type="button" className="secondary small" onClick={() => setComponents(ungroupComponents(draft.components, primary.id), 'Ungrouped.')}>
                  Ungroup
                </button>
              )}
              <button type="button" className="danger compact small" disabled={!primary} onClick={() => primary && remove(primary.id)}>
                <Icon name="trash" size={14} /> Delete
              </button>
            </div>
            <p className="hint">Ctrl/⌘-click or Shift-click to select several (to group them). The list order is the drawing order.</p>
          </section>

          {primary && (
            <ComponentProperties
              key={primary.id}
              component={primary}
              draft={draft}
              edgeCount={edges.length}
              units={units}
              onChange={(changes) => updateComponent(primary.id, changes)}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// `|| 0` turns −0 into 0, so saved data reads back identically.
const round = (v: number) => Math.round(v * 100) / 100 || 0;

/** Edge and footprint components follow the footprint: they can't be dragged freely. */
const movable = (c: FurnitureComponent) => c.shape !== 'edge' && c.shape !== 'footprint';

/** A plan offset expressed in a component's parent frame (so a child of a turned group moves as dragged). */
function toParentFrame(components: FurnitureComponent[], c: FurnitureComponent, by: Point): Point {
  if (!c.parentId) return by;
  const parent = placeComponents(components.map((k) => (k.hidden ? { ...k, hidden: false } : k))).find((p) => p.component.id === c.parentId);
  const yaw = parent ? (parent.yaw * Math.PI) / 180 : 0;
  return { x: by.x * Math.cos(yaw) + by.y * Math.sin(yaw), y: -by.x * Math.sin(yaw) + by.y * Math.cos(yaw) };
}

/** Recomputes curved panels, edge bands and seats; a failed one keeps its last outline. */
function withComputed<T extends BuilderPiece>(piece: T): T {
  const { components } = recomputeComponents(piece);
  return { ...piece, components };
}

function previewPiece(draft: Draft, top: number) {
  return {
    name: draft.name,
    kind: draft.kind,
    category: 'furniture' as const,
    width: draft.width,
    depth: draft.depth,
    height: Math.max(1, top),
    color: draft.color,
    appearance: { material: draft.material, finish: draft.finish },
    shape: draft.shape,
    components: draft.components,
  };
}

/** A placed component's outline as seen from above (bottom ring, turned and tilted). */
function planOutline(p: PlacedComponent): Point[] {
  const pts = componentPoints(p);
  const bottom = pts.slice(0, pts.length / 2);
  const top = pts.slice(pts.length / 2);
  // A tilted part shows its top shifted: use the hull of both rings.
  return p.component.tilt ? hull([...bottom, ...top]) : bottom;
}

/** Convex hull (monotone chain), for elevations and tilted outlines. */
function hull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const pathOf = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + ' Z';

/** The colour a component is drawn in: its own, or the piece's (lightly shaded by role). */
function fillOf(c: FurnitureComponent, pieceColour: string): string {
  if (c.color) return c.color;
  const shadeBy: Partial<Record<ComponentType, number>> = { backrest: -0.06, armrest: -0.03, base: -0.08, leg: -0.3, foot: -0.3 };
  return shadeBy[c.type] ? shade(pieceColour, shadeBy[c.type]!) : pieceColour;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

interface ViewProps {
  draft: Draft;
  placed: PlacedComponent[];
  selected: string[];
  snap: number;
  onSelect: (ids: string[]) => void;
  onLive: (components: FurnitureComponent[]) => void;
  onDone: (components: FurnitureComponent[], note?: string | null) => void;
  onRefuse: (message: string) => void;
}

/** Converts a pointer position to SVG user units (cm). */
function svgPoint(svg: SVGSVGElement, e: { clientX: number; clientY: number }): Point {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

function selectFrom(e: ReactPointerEvent, id: string, selected: string[]): string[] {
  if (e.shiftKey || e.metaKey || e.ctrlKey) return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
  return selected.includes(id) ? [id, ...selected.filter((s) => s !== id)] : [id];
}

function TopView({ draft, placed, selected, snap, units, onSelect, onLive, onDone, onRefuse }: ViewProps & { units: UnitSystem }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; mode: 'move' | 'turn'; start: Point; origin: FurnitureComponent; centre: Point; moved: boolean } | null>(null);
  const { rings } = localFootprint(draft);
  const edges = footprintEdges(draft);
  // Frame the footprint and every component, with room for labels and handles.
  const all = [...rings.flatMap((r) => r.outer), ...placed.flatMap(planOutline)];
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const pad = Math.max(draft.width, draft.depth) * 0.12 + 12;
  const box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  const order = placed.map((p, i) => ({ p, i, top: p.z + p.component.height })).sort((a, b) => a.top - b.top || a.i - b.i);
  const handleR = Math.max(box.w, box.h) / 60;

  function down(e: ReactPointerEvent, p: PlacedComponent, mode: 'move' | 'turn') {
    e.stopPropagation();
    const ids = selectFrom(e, p.component.id, selected);
    onSelect(ids);
    if (e.shiftKey || e.metaKey || e.ctrlKey) return;
    if (p.component.locked) {
      onRefuse(`“${p.component.name}” is locked. Unlock it in the list to move it.`);
      return;
    }
    if (!movable(p.component)) {
      if (mode === 'move') onRefuse(`“${p.component.name}” follows the footprint: change its edges, inset or thickness in the panel.`);
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { id: p.component.id, mode, start: svgPoint(svg.current!, e), origin: p.component, centre: { x: p.x, y: p.y }, moved: false };
  }

  function move(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const at = svgPoint(svg.current!, e);
    const c = d.origin;
    let next: FurnitureComponent;
    if (d.mode === 'move') {
      const by = toParentFrame(draft.components, c, { x: at.x - d.start.x, y: at.y - d.start.y });
      const s = (v: number) => (snap > 0 ? Math.round(v / snap) * snap : round(v));
      next = { ...c, x: s(c.x + by.x), y: s(c.y + by.y) };
    } else {
      const angle = (Math.atan2(at.y - d.centre.y, at.x - d.centre.x) * 180) / Math.PI + 90;
      const parentYaw = placed.find((p) => p.component.id === c.id)!.yaw - c.rotation;
      const step = e.altKey ? 1 : 5;
      next = { ...c, rotation: ((Math.round((angle - parentYaw) / step) * step) % 360 + 360) % 360 };
    }
    d.moved = true;
    onLive(draft.components.map((k) => (k.id === c.id ? next : k)));
  }

  function up() {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) onDone(draft.components);
  }

  return (
    <figure className="fb-view fb-top">
      <figcaption>From above · front at the bottom</figcaption>
      <svg
        ref={svg}
        className="fb-stage"
        tabIndex={0}
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        role="application"
        aria-label="Top view of the components. Arrow keys move the selected component, R turns it."
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerDown={() => onSelect([])}
      >
        <path d={ringsSvgPath(rings)} className="fb-footprint" fillRule="evenodd" vectorEffect="non-scaling-stroke" />
        {edges.map((edge) => {
          const mid = edge.points[Math.floor(edge.points.length / 2)];
          const a = edge.points[Math.max(0, Math.floor(edge.points.length / 2) - 1)];
          const b = edge.points[Math.min(edge.points.length - 1, Math.floor(edge.points.length / 2) + (edge.points.length === 2 ? 0 : 1))];
          const at = edge.points.length === 2 ? { x: (edge.points[0].x + edge.points[1].x) / 2, y: (edge.points[0].y + edge.points[1].y) / 2 } : mid;
          // Label outside the edge.
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const out = { x: ((b.y - a.y) / len) * handleR * 2.6, y: (-(b.x - a.x) / len) * handleR * 2.6 };
          return (
            <g key={edge.index} className="fb-edge-label" aria-hidden="true">
              <circle cx={at.x + out.x} cy={at.y + out.y} r={handleR * 1.5} />
              <text x={at.x + out.x} y={at.y + out.y} fontSize={handleR * 1.8} textAnchor="middle" dominantBaseline="central">
                {edge.index + 1}
              </text>
            </g>
          );
        })}
        {order.map(({ p }) => {
          const c = p.component;
          const isSel = selected.includes(c.id);
          return (
            <path
              key={c.id}
              d={pathOf(planOutline(p))}
              className={`fb-part ${isSel ? 'is-selected' : ''} ${c.locked ? 'is-locked' : ''}`}
              style={{ fill: fillOf(c, draft.color), stroke: isSel ? undefined : shade(fillOf(c, draft.color), -0.4) }}
              vectorEffect="non-scaling-stroke"
              onPointerDown={(e) => down(e, p, 'move')}
            >
              <title>{c.name}</title>
            </path>
          );
        })}
        {placed
          .filter((p) => p.component.id === selected[0] && movable(p.component) && !p.component.locked)
          .map((p) => {
            const yaw = (p.yaw * Math.PI) / 180;
            const reach = p.component.depth / 2 + handleR * 4;
            const hx = p.x + Math.sin(yaw) * reach;
            const hy = p.y - Math.cos(yaw) * reach;
            return (
              <g key="handle" className="fb-handle">
                <line x1={p.x} y1={p.y} x2={hx} y2={hy} vectorEffect="non-scaling-stroke" />
                <circle cx={hx} cy={hy} r={handleR} onPointerDown={(e) => down(e, p, 'turn')}>
                  <title>Drag to turn</title>
                </circle>
              </g>
            );
          })}
      </svg>
      <p className="visually-hidden" aria-live="polite">
        {selected.length > 0 ? `${selected.length} selected` : 'Nothing selected'} · footprint {formatLength(draft.width, units)} by {formatLength(draft.depth, units)}
      </p>
    </figure>
  );
}

/** Seen from the front: x across, height up. Drag up and down to set a component's elevation. */
function FrontView({ draft, placed, selected, snap, onSelect, onLive, onDone, onRefuse }: ViewProps) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; start: Point; origin: FurnitureComponent; moved: boolean } | null>(null);
  const shapes = placed.map((p) => {
    const pts = componentPoints(p);
    return { p, outline: hull(pts.map((q) => ({ x: q.x, y: -q.z }))), front: Math.max(...pts.map((q) => q.y)) };
  });
  // Back first, so nearer components are drawn over them.
  shapes.sort((a, b) => a.front - b.front);
  const top = Math.max(draft.height, ...placed.map((p) => p.z + p.component.height), 10);
  const pad = Math.max(draft.width, top) * 0.08 + 8;
  const minX = Math.min(-draft.width / 2, ...shapes.flatMap((s) => s.outline.map((q) => q.x)));
  const maxX = Math.max(draft.width / 2, ...shapes.flatMap((s) => s.outline.map((q) => q.x)));
  const box = { x: minX - pad, y: -top - pad, w: maxX - minX + pad * 2, h: top + pad * 2 };

  function down(e: ReactPointerEvent, p: PlacedComponent) {
    e.stopPropagation();
    onSelect(selectFrom(e, p.component.id, selected));
    if (e.shiftKey || e.metaKey || e.ctrlKey) return;
    if (p.component.locked) {
      onRefuse(`“${p.component.name}” is locked.`);
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { id: p.component.id, start: svgPoint(svg.current!, e), origin: p.component, moved: false };
  }
  function move(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const at = svgPoint(svg.current!, e);
    const c = d.origin;
    const s = (v: number) => (snap > 0 ? Math.round(v / snap) * snap : round(v));
    // Up the screen is up in the room. Edge and footprint components only move up and down.
    const z = s(c.z - (at.y - d.start.y));
    const dx = movable(c) ? toParentFrame(draft.components, c, { x: at.x - d.start.x, y: 0 }) : { x: 0, y: 0 };
    d.moved = true;
    onLive(draft.components.map((k) => (k.id === c.id ? { ...c, z, x: movable(c) ? s(c.x + dx.x) : c.x, y: movable(c) ? round(c.y + dx.y) : c.y } : k)));
  }
  function up() {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) onDone(draft.components);
  }

  return (
    <figure className="fb-view fb-front">
      <figcaption>From the front · drag up or down to set heights</figcaption>
      <svg ref={svg} className="fb-stage" tabIndex={0} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} role="application" aria-label="Front view of the components" onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerDown={() => onSelect([])}>
        <line x1={box.x} y1={0} x2={box.x + box.w} y2={0} className="fb-floor" vectorEffect="non-scaling-stroke" />
        <rect x={-draft.width / 2} y={-top} width={draft.width} height={top} className="fb-bounds" vectorEffect="non-scaling-stroke" />
        {shapes.map(({ p, outline }) => {
          const c = p.component;
          const isSel = selected.includes(c.id);
          return (
            <path key={c.id} d={pathOf(outline)} className={`fb-part ${isSel ? 'is-selected' : ''}`} style={{ fill: fillOf(c, draft.color), stroke: isSel ? undefined : shade(fillOf(c, draft.color), -0.4) }} vectorEffect="non-scaling-stroke" onPointerDown={(e) => down(e, p)}>
              <title>{c.name}</title>
            </path>
          );
        })}
      </svg>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function AddPicker({ onAdd }: { onAdd: (type: ComponentType) => void }) {
  const id = useId();
  return (
    <div className="studio-select">
      <label htmlFor={id} className="visually-hidden">
        Add a component
      </label>
      <select
        id={id}
        value=""
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value as ComponentType);
        }}
      >
        <option value="">+ Add component…</option>
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {COMPONENT_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
    </div>
  );
}

function ComponentList(props: { components: FurnitureComponent[]; selected: string[]; onSelect: (ids: string[]) => void; onToggle: (id: string, key: 'locked' | 'hidden') => void }) {
  const depthOf = (c: FurnitureComponent): number => {
    let d = 0;
    let p = c.parentId ? props.components.find((k) => k.id === c.parentId) : undefined;
    while (p && d < 6) {
      d++;
      p = p.parentId ? props.components.find((k) => k.id === p!.parentId) : undefined;
    }
    return d;
  };
  if (props.components.length === 0) return <p className="hint">No components yet. Start from a template, or add one.</p>;
  return (
    <ul className="fb-list" aria-label="Components">
      {props.components.map((c) => {
        const isSel = props.selected.includes(c.id);
        return (
          <li key={c.id} style={{ paddingInlineStart: `${depthOf(c) * 14}px` }} className={c.hidden ? 'is-hidden' : ''}>
            <button
              type="button"
              className={`fb-row ${isSel ? 'is-active' : ''}`}
              aria-pressed={isSel}
              onClick={(e) => {
                if (e.shiftKey || e.metaKey || e.ctrlKey) props.onSelect(isSel ? props.selected.filter((s) => s !== c.id) : [...props.selected, c.id]);
                else props.onSelect([c.id]);
              }}
            >
              <span className="fb-swatch" style={{ background: c.type === 'group' ? 'transparent' : (c.color ?? 'var(--surface-sunk)') }} aria-hidden="true" />
              <span className="truncate">{c.name}</span>
              <span className="fb-row-meta">{COMPONENT_TYPE_LABELS[c.type]}</span>
            </button>
            <button type="button" className="icon-button small" aria-label={`${c.locked ? 'Unlock' : 'Lock'} ${c.name}`} aria-pressed={!!c.locked} onClick={() => props.onToggle(c.id, 'locked')}>
              <Icon name={c.locked ? 'lock' : 'unlock'} size={14} />
            </button>
            <button type="button" className="link-button" aria-label={`${c.hidden ? 'Show' : 'Hide'} ${c.name}`} aria-pressed={!!c.hidden} onClick={() => props.onToggle(c.id, 'hidden')}>
              {c.hidden ? 'Show' : 'Hide'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ComponentProperties(props: { component: FurnitureComponent; draft: Draft; edgeCount: number; units: UnitSystem; onChange: (changes: Partial<FurnitureComponent>) => void }) {
  const { component: c, draft, edgeCount, units, onChange } = props;
  const toInput = (cm: number) => Math.round(cmToInput(cm, units) * 100) / 100;
  const toCm = (v: number) => inputToCm(v, units);
  const unit = inputUnitLabel(units);
  const lockedNote = c.locked ? <p className="hint">Locked: unlock it in the list to change it.</p> : null;
  const disabled = !!c.locked;
  const others = draft.components.filter((k) => k.id !== c.id && k.type !== 'group');
  const descendants = new Set(withDescendants(draft.components, c.id).map((k) => k.id));
  const parents = draft.components.filter((k) => !descendants.has(k.id));
  const follows = !movable(c);
  const edgeOptions = Array.from({ length: edgeCount }, (_, i) => i);

  function setShape(shape: ComponentShape) {
    const changes: Partial<FurnitureComponent> = { shape };
    if (shape === 'edge') {
      changes.edges = c.edges ?? { from: 0, to: 0, startTrim: 0, endTrim: 0, inset: 0, thickness: Math.min(c.depth, 20), miterStart: false, miterEnd: false };
      changes.parentId = undefined;
    }
    if (shape === 'footprint') {
      changes.inset = c.inset ?? 1;
      changes.parentId = undefined;
    }
    if (shape === 'polygon' && !c.outline) {
      // Start from the component's current box (or circle) as an editable outline.
      const sides = c.shape === 'cylinder' || c.shape === 'ellipsoid' ? 12 : 4;
      const outline = Array.from({ length: sides }, (_, i) => {
        const a = (sides === 4 ? Math.PI / 4 : 0) + (i / sides) * Math.PI * 2 - Math.PI / 2;
        const k = sides === 4 ? Math.SQRT2 : 1;
        return { x: round((Math.cos(a) * c.width * k) / 2), y: round((Math.sin(a) * c.depth * k) / 2) };
      });
      changes.outline = centred(outline).outline;
    }
    if (shape === 'curved') {
      changes.sweep = c.sweep ?? 60;
      changes.outline = curvedOutline(c.width, c.depth, c.sweep ?? 60);
    }
    onChange(changes);
  }

  return (
    <section className="studio-section fb-props" aria-label={`${c.name} properties`}>
      <h3>{c.name}</h3>
      {lockedNote}
      <fieldset disabled={disabled} className="fb-fieldset">
        <div className="field">
          <label htmlFor="fb-c-name">Name</label>
          <input id="fb-c-name" type="text" defaultValue={c.name} maxLength={120} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && onChange({ name: e.target.value.trim() })} />
        </div>
        {c.type !== 'group' && (
          <div className="field-grid two">
            <div className="field">
              <label htmlFor="fb-c-type">Component</label>
              <select id="fb-c-type" value={c.type} onChange={(e) => onChange({ type: e.target.value as ComponentType })}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {COMPONENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fb-c-shape">Shape</label>
              <select id="fb-c-shape" value={c.shape} onChange={(e) => setShape(e.target.value as ComponentShape)}>
                {SHAPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {!follows && (
          <div className="field">
            <label htmlFor="fb-c-parent">Attached to</label>
            <select id="fb-c-parent" value={c.parentId ?? ''} onChange={(e) => onChange({ parentId: e.target.value || undefined })}>
              <option value="">The piece (no parent)</option>
              {parents.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
            <p className="hint">Attached components move and turn with their parent; their position and height are measured from it.</p>
          </div>
        )}

        <h4>Position</h4>
        <div className="field-grid two">
          {!follows && <NumberField label={c.parentId ? 'Across (from parent)' : 'Across (x)'} suffix={unit} value={toInput(c.x)} onCommit={(v) => onChange({ x: toCm(v) })} />}
          {!follows && <NumberField label={c.parentId ? 'Front–back (from parent)' : 'Front–back (y)'} suffix={unit} value={toInput(c.y)} onCommit={(v) => onChange({ y: toCm(v) })} />}
          <NumberField label={c.parentId ? 'Height above parent' : 'Height above floor'} suffix={unit} value={toInput(c.z)} onCommit={(v) => onChange({ z: toCm(v) })} />
          {!follows && <NumberField label="Turn" suffix="°" value={round(c.rotation)} onCommit={(v) => onChange({ rotation: ((v % 360) + 360) % 360 })} />}
        </div>

        {c.type !== 'group' && (
          <>
            <h4>Size</h4>
            <div className="field-grid two">
              {(c.shape === 'box' || c.shape === 'cylinder' || c.shape === 'ellipsoid' || c.shape === 'curved') && (
                <>
                  <NumberField label={c.shape === 'curved' ? 'Width (straight across)' : 'Width'} suffix={unit} min={0} value={toInput(c.width)} onCommit={(v) => v > 0 && onChange({ width: toCm(v) })} />
                  <NumberField label={c.shape === 'curved' ? 'Thickness' : 'Depth'} suffix={unit} min={0} value={toInput(c.depth)} onCommit={(v) => v > 0 && onChange({ depth: toCm(v) })} />
                </>
              )}
              <NumberField label="Height (thickness up)" suffix={unit} min={0} value={toInput(c.height)} onCommit={(v) => v > 0 && onChange({ height: toCm(v) })} />
              <NumberField label="Lean back" suffix="°" value={c.tilt ?? 0} onCommit={(v) => onChange({ tilt: Math.max(-60, Math.min(60, v)) || undefined })} />
            </div>
            {c.shape === 'curved' && <NumberField label="Curve (how far it bends)" suffix="°" min={1} value={c.sweep ?? 60} onCommit={(v) => onChange({ sweep: Math.max(1, Math.min(300, v)) })} />}
            {c.shape === 'cylinder' && <NumberField label="Top size (× bottom)" min={0} step={0.05} value={c.taper ?? 1} onCommit={(v) => v > 0 && onChange({ taper: Math.min(10, v) })} />}
            {(c.shape === 'polygon' || c.shape === 'edge' || c.shape === 'footprint' || c.shape === 'curved') && (
              <p className="hint">
                Outline {formatLength(c.width, units)} × {formatLength(c.depth, units)}
                {c.shape === 'polygon' ? ' — edit its corners below.' : ', worked out from the footprint.'}
              </p>
            )}
            {c.shape === 'polygon' && c.outline && <OutlineEditor outline={c.outline} units={units} onChange={(outline) => onChange({ outline })} />}

            {c.shape === 'edge' && c.edges && (
              <>
                <h4>Follows the footprint</h4>
                <div className="field-grid two">
                  <EdgeSelect label="From edge" value={c.edges.from} options={edgeOptions} onChange={(from) => onChange({ edges: { ...c.edges!, from } })} />
                  <EdgeSelect label="To edge" value={c.edges.to} options={edgeOptions} onChange={(to) => onChange({ edges: { ...c.edges!, to } })} />
                  <NumberField label="Thickness" suffix={unit} min={0} value={toInput(c.edges.thickness)} onCommit={(v) => v > 0 && onChange({ edges: { ...c.edges!, thickness: toCm(v) } })} />
                  <NumberField label="In from the edge" suffix={unit} min={0} value={toInput(c.edges.inset)} onCommit={(v) => onChange({ edges: { ...c.edges!, inset: Math.max(0, toCm(v)) } })} />
                  <NumberField label="Shorten start" suffix={unit} min={0} value={toInput(c.edges.startTrim)} onCommit={(v) => onChange({ edges: { ...c.edges!, startTrim: Math.max(0, toCm(v)) } })} />
                  <NumberField label="Shorten end" suffix={unit} min={0} value={toInput(c.edges.endTrim)} onCommit={(v) => onChange({ edges: { ...c.edges!, endTrim: Math.max(0, toCm(v)) } })} />
                </div>
                <label className="toggle">
                  <input type="checkbox" checked={c.edges.miterStart} onChange={(e) => onChange({ edges: { ...c.edges!, miterStart: e.target.checked } })} />
                  <span>Angle the start to meet the neighbouring section</span>
                </label>
                <label className="toggle">
                  <input type="checkbox" checked={c.edges.miterEnd} onChange={(e) => onChange({ edges: { ...c.edges!, miterEnd: e.target.checked } })} />
                  <span>Angle the end to meet the neighbouring section</span>
                </label>
                <p className="hint">Edges are numbered on the top view. A backrest along an angled edge follows that angle.</p>
              </>
            )}

            {c.shape === 'footprint' && (
              <>
                <h4>Fills the footprint</h4>
                <NumberField label="Gap from the edges" suffix={unit} min={0} value={toInput(c.inset ?? 0)} onCommit={(v) => onChange({ inset: Math.max(0, toCm(v)) })} />
                {others.length > 0 && (
                  <fieldset className="fb-cut">
                    <legend>Leave room for</legend>
                    {others.map((k) => (
                      <label key={k.id} className="toggle">
                        <input
                          type="checkbox"
                          checked={c.cut?.includes(k.id) ?? false}
                          onChange={(e) => onChange({ cut: e.target.checked ? [...(c.cut ?? []), k.id] : (c.cut ?? []).filter((x) => x !== k.id) })}
                        />
                        <span>{k.name}</span>
                      </label>
                    ))}
                  </fieldset>
                )}
                <div className="field-grid two">
                  <NumberField label="Split into" suffix="parts" min={1} value={c.split?.count ?? 1} onCommit={(v) => onChange({ split: v > 1 ? { along: c.split?.along ?? 2, count: Math.min(12, Math.round(v)), index: Math.min(c.split?.index ?? 0, Math.round(v) - 1), gap: c.split?.gap ?? 1 } : undefined })} />
                  {c.split && <NumberField label="This is part" min={1} value={c.split.index + 1} onCommit={(v) => onChange({ split: { ...c.split!, index: Math.max(0, Math.min(c.split!.count - 1, Math.round(v) - 1)) } })} />}
                  {c.split && <EdgeSelect label="Split across edge" value={c.split.along} options={edgeOptions} onChange={(along) => onChange({ split: { ...c.split!, along } })} />}
                </div>
              </>
            )}

            <h4>Edges</h4>
            <div className="field-grid two">
              <div className="field">
                <label htmlFor="fb-c-edge">Edge style</label>
                <select id="fb-c-edge" value={c.edgeStyle ?? 'rounded'} onChange={(e) => onChange({ edgeStyle: e.target.value as ComponentEdgeStyle })}>
                  {EDGE_STYLES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <NumberField label="Rounding / bevel" suffix={unit} min={0} value={toInput(c.radius ?? 0)} onCommit={(v) => onChange({ radius: Math.max(0, toCm(v)) })} />
            </div>

            <h4>Material</h4>
            <div className="field-grid two">
              <div className="field">
                <label htmlFor="fb-c-material">Material</label>
                <select id="fb-c-material" value={c.material ?? 'piece'} onChange={(e) => onChange({ material: e.target.value === 'piece' ? undefined : (e.target.value as MaterialKind) })}>
                  {MATERIALS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="fb-c-finish">Finish</label>
                <select id="fb-c-finish" value={c.finish ?? ''} onChange={(e) => onChange({ finish: (e.target.value || undefined) as SurfaceFinish | undefined })}>
                  <option value="">Same as the piece</option>
                  {FINISHES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="inline-field">
              <label htmlFor="fb-c-colour">Colour</label>
              <input id="fb-c-colour" type="color" value={c.color && c.color.length === 7 ? c.color : draft.color.length === 7 ? draft.color : '#e2d9c8'} onChange={(e) => onChange({ color: e.target.value })} />
              {c.color && (
                <button type="button" className="link-button" onClick={() => onChange({ color: undefined })}>
                  Use the piece’s colour
                </button>
              )}
            </div>
            <div className="field-grid two">
              <div className="field">
                <label htmlFor="fb-c-pattern">Fabric pattern</label>
                <select id="fb-c-pattern" value={c.pattern ?? 'plain'} onChange={(e) => onChange({ pattern: e.target.value as UpholsteryPattern })}>
                  {PATTERNS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="fb-c-seams">Seams</label>
                <select id="fb-c-seams" value={c.seams ?? 'none'} onChange={(e) => onChange({ seams: e.target.value as SeamStyle })}>
                  {SEAMS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Range label="Texture size" min={0.25} max={4} step={0.25} value={c.textureScale ?? 1} format={(v) => `${v}×`} onChange={(v) => onChange({ textureScale: v === 1 ? undefined : v })} />
            <Range label="Roughness" min={0} max={1} step={0.05} value={c.roughness ?? -1} format={(v) => (v < 0 ? 'Material default' : v < 0.35 ? `${v} · shiny` : v < 0.7 ? `${v} · soft sheen` : `${v} · matte`)} onChange={(v) => onChange({ roughness: v < 0 ? undefined : v })} allowDefault />
          </>
        )}
      </fieldset>
    </section>
  );
}

function EdgeSelect(props: { label: string; value: number; options: number[]; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))}>
        {props.options.map((i) => (
          <option key={i} value={i}>
            Edge {i + 1}
          </option>
        ))}
      </select>
    </div>
  );
}

function Range(props: { label: string; min: number; max: number; step: number; value: number; format: (v: number) => string; onChange: (v: number) => void; allowDefault?: boolean }) {
  const id = useId();
  const [value, setValue] = useState(props.value);
  useEffect(() => setValue(props.value), [props.value]);
  return (
    <div className="range-field">
      <div className="range-label">
        <label htmlFor={id}>{props.label}</label>
        <output htmlFor={id}>{props.format(value)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={props.allowDefault ? props.min - props.step : props.min}
        max={props.max}
        step={props.step}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerUp={() => props.onChange(value)}
        onKeyUp={() => props.onChange(value)}
        onBlur={() => value !== props.value && props.onChange(value)}
      />
    </div>
  );
}

/** Exact corners of a polygon component (relative to its centre). */
function OutlineEditor({ outline, units, onChange }: { outline: Point[]; units: UnitSystem; onChange: (outline: Point[]) => void }) {
  const toInput = (cm: number) => Math.round(cmToInput(cm, units) * 100) / 100;
  const toCm = (v: number) => inputToCm(v, units);
  const unit = inputUnitLabel(units);
  const set = (i: number, p: Point) => onChange(outline.map((q, k) => (k === i ? p : q)));
  return (
    <details className="fb-outline">
      <summary>Corners ({outline.length})</summary>
      <ol>
        {outline.map((p, i) => (
          <li key={i} className="field-grid two">
            <NumberField label={`Corner ${i + 1} across`} suffix={unit} value={toInput(p.x)} onCommit={(v) => set(i, { x: toCm(v), y: p.y })} />
            <NumberField label={`Corner ${i + 1} front–back`} suffix={unit} value={toInput(p.y)} onCommit={(v) => set(i, { x: p.x, y: toCm(v) })} />
          </li>
        ))}
      </ol>
      <div className="button-row">
        <button type="button" className="secondary small" onClick={() => onChange([...outline, { x: (outline[0].x + outline[outline.length - 1].x) / 2, y: (outline[0].y + outline[outline.length - 1].y) / 2 }])}>
          Add a corner
        </button>
        <button type="button" className="secondary small" disabled={outline.length <= 3} onClick={() => onChange(outline.slice(0, -1))}>
          Remove the last corner
        </button>
      </div>
    </details>
  );
}
