import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { NumberField } from '../components/NumberField';
import { SegmentedControl } from '../components/SegmentedControl';
import type { Project, UnitSystem } from '../model/types';
import { CM_PER_INCH, cmToInput, inputToCm, inputUnitLabel } from '../model/units';
import { buildFromScan, initialReview, sectionLabel, type BuiltObject, type BuiltOpening, type BuildResult, type Note, type Review } from './convert';
import { BOX, catalogueName, categoryLabel, choicesFor, SCAN_CATEGORIES, STAIRS, suggestPiece } from './furnitureMap';
import { readScanFile, type ScanChoice } from './readScan';
import { ScanPreview } from './ScanPreview';
import { SAMPLES, sampleToRoomPlan } from './samples';
import { parseRoomPlan } from './roomPlan';
import type { ScanConfidence, ScanData, ScanOpeningKind } from './types';

/**
 * Import a room scan: choose a file (or a synthetic sample), pick a room if the file holds
 * several, then review and correct everything before a NEW project is created.
 *
 * Everything happens in this browser tab. The file is read locally (see readScan.ts), only
 * its geometry is used, and nothing is sent anywhere.
 */

interface Props {
  open: boolean;
  units: UnitSystem;
  onClose: () => void;
  /** Saves the project as a new project and opens it; resolves to the name it was saved as. */
  onCreate: (project: Project) => Promise<void>;
}

type Stage = { step: 'choose' } | { step: 'pick'; choices: ScanChoice[]; skipped: string | null } | { step: 'review'; scan: ScanData; skipped: string | null };
type Tab = 'room' | 'openings' | 'furniture' | 'notes';

export default function ScanImportDialog({ open, units, onClose, onCreate }: Props) {
  const [stage, setStage] = useState<Stage>({ step: 'choose' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Start afresh each time the dialog opens.
  useEffect(() => {
    if (open) {
      setStage({ step: 'choose' });
      setError(null);
    }
  }, [open]);

  async function readFile(file: File) {
    setBusy(true);
    setError(null);
    const result = await readScanFile(file, file.name);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.choices.length === 1) setStage({ step: 'review', scan: result.choices[0].scan, skipped: result.skipped });
    else setStage({ step: 'pick', choices: result.choices, skipped: result.skipped });
  }

  function trySample(index: number) {
    setError(null);
    const sample = SAMPLES[index];
    setStage({ step: 'review', scan: { ...parseRoomPlan(sampleToRoomPlan(sample), 'Synthetic sample (generated in this browser)', sample.name), name: sample.name.replace(/^Sample /, 'Scanned ').replace(/ \(synthetic\)$/, '') }, skipped: null });
  }

  const title = stage.step === 'review' ? 'Review the scanned room' : 'Import a room scan';
  return (
    <Dialog open={open} title={title} onClose={onClose} className={`scan-dialog${stage.step === 'review' ? ' is-review' : ''}`}>
      {stage.step === 'choose' && <ChooseStep busy={busy} error={error} onFile={readFile} onSample={trySample} />}
      {stage.step === 'pick' && <PickStep choices={stage.choices} onPick={(scan) => setStage({ step: 'review', scan, skipped: stage.skipped })} onBack={() => setStage({ step: 'choose' })} />}
      {stage.step === 'review' && <ReviewStep key={stage.scan.source + stage.scan.name} scan={stage.scan} skipped={stage.skipped} units={units} onBack={() => setStage({ step: 'choose' })} onCancel={onClose} onCreate={onCreate} />}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Step 1: choose a file
// ---------------------------------------------------------------------------

function ChooseStep({ busy, error, onFile, onSample }: { busy: boolean; error: string | null; onFile: (file: File) => void; onSample: (index: number) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <>
      <section className="dialog-section">
        <div
          className={`scan-drop${dragging ? ' is-dragging' : ''}`}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) onFile(file);
          }}
        >
          <Icon name="upload" size={22} />
          <p>
            <strong>Choose a scan from your iPhone or iPad</strong>
          </p>
          <p className="hint">Apple RoomPlan .json, a 3D Model Anything room .zip, or a Roomination scan file. On an iPhone, pick it from Files (AirDropped scans are in Downloads).</p>
          <button type="button" className="primary" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? 'Reading the scan…' : 'Choose scan file…'}
          </button>
          <input
            ref={input}
            type="file"
            accept=".json,.zip,application/json,application/zip"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = '';
            }}
          />
        </div>
        {error && (
          <p className="form-error scan-error" role="alert">
            {error}
          </p>
        )}
        <p className="hint scan-privacy">
          <Icon name="lock" size={14} /> The scan is read on this device only. Nothing is uploaded, and photos, 3D meshes, depth recordings and AR maps inside a .zip are never opened.
        </p>
      </section>
      <section className="dialog-section">
        <h3>No scan to hand?</h3>
        <p className="hint section-hint">Try a made-up scan (generated here, not from a real room):</p>
        <div className="button-row">
          {SAMPLES.map((s, i) => (
            <button key={s.name} type="button" className="secondary small" onClick={() => onSample(i)}>
              {s.name.replace(/^Sample /, '').replace(/ \(synthetic\)$/, '').replace(/^./, (c) => c.toUpperCase())}
            </button>
          ))}
        </div>
      </section>
      <section className="dialog-section">
        <details className="scan-help">
          <summary>How do I scan a room?</summary>
          <p className="hint">
            Scanning needs an iPhone or iPad with a LiDAR Scanner (iPhone 12 Pro or a later Pro model, or an iPad Pro from 2020 on) and an app that uses Apple’s RoomPlan and can export its result, such as 3D Model Anything. Roomination’s website can’t scan by itself: browsers can’t use the LiDAR Scanner. Send the exported file to the device you plan on with AirDrop or the Files app, then choose it here.
          </p>
        </details>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2: the file holds several rooms
// ---------------------------------------------------------------------------

function PickStep({ choices, onPick, onBack }: { choices: ScanChoice[]; onPick: (scan: ScanData) => void; onBack: () => void }) {
  const [index, setIndex] = useState(0);
  const groupId = useId();
  return (
    <>
      <section className="dialog-section">
        <h3 id={groupId}>This file holds {choices.length} rooms. Which one?</h3>
        <div className="scan-room-list" role="radiogroup" aria-labelledby={groupId}>
          {choices.map((c, i) => (
            <label key={i} className={`scan-room-choice${index === i ? ' is-active' : ''}`}>
              <input type="radio" name="scan-room" checked={index === i} onChange={() => setIndex(i)} />
              <span>
                <strong>{c.label}</strong>
                <span className="hint">
                  {c.scan.walls.length} walls · {c.scan.openings.length} doors and windows · {c.scan.objects.length} objects
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>
      <div className="dialog-footer scan-footer">
        <div className="button-row">
          <button type="button" className="secondary" onClick={onBack}>
            Back
          </button>
          <button type="button" className="primary" onClick={() => onPick(choices[index].scan)}>
            Review this room
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 3: review and correct
// ---------------------------------------------------------------------------

/** A measurement shown exactly (to the millimetre, or a tenth of an inch), never rounded to metres. */
function exact(cm: number, units: UnitSystem): string {
  const value = units === 'metric' ? cm : cm / CM_PER_INCH;
  const text = (Math.round(value * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
  return units === 'metric' ? `${text} cm` : `${text} in`;
}

const CONFIDENCE_LABELS: Record<ScanConfidence, string> = { high: 'High', medium: 'Medium', low: 'Low', unknown: 'Not given' };

function Confidence({ value }: { value: ScanConfidence }) {
  return (
    <span className={`scan-confidence is-${value}`} title="The scanner’s own confidence label">
      {value === 'low' && <Icon name="warning" size={12} />}
      {value === 'unknown' ? 'No confidence given' : `${CONFIDENCE_LABELS[value]} confidence`}
    </span>
  );
}

let addedCount = 0;

function ReviewStep({ scan, skipped, units, onBack, onCancel, onCreate }: { scan: ScanData; skipped: string | null; units: UnitSystem; onBack: () => void; onCancel: () => void; onCreate: (p: Project) => Promise<void> }) {
  const [review, setReview] = useState<Review>(() => initialReview(scan));
  const [tab, setTab] = useState<Tab>('room');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const result = useMemo(() => buildFromScan(scan, review), [scan, review]);
  const listRef = useRef<HTMLDivElement>(null);

  const checks = result.notes.filter((n) => n.level === 'check').length;
  const unit = inputUnitLabel(units);
  const toInput = (cm: number) => cmToInput(cm, units);
  const fromInput = (v: number) => inputToCm(v, units);

  function select(id: string) {
    setSelected(id);
    const isOpening = result.openings.some((o) => o.id === id);
    const isObject = result.objects.some((o) => o.id === id);
    const nextTab: Tab = isOpening ? 'openings' : isObject ? 'furniture' : 'room';
    setTab(nextTab);
    // Bring its card into view once the tab has rendered.
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-item="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  const editOpening = (id: string, change: Partial<Review['openings'][string]>) => setReview((r) => ({ ...r, openings: { ...r.openings, [id]: { ...r.openings[id], ...change } } }));
  const editObject = (id: string, change: Partial<Review['objects'][string]>) => setReview((r) => ({ ...r, objects: { ...r.objects, [id]: { ...r.objects[id], ...change } } }));

  async function create() {
    if (!result.project) return;
    setCreating(true);
    try {
      await onCreate(result.project);
    } finally {
      setCreating(false);
    }
  }

  const tabs: { value: Tab; label: string }[] = [
    { value: 'room', label: 'Room' },
    { value: 'openings', label: `Openings (${result.openings.filter((o) => o.include && !o.problem).length})` },
    { value: 'furniture', label: `Furniture (${result.objects.filter((o) => o.include && !o.problem).length})` },
    { value: 'notes', label: checks ? `Check (${checks})` : 'Notes' },
  ];

  return (
    <>
      <div className="scan-review">
        <div className="scan-stage">
          <ScanPreview result={result} units={units} selectedId={selected} onSelect={select} />
          <p className="hint scan-source">
            {scan.source}
            {skipped ? `. Not opened: ${skipped}.` : '.'}
          </p>
          <p className="scan-legend hint" aria-hidden="true">
            <span className="swatch is-low" /> low confidence <span className="swatch is-added" /> added by Roomination <span className="swatch is-fixture" /> fitted (the optimizer won’t move it)
          </p>
        </div>
        <div className="scan-panel" ref={listRef}>
          <div className="scan-tabs">
            <SegmentedControl label="Review" hideLabel value={tab} options={tabs} onChange={setTab} />
          </div>
          {result.problem && (
            <p className="form-error" role="alert">
              {result.problem}
            </p>
          )}
          {tab === 'room' && <RoomTab result={result} review={review} setReview={setReview} units={units} unit={unit} toInput={toInput} fromInput={fromInput} selected={selected} onSelect={select} />}
          {tab === 'openings' && <OpeningsTab result={result} review={review} setReview={setReview} edit={editOpening} units={units} unit={unit} toInput={toInput} fromInput={fromInput} selected={selected} onSelect={select} />}
          {tab === 'furniture' && <FurnitureTab result={result} setReview={setReview} edit={editObject} units={units} unit={unit} toInput={toInput} fromInput={fromInput} selected={selected} onSelect={select} />}
          {tab === 'notes' && <NotesTab notes={result.notes} onSelect={select} />}
        </div>
      </div>
      <div className="dialog-footer scan-footer">
        <p className="hint">Creates a new project. Nothing you already have is changed.</p>
        <div className="button-row">
          <button type="button" className="secondary" onClick={onBack}>
            Choose another file
          </button>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={create} disabled={!result.project || creating}>
            <Icon name="check" size={16} /> {creating ? 'Creating…' : 'Create new project'}
          </button>
        </div>
      </div>
    </>
  );
}

interface TabProps {
  result: BuildResult;
  units: UnitSystem;
  unit: string;
  toInput: (cm: number) => number;
  fromInput: (v: number) => number;
  selected: string | null;
  onSelect: (id: string) => void;
}

function Measured({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
  return (
    <p className="scan-measured hint">
      <span>Measured: {children}</span>
      {onReset && (
        <button type="button" className="link-button" onClick={onReset}>
          Reset
        </button>
      )}
    </p>
  );
}

function RoomTab({ result, review, setReview, units, unit, toInput, fromInput, selected, onSelect }: TabProps & { review: Review; setReview: (f: (r: Review) => Review) => void }) {
  const nameId = useId();
  const measuredCeiling = result.project && review.ceiling === null ? result.project.room.height : null;
  return (
    <div className="scan-tab">
      <div className="field">
        <label htmlFor={nameId}>Project name</label>
        <input id={nameId} type="text" maxLength={60} value={review.name} onChange={(e) => setReview((r) => ({ ...r, name: e.target.value }))} />
      </div>

      <h3>Orientation</h3>
      <label className="toggle">
        <input type="checkbox" checked={review.straighten} onChange={(e) => setReview((r) => ({ ...r, straighten: e.target.checked }))} />
        Line the walls up with the grid
      </label>
      <p className="hint">{Math.abs(result.skew) < 0.05 ? 'The walls are already lined up.' : `Turns the plan ${Math.abs(Math.round(result.skew * 10) / 10)}°.`} Turning never changes a length or an angle inside the room.</p>
      <div className="button-row">
        <button type="button" className="secondary small" onClick={() => setReview((r) => ({ ...r, quarterTurns: (r.quarterTurns + 3) % 4 }))}>
          <Icon name="rotateLeft" size={16} /> Turn left
        </button>
        <button type="button" className="secondary small" onClick={() => setReview((r) => ({ ...r, quarterTurns: (r.quarterTurns + 1) % 4 }))}>
          <Icon name="rotateRight" size={16} /> Turn right
        </button>
      </div>

      <h3>Ceiling</h3>
      <div className="field-grid two">
        <NumberField label="Ceiling height" suffix={unit} value={toInput(review.ceiling ?? result.project?.room.height ?? 250)} min={0} onCommit={(v) => setReview((r) => ({ ...r, ceiling: fromInput(v) }))} />
      </div>
      {review.ceiling !== null ? (
        <Measured onReset={() => setReview((r) => ({ ...r, ceiling: null }))}>you changed it</Measured>
      ) : (
        measuredCeiling !== null && <Measured>{exact(measuredCeiling, units)} (the most common wall height)</Measured>
      )}

      <h3>Walls</h3>
      <p className="hint section-hint">Walls are numbered clockwise. Changing a length moves the corner at the wall’s end.</p>
      <ul className="scan-list">
        {result.walls.map((w) => (
          <li key={w.id} data-item={w.id} className={`scan-card${selected === w.id ? ' is-selected' : ''}${w.confidence === 'low' ? ' is-low' : ''}`} onClick={() => onSelect(w.id)}>
            <div className="scan-card-head">
              <strong>{w.label}</strong>
              {w.added ? <span className="scan-confidence is-added">Added to close a gap</span> : <Confidence value={w.confidence} />}
            </div>
            {w.outer ? (
              <div className="field-grid two">
                <NumberField label="Length" suffix={unit} value={toInput(w.length)} min={0} onCommit={(v) => setReview((r) => ({ ...r, wallLengths: { ...r.wallLengths, [w.id]: fromInput(v) } }))} />
              </div>
            ) : (
              <p className="hint">Interior wall, {exact(w.length, units)}</p>
            )}
            {w.measured !== null ? (
              <Measured
                onReset={
                  review.wallLengths[w.id] !== undefined
                    ? () =>
                        setReview((r) => {
                          const { [w.id]: _, ...rest } = r.wallLengths;
                          return { ...r, wallLengths: rest };
                        })
                    : undefined
                }
              >
                {exact(w.measured, units)}
                {Math.abs(w.measured - w.length) >= 0.05 && review.wallLengths[w.id] === undefined ? ` (corners joined: ${exact(w.length, units)})` : ''}
              </Measured>
            ) : (
              <p className="hint">Not measured: Roomination added it where the scan missed part of the room.</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const KIND_LABELS: Record<ScanOpeningKind, string> = { door: 'Door', window: 'Window', opening: 'Doorway (no door)' };

function OpeningsTab({ result, review, setReview, edit, units, unit, toInput, fromInput, selected, onSelect }: TabProps & { review: Review; setReview: (f: (r: Review) => Review) => void; edit: (id: string, change: Review['openings'][string]) => void }) {
  return (
    <div className="scan-tab">
      {result.openings.length === 0 && <p className="hint">The scan found no doors or windows.</p>}
      <ul className="scan-list">
        {result.openings.map((o) => (
          <OpeningCard key={o.id} o={o} edit={edit} units={units} unit={unit} toInput={toInput} fromInput={fromInput} selected={selected === o.id} onSelect={onSelect} onRemove={o.added ? () => setReview((r) => ({ ...r, addedOpenings: r.addedOpenings.filter((a) => a.id !== o.id) })) : undefined} review={review} setReview={setReview} />
        ))}
      </ul>
      {result.project && <AddOpening result={result} unit={unit} toInput={toInput} fromInput={fromInput} onAdd={(a) => setReview((r) => ({ ...r, addedOpenings: [...r.addedOpenings, a] }))} />}
    </div>
  );
}

function OpeningCard({ o, edit, units, unit, toInput, fromInput, selected, onSelect, onRemove, review, setReview }: { o: BuiltOpening; edit: (id: string, change: Review['openings'][string]) => void; units: UnitSystem; unit: string; toInput: (cm: number) => number; fromInput: (v: number) => number; selected: boolean; onSelect: (id: string) => void; onRemove?: () => void; review: Review; setReview: (f: (r: Review) => Review) => void }) {
  const m = o.measured;
  const set = (change: Review['openings'][string]) => {
    if (o.added) setReview((r) => ({ ...r, addedOpenings: r.addedOpenings.map((a) => (a.id === o.id ? { ...a, ...change } : a)) }));
    else edit(o.id, change);
  };
  const edit0 = review.openings[o.id];
  const edited = !o.added && !!edit0 && [edit0.kind, edit0.width, edit0.height, edit0.bottom].some((v) => v !== undefined);
  return (
    <li data-item={o.id} className={`scan-card${selected ? ' is-selected' : ''}${o.confidence === 'low' ? ' is-low' : ''}${o.include ? '' : ' is-excluded'}`} onClick={() => onSelect(o.id)}>
      <div className="scan-card-head">
        {o.added ? (
          <strong>{KIND_LABELS[o.kind]} (added)</strong>
        ) : (
          <label className="toggle">
            <input type="checkbox" checked={o.include} onChange={(e) => edit(o.id, { include: e.target.checked })} />
            <strong>
              {KIND_LABELS[o.kind]}
              {o.wall ? ` · ${o.wall}` : ''}
            </strong>
          </label>
        )}
        {o.added ? (
          <button type="button" className="link-button" onClick={onRemove}>
            Remove
          </button>
        ) : (
          <Confidence value={o.confidence} />
        )}
      </div>
      {o.include && (
        <>
          <SegmentedControl label="Type" value={o.kind} options={(['door', 'window', 'opening'] as const).map((k) => ({ value: k, label: k === 'opening' ? 'Doorway' : KIND_LABELS[k] }))} onChange={(kind) => set({ kind })} />
          <div className="field-grid">
            <NumberField label="Width" suffix={unit} value={toInput(o.width)} min={0} onCommit={(v) => set({ width: fromInput(v) })} />
            <NumberField label="Height" suffix={unit} value={toInput(o.height)} min={0} onCommit={(v) => set({ height: fromInput(v) })} />
            {o.kind === 'window' && <NumberField label="Sill height" suffix={unit} value={toInput(o.bottom)} min={0} onCommit={(v) => set({ bottom: fromInput(v) })} />}
          </div>
        </>
      )}
      {m && (
        <Measured onReset={edited ? () => edit(o.id, { kind: undefined, width: undefined, height: undefined, bottom: undefined }) : undefined}>
          {m.kind === o.kind ? '' : `${KIND_LABELS[m.kind].toLowerCase()}, `}
          {exact(m.width, units)} wide, {exact(m.height, units)} high{m.kind === 'window' ? `, sill ${exact(m.bottom, units)}` : ''}
        </Measured>
      )}
      {o.include && o.problem && <p className="scan-problem">{o.problem}</p>}
    </li>
  );
}

function AddOpening({ result, unit, toInput, fromInput, onAdd }: { result: BuildResult; unit: string; toInput: (cm: number) => number; fromInput: (v: number) => number; onAdd: (a: Review['addedOpenings'][number]) => void }) {
  const [kind, setKind] = useState<ScanOpeningKind>('door');
  const [wall, setWall] = useState(0);
  const outer = result.walls.filter((w) => w.outer);
  const length = outer[wall]?.length ?? 100;
  const [offset, setOffset] = useState<number | null>(null);
  const [width, setWidth] = useState(80);
  const wallId = useId();
  const at = offset ?? length / 2;
  return (
    <details className="scan-add">
      <summary>
        <Icon name="plus" size={14} /> Add a door, window or doorway the scan missed
      </summary>
      <SegmentedControl label="Type" value={kind} options={(['door', 'window', 'opening'] as const).map((k) => ({ value: k, label: k === 'opening' ? 'Doorway' : KIND_LABELS[k] }))} onChange={setKind} />
      <div className="field">
        <label htmlFor={wallId}>Wall</label>
        <select id={wallId} value={wall} onChange={(e) => setWall(Number(e.target.value))}>
          {outer.map((w, i) => (
            <option key={w.id} value={i}>
              {w.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field-grid two">
        <NumberField label="Centre, from the wall’s start" suffix={unit} value={toInput(at)} min={0} onCommit={(v) => setOffset(fromInput(v))} />
        <NumberField label="Width" suffix={unit} value={toInput(width)} min={0} onCommit={(v) => setWidth(fromInput(v))} />
      </div>
      <button
        type="button"
        className="secondary small"
        onClick={() =>
          onAdd({ id: `added-${kind}-${++addedCount}-${Date.now().toString(36)}`, kind, wall, offset: at, width, height: kind === 'window' ? 120 : 205, bottom: kind === 'window' ? 90 : 0 })
        }
      >
        Add {kind === 'opening' ? 'doorway' : kind}
      </button>
    </details>
  );
}

function FurnitureTab({ result, setReview, edit, units, unit, toInput, fromInput, selected, onSelect }: TabProps & { setReview: (f: (r: Review) => Review) => void; edit: (id: string, change: Review['objects'][string]) => void }) {
  return (
    <div className="scan-tab">
      <p className="hint section-hint">The scanner measures each object as a box. Roomination suggests a catalogue piece of the same size; its colour and style are a guess, so choose whatever matches.</p>
      {result.objects.length === 0 && <p className="hint">The scan found no furniture.</p>}
      <ul className="scan-list">
        {result.objects.map((o) => (
          <ObjectCard key={o.id} o={o} edit={edit} setReview={setReview} units={units} unit={unit} toInput={toInput} fromInput={fromInput} selected={selected === o.id} onSelect={onSelect} />
        ))}
      </ul>
      {result.project && <AddPiece unit={unit} toInput={toInput} fromInput={fromInput} onAdd={(a) => setReview((r) => ({ ...r, addedPieces: [...r.addedPieces, a] }))} />}
    </div>
  );
}

const CATEGORY_OPTIONS = Object.keys(SCAN_CATEGORIES).sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)));

function ObjectCard({ o, edit, setReview, units, unit, toInput, fromInput, selected, onSelect }: { o: BuiltObject; edit: (id: string, change: Review['objects'][string]) => void; setReview: (f: (r: Review) => Review) => void; units: UnitSystem; unit: string; toInput: (cm: number) => number; fromInput: (v: number) => number; selected: boolean; onSelect: (id: string) => void }) {
  const categoryId = useId();
  const asId = useId();
  const m = o.measured;
  const section = sectionLabel(o.section);
  const options = o.category === 'stairs' ? [STAIRS, BOX] : [...choicesFor(o.category, o.section), BOX];
  const set = (change: Review['objects'][string]) => {
    if (o.added) setReview((r) => ({ ...r, addedPieces: r.addedPieces.map((a) => (a.id === o.id ? { ...a, ...change } : a)) }));
    else edit(o.id, change);
  };
  const sized = m && (Math.abs(o.width - m.width) > 0.05 || Math.abs(o.depth - m.depth) > 0.05 || Math.abs(o.height - m.height) > 0.05);
  return (
    <li data-item={o.id} className={`scan-card${selected ? ' is-selected' : ''}${o.confidence === 'low' ? ' is-low' : ''}${o.include ? '' : ' is-excluded'}`} onClick={() => onSelect(o.id)}>
      <div className="scan-card-head">
        {o.added ? (
          <strong>{o.name} (added)</strong>
        ) : (
          <label className="toggle">
            <input type="checkbox" checked={o.include} onChange={(e) => edit(o.id, { include: e.target.checked })} />
            <strong>{o.name}</strong>
          </label>
        )}
        {o.added ? (
          <button type="button" className="link-button" onClick={() => setReview((r) => ({ ...r, addedPieces: r.addedPieces.filter((a) => a.id !== o.id) }))}>
            Remove
          </button>
        ) : (
          <Confidence value={o.confidence} />
        )}
      </div>
      {m && (
        <p className="hint scan-says">
          <span className="scan-tag">Scanner</span> {categoryLabel(m.category)}
          {section ? ` in the ${section.toLowerCase()}` : ''}, {exact(m.width, units)} × {exact(m.depth, units)}, {exact(m.height, units)} high
          {m.bottom >= 5 ? `, ${exact(m.bottom, units)} off the floor` : ''}
        </p>
      )}
      {o.include && (
        <>
          {!o.added && (
            <p className="hint scan-says">
              <span className="scan-tag is-guess">Roomination’s guess</span> {o.as === o.suggestion.as ? o.suggestion.reason : 'You chose this.'}
            </p>
          )}
          <div className="field-grid two">
            <div className="field">
              <label htmlFor={categoryId}>Category</label>
              <select id={categoryId} value={o.category} onChange={(e) => set({ category: e.target.value, as: o.added ? suggestPiece(e.target.value, o, null).as : undefined })}>
                {[...new Set([...CATEGORY_OPTIONS, o.category])].map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={asId}>Shown as</label>
              <select id={asId} value={o.as} onChange={(e) => set({ as: e.target.value })}>
                {[...new Set([...options, o.as])].map((id) => (
                  <option key={id} value={id}>
                    {id === BOX ? 'Plain box' : id === STAIRS ? 'Staircase' : (catalogueName(id) ?? id)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field-grid">
            <NumberField label="Width" suffix={unit} value={toInput(o.width)} min={0} onCommit={(v) => set({ width: fromInput(v) })} />
            <NumberField label="Depth" suffix={unit} value={toInput(o.depth)} min={0} onCommit={(v) => set({ depth: fromInput(v) })} />
            <NumberField label="Height" suffix={unit} value={toInput(o.height)} min={0} onCommit={(v) => set({ height: fromInput(v) })} />
          </div>
          {sized && (
            <button type="button" className="link-button" onClick={() => edit(o.id, { width: undefined, depth: undefined, height: undefined })}>
              Reset to the measured size
            </button>
          )}
        </>
      )}
      {o.include && o.problem && <p className="scan-problem">{o.problem}</p>}
    </li>
  );
}

function AddPiece({ unit, toInput, fromInput, onAdd }: { unit: string; toInput: (cm: number) => number; fromInput: (v: number) => number; onAdd: (a: Review['addedPieces'][number]) => void }) {
  const [category, setCategory] = useState('table');
  const [size, setSize] = useState({ width: 80, depth: 50, height: 75 });
  const categoryId = useId();
  return (
    <details className="scan-add">
      <summary>
        <Icon name="plus" size={14} /> Add furniture the scan missed
      </summary>
      <div className="field">
        <label htmlFor={categoryId}>Category</label>
        <select id={categoryId} value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORY_OPTIONS.filter((c) => c !== 'stairs').map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>
      </div>
      <div className="field-grid">
        <NumberField label="Width" suffix={unit} value={toInput(size.width)} min={0} onCommit={(v) => setSize((s) => ({ ...s, width: fromInput(v) }))} />
        <NumberField label="Depth" suffix={unit} value={toInput(size.depth)} min={0} onCommit={(v) => setSize((s) => ({ ...s, depth: fromInput(v) }))} />
        <NumberField label="Height" suffix={unit} value={toInput(size.height)} min={0} onCommit={(v) => setSize((s) => ({ ...s, height: fromInput(v) }))} />
      </div>
      <p className="hint">It’s placed in the middle of the room; move it after creating the project.</p>
      <button type="button" className="secondary small" onClick={() => onAdd({ id: `added-piece-${++addedCount}-${Date.now().toString(36)}`, category, as: suggestPiece(category, size, null).as, ...size })}>
        Add {categoryLabel(category).toLowerCase()}
      </button>
    </details>
  );
}

const NOTE_GROUPS: { level: Note['level']; title: string }[] = [
  { level: 'check', title: 'Please check' },
  { level: 'assumed', title: 'Assumed (not measured)' },
  { level: 'info', title: 'For your information' },
];

function NotesTab({ notes, onSelect }: { notes: Note[]; onSelect: (id: string) => void }) {
  if (notes.length === 0) return <p className="hint">Nothing to report.</p>;
  return (
    <div className="scan-tab">
      {NOTE_GROUPS.map(({ level, title }) => {
        const list = notes.filter((n) => n.level === level);
        if (!list.length) return null;
        return (
          <section key={level} className={`scan-notes is-${level}`}>
            <h3>{title}</h3>
            <ul>
              {list.map((n, i) => (
                <li key={i}>
                  {n.text}
                  {n.itemId && (
                    <>
                      {' '}
                      <button type="button" className="link-button" onClick={() => onSelect(n.itemId!)}>
                        Show
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
