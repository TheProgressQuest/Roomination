import type { Dispatch } from 'react';
import type { Conflict } from '../model/conflicts';
import type { Project } from '../model/types';
import type { EditorAction } from '../state/editor';
import type { Selection } from '../state/selection';
import { ChecksList } from './ChecksList';
import { SelectionEditor } from './StructureEditors';

interface PropertiesPanelProps {
  project: Project;
  selection: Selection;
  conflicts: Conflict[];
  dispatch: Dispatch<EditorAction>;
  onDelete: (id: string) => void;
  onSelect: (selection: Selection) => void;
}

/** Desktop right-hand panel. On smaller screens the same editor opens in a modal. */
export function PropertiesPanel({ project, selection, conflicts, dispatch, onDelete, onSelect }: PropertiesPanelProps) {
  return (
    <aside className="panel properties-panel" aria-label="Selected object properties">
      {selection ? (
        <SelectionEditor project={project} selection={selection} conflicts={conflicts} dispatch={dispatch} onDelete={onDelete} onSelect={onSelect} />
      ) : (
        <>
          <section className="panel-section empty-state">
            <div className="empty-illustration" aria-hidden="true">
              🛋️
            </div>
            <h2>Nothing selected</h2>
            <p className="hint">Click something on the plan, or pick it from “In this room”, to edit it.</p>
            <ul className="shortcut-list">
              <li><kbd>Drag</kbd> move · doors &amp; windows slide along walls</li>
              <li><kbd>Arrow keys</kbd> nudge 1 cm (Shift: 10 cm)</li>
              <li><kbd>R</kbd> rotate 90°</li>
              <li><kbd>Delete</kbd> remove</li>
              <li><kbd>Ctrl/⌘ Z</kbd> undo · <kbd>Shift</kbd> redo</li>
            </ul>
          </section>
          <section className="panel-section">
            <h3>Room checks</h3>
            <ChecksList project={project} conflicts={conflicts} onSelect={(id) => onSelect({ kind: 'object', id })} />
          </section>
        </>
      )}
    </aside>
  );
}
