import { describeConflict } from '../model/conflicts';
import type { Project } from '../model/types';
import type { ConflictPrompt } from '../state/editor';
import { Icon } from './Icon';

interface ConflictBannerProps {
  prompt: ConflictPrompt | null;
  project: Project;
  onRevert: () => void;
  onAllow: () => void;
  onDismiss: () => void;
}

/**
 * Appears once, after a change creates new overlaps (never while dragging).
 * Non-blocking: the user can keep working, and the warning stays visible on the
 * plan and in Checks until they decide.
 */
export function ConflictBanner({ prompt, project, onRevert, onAllow, onDismiss }: ConflictBannerProps) {
  return (
    <div className="banner-region" aria-live="polite">
      {prompt && (
        <div className="conflict-banner" key={prompt.id} role="group" aria-label="Overlap warning">
          <Icon name="warning" />
          <div className="conflict-banner-text">
            {prompt.conflicts.slice(0, 2).map((c) => (
              <p key={c.key}>{describeConflict(c, project, prompt.focusId ?? undefined)}</p>
            ))}
            {prompt.conflicts.length > 2 && <p className="muted">…and {prompt.conflicts.length - 2} more.</p>}
          </div>
          <div className="conflict-banner-actions">
            <button type="button" className="secondary small" onClick={onRevert}>
              Move it back
            </button>
            <button type="button" className="secondary small" onClick={onAllow}>
              Allow overlap
            </button>
            <button type="button" className="icon-button small" onClick={onDismiss} aria-label="Dismiss (keep the warning)">
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
