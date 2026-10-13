import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { putAsset, StorageFullError } from '../storage/assets';
import type { RGBAImage } from './imageOps';
import { encodeImage, imageFromFile, imageToUrl } from './imageIO';
import { PhotoEditor } from './PhotoEditor';
import { stopPhotoWorker } from './photoClient';

/**
 * "Create furniture from photos": choose photos of one piece (front, side, top, or any
 * other angle), edit them (crop, rotate, straighten, remove the background) and keep them.
 * Everything happens in this browser; photos are saved on this device only.
 */

export type PhotoView = 'front' | 'side' | 'top' | 'other';

export interface WorkshopPhoto {
  id: string;
  view: PhotoView;
}

const VIEWS: { view: PhotoView; label: string; hint: string }[] = [
  { view: 'front', label: 'Front', hint: 'Straight on, at about seat height. Used for the front of the 3D model.' },
  { view: 'side', label: 'Side', hint: 'From the left or right. Used for the sides of the 3D model.' },
  { view: 'top', label: 'From above', hint: 'Looking straight down (stand on a step). Best for tracing the outline.' },
  { view: 'other', label: 'Another angle', hint: 'Any other view, kept as a reference.' },
];

interface Slot {
  view: PhotoView;
  image: RGBAImage;
  url: string;
}

export default function PhotoWorkshop({ onDone, onCancel }: { onDone: (photos: WorkshopPhoto[]) => void; onCancel: () => void }) {
  const [slots, setSlots] = useState<Partial<Record<PhotoView, Slot>>>({});
  const [editing, setEditing] = useState<PhotoView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Free preview URLs and the worker when the workshop closes.
  const urls = useRef(new Set<string>());
  for (const slot of Object.values(slots)) if (slot?.url) urls.current.add(slot.url);
  useEffect(
    () => () => {
      stopPhotoWorker();
      for (const url of urls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  async function choose(view: PhotoView, file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const image = await imageFromFile(file);
      const url = await imageToUrl(image);
      setSlots((current) => ({ ...current, [view]: { view, image, url } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That photo couldn’t be opened.');
    }
  }

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      const photos: WorkshopPhoto[] = [];
      for (const slot of Object.values(slots)) {
        if (!slot) continue;
        const blob = await encodeImage(slot.image);
        photos.push({ id: await putAsset(blob, { width: slot.image.width, height: slot.image.height }), view: slot.view });
      }
      onDone(photos);
    } catch (e) {
      setError(e instanceof StorageFullError ? e.message : `The photos couldn’t be saved: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  }

  const count = Object.values(slots).filter(Boolean).length;
  const current = editing ? slots[editing] : undefined;

  if (current && editing) {
    return (
      <PhotoEditor
        title={`Edit photo: ${VIEWS.find((v) => v.view === editing)!.label}`}
        image={current.image}
        onCancel={() => setEditing(null)}
        onSave={async (image) => {
          const url = await imageToUrl(image);
          setSlots((s) => ({ ...s, [editing]: { view: editing, image, url } }));
          setEditing(null);
        }}
      />
    );
  }

  return (
    <Dialog
      open
      title="Create furniture from photos"
      onClose={onCancel}
      className="workshop-dialog"
      footer={
        <div className="button-row">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={finish} disabled={count === 0 || saving}>
            {saving ? 'Saving…' : count > 1 ? `Use these ${count} photos` : 'Use this photo'}
          </button>
        </div>
      }
    >
      <div className="workshop">
        <p className="workshop-intro">
          <strong>For best results, photograph your furniture from the front, the side and above.</strong> One photo is enough to start. Plain backgrounds (a wall or floor) make
          backgrounds easiest to remove.
        </p>
        <p className="hint">
          <Icon name="lock" size={14} /> Photos are processed and stored only in this browser, on this device. They are never uploaded.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <ul className="view-slots">
          {VIEWS.map(({ view, label, hint }) => {
            const slot = slots[view];
            const inputId = `photo-${view}`;
            return (
              <li key={view} className="view-slot">
                <h4>{label}</h4>
                {slot?.url ? <img src={slot.url} alt={`${label} photo`} className="slot-preview" /> : <div className="slot-empty">{hint}</div>}
                <div className="button-row">
                  <label htmlFor={inputId} className="secondary small file-button">
                    <Icon name="upload" size={14} /> {slot ? 'Replace' : 'Choose photo'}
                  </label>
                  <input
                    id={inputId}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    className="visually-hidden"
                    onChange={(e) => {
                      void choose(view, e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                  {slot && (
                    <>
                      <button type="button" className="secondary small" onClick={() => setEditing(view)}>
                        <Icon name="edit" size={14} /> Edit
                      </button>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() =>
                          setSlots((s) => {
                            const next = { ...s };
                            delete next[view];
                            return next;
                          })
                        }
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="hint">Editing lets you crop, rotate, straighten a photo taken at an angle, and remove its background — automatically or with an eraser.</p>
      </div>
    </Dialog>
  );
}
