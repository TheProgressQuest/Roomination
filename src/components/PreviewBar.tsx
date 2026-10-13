import { Icon } from './Icon';

interface PreviewBarProps {
  title: string;
  onApply: () => void;
  onBack: () => void;
  onExit: () => void;
}

/** Shown above the plan while a suggestion is previewed. The real layout is untouched. */
export function PreviewBar({ title, onApply, onBack, onExit }: PreviewBarProps) {
  return (
    <section className="drawing-bar preview-bar" aria-label="Previewing a layout">
      <p className="drawing-title">
        <Icon name="sparkle" size={16} /> Previewing {title}
      </p>
      <p className="hint" role="status">
        This is only a preview — your layout hasn’t changed. Nothing on the plan can be edited until you exit.
      </p>
      <div className="drawing-actions">
        <button type="button" className="secondary" onClick={onBack}>
          Back to suggestions
        </button>
        <button type="button" className="secondary" onClick={onExit}>
          Exit preview
        </button>
        <button type="button" className="primary" onClick={onApply}>
          <Icon name="check" size={16} /> Apply layout
        </button>
      </div>
    </section>
  );
}
