import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import { SegmentedControl } from '../components/SegmentedControl';
import { mirrorImage, prepareView, smoothMask, symmetricMask, traceOutline, type Point2 } from '../model/photoModel';
import type { Furniture, PhotoModel, Point, UnitSystem } from '../model/types';
import { formatLength } from '../model/units';
import { encodeImage, toImageData } from '../photo/imageIO';
import type { RGBAImage } from '../photo/imageOps';
import type { EditorAction } from '../state/editor';
import { putAsset } from '../storage/assets';
import { cutTexture } from './photoTools';

/**
 * Reconstruct an object from photos: for each view (front, a side, the top), drag the corners
 * onto the object in a photo; the patch is straightened, the background you tap is trimmed
 * away, and the outline that's left shapes the object while the photo colours it. The object's
 * measured size never changes: the photos only shape and colour it inside that box.
 */

type Which = 'front' | 'right' | 'left' | 'top';
type ViewKey = 'front' | 'side' | 'top';
const VIEW_OF: Record<Which, ViewKey> = { front: 'front', right: 'side', left: 'side', top: 'top' };
const VIEW_LABELS: Record<ViewKey, string> = { front: 'Front', side: 'Side', top: 'Top' };

interface Props {
  piece: Furniture | null;
  /** The photo as corrected (white balance and exposure). */
  image: RGBAImage;
  corners: [Point, Point, Point, Point];
  units: UnitSystem;
  dispatch: Dispatch<EditorAction>;
}

export function RebuildObject({ piece, image, corners, units, dispatch }: Props) {
  const [which, setWhich] = useState<Which>('front');
  const [tolerance, setTolerance] = useState(22);
  const [seeds, setSeeds] = useState<Point2[]>([]);
  const [symmetric, setSymmetric] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Tapped background belongs to one view of one photo.
  useEffect(() => setSeeds([]), [which, image]);
  // Fronts and tops are usually symmetrical left to right; sides (front ≠ back) usually aren't.
  useEffect(() => setSymmetric(which === 'front' || which === 'top'), [which]);

  if (!piece) return <p className="hint">Select the object to rebuild (tap it in the plan or the 3D view), then come back here.</p>;
  const view = VIEW_OF[which];
  const size = view === 'front' ? { widthCm: piece.width, heightCm: piece.height } : view === 'side' ? { widthCm: piece.depth, heightCm: piece.height } : { widthCm: piece.width, heightCm: piece.depth };
  const model = piece.photoModel;
  const views = (['front', 'side', 'top'] as const).filter((v) => model?.[v]);
  const cutAt = (maxSide: number) => cutTexture(image, { corners, widthCm: size.widthCm, heightCm: size.heightCm, brightness: 1, seamless: false }, maxSide);

  async function apply() {
    if (!piece) return;
    setBusy(true);
    setMessage(null);
    try {
      const ready = prepareView(cutAt(512), tolerance, which === 'left', seeds, symmetric);
      if (!ready) throw new Error('Nothing of the object was left. Lower “Background similarity”, or clear the trimming.');
      const blob = await encodeImage(ready.image as RGBAImage);
      const assetId = await putAsset(blob, { width: ready.image.width, height: ready.image.height });
      const next: PhotoModel = { ...(model ?? {}), [view]: { assetId, silhouette: ready.silhouette, color: ready.color } };
      delete next.off;
      dispatch({ type: 'furniture/update', id: piece.id, changes: { photoModel: next } });
      setMessage(`${VIEW_LABELS[view]} view used, at the measured ${formatLength(size.widthCm, units)} × ${formatLength(size.heightCm, units)}. Undo takes it back.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That view couldn’t be made.');
    } finally {
      setBusy(false);
    }
  }

  const remove = (key: ViewKey) => {
    if (!model) return;
    const rest: PhotoModel = { ...model };
    delete rest[key];
    dispatch({ type: 'furniture/update', id: piece.id, changes: { photoModel: rest.front || rest.side || rest.top ? rest : undefined } });
  };

  return (
    <div className="stack rebuild-object">
      <p className="hint">
        Rebuild <strong>{piece.name}</strong> from photos, one view at a time. Drag the four corners to a rectangle around the object as seen from that side (1 top left, 2 top right, 3 bottom right, 4 bottom left). Its measured size stays {formatLength(piece.width, units)} wide, {formatLength(piece.depth, units)} deep and {formatLength(piece.height, units)} high.
      </p>
      <SegmentedControl
        label="This photo shows the object’s"
        value={which}
        options={[
          { value: 'front', label: 'Front' },
          { value: 'right', label: 'Right side' },
          { value: 'left', label: 'Left side' },
          { value: 'top', label: 'Top' },
        ]}
        onChange={setWhich}
      />
      <OutlinePreview image={image} corners={corners} size={size} tolerance={tolerance} mirror={which === 'left'} seeds={seeds} symmetric={symmetric} cut={cutAt} onTap={(p) => setSeeds((s) => [...s, p])} />
      <label className="range-label field">
        <span className="field-label">Background similarity {tolerance}</span>
        <input type="range" min={4} max={60} step={1} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} />
      </label>
      <label className="toggle">
        <input type="checkbox" checked={symmetric} onChange={(e) => setSymmetric(e.target.checked)} />
        Symmetrical left to right (its outline is mirrored to match)
      </label>
      <div className="button-row">
        <button type="button" className="primary" disabled={busy} onClick={() => void apply()}>
          {busy ? 'Working…' : `Use as the ${VIEW_LABELS[view].toLowerCase()} view`}
        </button>
        {seeds.length > 0 && (
          <button type="button" className="secondary" onClick={() => setSeeds([])}>
            Clear trimming
          </button>
        )}
      </div>
      {model && (
        <div className="stack rebuild-views">
          <p className="field-label">Views used</p>
          <ul className="match-views">
            {views.map((v) => (
              <li key={v}>
                <span>{VIEW_LABELS[v]}</span>
                <button type="button" className="link-button" onClick={() => remove(v)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <label className="toggle">
            <input type="checkbox" checked={!model.off} onChange={(e) => dispatch({ type: 'furniture/update', id: piece.id, changes: { photoModel: { ...model, off: e.target.checked ? undefined : true } } })} />
            Show the rebuilt look
          </label>
          <p className="hint">The rebuilt look is only how it appears. Moving it, collisions and measurements still use its measured box. To use it in other rooms, save it to your library from its properties.</p>
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => dispatch({ type: 'furniture/update', id: piece.id, changes: { photoModel: undefined } })}>
              Remove the rebuilt look
            </button>
          </div>
        </div>
      )}
      {message && (
        <p className="hint match-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

/** The straightened patch: tap the background to trim it (shown as a checkerboard). */
function OutlinePreview({ image, corners, size, tolerance, mirror, seeds, symmetric, cut, onTap }: { image: RGBAImage; corners: [Point, Point, Point, Point]; size: { widthCm: number; heightCm: number }; tolerance: number; mirror: boolean; seeds: Point2[]; symmetric: boolean; cut: (maxSide: number) => RGBAImage; onTap: (p: Point2) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const patch = useMemo(() => {
    const p = cut(200);
    return mirror ? mirrorImage(p) : p;
  }, [image, corners, size.widthCm, size.heightCm, mirror]);
  const mask = useMemo(() => {
    const traced = smoothMask(traceOutline(patch, tolerance, seeds), patch.width, patch.height);
    return symmetric ? symmetricMask(traced, patch.width, patch.height) : traced;
  }, [patch, tolerance, seeds, symmetric]);
  // Where the patch is drawn, at the object's real proportions.
  const frame = useMemo(() => {
    const aspect = size.widthCm / size.heightCm;
    const w = Math.min(280, 200 * aspect);
    return { x: (280 - w) / 2, y: (200 - w / aspect) / 2, w, h: w / aspect };
  }, [size.widthCm, size.heightCm]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    canvas.width = 280;
    canvas.height = 200;
    ctx.clearRect(0, 0, 280, 200);
    for (let y = 0; y < frame.h; y += 8)
      for (let x = 0; x < frame.w; x += 8) {
        ctx.fillStyle = (x + y) % 16 ? '#d9dce3' : '#f4f5f8';
        ctx.fillRect(frame.x + x, frame.y + y, Math.min(8, frame.w - x), Math.min(8, frame.h - y));
      }
    const data = new Uint8ClampedArray(patch.data);
    for (let i = 0; i < mask.length; i++) if (!mask[i]) data[i * 4 + 3] = 0;
    const tile = document.createElement('canvas');
    tile.width = patch.width;
    tile.height = patch.height;
    tile.getContext('2d')!.putImageData(toImageData({ width: patch.width, height: patch.height, data } as RGBAImage), 0, 0);
    ctx.drawImage(tile, frame.x, frame.y, frame.w, frame.h);
    for (const s of seeds) {
      ctx.beginPath();
      ctx.arc(frame.x + s.x * frame.w, frame.y + s.y * frame.h, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#1f2bd6';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [patch, mask, seeds, frame]);

  return (
    <figure className="match-preview rebuild-preview">
      <canvas
        ref={ref}
        aria-label="This view, straightened. Tap the background around the object to trim it."
        onPointerDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 280;
          const y = ((e.clientY - rect.top) / rect.height) * 200;
          const p = { x: (x - frame.x) / frame.w, y: (y - frame.y) / frame.h };
          if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) onTap(p);
        }}
      />
      <figcaption className="hint">Straightened, at the object’s proportions. Tap the background (wall, table) to trim it; the checkerboard shows what’s trimmed.</figcaption>
    </figure>
  );
}
