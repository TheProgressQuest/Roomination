import { useId, useState, type Dispatch } from 'react';
import { FURNITURE_KIND_LABELS, PREFERENCES_FOR_KIND, PREFERENCE_LABELS, RELATIONSHIP_LABELS } from '../model/furnitureKinds';
import { createId } from '../model/sample';
import type { Furniture, FurnitureKind, Project, RelationshipType } from '../model/types';
import type { EditorAction } from '../state/editor';
import { Icon } from './Icon';
import { Section } from './ObjectEditor';

interface PlanningProps {
  project: Project;
  item: Furniture;
  dispatch: Dispatch<EditorAction>;
}

/** Lock toggle, at the top of a piece's properties where it's easy to find. */
export function LockToggle({ item, dispatch }: Omit<PlanningProps, 'project'>) {
  return (
    <label className={`lock-toggle ${item.locked ? 'is-locked' : ''}`}>
      <input type="checkbox" checked={item.locked} onChange={(e) => dispatch({ type: 'furniture/lock', ids: [item.id], locked: e.target.checked })} />
      <Icon name={item.locked ? 'lock' : 'unlock'} size={16} />
      <span>{item.locked ? 'Position locked' : 'Lock position'}</span>
    </label>
  );
}

/** What the piece is, how it likes to be placed, and which pieces it belongs with. */
export function PlanningFields({ project, item, dispatch }: PlanningProps) {
  const kindId = useId();
  const offered = PREFERENCES_FOR_KIND[item.kind];
  const togglePreference = (preference: (typeof offered)[number], on: boolean) =>
    dispatch({ type: 'furniture/update', id: item.id, changes: { preferences: on ? [...item.preferences, preference] : item.preferences.filter((p) => p !== preference) } });

  return (
    <Section title="Layout planning" hint="Used by Optimize Layout. Nothing here is assumed — choose what matters to you.">
      <div className="field">
        <label htmlFor={kindId}>What it is</label>
        <select
          id={kindId}
          value={item.kind}
          onChange={(e) => {
            const kind = e.target.value as FurnitureKind;
            // Keep only preferences that make sense for the new kind.
            dispatch({ type: 'furniture/update', id: item.id, changes: { kind, preferences: item.preferences.filter((p) => PREFERENCES_FOR_KIND[kind].includes(p)) } });
          }}
        >
          {(Object.keys(FURNITURE_KIND_LABELS) as FurnitureKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {FURNITURE_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>
      {offered.length > 0 && (
        <fieldset className="check-group">
          <legend>Placement preferences</legend>
          {offered.map((preference) => (
            <label key={preference} className="toggle">
              <input type="checkbox" checked={item.preferences.includes(preference)} onChange={(e) => togglePreference(preference, e.target.checked)} />
              <span>{PREFERENCE_LABELS[preference]}</span>
            </label>
          ))}
        </fieldset>
      )}
      <Relationships project={project} item={item} dispatch={dispatch} />
    </Section>
  );
}

const RELATIONSHIP_CHOICES: { type: RelationshipType; reversed: boolean; label: string }[] = [
  { type: 'inFrontOf', reversed: false, label: 'Has in front of it…' },
  { type: 'inFrontOf', reversed: true, label: 'Sits in front of…' },
  { type: 'faces', reversed: false, label: 'Faces…' },
  { type: 'beside', reversed: false, label: 'Has beside it…' },
  { type: 'beside', reversed: true, label: 'Stands beside…' },
  { type: 'near', reversed: false, label: 'Stays near…' },
];

function Relationships({ project, item, dispatch }: PlanningProps) {
  const typeId = useId();
  const otherId = useId();
  const [choice, setChoice] = useState(0);
  const [other, setOther] = useState('');
  const name = (id: string) => project.furniture.find((f) => f.id === id)?.name ?? '?';
  const mine = project.relationships.filter((r) => r.a === item.id || r.b === item.id);
  const others = project.furniture.filter((f) => f.id !== item.id && f.category !== 'floorCovering');

  function add() {
    if (!other) return;
    const { type, reversed } = RELATIONSHIP_CHOICES[choice];
    dispatch({ type: 'relationship/add', relationship: { id: createId(), type, a: reversed ? other : item.id, b: reversed ? item.id : other } });
    setOther('');
  }

  return (
    <div className="relationships">
      <p className="field-label">Belongs with</p>
      {mine.length === 0 ? (
        <p className="hint">No relationships. Link pieces that are used together, like a desk and its chair.</p>
      ) : (
        <ul className="relationship-list">
          {mine.map((r) => (
            <li key={r.id}>
              <span>{RELATIONSHIP_LABELS[r.type](name(r.a), name(r.b))}</span>
              <button type="button" className="icon-button small" aria-label={`Remove: ${RELATIONSHIP_LABELS[r.type](name(r.a), name(r.b))}`} onClick={() => dispatch({ type: 'relationship/remove', id: r.id })}>
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <div className="relationship-add">
          <div className="field">
            <label htmlFor={typeId}>{item.name}…</label>
            <select id={typeId} value={choice} onChange={(e) => setChoice(Number(e.target.value))}>
              {RELATIONSHIP_CHOICES.map((c, i) => (
                <option key={c.label} value={i}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={otherId}>Other piece</label>
            <select id={otherId} value={other} onChange={(e) => setOther(e.target.value)}>
              <option value="">Choose…</option>
              {others.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="secondary small" onClick={add} disabled={!other}>
            <Icon name="plus" size={14} /> Link
          </button>
        </div>
      )}
    </div>
  );
}
