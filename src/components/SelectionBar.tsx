import { Icon } from './Icon';

interface SelectionBarProps {
  /** Name of the selected object, or null when nothing is selected. */
  selectedName: string | null;
  canRotate: boolean;
  onEdit: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onAdd: () => void;
}

/**
 * Touch-friendly controls under the plan on phones and tablets: a visible "Edit"
 * button (double-tap is a shortcut, never the only way), plus rotate and delete.
 */
export function SelectionBar({ selectedName, canRotate, onEdit, onRotate, onDelete, onAdd }: SelectionBarProps) {
  if (!selectedName) {
    return (
      <div className="selection-bar">
        <p className="selection-hint">Tap an item to select it. Double-tap to edit.</p>
        <button type="button" className="primary" onClick={onAdd}>
          <Icon name="plus" size={16} /> Add
        </button>
      </div>
    );
  }
  return (
    <div className="selection-bar" role="toolbar" aria-label={`Actions for ${selectedName}`}>
      <p className="selection-name truncate">{selectedName}</p>
      <div className="button-row tight">
        <button type="button" className="primary" onClick={onEdit}>
          <Icon name="edit" size={16} /> Edit
        </button>
        {canRotate && (
          <button type="button" className="icon-button" onClick={onRotate} aria-label="Rotate 90° clockwise">
            <Icon name="rotateRight" />
          </button>
        )}
        <button type="button" className="icon-button danger-icon" onClick={onDelete} aria-label={`Delete ${selectedName}`}>
          <Icon name="trash" />
        </button>
      </div>
    </div>
  );
}
