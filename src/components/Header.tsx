import type { ThemePreference } from '../state/preferences';
import { Icon, type IconName } from './Icon';

export type SaveStatus = 'saved' | 'saving' | 'error';

interface HeaderProps {
  projectName: string;
  saveStatus: SaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  theme: ThemePreference;
  onUndo: () => void;
  onRedo: () => void;
  onOpenProjects: () => void;
  onTheme: (theme: ThemePreference) => void;
}

const SAVE_LABELS: Record<SaveStatus, string> = {
  saved: 'Saved on this device',
  saving: 'Saving…',
  error: 'Couldn’t save — storage may be blocked',
};

const THEMES: { value: ThemePreference; icon: IconName; label: string }[] = [
  { value: 'light', icon: 'sun', label: 'Light theme' },
  { value: 'dark', icon: 'moon', label: 'Dark theme' },
  { value: 'system', icon: 'monitor', label: 'Match system theme' },
];

export function Header(props: HeaderProps) {
  return (
    <header className="app-header">
      <div className="brand">
        <Logo />
        <div className="brand-text">
          <h1>Roomination</h1>
          <p className="tagline">A little less guessing. A lot more room for living.</p>
        </div>
      </div>

      <button type="button" className="project-button" onClick={props.onOpenProjects} aria-label={`Projects. Current project: ${props.projectName}`}>
        <Icon name="folder" />
        <span className="truncate">{props.projectName}</span>
      </button>

      <div className="header-actions">
        <span className={`save-status is-${props.saveStatus}`} role="status" title={SAVE_LABELS[props.saveStatus]}>
          <span className="save-dot" aria-hidden="true" />
          <span className="save-label">{SAVE_LABELS[props.saveStatus]}</span>
        </span>
        <div className="segmented theme-toggle" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={props.theme === t.value}
              aria-label={t.label}
              title={t.label}
              className={props.theme === t.value ? 'is-active' : ''}
              onClick={() => props.onTheme(t.value)}
            >
              <Icon name={t.icon} size={16} />
            </button>
          ))}
        </div>
        <div className="button-row tight">
          <button type="button" className="icon-button" onClick={props.onUndo} disabled={!props.canUndo} aria-label="Undo" title="Undo (Ctrl/⌘ Z)">
            <Icon name="undo" />
          </button>
          <button type="button" className="icon-button" onClick={props.onRedo} disabled={!props.canRedo} aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)">
            <Icon name="redo" />
          </button>
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 40 40" width="36" height="36" aria-hidden="true">
      <rect x="2" y="2" width="36" height="36" rx="10" fill="#d9643a" />
      <path d="M10 30V18l10-8 10 8v12" fill="none" stroke="#fffaf2" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <rect x="15" y="22" width="10" height="5" rx="2" fill="#f2c879" />
    </svg>
  );
}
