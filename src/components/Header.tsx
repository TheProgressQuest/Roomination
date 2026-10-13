import { Icon } from './Icon';

export type SaveStatus = 'saved' | 'saving' | 'error';

interface HeaderProps {
  projectName: string;
  saveStatus: SaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRename: (name: string) => void;
}

const SAVE_LABELS: Record<SaveStatus, string> = {
  saved: 'Saved on this device',
  saving: 'Saving…',
  error: "Couldn't save — storage may be blocked",
};

export function Header({ projectName, saveStatus, canUndo, canRedo, onUndo, onRedo, onRename }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="brand">
        <Logo />
        <div>
          <h1>Roomination</h1>
          <p className="tagline">A little less guessing. A lot more room for living.</p>
        </div>
      </div>

      <input
        // Remount when the saved name changes (e.g. after undo) so the field stays in sync.
        key={projectName}
        className="project-name"
        aria-label="Project name"
        defaultValue={projectName}
        maxLength={60}
        onBlur={(e) => onRename(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />

      <div className="header-actions">
        <span className={`save-status is-${saveStatus}`} role="status">
          <span className="save-dot" aria-hidden="true" />
          {SAVE_LABELS[saveStatus]}
        </span>
        <div className="button-row tight">
          <button type="button" className="icon-button" onClick={onUndo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl/⌘ Z)">
            <Icon name="undo" />
          </button>
          <button type="button" className="icon-button" onClick={onRedo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)">
            <Icon name="redo" />
          </button>
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
      <rect x="2" y="2" width="36" height="36" rx="10" fill="#d9643a" />
      <path d="M10 30V18l10-8 10 8v12" fill="none" stroke="#fffaf2" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <rect x="15" y="22" width="10" height="5" rx="2" fill="#f2c879" />
    </svg>
  );
}
