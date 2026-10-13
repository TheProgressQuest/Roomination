import { useId, useState } from 'react';
import type { SnapSettings } from '../model/snapping';
import type { Point, UnitSystem } from '../model/types';
import { cmToInput, formatLength, inputToCm, inputUnitLabel } from '../model/units';
import { Icon } from './Icon';

interface DrawingBarProps {
  mode: 'drawRoom' | 'drawWall';
  draft: Point[];
  units: UnitSystem;
  snap: SnapSettings;
  onSnap: (snap: SnapSettings) => void;
  onStartAt: (point: Point) => void;
  onAddWall: (lengthCm: number, angleDeg: number) => void;
  onUndoPoint: () => void;
  onFinish: () => void;
  onCancel: () => void;
  /** Phones: tuck the typed-measurement form away so the plan keeps most of the screen. */
  compact: boolean;
}

/**
 * Controls shown while drawing walls. Everything that can be done by clicking on the
 * plan can also be done here with exact numbers — so walls can be drawn with a
 * keyboard, or precisely on a small touch screen.
 */
export function DrawingBar(props: DrawingBarProps) {
  const { mode, draft, units } = props;
  const unit = inputUnitLabel(units);
  const [start, setStart] = useState({ x: '0', y: '0' });
  const [wall, setWall] = useState({ length: units === 'metric' ? '300' : '120', angle: '0' });
  const ids = { x: useId(), y: useId(), length: useId(), angle: useId() };
  const last = draft[draft.length - 1];
  const previous = draft[draft.length - 2];
  const lastLength = last && previous ? Math.hypot(last.x - previous.x, last.y - previous.y) : null;
  const room = mode === 'drawRoom';
  const enough = draft.length >= (room ? 3 : 2);

  const entry = (
    <>
      <form
        className="drawing-entry"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.length === 0) props.onStartAt({ x: inputToCm(Number(start.x), units), y: inputToCm(Number(start.y), units) });
          else props.onAddWall(inputToCm(Number(wall.length), units), Number(wall.angle));
        }}
      >
        {draft.length === 0 ? (
          <>
            <Field id={ids.x} label="Start X" suffix={unit} value={start.x} onChange={(x) => setStart({ ...start, x })} />
            <Field id={ids.y} label="Start Y" suffix={unit} value={start.y} onChange={(y) => setStart({ ...start, y })} />
            <button type="submit" className="secondary">Place start</button>
          </>
        ) : (
          <>
            <Field id={ids.length} label="Wall length" suffix={unit} value={wall.length} onChange={(length) => setWall({ ...wall, length })} />
            <Field id={ids.angle} label="Angle" suffix="°" value={wall.angle} onChange={(angle) => setWall({ ...wall, angle })} />
            <button type="submit" className="secondary">Add wall</button>
          </>
        )}
      </form>
      <p className="hint drawing-angle-hint">Angles: 0° right, 90° down, 180° left, 270° up.</p>
    </>
  );

  return (
    <section className="drawing-bar" aria-label={room ? 'Drawing the room shape' : 'Drawing an interior wall'}>
      <div className="drawing-head">
        <p className="drawing-title">
          <Icon name={room ? 'drawRoom' : 'drawWall'} size={16} /> {room ? 'Draw room shape' : 'Draw interior wall'}
        </p>
        <p className="hint" role="status">
          {draft.length === 0
            ? 'Tap or click on the plan to place the first corner — or type a start point.'
            : room
              ? `${draft.length} corner${draft.length === 1 ? '' : 's'} placed${lastLength ? ` · last wall ${formatLength(lastLength, units)}` : ''}. ${enough ? 'Tap the first corner or press Close room to finish.' : 'Keep going: a room needs at least three corners.'}`
              : `${draft.length} point${draft.length === 1 ? '' : 's'} placed. ${enough ? 'Press Finish when the wall is complete.' : 'Place the wall’s other end.'}`}
        </p>
      </div>

      {props.compact ? (
        <details className="drawing-entry-toggle">
          <summary>Type exact measurements</summary>
          {entry}
        </details>
      ) : (
        entry
      )}

      <div className="drawing-actions">
        <button type="button" className="secondary" onClick={props.onUndoPoint} disabled={draft.length === 0} aria-label="Undo last point">
          <Icon name="undo" size={16} /> Undo
        </button>
        <button type="button" className="secondary" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={props.onFinish} disabled={!enough}>
          <Icon name="check" size={16} /> {room ? 'Close room' : 'Finish wall'}
        </button>
      </div>

      <SnapOptions snap={props.snap} onSnap={props.onSnap} units={units} />
    </section>
  );
}

function Field({ id, label, suffix, value, onChange }: { id: string; label: string; suffix: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-input">
        <input id={id} type="number" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
        <span className="field-suffix" aria-hidden="true">
          {suffix}
        </span>
      </div>
    </div>
  );
}

/** Which kinds of snapping are on. Shared by wall drawing and corner dragging. */
export function SnapOptions({ snap, onSnap, units }: { snap: SnapSettings; onSnap: (snap: SnapSettings) => void; units: UnitSystem }) {
  const set = (changes: Partial<SnapSettings>) => onSnap({ ...snap, ...changes });
  const toggle = (key: 'endpoints' | 'walls' | 'grid' | 'alignment' | 'angles', label: string) => (
    <label className="chip-toggle">
      <input type="checkbox" checked={snap[key]} onChange={(e) => set({ [key]: e.target.checked })} />
      <span>{label}</span>
    </label>
  );
  return (
    <details className="snap-options">
      <summary>
        <Icon name="magnet" size={15} /> Snapping
      </summary>
      <div className="chip-row">
        {toggle('endpoints', 'Corners')}
        {toggle('walls', 'Walls')}
        {toggle('alignment', 'Line up')}
        {toggle('grid', 'Grid')}
        {toggle('angles', 'Angles')}
      </div>
      <div className="field-grid two">
        <label className="field">
          <span className="field-label">Grid step</span>
          <select value={snap.gridSize} onChange={(e) => set({ gridSize: Number(e.target.value) })} disabled={!snap.grid}>
            {[1, 5, 10, 25, 50].map((cm) => (
              <option key={cm} value={cm}>
                {units === 'metric' ? `${cm} cm` : `≈ ${cmToInput(cm, units)} in`}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Angle step</span>
          <select value={snap.angleStep} onChange={(e) => set({ angleStep: Number(e.target.value) })} disabled={!snap.angles}>
            {[15, 30, 45, 90].map((deg) => (
              <option key={deg} value={deg}>
                {deg}°
              </option>
            ))}
          </select>
        </label>
      </div>
    </details>
  );
}
