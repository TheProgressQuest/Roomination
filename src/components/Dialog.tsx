import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Optional footer (e.g. action buttons) that stays visible while the body scrolls. */
  footer?: ReactNode;
  className?: string;
}

/**
 * Accessible modal built on the native <dialog> element: it traps keyboard focus,
 * closes on Escape, and makes everything behind it inert, so taps can't fall
 * through to the floor plan. Clicking the backdrop deliberately does nothing.
 */
export function Dialog({ open, title, onClose, children, footer, className = '' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Escape: let React decide, so state and the element never disagree.
        e.preventDefault();
        onClose();
      }}
    >
      {open && (
        <div className="dialog-frame">
          <header className="dialog-header">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          </header>
          <div className="dialog-body">{children}</div>
          {footer && <footer className="dialog-footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
