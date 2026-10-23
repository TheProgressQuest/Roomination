import { useEffect, useId, useMemo, useRef, useState, type Dispatch } from 'react';
import { Icon } from '../components/Icon';
import { NumberField } from '../components/NumberField';
import { SegmentedControl } from '../components/SegmentedControl';
import { MATERIAL_DEFAULT_FINISH } from './defaults';
import type { Furniture, PhotoTexture, Point, Project, ReferencePhoto } from '../model/types';
import { cmToInput, inputToCm, inputUnitLabel } from '../model/units';
import { wallLabel, wallSegments } from '../model/walls';
import { encodeImage, imageFromFile, toImageData } from '../photo/imageIO';
import type { RGBAImage } from '../photo/imageOps';
import type { EditorAction } from '../state/editor';
import { getAsset, putAsset } from '../storage/assets';
import { cutTexture, sampleColour, suggestPalette, type TextureCut } from './photoTools';

/**
 * Match My Room: photos of the real room beside the live 3D view, and tools to copy what's in
 * them: sample a colour, cut a flat patch (tiles, a stretch of wall, a cabinet front) into a
 * repeating texture, and give either to the walls, the floor or the selected piece.
 *
 * Everything stays on this device: photos and textures are stored in this browser's storage
 * like every other photo, and every change is an ordinary, undoable edit.
 */

interface Props {
  project: Project;
  selectedId: string | null;
  dispatch: Dispatch<EditorAction>;
  onClose: () => void;
}

type Mode = 'colour' | 'texture';
type Target = { kind: 'piece' } | { kind: 'walls' } | { kind: 'wall'; id: string } | { kind: 'floor' };
type Surface = 'front' | 'top' | 'side';

const targetKey = (t: Target) => (t.kind === 'wall' ? `wall:${t.id}` : t.kind);

async function loadPhoto(assetId: string): Promise<RGBAImage | null> {
  const asset = await getAsset(assetId);
  if (!asset) return null;
  const bitmap = await createImageBitmap(asset.blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
}

export default function MatchMyRoom({ project, selectedId, dispatch, onClose }: Props) {
  const photos = project.referencePhotos ?? [];
  const units = project.units;
  const unit = inputUnitLabel(units);
  const piece = project.furniture.find((f) => f.id === selectedId) ?? null;
  const [active, setActive] = useState<string | null>(photos[0]?.assetId ?? null);
  const [image, setImage] = useState<RGBAImage | null>(null);
  const [mode, setMode] = useState<Mode>('colour');
  const [colour, setColour] = useState<string | null>(null);
  const [corners, setCorners] = useState<[Point, Point, Point, Point] | null>(null);
  const [size, setSize] = useState({ widthCm: 60, heightCm: 60 });
  const [brightness, setBrightness] = useState(1.15);
  const [roughness, setRoughness] = useState(0.6);
  const [seamless, setSeamless] = useState(true);
  const [target, setTarget] = useState<Target>(piece ? { kind: 'piece' } : { kind: 'walls' });
  const [surface, setSurface] = useState<Surface>('front');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const targetId = useId();

  // Follow the selection: picking a piece in the 3D view makes it the target.
  useEffect(() => {
    if (piece) setTarget({ kind: 'piece' });
    else setTarget((t) => (t.kind === 'piece' ? { kind: 'walls' } : t));
  }, [piece?.id]);

  useEffect(() => {
    if (!active && photos[0]) setActive(photos[0].assetId);
    if (active && !photos.some((p) => p.assetId === active)) setActive(photos[0]?.assetId ?? null);
  }, [photos, active]);

  useEffect(() => {
    let cancelled = false;
    setImage(null);
    if (!active) return;
    void loadPhoto(active).then((img) => {
      if (cancelled) return;
      setImage(img);
      if (img) setCorners([{ x: img.width * 0.3, y: img.height * 0.55 }, { x: img.width * 0.7, y: img.height * 0.55 }, { x: img.width * 0.75, y: img.height * 0.85 }, { x: img.width * 0.25, y: img.height * 0.85 }]);
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const palette = useMemo(() => (image ? suggestPalette(image, 6) : []), [image]);
  const cut: TextureCut | null = corners ? { corners, ...size, brightness, seamless } : null;

  async function addPhoto(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const img = await imageFromFile(file);
      const blob = await encodeImage(img);
      const assetId = await putAsset(blob, { width: img.width, height: img.height });
      const next: ReferencePhoto[] = [...photos.filter((p) => p.assetId !== assetId), { assetId, name: file.name.slice(0, 80), addedAt: Date.now() }];
      dispatch({ type: 'photos/set', photos: next });
      setActive(assetId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That photo couldn’t be added.');
    } finally {
      setBusy(false);
    }
  }

  function applyColour() {
    if (!colour) return;
    if (target.kind === 'piece' && piece) dispatch({ type: 'furniture/update', id: piece.id, changes: { color: colour } });
    if (target.kind === 'walls') dispatch({ type: 'room/setWallLook', wallId: null, color: colour });
    if (target.kind === 'wall') dispatch({ type: 'room/setWallLook', wallId: target.id, color: colour });
    if (target.kind === 'floor') dispatch({ type: 'floor/set', floor: { color: colour } });
    setMessage('Colour applied. Undo brings back the previous one.');
  }

  async function applyTexture() {
    if (!image || !cut) return;
    setBusy(true);
    setMessage(null);
    try {
      const tile = cutTexture(image, cut, 512);
      const blob = await encodeImage(tile);
      const assetId = await putAsset(blob, { width: tile.width, height: tile.height });
      const texture: PhotoTexture = { assetId, widthCm: Math.round(size.widthCm * 10) / 10, heightCm: Math.round(size.heightCm * 10) / 10, roughness };
      if (target.kind === 'piece' && piece) dispatch({ type: 'furniture/update', id: piece.id, changes: { appearance: withPhoto(piece, surface, assetId) } });
      if (target.kind === 'walls') dispatch({ type: 'room/setWallLook', wallId: null, texture });
      if (target.kind === 'wall') dispatch({ type: 'room/setWallLook', wallId: target.id, texture });
      if (target.kind === 'floor') dispatch({ type: 'floor/set', floor: { photo: texture } });
      setMessage('Texture applied. The original photo is kept; Undo removes the texture.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That texture couldn’t be made.');
    } finally {
      setBusy(false);
    }
  }

  function removeTexture() {
    if (target.kind === 'piece' && piece?.appearance?.textures?.[surface]) {
      const { [surface]: _gone, ...textures } = piece.appearance.textures;
      dispatch({ type: 'furniture/update', id: piece.id, changes: { appearance: { ...piece.appearance, textures } } });
    }
    if (target.kind === 'walls') dispatch({ type: 'room/setWallLook', wallId: null, texture: null });
    if (target.kind === 'wall') dispatch({ type: 'room/setWallLook', wallId: target.id, texture: null, color: null });
    if (target.kind === 'floor') dispatch({ type: 'floor/set', floor: { photo: undefined } });
  }

  const walls = wallSegments(project.room);
  const targets: { value: string; label: string; target: Target }[] = [
    ...(piece ? [{ value: 'piece', label: `Selected: ${piece.name}`, target: { kind: 'piece' } as Target }] : []),
    { value: 'walls', label: 'All walls', target: { kind: 'walls' } },
    ...walls.map((w) => ({ value: `wall:${w.id}`, label: wallLabel(project.room, w.id), target: { kind: 'wall', id: w.id } as Target })),
    { value: 'floor', label: 'Floor', target: { kind: 'floor' } },
  ];
  const hasTexture =
    (target.kind === 'piece' && !!piece?.appearance?.textures?.[surface]) ||
    (target.kind === 'walls' && !!project.room.wallTexture) ||
    (target.kind === 'wall' && !!project.room.wallFinishes?.[target.id]) ||
    (target.kind === 'floor' && !!project.room.floor.photo);

  return (
    <aside className="match-panel" aria-label="Match my room">
      <div className="match-head">
        <h2>
          Match my room <span className="beta-badge">Beta</span>
        </h2>
        <button type="button" className="icon-button small" aria-label="Close Match my room" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="match-photos" role="list" aria-label="Photos of the room">
        {photos.map((p) => (
          <PhotoThumb key={p.assetId} photo={p} active={p.assetId === active} onSelect={() => setActive(p.assetId)} onRemove={() => dispatch({ type: 'photos/set', photos: photos.filter((q) => q.assetId !== p.assetId) })} />
        ))}
        <button type="button" className="secondary small match-add" onClick={() => fileInput.current?.click()} disabled={busy}>
          <Icon name="plus" size={14} /> {photos.length ? 'Add photo' : 'Add a photo of the room'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void addPhoto(file);
            e.target.value = '';
          }}
        />
      </div>
      <p className="hint">Photos stay on this device. Put the photo beside the 3D view and copy what you see.</p>

      {image && corners && (
        <>
          <SegmentedControl
            label="Tool"
            value={mode}
            options={[
              { value: 'colour', label: 'Pick colour' },
              { value: 'texture', label: 'Cut texture' },
            ]}
            onChange={setMode}
          />
          <PhotoCanvas image={image} mode={mode} corners={corners} onCorners={setCorners} onSample={(p) => setColour(sampleColour(image, p.x, p.y, Math.max(2, Math.round(image.width / 300))))} />

          {mode === 'colour' ? (
            <div className="stack">
              <p className="hint">Tap the photo to sample a colour, or pick one the photo suggests. Photos are often darker than the real surface.</p>
              <div className="match-swatches" role="radiogroup" aria-label="Suggested colours">
                {palette.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={colour === c} className="match-swatch" style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => setColour(c)} />
                ))}
              </div>
              {colour && (
                <div className="match-picked">
                  <span className="match-swatch is-large" style={{ background: colour }} aria-hidden="true" />
                  <label className="field">
                    <span className="field-label">Colour</span>
                    <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} />
                  </label>
                  <code>{colour}</code>
                </div>
              )}
            </div>
          ) : (
            <div className="stack">
              <p className="hint">Drag the four corners onto a flat patch: a few floor tiles, a stretch of wall, a cabinet front. Then enter that patch’s real size. Perspective is corrected from your corners only, so place them carefully; curved surfaces won’t flatten.</p>
              <div className="field-grid two">
                <NumberField label="Patch width" suffix={unit} min={1} value={cmToInput(size.widthCm, units)} onCommit={(v) => setSize((s) => ({ ...s, widthCm: Math.max(1, inputToCm(v, units)) }))} />
                <NumberField label="Patch height" suffix={unit} min={1} value={cmToInput(size.heightCm, units)} onCommit={(v) => setSize((s) => ({ ...s, heightCm: Math.max(1, inputToCm(v, units)) }))} />
              </div>
              <label className="range-label field">
                <span className="field-label">Brightness ×{brightness.toFixed(2)}</span>
                <input type="range" min={0.6} max={1.8} step={0.05} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} />
              </label>
              <label className="range-label field">
                <span className="field-label">Roughness {roughness < 0.35 ? '(glossy)' : roughness > 0.75 ? '(matte)' : '(satin)'}</span>
                <input type="range" min={0.05} max={1} step={0.05} value={roughness} onChange={(e) => setRoughness(Number(e.target.value))} />
              </label>
              <label className="toggle">
                <input type="checkbox" checked={seamless} onChange={(e) => setSeamless(e.target.checked)} />
                Soften the seams where it repeats
              </label>
              {cut && <TexturePreview image={image} cut={cut} />}
            </div>
          )}

          <div className="field">
            <label htmlFor={targetId}>Apply to</label>
            <select
              id={targetId}
              value={targetKey(target)}
              onChange={(e) => {
                const found = targets.find((t) => t.value === e.target.value);
                if (found) setTarget(found.target);
              }}
            >
              {targets.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          {target.kind === 'piece' && mode === 'texture' && (
            <SegmentedControl
              label="Surface of the piece"
              value={surface}
              options={[
                { value: 'front', label: 'Front' },
                { value: 'top', label: 'Top' },
                { value: 'side', label: 'Sides' },
              ]}
              onChange={setSurface}
            />
          )}
          {target.kind === 'piece' && mode === 'texture' && <p className="hint">On furniture, the patch is stretched over that whole surface (photograph the front straight on).</p>}
          <div className="button-row">
            {mode === 'colour' ? (
              <button type="button" className="primary small" disabled={!colour} onClick={applyColour}>
                Apply colour
              </button>
            ) : (
              <button type="button" className="primary small" disabled={busy} onClick={() => void applyTexture()}>
                {busy ? 'Making texture…' : 'Apply texture'}
              </button>
            )}
            {hasTexture && (
              <button type="button" className="secondary small" onClick={removeTexture}>
                Remove {target.kind === 'wall' ? 'this wall’s own look' : 'texture'}
              </button>
            )}
          </div>
        </>
      )}
      {!photos.length && <p className="hint">Add a photo taken from a corner or doorway, with the lights on. Then match colours and textures to it, surface by surface.</p>}
      {message && (
        <p className="hint match-message" role="status">
          {message}
        </p>
      )}
    </aside>
  );
}

function withPhoto(piece: Furniture, surface: Surface, assetId: string): NonNullable<Furniture['appearance']> {
  const material = piece.appearance?.material ?? 'custom';
  return { material, finish: piece.appearance?.finish ?? MATERIAL_DEFAULT_FINISH, ...piece.appearance, textures: { ...(piece.appearance?.textures ?? {}), [surface]: assetId } };
}

function PhotoThumb({ photo, active, onSelect, onRemove }: { photo: ReferencePhoto; active: boolean; onSelect: () => void; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    void getAsset(photo.assetId).then((a) => {
      if (!a) return;
      revoke = URL.createObjectURL(a.blob);
      setUrl(revoke);
    });
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [photo.assetId]);
  return (
    <div role="listitem" className={`match-thumb${active ? ' is-active' : ''}`}>
      <button type="button" onClick={onSelect} aria-pressed={active} aria-label={`Use photo ${photo.name}`}>
        {url && <img src={url} alt="" />}
      </button>
      <button type="button" className="match-thumb-remove" aria-label={`Remove ${photo.name} from this project`} onClick={onRemove}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

/** The photo, fitted to the panel: tap to sample, or drag the texture corners. */
function PhotoCanvas({ image, mode, corners, onCorners, onSample }: { image: RGBAImage; mode: Mode; corners: [Point, Point, Point, Point]; onCorners: (c: [Point, Point, Point, Point]) => void; onSample: (p: Point) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const source = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    c.getContext('2d')!.putImageData(toImageData(image), 0, 0);
    return c;
  }, [image]);
  const dragging = useRef<number | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const width = canvas.clientWidth || 340;
    const scale = width / image.width;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(image.height * scale * ratio);
    canvas.style.height = `${image.height * scale}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);
    ctx.drawImage(source, 0, 0);
    if (mode === 'texture') {
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = 'rgba(31, 43, 214, 0.18)';
      ctx.beginPath();
      corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([6 / scale, 4 / scale]);
      ctx.strokeStyle = '#1f2bd6';
      ctx.stroke();
      ctx.setLineDash([]);
      corners.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 9 / scale, 0, Math.PI * 2);
        ctx.fillStyle = '#1f2bd6';
        ctx.fill();
        ctx.lineWidth = 2 / scale;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = `${11 / scale}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), p.x, p.y);
      });
    }
  }, [image, source, mode, corners]);

  const toImage = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = rect.width / image.width;
    return { x: Math.max(0, Math.min(image.width, (e.clientX - rect.left) / scale)), y: Math.max(0, Math.min(image.height, (e.clientY - rect.top) / scale)) };
  };

  return (
    <canvas
      ref={ref}
      className={`match-photo is-${mode}`}
      aria-label={mode === 'colour' ? 'Room photo: tap to sample a colour' : 'Room photo: drag the four numbered corners'}
      onPointerDown={(e) => {
        const p = toImage(e);
        if (mode === 'colour') {
          onSample(p);
          return;
        }
        const rect = e.currentTarget.getBoundingClientRect();
        const scale = rect.width / image.width;
        const near = corners.findIndex((c) => Math.hypot(c.x - p.x, c.y - p.y) * scale < 22);
        if (near >= 0) {
          dragging.current = near;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      }}
      onPointerMove={(e) => {
        if (dragging.current === null) return;
        const p = toImage(e);
        const next = [...corners] as [Point, Point, Point, Point];
        next[dragging.current] = p;
        onCorners(next);
      }}
      onPointerUp={() => (dragging.current = null)}
      onPointerCancel={() => (dragging.current = null)}
    />
  );
}

function TexturePreview({ image, cut }: { image: RGBAImage; cut: TextureCut }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const canvas = ref.current;
      if (!canvas) return;
      const tile = cutTexture(image, cut, 128);
      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = tile.width;
      tileCanvas.height = tile.height;
      tileCanvas.getContext('2d')!.putImageData(toImageData(tile), 0, 0);
      const ctx = canvas.getContext('2d')!;
      canvas.width = 240;
      canvas.height = 120;
      // Repeated 2 × 2 (or so), as it will tile on the surface.
      const pattern = ctx.createPattern(tileCanvas, 'repeat')!;
      const scale = Math.min(120 / tile.width, 60 / tile.height);
      pattern.setTransform(new DOMMatrix().scale(scale));
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, 240, 120);
    });
    return () => cancelAnimationFrame(frame);
  }, [image, cut.corners, cut.widthCm, cut.heightCm, cut.brightness, cut.seamless]);
  return (
    <figure className="match-preview">
      <canvas ref={ref} aria-label="Preview of the texture, repeated" />
      <figcaption className="hint">Preview, repeated as it will be on the surface.</figcaption>
    </figure>
  );
}
