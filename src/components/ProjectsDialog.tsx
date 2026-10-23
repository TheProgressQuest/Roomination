import { useId, useRef, useState } from 'react';
import type { ProjectSummary } from '../storage/projectStore';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { StorageSection } from './StorageSection';

interface ProjectsDialogProps {
  open: boolean;
  onClose: () => void;
  activeId: string;
  activeName: string;
  projects: ProjectSummary[];
  /** Message from the last import attempt (error or success). */
  importMessage: { kind: 'error' | 'success'; text: string } | null;
  onOpenProject: (id: string) => void;
  onRename: (name: string) => void;
  onNew: (kind: 'empty' | 'sample') => void;
  onDuplicate: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  /** Opens the room-scan importer (LiDAR scans from an iPhone or iPad). */
  onImportScan: () => void;
  onDelete: (id: string) => void;
  /** Photos the open project (including its undo history) still refers to. */
  photosInUse: () => string[];
}

/**
 * Manage saved projects. Everything here stays in this browser; export is the only
 * way data leaves the device, and only as a file the user saves themselves.
 */
export function ProjectsDialog(props: ProjectsDialogProps) {
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nameId = useId();

  return (
    <Dialog open={props.open} title="Projects" onClose={props.onClose} className="projects-dialog">
      <section className="dialog-section">
        <h3>Current project</h3>
        <div className="field">
          <label htmlFor={nameId}>Name</label>
          <input
            id={nameId}
            key={props.activeName}
            type="text"
            defaultValue={props.activeName}
            maxLength={60}
            onBlur={(e) => props.onRename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </div>
        <div className="button-row">
          <button type="button" className="secondary" onClick={props.onDuplicate}>
            <Icon name="copy" size={16} /> Duplicate as a new layout
          </button>
          <button type="button" className="secondary" onClick={props.onExport}>
            <Icon name="download" size={16} /> Export file
          </button>
        </div>
        <p className="hint">Duplicate to try variations (Layout A, B, C…) without losing the original. Projects with photos export as a .zip that includes them.</p>
      </section>

      <section className="dialog-section">
        <h3>Your projects</h3>
        <ul className="project-list">
          {props.projects.map((p) => {
            const active = p.id === props.activeId;
            return (
              <li key={p.id} className={active ? 'is-active' : ''}>
                {confirmingDelete === p.id ? (
                  <div className="confirm-delete" role="group" aria-label={`Confirm deleting ${p.name}`}>
                    <p>
                      Delete <strong>{p.name}</strong>? This can’t be undone.
                    </p>
                    <div className="button-row">
                      <button type="button" className="secondary" onClick={() => setConfirmingDelete(null)} autoFocus>
                        Keep it
                      </button>
                      <button
                        type="button"
                        className="danger compact"
                        onClick={() => {
                          setConfirmingDelete(null);
                          props.onDelete(p.id);
                        }}
                      >
                        Delete forever
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="project-info">
                      <span className="project-name-text truncate">{p.name}</span>
                      <span className="hint">
                        {active ? 'Open now · ' : ''}
                        {p.readable ? `${p.furnitureCount} items · ` : 'Can’t be read · '}
                        {new Date(p.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                    </div>
                    <div className="button-row tight">
                      {!active && p.readable && (
                        <button type="button" className="secondary small" onClick={() => props.onOpenProject(p.id)}>
                          Open
                        </button>
                      )}
                      <button type="button" className="icon-button" aria-label={`Delete ${p.name}`} onClick={() => setConfirmingDelete(p.id)}>
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="dialog-section">
        <h3>Start or bring in a project</h3>
        <div className="button-row">
          <button type="button" className="secondary" onClick={() => props.onNew('empty')}>
            <Icon name="plus" size={16} /> Empty room
          </button>
          <button type="button" className="secondary" onClick={() => props.onNew('sample')}>
            <Icon name="plus" size={16} /> Sample room
          </button>
          <button type="button" className="secondary" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" size={16} /> Import file…
          </button>
          <button type="button" className="secondary" onClick={props.onImportScan}>
            <Icon name="floorPlan" size={16} /> Import room scan…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,.zip,application/json,application/zip"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) props.onImport(file);
              e.target.value = '';
            }}
          />
        </div>
        {props.importMessage && (
          <p className={`import-message is-${props.importMessage.kind}`} role="status">
            {props.importMessage.text}
          </p>
        )}
        <p className="hint">Imports are always added as a new project — nothing existing is overwritten. A room scan from an iPhone or iPad with LiDAR is read on this device and reviewed before anything is created.</p>
      </section>

      <StorageSection inUse={props.photosInUse} />
    </Dialog>
  );
}
