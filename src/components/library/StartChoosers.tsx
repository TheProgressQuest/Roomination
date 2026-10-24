import { useEffect, useId, useState } from 'react';
import { Dialog } from '../Dialog';
import { useOpenStudio, type StudioRequest } from '../studio/studioContext';

/**
 * The two ways to start a new piece yourself (Furnish → Custom furniture & library):
 *  - Create furniture…: draw its outline, combine shapes, or build it from parts;
 *  - From photos or a 3D scan…: import a scan, or start from photos.
 * Each opens the same tool as before; editing an existing piece goes straight to its tool.
 */

type Option<T extends string> = { value: T; title: string; text: string; request: StudioRequest; start: string };

export type CreateMethod = 'outline' | 'shapes' | 'parts';

const CREATE_OPTIONS: Option<CreateMethod>[] = [
  { value: 'outline', title: 'Draw its outline', text: 'Quickest: click or tap its corners, or start from an L-shape, circle or rounded rectangle. Good for tables, desks and sofas.', request: { mode: 'new' }, start: 'Start drawing' },
  { value: 'shapes', title: 'Combine shapes', text: 'Add and cut rectangles and circles to make its footprint. Good for corner units and bay seating.', request: { mode: 'builder' }, start: 'Start combining shapes' },
  { value: 'parts', title: 'Build from parts', text: 'Legs, seat, back, shelves and doors in 3D, with templates. Good for detailed pieces.', request: { mode: 'components' }, start: 'Start building' },
];

type PhotoStart = 'scan' | 'photos';

const PHOTO_OPTIONS: Option<PhotoStart>[] = [
  { value: 'scan', title: 'I have a 3D scan', text: 'A GLB or USDZ from a scanning app (Reality Composer, Scaniverse, Polycam …). Imported with its textures, at its real size.', request: { mode: 'model' }, start: 'Choose the scan' },
  { value: 'photos', title: 'I have photos of it', text: 'Front, side or top photos become its surfaces. Later, its Photos & scans can also rebuild its shape from them.', request: { mode: 'photos' }, start: 'Start from photos' },
];

const LAST_METHOD = 'roomination.createMethod';

/** The method used last (kept in this browser only; any failure just means no preselection). */
function lastMethod(): CreateMethod {
  try {
    const saved = localStorage.getItem(LAST_METHOD);
    return CREATE_OPTIONS.some((o) => o.value === saved) ? (saved as CreateMethod) : 'outline';
  } catch {
    return 'outline';
  }
}

function rememberMethod(method: CreateMethod) {
  try {
    localStorage.setItem(LAST_METHOD, method);
  } catch {
    /* storage blocked (private browsing): the choice just isn't remembered */
  }
}

function Chooser<T extends string>({ title, intro, options, initial, initialBadge, onClose, onChoose }: { title: string; intro: string; options: Option<T>[]; initial: T; /** Marks the preselected option (e.g. "Used last"). */ initialBadge?: string; onClose: () => void; onChoose: (option: Option<T>) => void }) {
  const [value, setValue] = useState<T>(initial);
  const formId = useId();
  const name = useId();
  useEffect(() => setValue(initial), [initial]);
  const chosen = options.find((o) => o.value === value) ?? options[0];
  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      className="start-chooser"
      footer={
        <div className="button-row">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className="primary">
            {chosen.start}
          </button>
        </div>
      }
    >
      <form
        id={formId}
        className="dialog-section stack"
        onSubmit={(e) => {
          e.preventDefault();
          onChoose(chosen);
        }}
      >
        <p className="hint">{intro}</p>
        <div className="choice-cards" role="radiogroup" aria-label={title}>
          {options.map((o) => (
            <label key={o.value} className={`choice-card${o.value === value ? ' is-active' : ''}`}>
              <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => setValue(o.value)} />
              <span className="choice-title">
                {o.title}
                {initialBadge && o.value === initial && <span className="badge">{initialBadge}</span>}
              </span>
              <span className="choice-text">{o.text}</span>
            </label>
          ))}
        </div>
      </form>
    </Dialog>
  );
}

/** Create furniture…: the last-used method is preselected, so Enter starts it again. */
export function CreateFurnitureDialog({ onClose }: { onClose: () => void }) {
  const openStudio = useOpenStudio();
  const [initial] = useState(lastMethod);
  const [remembered] = useState(() => {
    try {
      return localStorage.getItem(LAST_METHOD) !== null;
    } catch {
      return false;
    }
  });
  return (
    <Chooser
      title="Create furniture"
      intro="Choose how to start. Every piece keeps all its options, whichever way you start."
      options={CREATE_OPTIONS}
      initial={initial}
      initialBadge={remembered ? 'Used last' : undefined}
      onClose={onClose}
      onChoose={(o) => {
        rememberMethod(o.value);
        onClose();
        openStudio(o.request);
      }}
    />
  );
}

/** From photos or a 3D scan…: a new piece from a scan, or from photos. */
export function PhotosOrScanDialog({ onClose }: { onClose: () => void }) {
  const openStudio = useOpenStudio();
  return (
    <Chooser
      title="From photos or a 3D scan"
      intro="Start a new piece from what you have. For a piece already in the room, select it and use Photos & scans in its properties."
      options={PHOTO_OPTIONS}
      initial="scan"
      onClose={onClose}
      onChoose={(o) => {
        onClose();
        openStudio(o.request);
      }}
    />
  );
}
