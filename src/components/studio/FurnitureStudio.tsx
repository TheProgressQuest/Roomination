import { Suspense, lazy, useEffect, useId, useMemo, useState } from 'react';
import { FURNITURE_KIND_LABELS } from '../../model/furnitureKinds';
import { boundingBox } from '../../model/polygon';
import { flattenShape, isCurved, ringsSvgPath, scaleShape, shapeProblem, shapeRings, shapeTemplate, SHAPE_TEMPLATE_LABELS, type ShapeTemplate } from '../../model/shape';
import { cornerAngle, deleteVertex, edgeLength, insertVertex, moveVertex, resizeShape, setCornerAngle, setEdgeLength, shapeSize, toggleCurve } from '../../model/shapeEdit';
import type { FurnitureCategory, FurnitureKind, FurnitureShape, MaterialKind, Point, ShapeVertex, SurfaceFinish, UnitSystem } from '../../model/types';
import { cmToInput, formatLength, inputToCm, inputUnitLabel } from '../../model/units';
import { traceAlphaOutline } from '../../photo/trace';
import type { FurnitureTemplate } from '../../storage/projectFile';
import { useAssetImage } from '../useAssetImage';
import { Dialog } from '../Dialog';
import { Icon } from '../Icon';
import { NumberField } from '../NumberField';
import { SegmentedControl } from '../SegmentedControl';
import { ShapeCanvas, type StudioSelection, type TraceReference } from './ShapeCanvas';
import type { WorkshopPhoto } from '../../photo/PhotoWorkshop';

/**
 * The furniture studio: draw or edit a piece's outline (corners, exact lengths and angles,
 * curves), set its details and appearance, and attach photos. Nothing here changes the
 * project until Save, which applies everything as one undoable step.
 */

const PhotoWorkshop = lazy(() => import('../../photo/PhotoWorkshop'));
const ShapeBuilder = lazy(() => import('../../builder/ShapeBuilder'));

export interface StudioResult {
  template: FurnitureTemplate;
  /** Also keep a copy in the furniture library. */
  saveToLibrary: boolean;
}

interface FurnitureStudioProps {
  title: string;
  /** What to start from; a template without a shape starts as its rectangle. */
  initial: FurnitureTemplate;
  /** Start in drawing mode with no corners (draw from scratch). */
  startDrawing?: boolean;
  /** Start by adding photos. */
  startWithPhotos?: boolean;
  /** Start in the Shape Builder. */
  startWithBuilder?: boolean;
  units: UnitSystem;
  touch: boolean;
  /** Offer "Also save to my furniture library" (off when already editing a library item). */
  offerLibrary: boolean;
  saveLabel: string;
  /** Applies the result; resolves to a reason if it couldn't be applied (the studio then stays open). */
  onSave: (result: StudioResult) => Promise<string | null>;
  onCancel: () => void;
}

interface Draft {
  name: string;
  kind: FurnitureKind;
  category: FurnitureCategory;
  height: number;
  color: string;
  clearance: number;
  material: MaterialKind | null;
  finish: SurfaceFinish;
  textures: { top?: string; front?: string; side?: string };
  photos: string[];
  points: ShapeVertex[];
  /** Holes, separate parts and the Shape Builder recipe (the outline is edited here; these come from the builder). */
  holes?: ShapeVertex[][];
  islands?: FurnitureShape['islands'];
  source?: FurnitureShape['source'];
  closed: boolean;
}

const MATERIALS: { value: MaterialKind | 'none'; label: string }[] = [
  { value: 'none', label: 'Plain' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'leather', label: 'Leather' },
  { value: 'wood', label: 'Wood' },
  { value: 'metal', label: 'Metal' },
  { value: 'glass', label: 'Glass' },
  { value: 'plastic', label: 'Plastic' },
  { value: 'custom', label: 'Custom' },
];
const FINISHES: { value: SurfaceFinish; label: string }[] = [
  { value: 'matte', label: 'Matte' },
  { value: 'satin', label: 'Satin' },
  { value: 'gloss', label: 'Gloss' },
];
const CATEGORIES: { value: FurnitureCategory; label: string }[] = [
  { value: 'furniture', label: 'Furniture' },
  { value: 'decoration', label: 'Décor' },
  { value: 'floorCovering', label: 'Rug / mat' },
];
const SNAPS = [
  { value: 0, label: 'Off' },
  { value: 1, label: '1 cm' },
  { value: 5, label: '5 cm' },
  { value: 10, label: '10 cm' },
];

/** Width and depth of a whole shape (all its parts). */
function shapeBox(shape: FurnitureShape): { width: number; depth: number } {
  const box = boundingBox(shapeRings(shape).flatMap((r) => r.outer));
  return { width: box.maxX - box.minX, depth: box.maxY - box.minY };
}

function draftFrom(t: FurnitureTemplate, drawing: boolean): Draft {
  const rectangle: ShapeVertex[] = [
    { x: -t.width / 2, y: -t.depth / 2 },
    { x: t.width / 2, y: -t.depth / 2 },
    { x: t.width / 2, y: t.depth / 2 },
    { x: -t.width / 2, y: t.depth / 2 },
  ];
  return {
    name: t.name,
    kind: t.kind,
    category: t.category,
    height: t.height,
    color: t.color,
    clearance: t.clearance ?? 0,
    material: t.appearance?.material ?? null,
    finish: t.appearance?.finish ?? 'satin',
    textures: { ...(t.appearance?.textures ?? {}) },
    photos: [...(t.appearance?.photos ?? [])],
    points: drawing ? [] : (t.shape?.points ?? rectangle),
    ...(drawing ? {} : { holes: t.shape?.holes, islands: t.shape?.islands, source: t.shape?.source }),
    closed: !drawing,
  };
}

/** The draft's whole shape: its outline plus any holes and separate parts. */
function draftShape(draft: Draft): FurnitureShape {
  return {
    points: draft.points,
    ...(draft.holes?.length ? { holes: draft.holes } : {}),
    ...(draft.islands?.length ? { islands: draft.islands } : {}),
    ...(draft.source?.length ? { source: draft.source } : {}),
  };
}

/** A new outline: a recipe no longer describes a hand-edited outline, so it's let go. */
const withPoints = (draft: Draft, points: ShapeVertex[]): Draft => ({ ...draft, points, source: undefined });

export default function FurnitureStudio(props: FurnitureStudioProps) {
  const { units, touch, initial } = props;
  const start = useMemo(() => draftFrom(initial, props.startDrawing ?? false), [initial, props.startDrawing]);
  /** What's on screen. Dragging and typing change it live... */
  const [draft, setDraft] = useState<Draft>(start);
  /** ...while history only records finished changes (a drag released, a field left). */
  const [committed, setCommitted] = useState<Draft>(start);
  const [past, setPast] = useState<Draft[]>([]);
  const [future, setFuture] = useState<Draft[]>([]);
  const [selection, setSelection] = useState<StudioSelection>(null);
  const [snap, setSnap] = useState(1);
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  /** Remounts the drawing (refitting the view) when the builder replaces the shape. */
  const [canvasKey, setCanvasKey] = useState(0);
  const startWithBuilder = props.startWithBuilder ?? false;
  useEffect(() => {
    if (startWithBuilder) setBuilderOpen(true);
  }, [startWithBuilder]);
  // Open the photo tools only once the studio itself is showing: modal dialogs stack in the
  // order they open, and the photo tools must sit on top.
  const startWithPhotos = props.startWithPhotos ?? false;
  useEffect(() => {
    if (startWithPhotos) setWorkshopOpen(true);
  }, [startWithPhotos]);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [traceScale, setTraceScale] = useState(0.2);
  const [traceOpacity, setTraceOpacity] = useState(0.6);
  const [measuring, setMeasuring] = useState<Point[] | null>(null);
  const [measureLength, setMeasureLength] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const traceImage = useAssetImage(traceId ?? undefined);

  const unit = inputUnitLabel(units);
  const toInput = (cm: number) => Math.round(cmToInput(cm, units) * 100) / 100;
  const toCm = (v: number) => inputToCm(v, units);

  const problem = draft.closed ? shapeProblem(draftShape(draft)) : null;
  const composite = !!(draft.holes?.length || draft.islands?.length);
  const size = draft.closed && draft.points.length >= 3 ? (composite ? shapeBox(draftShape(draft)) : shapeSize(draft.points)) : null;

  /** Records a finished change as one undo step (nothing is recorded if nothing changed). */
  function commit(next: Draft) {
    setDraft(next);
    if (next === committed) return;
    setPast((p) => [...p.slice(-99), committed]);
    setFuture([]);
    setCommitted(next);
    setMessage(null);
  }
  const update = (changes: Partial<Draft>) => commit('points' in changes ? withPoints({ ...draft, ...changes }, changes.points!) : { ...draft, ...changes });

  /** Stretches the whole shape (holes and separate parts too) about its centre. */
  function resize(width: number, depth: number) {
    if (!composite) {
      update({ points: resizeShape(draft.points, width, depth) });
      return;
    }
    const shape = draftShape(draft);
    const box = boundingBox(shapeRings(shape).flatMap((r) => r.outer));
    const sx = width / Math.max(box.maxX - box.minX, 1e-9);
    const sy = depth / Math.max(box.maxY - box.minY, 1e-9);
    const c = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    const scaled = scaleShape(shape, sx, sy);
    const back = (pts: ShapeVertex[]) => pts.map((v) => ({ x: v.x + c.x - c.x * sx, y: v.y + c.y - c.y * sy, ...(v.c1 && v.c2 ? { c1: { x: v.c1.x + c.x - c.x * sx, y: v.c1.y + c.y - c.y * sy }, c2: { x: v.c2.x + c.x - c.x * sx, y: v.c2.y + c.y - c.y * sy } } : {}) }));
    commit({
      ...draft,
      points: back(scaled.points),
      holes: scaled.holes?.map(back),
      islands: scaled.islands?.map((i) => ({ points: back(i.points), ...(i.holes ? { holes: i.holes.map(back) } : {}) })),
      source: undefined,
    });
  }

  function onCanvasChange(points: ShapeVertex[], done: boolean) {
    if (!done) {
      setDraft(withPoints(draft, points));
      return;
    }
    commit(withPoints(draft, points));
  }

  function undo() {
    const previous = past.at(-1);
    if (!previous) return;
    setPast(past.slice(0, -1));
    setFuture([committed, ...future]);
    setDraft(previous);
    setCommitted(previous);
    setSelection(null);
  }
  function redo() {
    const nextDraft = future[0];
    if (!nextDraft) return;
    setFuture(future.slice(1));
    setPast([...past, committed]);
    setDraft(nextDraft);
    setCommitted(nextDraft);
    setSelection(null);
  }

  function useTemplate(template: ShapeTemplate) {
    commit({ ...draft, points: shapeTemplate(template).points, holes: undefined, islands: undefined, source: undefined, closed: true });
    setSelection(null);
  }

  function startDrawing() {
    commit({ ...draft, points: [], holes: undefined, islands: undefined, source: undefined, closed: false });
    setSelection(null);
  }

  function closeOutline() {
    if (draft.points.length < 3) return;
    commit({ ...draft, closed: true });
  }

  function deleteCorner(index: number) {
    if (draft.points.length <= 3) {
      setMessage('A shape needs at least three corners.');
      return;
    }
    commit(withPoints(draft, deleteVertex(draft.points, index)));
    setSelection(null);
  }

  // Tracing reference (a photo shown under the outline at a scale the person sets).
  const reference: TraceReference | null = useMemo(
    () => (traceImage ? { url: traceImage.src, width: traceImage.naturalWidth, height: traceImage.naturalHeight, cmPerPx: traceScale, opacity: traceOpacity } : null),
    [traceImage, traceScale, traceOpacity],
  );

  function onMeasurePoint(p: Point) {
    const points = [...(measuring ?? []), p].slice(-2);
    setMeasuring(points);
  }
  function applyScale() {
    if (!measuring || measuring.length < 2 || !measureLength || measureLength <= 0) return;
    const drawn = Math.hypot(measuring[1].x - measuring[0].x, measuring[1].y - measuring[0].y);
    if (drawn <= 0) return;
    setTraceScale(traceScale * (toCm(measureLength) / drawn));
    setMeasuring(null);
    setMeasureLength(null);
    setMessage('Scale set. Trace the outline over the photo, or let Roomination trace it, then check the measurements.');
  }

  async function autoTrace() {
    if (!traceImage) return;
    const outline = traceAlphaOutline(traceImage, traceScale);
    if (!outline) {
      setMessage('No clear silhouette found. Remove the background first (Photos → Edit), or trace the outline by hand.');
      return;
    }
    commit({ ...draft, points: outline, holes: undefined, islands: undefined, source: undefined, closed: true });
    setSelection(null);
    setMessage('Outline traced from the photo. Photos are rarely perfectly square-on, so check the width and depth against the real piece.');
  }

  function onWorkshopDone(photos: WorkshopPhoto[]) {
    setWorkshopOpen(false);
    if (photos.length === 0) return;
    const textures = { ...draft.textures };
    for (const photo of photos) if (photo.view !== 'other' && !textures[photo.view]) textures[photo.view] = photo.id;
    commit({ ...draft, photos: [...new Set([...draft.photos, ...photos.map((p) => p.id)])], textures });
    const top = photos.find((p) => p.view === 'top');
    if (top) setTraceId(top.id);
    const used = (['front', 'side', 'top'] as const).filter((v) => photos.some((p) => p.view === v));
    setMessage(
      `${photos.length === 1 ? 'Photo' : `${photos.length} photos`} added${used.length ? ` (used for the ${used.join(', ')} of the 3D model)` : ''}. ` +
        (top ? 'Set the scale and trace the outline over the top photo, or draw it.' : 'Now draw the outline, or start from a shape. A photo from above can be traced.'),
    );
  }

  async function save() {
    if (!draft.closed) {
      setMessage('Close the outline first: click its first corner, or press Close shape.');
      return;
    }
    if (problem) {
      setMessage(problem);
      return;
    }
    // A standard piece whose outline wasn't touched stays standard (keeping its per-type 3D
    // look, e.g. a sofa's back and arms) even if its colour, material or photos changed.
    const shape = draftShape(draft);
    const outlineUntouched = !initial.shape && JSON.stringify(shape) === JSON.stringify({ points: start.points });
    const { width, depth } = outlineUntouched ? { width: initial.width, depth: initial.depth } : shapeBox(shape);
    const textures = Object.fromEntries(Object.entries(draft.textures).filter(([, v]) => v));
    const appearance =
      draft.material || draft.photos.length > 0 || Object.keys(textures).length > 0
        ? { material: draft.material ?? ('custom' as const), finish: draft.finish, ...(Object.keys(textures).length ? { textures } : {}), ...(draft.photos.length ? { photos: draft.photos } : {}) }
        : undefined;
    const template: FurnitureTemplate = {
      ...initial,
      name: draft.name.trim() || 'Custom piece',
      kind: draft.kind,
      category: draft.category,
      height: draft.height,
      color: draft.color,
      width,
      depth,
      shape: outlineUntouched ? undefined : shape,
      ...(draft.clearance > 0 ? { clearance: draft.clearance } : { clearance: undefined }),
      appearance,
    };
    const refused = await props.onSave({ template, saveToLibrary });
    if (refused) setMessage(refused);
  }

  // Keyboard shortcuts while the studio is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The Shape Builder and photo tools have their own undo while they're open on top.
      if (builderOpen || workshopOpen) return;
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selectedVertex = selection?.kind === 'vertex' ? selection.index : null;
  const selectedEdge = selection?.kind === 'edge' ? selection.index : null;

  return (
    <Dialog
      open
      title={props.title}
      onClose={props.onCancel}
      className="studio-dialog"
      footer={
        <div className="studio-footer">
          {props.offerLibrary && (
            <label className="toggle">
              <input type="checkbox" checked={saveToLibrary} onChange={(e) => setSaveToLibrary(e.target.checked)} />
              <span>Also save to my furniture library</span>
            </label>
          )}
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
      <div className="studio">
        <div className="studio-stage">
          <div className="studio-toolbar" role="toolbar" aria-label="Shape tools">
            <button type="button" className="icon-button small" onClick={undo} disabled={past.length === 0} aria-label="Undo" title="Undo (Ctrl/⌘ Z)">
              <Icon name="undo" />
            </button>
            <button type="button" className="icon-button small" onClick={redo} disabled={future.length === 0} aria-label="Redo" title="Redo">
              <Icon name="redo" />
            </button>
            <button type="button" className="secondary small" onClick={() => commit(start)} disabled={committed === start}>
              Reset
            </button>
            <TemplatePicker onPick={useTemplate} onDraw={startDrawing} />
            <button type="button" className="secondary small" onClick={() => setBuilderOpen(true)} title="Combine rectangles, circles, curves and more into one shape">
              <Icon name="shapes" size={16} /> Shape Builder
            </button>
            {!draft.closed && (
              <button type="button" className="primary small" onClick={closeOutline} disabled={draft.points.length < 3}>
                Close shape
              </button>
            )}
            <SnapPicker value={snap} onChange={setSnap} />
          </div>

          <ShapeCanvas
            key={canvasKey}
            points={draft.points}
            holes={draft.holes?.map((h) => flattenShape({ points: h }))}
            islands={draft.islands?.map((i) => ({ outer: flattenShape({ points: i.points }), holes: (i.holes ?? []).map((h) => flattenShape({ points: h })) }))}
            closed={draft.closed}
            selection={selection}
            snap={snap}
            units={units}
            reference={reference}
            measuring={measuring}
            touch={touch}
            onChange={onCanvasChange}
            onSelect={setSelection}
            onAddPoint={(p) => commit({ ...draft, points: [...draft.points, p] })}
            onClose={closeOutline}
            onDeleteVertex={deleteCorner}
            onMeasurePoint={onMeasurePoint}
          />

          <p className={`studio-status ${problem || message ? '' : 'is-quiet'}`} role="status" aria-live="polite">
            {problem ?? message ?? (draft.closed ? 'Drag corners to reshape. Select an edge to type its length, curve it, or add a corner.' : 'Click (or tap) to place each corner.')}
          </p>
        </div>

        <div className="studio-panel">
          <section className="studio-section">
            <h3>Details</h3>
            <div className="field">
              <label htmlFor="studio-name">Name</label>
              <input id="studio-name" type="text" value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onBlur={() => commit(draft)} />
            </div>
            <KindSelect value={draft.kind} onChange={(kind) => update({ kind })} />
            <SegmentedControl label="Layer" value={draft.category} options={CATEGORIES} onChange={(category) => update({ category })} />
            <div className="field-grid two">
              <NumberField label="Height" suffix={unit} min={0} value={toInput(draft.height)} onCommit={(v) => v > 0 && update({ height: toCm(v) })} />
              <NumberField label="Keep clear in front" suffix={unit} min={0} value={toInput(draft.clearance)} onCommit={(v) => update({ clearance: Math.max(0, toCm(v)) })} />
            </div>
          </section>

          {size && (
            <section className="studio-section">
              <h3>Overall size</h3>
              <div className="field-grid two">
                <NumberField label="Width" suffix={unit} min={0} value={toInput(size.width)} onCommit={(v) => v > 0 && resize(toCm(v), size.depth)} />
                <NumberField label="Depth" suffix={unit} min={0} value={toInput(size.depth)} onCommit={(v) => v > 0 && resize(size.width, toCm(v))} />
              </div>
              <p className="hint">Changing these stretches the whole outline. Front is at the bottom of the drawing.</p>
            </section>
          )}

          {draft.closed && selectedVertex !== null && draft.points[selectedVertex] && (
            <section className="studio-section">
              <h3>Corner {selectedVertex + 1}</h3>
              <div className="field-grid two">
                <NumberField label="Across (x)" suffix={unit} value={toInput(draft.points[selectedVertex].x)} onCommit={(v) => update({ points: moveVertex(draft.points, selectedVertex, { x: toCm(v), y: draft.points[selectedVertex].y }) })} />
                <NumberField label="Front–back (y)" suffix={unit} value={toInput(draft.points[selectedVertex].y)} onCommit={(v) => update({ points: moveVertex(draft.points, selectedVertex, { x: draft.points[selectedVertex].x, y: toCm(v) }) })} />
                <NumberField label="Inside angle" suffix="°" min={1} value={Math.round(cornerAngle(draft.points, selectedVertex) * 10) / 10} onCommit={(v) => update({ points: setCornerAngle(draft.points, selectedVertex, v) })} />
              </div>
              <div className="button-row">
                <button type="button" className="secondary small" onClick={() => setSelection({ kind: 'edge', index: selectedVertex })}>
                  Edit the edge after this corner
                </button>
                <button type="button" className="danger compact small" onClick={() => deleteCorner(selectedVertex)} disabled={draft.points.length <= 3}>
                  <Icon name="trash" size={16} /> Delete corner
                </button>
              </div>
            </section>
          )}

          {draft.closed && selectedEdge !== null && draft.points[selectedEdge] && (
            <section className="studio-section">
              <h3>Edge {selectedEdge + 1}</h3>
              <NumberField label={isCurved(draft.points[selectedEdge]) ? 'Length (along the curve)' : 'Length'} suffix={unit} min={0} value={toInput(edgeLength(draft.points, selectedEdge))} onCommit={(v) => v > 0 && update({ points: setEdgeLength(draft.points, selectedEdge, toCm(v)) })} />
              <div className="button-row">
                <button type="button" className="secondary small" onClick={() => update({ points: toggleCurve(draft.points, selectedEdge) })}>
                  {isCurved(draft.points[selectedEdge]) ? 'Make straight' : 'Make curved'}
                </button>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => {
                    update({ points: insertVertex(draft.points, selectedEdge) });
                    setSelection({ kind: 'vertex', index: selectedEdge + 1 });
                  }}
                >
                  Add a corner in the middle
                </button>
              </div>
              {isCurved(draft.points[selectedEdge]) && <p className="hint">Drag the two square handles to shape the curve.</p>}
            </section>
          )}

          {draft.closed && (
            <section className="studio-section">
              <h3>All corners</h3>
              <ol className="corner-list">
                {draft.points.map((v, i) => (
                  <li key={i}>
                    <button type="button" className={selectedVertex === i ? 'is-active' : ''} aria-pressed={selectedVertex === i} onClick={() => setSelection({ kind: 'vertex', index: i })}>
                      <span>Corner {i + 1}</span>
                      <span className="corner-meta">
                        {formatLength(v.x, units)}, {formatLength(v.y, units)} · edge {formatLength(edgeLength(draft.points, i), units)}
                        {isCurved(v) ? ' (curved)' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="studio-section">
            <h3>Appearance</h3>
            <div className="inline-field">
              <label htmlFor="studio-colour">Colour</label>
              <input id="studio-colour" type="color" value={draft.color.length === 7 ? draft.color : '#e9a178'} onChange={(e) => setDraft({ ...draft, color: e.target.value })} onBlur={() => commit(draft)} />
            </div>
            <div className="field">
              <label htmlFor="studio-material">Material</label>
              <select id="studio-material" value={draft.material ?? 'none'} onChange={(e) => update({ material: e.target.value === 'none' ? null : (e.target.value as MaterialKind) })}>
                {MATERIALS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            {draft.material && <SegmentedControl label="Finish" value={draft.finish} options={FINISHES} onChange={(finish) => update({ finish })} />}
            <AppearancePreview draft={draft} />
          </section>

          <section className="studio-section">
            <h3>Photos</h3>
            <p className="hint">For best results, photograph your furniture from the front, the side and above. Any one photo is enough to start. Photos stay on this device.</p>
            <button type="button" className="secondary" onClick={() => setWorkshopOpen(true)}>
              <Icon name="upload" size={16} /> {draft.photos.length ? 'Add or edit photos' : 'Add photos'}
            </button>
            {draft.photos.length > 0 && (
              <ul className="photo-list">
                {draft.photos.map((id) => (
                  <PhotoRow
                    key={id}
                    id={id}
                    textures={draft.textures}
                    tracing={traceId === id}
                    onTexture={(surface) => update({ textures: { ...draft.textures, [surface]: draft.textures[surface] === id ? undefined : id } })}
                    onTrace={() => setTraceId(traceId === id ? null : id)}
                    onRemove={() => update({ photos: draft.photos.filter((p) => p !== id), textures: Object.fromEntries(Object.entries(draft.textures).filter(([, v]) => v !== id)) })}
                  />
                ))}
              </ul>
            )}
            {reference && (
              <div className="trace-tools">
                <h4>Tracing over a photo</h4>
                <div className="range-field">
                  <div className="range-label">
                    <label htmlFor="trace-opacity">Photo visibility</label>
                    <output htmlFor="trace-opacity">{Math.round(traceOpacity * 100)}%</output>
                  </div>
                  <input id="trace-opacity" type="range" min={0.1} max={1} step={0.05} value={traceOpacity} onChange={(e) => setTraceOpacity(Number(e.target.value))} />
                </div>
                {measuring ? (
                  <div className="measure-panel">
                    <p className="hint">{measuring.length < 2 ? 'Click two points on the photo whose real distance you know (e.g. the two ends of the sofa).' : 'Now type the real distance between the two points.'}</p>
                    {measuring.length === 2 && (
                      <NumberField label="Real distance" suffix={unit} min={0} value={measureLength ?? 0} onCommit={(v) => setMeasureLength(v)} />
                    )}
                    <div className="button-row">
                      <button type="button" className="primary small" onClick={applyScale} disabled={measuring.length < 2 || !measureLength}>
                        Set scale
                      </button>
                      <button type="button" className="secondary small" onClick={() => setMeasuring(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="button-row">
                    <button type="button" className="secondary small" onClick={() => setMeasuring([])}>
                      Set scale from a known length
                    </button>
                    <button type="button" className="secondary small" onClick={autoTrace}>
                      Trace outline automatically
                    </button>
                  </div>
                )}
                <p className="hint">A photo has no built-in scale, and angled photos distort shapes: always check the measurements against the real piece.</p>
              </div>
            )}
          </section>
        </div>
      </div>

      {builderOpen && (
        <Suspense fallback={<p className="hint">Loading the Shape Builder…</p>}>
          <ShapeBuilder
            shape={draft.closed && draft.points.length >= 3 ? draftShape(draft) : null}
            units={units}
            color={draft.color}
            onCancel={() => setBuilderOpen(false)}
            onDone={({ shape }) => {
              setBuilderOpen(false);
              commit({ ...draft, points: shape.points, holes: shape.holes, islands: shape.islands, source: shape.source, closed: true });
              setSelection(null);
              setCanvasKey((k) => k + 1);
              setMessage(
                shape.holes?.length || shape.islands?.length
                  ? 'Shape made in the Shape Builder. Its holes and separate parts are kept; reopen the builder to change them.'
                  : 'Shape made in the Shape Builder. Reopen the builder to change its parts, or fine-tune the outline here.',
              );
            }}
          />
        </Suspense>
      )}

      {workshopOpen && (
        <Suspense fallback={<p className="hint">Loading photo tools…</p>}>
          <PhotoWorkshop onDone={onWorkshopDone} onCancel={() => setWorkshopOpen(false)} />
        </Suspense>
      )}
    </Dialog>
  );
}

function TemplatePicker({ onPick, onDraw }: { onPick: (t: ShapeTemplate) => void; onDraw: () => void }) {
  const id = useId();
  return (
    <div className="studio-select">
      <label htmlFor={id} className="visually-hidden">
        Start from a shape
      </label>
      <select
        id={id}
        value=""
        onChange={(e) => {
          if (e.target.value === 'draw') onDraw();
          else if (e.target.value) onPick(e.target.value as ShapeTemplate);
        }}
      >
        <option value="">Start from…</option>
        <option value="draw">Draw from scratch</option>
        {(Object.keys(SHAPE_TEMPLATE_LABELS) as ShapeTemplate[]).map((t) => (
          <option key={t} value={t}>
            {SHAPE_TEMPLATE_LABELS[t]}
          </option>
        ))}
      </select>
    </div>
  );
}

function SnapPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div className="studio-select">
      <label htmlFor={id}>Snap</label>
      <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {SNAPS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function KindSelect({ value, onChange }: { value: FurnitureKind; onChange: (kind: FurnitureKind) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>Type</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as FurnitureKind)}>
        {(Object.keys(FURNITURE_KIND_LABELS) as FurnitureKind[]).map((k) => (
          <option key={k} value={k}>
            {FURNITURE_KIND_LABELS[k]}
          </option>
        ))}
      </select>
    </div>
  );
}

function PhotoRow(props: { id: string; textures: Draft['textures']; tracing: boolean; onTexture: (surface: 'top' | 'front' | 'side') => void; onTrace: () => void; onRemove: () => void }) {
  const image = useAssetImage(props.id);
  return (
    <li className="photo-row">
      {image ? <img src={image.src} alt="" className="photo-thumb" /> : <span className="photo-thumb is-missing">Photo missing</span>}
      <div className="photo-actions">
        <span className="photo-label">Use as:</span>
        {(['top', 'front', 'side'] as const).map((surface) => (
          <label key={surface} className="chip-toggle">
            <input type="checkbox" checked={props.textures[surface] === props.id} onChange={() => props.onTexture(surface)} disabled={!image} />
            <span>{surface === 'top' ? 'Top' : surface === 'front' ? 'Front' : 'Side'}</span>
          </label>
        ))}
        <button type="button" className="link-button" onClick={props.onTrace} disabled={!image}>
          {props.tracing ? 'Hide from drawing' : 'Trace over it'}
        </button>
        <button type="button" className="link-button" onClick={props.onRemove}>
          Remove
        </button>
      </div>
    </li>
  );
}

/** A quick look at the result: the outline from above (with the top photo) and the front. */
function AppearancePreview({ draft }: { draft: Draft }) {
  const top = useAssetImage(draft.textures.top);
  const front = useAssetImage(draft.textures.front);
  if (!draft.closed || draft.points.length < 3) return null;
  const rings = shapeRings(draftShape(draft));
  const box = boundingBox(rings.flatMap((r) => r.outer));
  const w = box.maxX - box.minX || 1;
  const d = box.maxY - box.minY || 1;
  const h = draft.height || 1;
  const id = `preview-${draft.points.length}`;
  return (
    <div className="appearance-preview" aria-label="Preview of the piece from above and from the front">
      <figure>
        <svg viewBox={`${box.minX - 4} ${box.minY - 4} ${w + 8} ${d + 8}`} role="img" aria-label="From above">
          {top && (
            <defs>
              <pattern id={id} patternUnits="userSpaceOnUse" x={box.minX} y={box.minY} width={w} height={d}>
                <image href={top.src} width={w} height={d} preserveAspectRatio="none" />
              </pattern>
            </defs>
          )}
          <path d={ringsSvgPath(rings)} fillRule="evenodd" fill={top ? `url(#${id})` : draft.color} stroke="rgba(0,0,0,0.35)" strokeWidth={Math.max(w, d) / 150} />
        </svg>
        <figcaption>Above</figcaption>
      </figure>
      <figure>
        <svg viewBox={`-4 -4 ${w + 8} ${h + 8}`} role="img" aria-label="From the front">
          <rect x={0} y={0} width={w} height={h} fill={draft.color} />
          {front && <image href={front.src} x={0} y={0} width={w} height={h} preserveAspectRatio="none" />}
          <rect x={0} y={0} width={w} height={h} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={Math.max(w, h) / 150} />
        </svg>
        <figcaption>Front</figcaption>
      </figure>
    </div>
  );
}
