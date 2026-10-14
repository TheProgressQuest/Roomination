import { useState } from 'react';
import { boundingBox } from '../../model/polygon';
import { localFootprint, ringsSvgPath } from '../../model/shape';
import type { UnitSystem } from '../../model/types';
import { formatLength } from '../../model/units';
import { deleteLibraryItem, duplicateLibraryItem, furnitureOrigin, ORIGIN_LABELS, type LibraryItem } from '../../storage/library';
import type { FurnitureTemplate } from '../../storage/projectFile';
import { Icon } from '../Icon';
import { useOpenStudio } from '../studio/studioContext';
import { useAssetImage } from '../useAssetImage';
import { libraryChanged, useLibrary } from './useLibrary';

/**
 * Custom furniture: draw a new piece, start from photos, or reuse a piece from the
 * library (saved on this device and shared by every project).
 */
export function CustomFurniturePanel({ units, onPlace }: { units: UnitSystem; onPlace: (template: FurnitureTemplate) => void }) {
  const openStudio = useOpenStudio();
  const { items, loading, error } = useLibrary();
  return (
    <div className="custom-furniture">
      <div className="preset-grid">
        <button type="button" className="preset" onClick={() => openStudio({ mode: 'new' })}>
          <Icon name="drawRoom" size={16} />
          <span className="preset-label">Draw custom furniture</span>
        </button>
        <button type="button" className="preset" onClick={() => openStudio({ mode: 'photos' })}>
          <Icon name="upload" size={16} />
          <span className="preset-label">Create from photos</span>
        </button>
      </div>
      <h3 className="list-heading">My furniture library</h3>
      {error && <p className="form-error">{error}</p>}
      {!loading && items.length === 0 && !error && <p className="hint">Pieces you save to the library appear here, ready for any project on this device.</p>}
      {items.length > 0 && (
        <ul className="library-list">
          {items.map((item) => (
            <LibraryRow key={item.id} item={item} units={units} names={items.map((i) => i.template.name)} onPlace={() => onPlace(item.template)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LibraryRow({ item, units, names, onPlace }: { item: LibraryItem; units: UnitSystem; names: string[]; onPlace: () => void }) {
  const openStudio = useOpenStudio();
  const [confirming, setConfirming] = useState(false);
  const t = item.template;
  const origin = furnitureOrigin(t);
  return (
    <li className="library-row">
      <LibraryThumbnail template={t} />
      <div className="library-info">
        <span className="object-name">{t.name}</span>
        <span className="object-meta">
          <span className={`origin-badge is-${origin}`}>{ORIGIN_LABELS[origin]}</span> {formatLength(t.width, units)} × {formatLength(t.depth, units)}
        </span>
      </div>
      {confirming ? (
        <div className="library-actions">
          <span className="hint">Delete from library?</span>
          <button
            type="button"
            className="danger compact small"
            onClick={async () => {
              await deleteLibraryItem(item.id);
              libraryChanged();
            }}
          >
            Delete
          </button>
          <button type="button" className="secondary small" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </div>
      ) : (
        <div className="library-actions">
          <button type="button" className="primary small" onClick={onPlace} aria-label={`Add ${t.name} to the room`}>
            <Icon name="plus" size={14} /> Add
          </button>
          <button type="button" className="icon-button small" onClick={() => openStudio({ mode: 'library', libraryId: item.id })} aria-label={`Edit ${t.name}`} title="Edit">
            <Icon name="edit" size={16} />
          </button>
          <button
            type="button"
            className="icon-button small"
            onClick={async () => {
              await duplicateLibraryItem(item, names);
              libraryChanged();
            }}
            aria-label={`Duplicate ${t.name}`}
            title="Duplicate"
          >
            <Icon name="copy" size={16} />
          </button>
          <button type="button" className="icon-button small danger-icon" onClick={() => setConfirming(true)} aria-label={`Delete ${t.name} from the library`} title="Delete">
            <Icon name="trash" size={16} />
          </button>
        </div>
      )}
    </li>
  );
}

/** A small picture of a piece: its photo if it has one, otherwise its outline from above. */
export function LibraryThumbnail({ template }: { template: FurnitureTemplate }) {
  const photoId = template.appearance?.textures?.top ?? template.appearance?.textures?.front ?? template.appearance?.photos?.[0];
  const photo = useAssetImage(photoId);
  if (photo) return <img src={photo.src} alt="" className="library-thumb" />;
  const { rings } = localFootprint(template);
  const box = boundingBox(rings.flatMap((r) => r.outer));
  const size = Math.max(box.maxX - box.minX, box.maxY - box.minY);
  return (
    <svg className="library-thumb" viewBox={`${box.minX - size * 0.1} ${box.minY - size * 0.1} ${size * 1.2} ${size * 1.2}`} aria-hidden="true">
      <path d={ringsSvgPath(rings)} fillRule="evenodd" fill={template.color} stroke="rgba(0,0,0,0.4)" strokeWidth={size / 40} />
    </svg>
  );
}
