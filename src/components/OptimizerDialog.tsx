import { useId, useMemo, useState, type Dispatch } from 'react';
import { FURNITURE_KIND_LABELS, functionWeightFor } from '../model/furnitureKinds';
import { createId } from '../model/sample';
import type { OptimizerSettings, Project, SavedLayout } from '../model/types';
import { cmToInput, inputToCm, inputUnitLabel } from '../model/units';
import type { Suggestion } from '../optimizer/optimize';
import type { Scores } from '../optimizer/scoring';
import { hasMoved, withPoses } from '../optimizer/search';
import type { EditorAction } from '../state/editor';
import { isStale, type OptimizerRunState } from '../state/useOptimizer';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { LayoutPreview } from './LayoutPreview';
import { NumberField } from './NumberField';
import { SegmentedControl } from './SegmentedControl';

interface OptimizerDialogProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  dispatch: Dispatch<EditorAction>;
  run: OptimizerRunState;
  onStart: (movableIds: string[]) => void;
  onCancel: () => void;
  onPreview: (title: string, positions: SavedLayout['positions']) => void;
  onApply: (title: string, positions: SavedLayout['positions']) => void;
}

/**
 * Optimize Layout: choose an emphasis, pick which pieces may move, then compare up to
 * three suggestions against the current layout. Nothing changes until "Apply layout".
 */
export function OptimizerDialog(props: OptimizerDialogProps) {
  const { project, dispatch, run } = props;
  const settings = project.optimizer;
  const set = (changes: Partial<OptimizerSettings>) => dispatch({ type: 'optimizer/settings', changes });
  const candidates = project.furniture;
  // Which pieces may move this time: explicit choices, otherwise everything except rugs.
  const [choices, setChoices] = useState<Map<string, boolean>>(() => new Map());
  const chosen = (f: Project['furniture'][number]) => choices.get(f.id) ?? f.category !== 'floorCovering';
  const movable = candidates.filter((f) => !f.locked && chosen(f));
  const running = run.phase === 'running';
  const weight = functionWeightFor(settings);

  return (
    <Dialog open={props.open} title="Optimize layout" onClose={props.onClose} className="optimizer-dialog">
      <section className="dialog-section">
        <p className="hint">
          Roomination tries many arrangements on this device and suggests the best few. Your layout stays as it is until you apply a suggestion — and
          applying can be undone.
        </p>
      </section>

      <section className="dialog-section optimizer-settings" aria-label="Optimizer settings">
        <SegmentedControl
          label="Emphasis"
          value={settings.mode}
          options={[
            { value: 'functional', label: 'Functional' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'aesthetic', label: 'Aesthetic' },
          ]}
          onChange={(mode) => set({ mode })}
        />
        <WeightSlider value={weight} disabled={settings.mode !== 'balanced'} onChange={(functionWeight) => set({ functionWeight })} />
        <p className="hint">
          {settings.mode === 'functional' && 'Prioritises clear doorways and walkways, reachable stairs, vents and outlets, and furniture you can actually use.'}
          {settings.mode === 'aesthetic' && 'Prioritises alignment, balance, tidy spacing and seating that faces a shared focus. Appearance scores are a matter of taste.'}
          {settings.mode === 'balanced' && 'Blends both. Move the slider to choose how much each counts.'} Hard rules — staying inside the room, no overlaps, clear doorways
          and stairs — always apply, whatever the emphasis.
        </p>
        <div className="field-grid two">
          <NumberField
            label="Walkway width"
            suffix={inputUnitLabel(project.units)}
            min={0}
            value={cmToInput(settings.walkwayWidth, project.units)}
            onCommit={(v) => set({ walkwayWidth: inputToCm(v, project.units) })}
          />
          <SeedField seed={settings.seed} onChange={(seed) => set({ seed })} />
        </div>
        <p className="hint">The walkway width is your comfort preference for this plan. It is not a building-code or accessibility check.</p>
        <SegmentedControl
          label="Effort"
          value={settings.effort}
          options={[
            { value: 'quick', label: 'Quick' },
            { value: 'standard', label: 'Standard' },
            { value: 'thorough', label: 'Thorough' },
          ]}
          onChange={(effort) => set({ effort })}
        />
      </section>

      <section className="dialog-section" aria-label="Pieces the optimizer may move">
        <div className="section-head">
          <h3>Pieces it may move ({movable.length})</h3>
          <div className="button-row">
            <button type="button" className="link-button" onClick={() => dispatch({ type: 'furniture/lock', ids: candidates.map((f) => f.id), locked: false })}>
              Unlock all
            </button>
            <button type="button" className="link-button" onClick={() => dispatch({ type: 'furniture/lock', ids: candidates.map((f) => f.id), locked: true })}>
              Lock all
            </button>
          </div>
        </div>
        <ul className="movable-list">
          {candidates.map((f) => (
            <li key={f.id}>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={!f.locked && chosen(f)}
                  disabled={f.locked}
                  onChange={(e) => setChoices(new Map(choices).set(f.id, e.target.checked))}
                />
                <span className="truncate">{f.name}</span>
              </label>
              <span className="movable-kind">{FURNITURE_KIND_LABELS[f.kind]}</span>
              <button
                type="button"
                className={`icon-button small ${f.locked ? 'is-locked' : ''}`}
                aria-pressed={f.locked}
                aria-label={f.locked ? `Unlock ${f.name}` : `Lock ${f.name}`}
                title={f.locked ? 'Locked — click to unlock' : 'Lock in place'}
                onClick={() => dispatch({ type: 'furniture/lock', ids: [f.id], locked: !f.locked })}
              >
                <Icon name={f.locked ? 'lock' : 'unlock'} size={15} />
              </button>
            </li>
          ))}
        </ul>
        <p className="hint">
          Locked pieces stay exactly where they are. Walls, doors, windows and stairs never move. Relationships and placement preferences are set in each piece’s
          properties ({project.relationships.length} relationship{project.relationships.length === 1 ? '' : 's'} so far).
        </p>
      </section>

      <section className="dialog-section optimizer-run" aria-live="polite">
        {running ? (
          <div className="run-progress">
            <label htmlFor="optimizer-progress">Searching for layouts… {Math.round((run.done / Math.max(1, run.total)) * 100)}%</label>
            <progress id="optimizer-progress" max={run.total} value={run.done} />
            <button type="button" className="secondary" onClick={props.onCancel}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="primary" onClick={() => props.onStart(movable.map((f) => f.id))} disabled={movable.length === 0}>
            <Icon name="sparkle" size={16} /> {run.phase === 'done' ? 'Find layouts again' : 'Find layouts'}
          </button>
        )}
        {run.phase === 'failed' && <p className="import-message is-error">{run.message}</p>}
      </section>

      {run.phase === 'done' && <Results {...props} result={run.result} stale={isStale(run.basis, project)} basis={run.basis} />}

      <SavedLayouts {...props} />
    </Dialog>
  );
}

function WeightSlider({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (v: number) => void }) {
  const id = useId();
  const percent = Math.round(value * 100);
  return (
    <div className="range-field">
      <div className="range-label">
        <label htmlFor={id}>Function vs. aesthetics</label>
        <output htmlFor={id}>
          Function {percent}% · Aesthetics {100 - percent}%
        </output>
      </div>
      <input id={id} type="range" min={0} max={100} step={5} value={percent} disabled={disabled} onChange={(e) => onChange(Number(e.target.value) / 100)} />
    </div>
  );
}

function SeedField({ seed, onChange }: { seed: number; onChange: (seed: number) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>Seed</label>
      <div className="seed-row">
        <input id={id} type="number" min={0} value={seed} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(e.target.valueAsNumber)} />
        <button type="button" className="secondary small" onClick={() => onChange((seed * 48271 + 11) % 2147483647)} aria-label="Try a different seed">
          New
        </button>
      </div>
    </div>
  );
}

function Results(props: OptimizerDialogProps & { result: Extract<OptimizerRunState, { phase: 'done' }>['result']; stale: boolean; basis: Project }) {
  const { result, basis, stale } = props;
  if (result.status !== 'ok') {
    return (
      <section className="dialog-section">
        <p className="import-message is-error" role="status">
          {result.message}
        </p>
      </section>
    );
  }
  return (
    <section className="dialog-section" aria-label="Suggestions">
      {stale && (
        <p className="import-message is-error" role="status">
          The room has changed since these suggestions were made. Run the optimizer again to use them.
        </p>
      )}
      {result.message && <p className="hint result-note">{result.message}</p>}
      <div className="suggestion-grid">
        <article className="suggestion-card is-current">
          <h3>Current layout</h3>
          <LayoutPreview project={basis} movedIds={new Set()} label="Preview of your current layout" />
          <ScoreSummary scores={result.baseline.scores} />
          <ScoreBreakdown scores={result.baseline.scores} />
          {result.baseline.warnings.length > 0 && <List title="Still to look at" items={result.baseline.warnings} kind="warning" />}
        </article>
        {result.suggestions.map((s) => (
          <SuggestionCard key={s.id} suggestion={s} {...props} />
        ))}
      </div>
      {result.unmet.length > 0 && (
        <p className="hint">
          No suggestion fully met: {result.unmet.join('; ')}. These may compete with each other, with locked pieces, or with the room’s shape.
        </p>
      )}
      <p className="hint">
        Seed {result.seed} · algorithm v{result.algorithmVersion}. The same room, settings and seed always give the same suggestions.
      </p>
    </section>
  );
}

function SuggestionCard(props: OptimizerDialogProps & { suggestion: Suggestion; basis: Project; stale: boolean }) {
  const { suggestion, basis, stale, dispatch, onPreview, onApply } = props;
  const project = useMemo(() => withPoses(basis, new Map(suggestion.positions.map((p) => [p.id, p]))), [basis, suggestion]);
  const moved = useMemo(() => {
    const before = new Map(basis.furniture.map((f) => [f.id, f]));
    return new Set(suggestion.positions.filter((p) => hasMoved(before.get(p.id)!, p)).map((p) => p.id));
  }, [basis, suggestion]);
  const title = `${suggestion.title} — ${suggestion.emphasis}`;
  // 6. "Saved" comes from the project itself, so it's right after re-runs and reloads.
  const saved = props.project.savedLayouts.some((l) => samePositions(l.positions, suggestion.positions));

  return (
    <article className="suggestion-card" aria-label={title}>
      <h3>{suggestion.title}</h3>
      <p className="suggestion-emphasis">{suggestion.emphasis}</p>
      <LayoutPreview project={project} movedIds={moved} label={`Preview of ${title}`} />
      <p className="hint">{suggestion.movedCount === 0 ? 'Same as your current layout.' : `Moves ${suggestion.movedCount} piece${suggestion.movedCount === 1 ? '' : 's'} (dashed outlines).`}</p>
      <ScoreSummary scores={suggestion.scores} />
      {suggestion.improvements.length > 0 && <List title="Why it’s suggested" items={suggestion.improvements} kind="improvement" />}
      {suggestion.tradeoffs.length > 0 && <List title="Trade-offs" items={suggestion.tradeoffs} kind="tradeoff" />}
      {suggestion.warnings.length > 0 && <List title="Still to look at" items={suggestion.warnings} kind="warning" />}
      <ScoreBreakdown scores={suggestion.scores} />
      <div className="card-actions">
        <button type="button" className="secondary small" onClick={() => onPreview(title, suggestion.positions)} disabled={stale}>
          Preview on plan
        </button>
        <button
          type="button"
          className="secondary small"
          disabled={stale || saved}
          onClick={() => dispatch({ type: 'layouts/save', layout: { id: createId(), name: `${suggestion.title} (${suggestion.emphasis})`, createdAt: Date.now(), positions: suggestion.positions } })}
        >
          {saved ? 'Saved' : 'Save as layout'}
        </button>
        <button type="button" className="primary small" onClick={() => onApply(title, suggestion.positions)} disabled={stale}>
          Apply layout
        </button>
      </div>
    </article>
  );
}

function samePositions(a: SavedLayout['positions'], b: SavedLayout['positions']): boolean {
  return a.length === b.length && a.every((p, i) => p.id === b[i].id && p.x === b[i].x && p.y === b[i].y && p.rotation === b[i].rotation);
}

function ScoreSummary({ scores }: { scores: Scores }) {
  const pct = (v: number) => `${Math.round(v)}`;
  return (
    <dl className="score-summary">
      <div className="score-main">
        <dt>Overall</dt>
        <dd>{pct(scores.overall)}</dd>
      </div>
      <div>
        <dt>Functional</dt>
        <dd>{pct(scores.functional)}</dd>
      </div>
      <div>
        <dt title="A matter of taste">Aesthetic*</dt>
        <dd>{pct(scores.aesthetic)}</dd>
      </div>
      {scores.preferences !== null && (
        <div>
          <dt>Your preferences</dt>
          <dd>{pct(scores.preferences)}</dd>
        </div>
      )}
    </dl>
  );
}

function ScoreBreakdown({ scores }: { scores: Scores }) {
  return (
    <details className="score-breakdown">
      <summary>How this score was calculated</summary>
      <table>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col">Score</th>
            <th scope="col">Weight</th>
          </tr>
        </thead>
        <tbody>
          {scores.components.map((c) => (
            <tr key={c.id}>
              <th scope="row">
                {c.label}
                {c.group === 'aesthetic' && '*'}
                <span className="hint">{c.detail}</span>
              </th>
              <td>{Math.round(c.value * 100)}</td>
              <td>{c.weight}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Functional, aesthetic and preference scores are weighted averages of these measures (0–100). Overall = your function/aesthetics blend
        {scores.preferences !== null && ', counting 70%, plus your preferences at 30%'}. *Aesthetic measures are a subjective guide, not objective facts.
      </p>
    </details>
  );
}

function List({ title, items, kind }: { title: string; items: string[]; kind: 'improvement' | 'tradeoff' | 'warning' }) {
  return (
    <div className={`result-list is-${kind}`}>
      <h4>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function SavedLayouts({ project, dispatch, onPreview, onApply }: OptimizerDialogProps) {
  if (project.savedLayouts.length === 0) return null;
  return (
    <section className="dialog-section" aria-label="Saved layouts">
      <h3>Saved layouts</h3>
      <ul className="project-list">
        {project.savedLayouts.map((layout) => (
          <li key={layout.id}>
            <div className="project-info">
              <span className="project-name-text truncate">{layout.name}</span>
              <span className="hint">{layout.createdAt ? new Date(layout.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''}</span>
            </div>
            <div className="button-row tight">
              <button type="button" className="secondary small" onClick={() => onPreview(layout.name, layout.positions)}>
                Preview
              </button>
              <button type="button" className="secondary small" onClick={() => onApply(layout.name, layout.positions)}>
                Apply
              </button>
              <button type="button" className="icon-button small" aria-label={`Delete ${layout.name}`} onClick={() => dispatch({ type: 'layouts/delete', id: layout.id })}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
