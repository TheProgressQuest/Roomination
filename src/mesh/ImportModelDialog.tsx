import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Group } from 'three';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { NumberField } from '../components/NumberField';
import { SegmentedControl } from '../components/SegmentedControl';
import { guessKind } from '../model/furnitureKinds';
import { createFurniture } from '../model/sample';
import type { Furniture, MeshModel, UnitSystem } from '../model/types';
import { cmToInput, formatLength, inputToCm, inputUnitLabel } from '../model/units';
import { putAsset, StorageFullError } from '../storage/assets';
import { toTemplate } from '../storage/library';
import type { FurnitureTemplate } from '../storage/projectFile';
import { ModelFileError } from './inspect';
import { readModelFiles, TEXTURE_SIZES, toStoredGlb, turnedSize, disposeModel, type LoadedModel } from './loadModel';
import { ModelPreview } from './ModelPreview';

/**
 * Import 3D model: a textured model from a scanning app (Reality Composer / Object Capture,
 * Scaniverse, Polycam …) as GLB, glTF or USDZ. Preview it, set it upright and facing front,
 * give it its real size, then add it to the room (and the library), or use it as the look of
 * a piece already in the room. Everything happens on this device.
 */

interface Props {
  open: boolean;
  units: UnitSystem;
  /** Use the model as this piece's look (its measured size is kept unless changed here). */
  target?: Furniture;
  onClose: () => void;
  /** A new piece (and whether to also keep it in My Library). */
  onAdd: (template: FurnitureTemplate, alsoLibrary: boolean) => void | Promise<void>;
  /** The look (and size) for `target`. */
  onApply: (mesh: MeshModel, size: { width: number; depth: number; height: number }) => void;
}

type Size = { width: number; depth: number; height: number };
const NO_TURN: MeshModel['turn'] = { x: 0, y: 0, z: 0 };

export default function ImportModelDialog({ open, units, target, onClose, onAdd, onApply }: Props) {
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [status, setStatus] = useState<{ kind: 'idle' | 'working' | 'error'; message?: string }>({ kind: 'idle' });
  const [turn, setTurn] = useState<MeshModel['turn']>(NO_TURN);
  const [size, setSize] = useState<Size | null>(null);
  const [lock, setLock] = useState(!target);
  const [name, setName] = useState('');
  const [textures, setTextures] = useState<keyof typeof TEXTURE_SIZES>('full');
  const [alsoLibrary, setAlsoLibrary] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const unit = inputUnitLabel(units);

  // The model's size as modelled, after turning (glTF and USD are in metres).
  const natural = useMemo(() => (model ? turnedSize(model.scene, turn) : null), [model, turn.x, turn.y, turn.z]);
  // Turning changes which way is wide and which is deep: start the size again from the model.
  useEffect(() => {
    if (!natural) return;
    setSize(target ? { width: target.width, depth: target.depth, height: target.height } : natural);
  }, [natural]);
  useEffect(() => () => void (model && disposeModel(model.scene)), [model]);

  async function choose(files: File[]) {
    setStatus({ kind: 'working', message: 'Reading the model…' });
    try {
      const loaded = await readModelFiles(files);
      setModel(loaded);
      setTurn(NO_TURN);
      setName(target?.name ?? tidyName(loaded.name));
      setStatus({ kind: 'idle' });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof ModelFileError ? error.message : 'That model couldn’t be read on this device.' });
    }
  }

  const odd = natural && (Math.max(natural.width, natural.depth, natural.height) > 400 || Math.max(natural.width, natural.depth, natural.height) < 2);
  const setDimension = (key: keyof Size, cm: number) => {
    if (!size || !(cm > 0)) return;
    if (!lock) return setSize({ ...size, [key]: cm });
    const ratio = cm / size[key];
    setSize({ width: round(size.width * ratio), depth: round(size.depth * ratio), height: round(size.height * ratio) });
  };

  async function save() {
    if (!model || !size || !natural) return;
    setStatus({ kind: 'working', message: 'Saving the model on this device…' });
    try {
      const glb = await toStoredGlb(model.scene, TEXTURE_SIZES[textures]);
      const assetId = await putAsset(new Blob([new Uint8Array(glb)], { type: 'model/gltf-binary' }), { width: 0, height: 0 });
      const mesh: MeshModel = { assetId, triangles: model.triangles, turn, natural, ...(lock ? {} : { lockAspect: false }), source: `${model.name}.${model.format}` };
      if (target) {
        onApply(mesh, size);
      } else {
        const small = Math.max(size.width, size.depth) <= 60;
        const kind = guessKind(name);
        const piece = createFurniture({ x: 0, y: 0, name: name.trim() || 'Scanned object', ...size, kind: kind === 'custom' && small ? 'decor' : kind, category: small ? 'decoration' : 'furniture', color: '#b9b2a6', mesh });
        await onAdd(toTemplate(piece), alsoLibrary);
      }
      setStatus({ kind: 'idle' });
    } catch (error) {
      const message = error instanceof ModelFileError || error instanceof StorageFullError ? error.message : 'The model couldn’t be saved on this device. Browser storage may be full or blocked.';
      setStatus({ kind: 'error', message });
    }
  }

  const quarter = (v: number) => (v + 90) % 360;
  return (
    <Dialog
      open={open}
      title={target ? `3D model for ${target.name}` : 'Import a 3D model'}
      onClose={onClose}
      className="import-model-dialog"
      footer={
        <div className="button-row">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!model || !size || status.kind === 'working'} onClick={() => void save()}>
            {status.kind === 'working' && model ? 'Saving…' : target ? 'Use this model' : 'Add to room'}
          </button>
        </div>
      }
    >
      <section className="dialog-section stack">
        <p className="hint">
          Scan the object with a free phone app (Reality Composer’s Object Capture, Scaniverse, Polycam …) and export it as <strong>GLB</strong> or <strong>USDZ</strong>. For a <strong>.gltf</strong>, choose it together with its .bin and texture files. The file is read on this device; nothing is uploaded.
        </p>
        <div className="button-row">
          <button type="button" className="secondary" onClick={() => fileInput.current?.click()} disabled={status.kind === 'working'}>
            <Icon name="upload" size={16} /> {model ? 'Choose another model…' : 'Choose model file…'}
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          aria-label="3D model files"
          accept=".glb,.gltf,.bin,.usdz,.usdc,.usda,.usd,.jpg,.jpeg,.png,.webp,model/gltf-binary,model/gltf+json,model/vnd.usdz+zip"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) void choose(files);
          }}
        />
        {status.message && (
          <p className={status.kind === 'error' ? 'form-error' : 'hint'} role={status.kind === 'error' ? 'alert' : 'status'}>
            {status.message}
          </p>
        )}
      </section>

      {model && natural && size && (
        <>
          <section className="dialog-section stack">
            <ModelPreview root={model.scene as Group} turn={turn} />
            <p className="hint">
              {model.format.toUpperCase()} · {model.triangles.toLocaleString('en')} triangles · as modelled {formatLength(natural.width, units)} wide, {formatLength(natural.depth, units)} deep, {formatLength(natural.height, units)} high.
            </p>
            {model.warnings.map((w) => (
              <p key={w} className="hint">
                {w}
              </p>
            ))}
          </section>

          <section className="dialog-section stack">
            <h3 className="list-heading">Upright and facing front</h3>
            <p className="hint">The blue arrow is the front. Scans often come in lying down or turned: tip it until it stands, then turn it to face the arrow.</p>
            <div className="button-row">
              <button type="button" className="secondary" onClick={() => setTurn({ ...turn, x: quarter(turn.x) })}>
                Tip forward 90°
              </button>
              <button type="button" className="secondary" onClick={() => setTurn({ ...turn, z: quarter(turn.z) })}>
                Tip sideways 90°
              </button>
              <button type="button" className="secondary" onClick={() => setTurn({ ...turn, y: (turn.y + 90) % 360 })}>
                Turn 90°
              </button>
              <button type="button" className="link-button" onClick={() => setTurn(NO_TURN)} disabled={turn === NO_TURN}>
                Reset
              </button>
            </div>
            <label className="range-label field">
              <span className="field-label">Turn {Math.round(turn.y)}°</span>
              <input type="range" min={0} max={359} step={1} value={turn.y} onChange={(e) => setTurn({ ...turn, y: Number(e.target.value) })} />
            </label>
          </section>

          <section className="dialog-section stack">
            <h3 className="list-heading">Real size</h3>
            {odd && <p className="hint">This size looks unusual: the app may have saved it in other units. Enter one real measurement; the others follow.</p>}
            <div className="field-grid">
              <NumberField label="Width" suffix={unit} min={0.5} value={cmToInput(size.width, units)} onCommit={(v) => setDimension('width', inputToCm(v, units))} />
              <NumberField label="Depth" suffix={unit} min={0.5} value={cmToInput(size.depth, units)} onCommit={(v) => setDimension('depth', inputToCm(v, units))} />
              <NumberField label="Height" suffix={unit} min={0.5} value={cmToInput(size.height, units)} onCommit={(v) => setDimension('height', inputToCm(v, units))} />
            </div>
            <label className="toggle">
              <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
              Keep its proportions
            </label>
            <div className="button-row tight">
              <button type="button" className="link-button" onClick={() => setSize(natural)}>
                Use the size as modelled
              </button>
              {target && (
                <button type="button" className="link-button" onClick={() => setSize({ width: target.width, depth: target.depth, height: target.height })}>
                  Use {target.name}’s measured size
                </button>
              )}
            </div>
            <p className="hint">It stands on its base, centred in this size. Placement, collisions and the plan use the size, not the model.</p>
          </section>

          <section className="dialog-section stack">
            {!target && (
              <div className="field">
                <label htmlFor={nameId}>Name</label>
                <input id={nameId} type="text" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            )}
            <SegmentedControl
              label="Textures"
              value={textures}
              options={[
                { value: 'full', label: 'Full detail' },
                { value: 'light', label: 'Light (for phones)' },
              ]}
              onChange={setTextures}
            />
            {!target && (
              <label className="toggle">
                <input type="checkbox" checked={alsoLibrary} onChange={(e) => setAlsoLibrary(e.target.checked)} />
                Also save it to My Library (to use in other rooms)
              </label>
            )}
          </section>
        </>
      )}
    </Dialog>
  );
}

const round = (v: number) => Math.round(v * 10) / 10;

/** "vintage_radio_transceiver_1k" → "Vintage radio transceiver". */
function tidyName(file: string): string {
  const words = file.replace(/[_-]+/g, ' ').replace(/\b(1k|2k|4k|8k|lod\d|baked|mesh|model|final|export)\b/gi, '').replace(/\s+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Scanned object';
}
