import { describeConflict, type Conflict } from '../model/conflicts';
import type { Project } from '../model/types';
import { Icon } from './Icon';

interface ChecksListProps {
  project: Project;
  conflicts: Conflict[];
  onSelect: (id: string) => void;
}

/** Room-wide overview of overlaps: what needs attention, and what the user allowed. */
export function ChecksList({ project, conflicts, onSelect }: ChecksListProps) {
  const open = conflicts.filter((c) => !c.accepted);
  const allowed = conflicts.filter((c) => c.accepted);

  if (conflicts.length === 0) {
    return (
      <p className="checks-clear">
        <Icon name="check" size={16} /> No overlaps. Doorways, vents and outlets are clear.
      </p>
    );
  }

  const row = (conflict: Conflict) => (
    <li key={conflict.key}>
      <button type="button" className={`check-row ${conflict.accepted ? 'is-accepted' : 'is-warning'}`} onClick={() => onSelect(conflict.itemId)}>
        <Icon name={conflict.accepted ? 'check' : 'warning'} size={15} />
        <span>{describeConflict(conflict, project)}</span>
      </button>
    </li>
  );

  return (
    <div className="checks">
      {open.length > 0 && (
        <>
          <p className="checks-summary">
            {open.length} {open.length === 1 ? 'overlap needs' : 'overlaps need'} a look
          </p>
          <ul className="check-list">{open.map(row)}</ul>
        </>
      )}
      {allowed.length > 0 && (
        <>
          <p className="checks-summary muted">Allowed by you ({allowed.length})</p>
          <ul className="check-list">{allowed.map(row)}</ul>
        </>
      )}
    </div>
  );
}
