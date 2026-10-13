import type { Dispatch } from 'react';
import type { Conflict } from '../model/conflicts';
import { createId } from '../model/sample';
import { describeStairShape, layoutStair, stairPreset, stairProblems, totalSteps } from '../model/stairs';
import type { Project, Staircase, StairSection } from '../model/types';
import { cmToInput, formatLength, inputToCm, inputUnitLabel } from '../model/units';
import { canMergeWithNext, findSegment, wallLabel, wallSegments } from '../model/walls';
import type { EditorAction } from '../state/editor';
import type { Selection } from '../state/selection';
import { Icon } from './Icon';
import { NumberField } from './NumberField';
import { ConflictList, NameField, ObjectEditor, RotationField, Section } from './ObjectEditor';
import { SegmentedControl } from './SegmentedControl';

interface SelectionEditorProps {
  project: Project;
  selection: NonNullable<Selection>;
  conflicts: Conflict[];
  dispatch: Dispatch<EditorAction>;
  onSelect: (selection: Selection) => void;
  onDelete: (id: string) => void;
}

/** The property editor for whatever is selected: furniture, features, stairs, walls or corners. */
export function SelectionEditor(props: SelectionEditorProps) {
  const { project, selection } = props;
  if (selection.kind === 'wall') return <WallEditor {...props} wallId={selection.id} />;
  if (selection.kind === 'corner') return <CornerEditor {...props} nodeId={selection.id} />;
  const stair = project.stairs.find((s) => s.id === selection.id);
  if (stair) return <StairEditor {...props} stair={stair} />;
  return <ObjectEditor project={project} selectedId={selection.id} conflicts={props.conflicts} dispatch={props.dispatch} onDelete={props.onDelete} />;
}

// ---------------------------------------------------------------------------
// Walls and corners
// ---------------------------------------------------------------------------

function WallEditor({ project, wallId, dispatch, onSelect }: SelectionEditorProps & { wallId: string }) {
  const wall = findSegment(project.room, wallId);
  if (!wall) return null;
  const units = project.units;
  const unit = inputUnitLabel(units);
  const outer = wall.chain === 'outline';
  const onThisWall = project.features.filter((f) => f.placement.type === 'wall' && f.placement.wallId === wallId);
  const mergeable = canMergeWithNext(project.room, wallId);
  // Angles are shown as 0–360° clockwise from pointing right.
  const angle = Math.round((((wall.angle % 360) + 360) % 360) * 10) / 10;

  return (
    <div className="object-editor">
      <Section>
        <p className="kind-badge">
          <Icon name="wall" size={14} /> {outer ? 'Outer wall' : 'Interior wall'}
        </p>
        <h2 className="editor-title">{wallLabel(project.room, wallId)}</h2>
        <p className="hint">Drag the round corner handles on the plan to reshape the room. Connected walls stay joined.</p>
      </Section>

      <Section title="Size and direction">
        <div className="field-grid">
          <NumberField label="Length" suffix={unit} min={0} value={cmToInput(wall.length, units)} onCommit={(v) => dispatch({ type: 'walls/setLength', wallId, length: inputToCm(v, units) })} />
          <NumberField label="Angle" suffix="°" value={angle} onCommit={(v) => dispatch({ type: 'walls/setAngle', wallId, angle: v })} />
          <NumberField label="Thickness" suffix={unit} min={0} value={cmToInput(wall.thickness, units)} onCommit={(v) => dispatch({ type: 'walls/setThickness', wallId, thickness: inputToCm(v, units) })} />
        </div>
        <p className="hint">Length and angle move the wall’s end corner; its start corner stays put.</p>
      </Section>

      <Section title="Start corner" hint="Measured from the room’s origin (top-left of the original room).">
        <div className="field-grid two">
          <NumberField label="X" suffix={unit} value={cmToInput(wall.start.x, units)} onCommit={(v) => dispatch({ type: 'walls/moveNode', nodeId: wallId, to: { x: inputToCm(v, units), y: wall.start.y } })} />
          <NumberField label="Y" suffix={unit} value={cmToInput(wall.start.y, units)} onCommit={(v) => dispatch({ type: 'walls/moveNode', nodeId: wallId, to: { x: wall.start.x, y: inputToCm(v, units) } })} />
        </div>
      </Section>

      <Section title="Shape">
        <div className="button-row">
          <button type="button" className="secondary" onClick={() => dispatch({ type: 'walls/split', wallId, distance: wall.length / 2, newId: createId() })}>
            <Icon name="plus" size={16} /> Add corner in the middle
          </button>
          <button type="button" className="secondary" disabled={!mergeable} onClick={() => dispatch({ type: 'walls/merge', wallId })}>
            Merge with next wall
          </button>
        </div>
        <p className="hint">
          Adding a corner splits this wall in two — drag the new corner out to make an alcove or bay.
          {!mergeable && ' Only walls that continue in a straight line with the same thickness can merge.'}
        </p>
      </Section>

      {onThisWall.length > 0 && (
        <Section title="On this wall">
          <ul className="plain-list">
            {onThisWall.map((f) => (
              <li key={f.id}>
                <button type="button" className="link-button" onClick={() => onSelect({ kind: 'object', id: f.id })}>
                  {f.name}
                </button>
              </li>
            ))}
          </ul>
          <p className="hint">These move with the wall.</p>
        </Section>
      )}

      <Section>
        <button
          type="button"
          className="danger"
          onClick={() => {
            dispatch({ type: 'walls/delete', wallId, newPartitionId: createId() });
            onSelect(null);
          }}
        >
          <Icon name="trash" /> <span className="truncate">{outer ? 'Delete wall (joins its neighbours)' : 'Delete this interior wall'}</span>
        </button>
      </Section>
    </div>
  );
}

function CornerEditor({ project, nodeId, dispatch, onSelect }: SelectionEditorProps & { nodeId: string }) {
  const node = [...project.room.outline, ...project.room.partitions.flatMap((p) => p.nodes)].find((n) => n.id === nodeId);
  if (!node) return null;
  const units = project.units;
  const unit = inputUnitLabel(units);
  const meeting = wallSegments(project.room).filter((w) => w.id === nodeId || (w.end.x === node.x && w.end.y === node.y));

  return (
    <div className="object-editor">
      <Section>
        <p className="kind-badge">
          <Icon name="corner" size={14} /> Corner
        </p>
        <p className="hint">Where {meeting.map((w) => wallLabel(project.room, w.id)).join(' and ')} meet. Drag it on the plan, or type an exact position.</p>
      </Section>
      <Section title="Position">
        <div className="field-grid two">
          <NumberField label="X" suffix={unit} value={cmToInput(node.x, units)} onCommit={(v) => dispatch({ type: 'walls/moveNode', nodeId, to: { x: inputToCm(v, units), y: node.y } })} />
          <NumberField label="Y" suffix={unit} value={cmToInput(node.y, units)} onCommit={(v) => dispatch({ type: 'walls/moveNode', nodeId, to: { x: node.x, y: inputToCm(v, units) } })} />
        </div>
      </Section>
      <Section>
        <button
          type="button"
          className="danger"
          onClick={() => {
            dispatch({ type: 'walls/removeNode', nodeId });
            onSelect(null);
          }}
        >
          <Icon name="trash" /> Remove corner (joins the two walls)
        </button>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stairs
// ---------------------------------------------------------------------------

function StairEditor({ project, stair, conflicts, dispatch, onDelete }: SelectionEditorProps & { stair: Staircase }) {
  const units = project.units;
  const unit = inputUnitLabel(units);
  const length = (cm: number) => cmToInput(cm, units);
  const toCm = (v: number) => inputToCm(v, units);
  const change = (changes: Partial<Staircase>) => dispatch({ type: 'stairs/update', id: stair.id, changes });
  const setSections = (sections: StairSection[]) => change({ sections });
  const updateSection = (index: number, changes: Partial<StairSection>) => setSections(stair.sections.map((s, i) => (i === index ? { ...s, ...changes } : s)));

  const layout = layoutStair(stair.sections);
  const steps = totalSteps(stair);
  const problems = stairProblems(stair);
  const shape = describeStairShape(stair.sections);
  const width = stair.sections[0]?.width ?? 90;
  const turns = stair.sections.filter((s) => s.kind === 'landing' && s.turn !== 'straight');
  const turnSide = turns[0]?.turn === 'left' ? 'left' : 'right';

  return (
    <div className="object-editor">
      <Section>
        <p className="kind-badge">
          <Icon name="stairs" size={14} /> Staircase · {shape}
        </p>
        <NameField key={`${stair.id}:${stair.name}`} value={stair.name} onCommit={(name) => change({ name })} />
      </Section>

      <Section title="Shape">
        <div className="button-row">
          {(['straight', 'L', 'U'] as const).map((preset) => (
            <button key={preset} type="button" className="secondary small" onClick={() => setSections(stairPreset(preset, width, createId, turnSide))}>
              {preset === 'straight' ? 'Straight' : `${preset}-shaped`}
            </button>
          ))}
        </div>
        <SegmentedControl
          label="Direction"
          value={stair.direction}
          options={[
            { value: 'up', label: 'Goes up' },
            { value: 'down', label: 'Goes down' },
          ]}
          onChange={(direction) => change({ direction })}
        />
        {turns.length > 0 && (
          <SegmentedControl
            label="Turns"
            value={turnSide}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
            ]}
            onChange={(turn) => setSections(stair.sections.map((s) => (s.kind === 'landing' && s.turn !== 'straight' ? { ...s, turn } : s)))}
          />
        )}
      </Section>

      <Section title="Size">
        <div className="field-grid two">
          <NumberField label="Width" suffix={unit} min={0} value={length(width)} onCommit={(v) => setSections(stair.sections.map((s) => ({ ...s, width: toCm(v), length: s.kind === 'landing' ? toCm(v) : s.length })))} />
          <NumberField label="Total rise" suffix={unit} min={0} value={length(stair.rise)} onCommit={(v) => change({ rise: toCm(v) })} />
        </div>
        <p className="hint">
          Footprint {formatLength(layout.width, units)} × {formatLength(layout.depth, units)} · {steps} steps
          {steps > 0 && ` · about ${formatLength(stair.rise / steps, units)} per step`}. These are estimates for planning, not a building-code or safety check.
        </p>
      </Section>

      <Section title="Sections">
        <ol className="section-list">
          {stair.sections.map((section, index) => (
            <li key={section.id}>
              <div className="section-head">
                <span className="section-name">
                  {index + 1}. {section.kind === 'flight' ? 'Flight' : 'Landing'}
                </span>
                <button
                  type="button"
                  className="icon-button small"
                  aria-label={`Remove section ${index + 1}`}
                  disabled={stair.sections.length === 1}
                  onClick={() => setSections(stair.sections.filter((_, i) => i !== index))}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
              <div className="field-grid two">
                <NumberField label="Length" suffix={unit} min={0} value={length(section.length)} onCommit={(v) => updateSection(index, { length: toCm(v) })} />
                {section.kind === 'flight' ? (
                  <NumberField label="Steps" min={1} value={section.steps} onCommit={(v) => updateSection(index, { steps: v })} />
                ) : (
                  <SegmentedControl
                    label="Then"
                    value={section.turn}
                    options={[
                      { value: 'left', label: 'Left' },
                      { value: 'straight', label: 'On' },
                      { value: 'right', label: 'Right' },
                    ]}
                    onChange={(turn) => updateSection(index, { turn })}
                  />
                )}
              </div>
              {section.kind === 'flight' && <p className="hint">Treads about {formatLength(section.length / section.steps, units)} deep.</p>}
            </li>
          ))}
        </ol>
        <div className="button-row">
          <button type="button" className="secondary small" onClick={() => setSections([...stair.sections, { id: createId(), kind: 'flight', length: 100, width, steps: 4, turn: 'straight' }])}>
            <Icon name="plus" size={14} /> Add flight
          </button>
          <button type="button" className="secondary small" onClick={() => setSections([...stair.sections, { id: createId(), kind: 'landing', length: width, width, steps: 0, turn: 'right' }])}>
            <Icon name="plus" size={14} /> Add landing
          </button>
        </div>
        {problems.length > 0 && (
          <ul className="problem-list" role="status">
            {problems.map((p) => (
              <li key={p}>
                <Icon name="warning" size={15} /> {p}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Position">
        <div className="field-grid two">
          <NumberField label="From left" suffix={unit} value={length(stair.x)} onCommit={(v) => change({ x: toCm(v) })} />
          <NumberField label="From top" suffix={unit} value={length(stair.y)} onCommit={(v) => change({ y: toCm(v) })} />
        </div>
        <RotationField rotation={stair.rotation} onChange={(rotation) => change({ rotation })} />
      </Section>

      <ConflictList objectId={stair.id} project={project} conflicts={conflicts} dispatch={dispatch} />

      <Section>
        <button type="button" className="danger" onClick={() => onDelete(stair.id)}>
          <Icon name="trash" /> <span className="truncate">Delete {stair.name}</span>
        </button>
      </Section>
    </div>
  );
}
