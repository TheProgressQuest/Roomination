import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { SegmentedControl } from '../components/SegmentedControl';
import type { Point } from '../model/types';
import { cropImage, rotateImage, toImageData } from './imageIO';
import type { RGBAImage } from './imageOps';
import { adjustMask, edgeColourMask, straighten } from './photoClient';
import { smartRemove, type SegmentRun } from './segmentClient';

/**
 * Edits one photo: frame it (rotate, crop, straighten a photo taken at an angle), remove
 * its background (by colour, with an optional on-device AI model, or by hand), and tidy the
 * edges. The background is kept as transparency, so it can be restored at any time.
 */

type Tool = 'frame' | 'background' | 'touchup';
type FrameMode = 'crop' | 'straighten';

interface Snapshot {
  /** What's shown and saved: transparency marks removed background. */
  image: RGBAImage;
  /** The same photo with nothing removed (for the restore brush). */
  source: RGBAImage;
}

const TOOLS: { value: Tool; label: string }[] = [
  { value: 'frame', label: 'Frame' },
  { value: 'background', label: 'Background' },
  { value: 'touchup', label: 'Touch up' },
];

const copy = (image: RGBAImage): RGBAImage => ({ width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) });

function maskOf(image: RGBAImage): Uint8Array {
  const mask = new Uint8Array(image.width * image.height);
  for (let p = 0; p < mask.length; p++) mask[p] = image.data[p * 4 + 3];
  return mask;
}

function withMask(source: RGBAImage, mask: Uint8Array): RGBAImage {
  const data = new Uint8ClampedArray(source.data);
  for (let p = 0; p < mask.length; p++) data[p * 4 + 3] = Math.min(source.data[p * 4 + 3], mask[p]);
  return { width: source.width, height: source.height, data };
}

export function PhotoEditor({ title, image: initial, onSave, onCancel }: { title: string; image: RGBAImage; onSave: (image: RGBAImage) => void; onCancel: () => void }) {
  const [state, setState] = useState<Snapshot>(() => ({ image: copy(initial), source: copy(initial) }));
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [tool, setTool] = useState<Tool>('background');
  const [frameMode, setFrameMode] = useState<FrameMode>('crop');
  const [corners, setCorners] = useState<Point[]>(() => defaultCorners(initial));
  const [fineAngle, setFineAngle] = useState(0);
  const [tolerance, setTolerance] = useState(35);
  const [brush, setBrush] = useState<'erase' | 'restore'>('erase');
  const [brushSize, setBrushSize] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const segmentRun = useRef<SegmentRun | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const stroke = useRef<{ data: Uint8ClampedArray; before: Snapshot } | null>(null);
  const [dragCorner, setDragCorner] = useState<number | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);

  const { image, source } = state;

  // Draw the working image whenever it changes.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    el.width = image.width;
    el.height = image.height;
    el.getContext('2d')!.putImageData(toImageData(image), 0, 0);
  }, [image]);

  useEffect(() => () => segmentRun.current?.cancel(), []);

  function apply(next: Snapshot, note?: string) {
    setHistory((h) => [...h.slice(-11), state]);
    setState(next);
    setMessage(note ?? null);
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory(history.slice(0, -1));
    setState(previous);
    setCorners(defaultCorners(previous.image));
  }

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setMessage(null);
    try {
      await work();
    } catch (e) {
      if (!(e instanceof Error && e.message === 'Cancelled')) setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  // --- Frame ---------------------------------------------------------------

  function rotate(degrees: number) {
    const next = { image: rotateImage(image, degrees), source: rotateImage(source, degrees) };
    apply(next);
    setCorners(defaultCorners(next.image));
    setFineAngle(0);
  }

  function applyCrop() {
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const x = Math.max(0, Math.min(...xs));
    const y = Math.max(0, Math.min(...ys));
    const w = Math.min(image.width, Math.max(...xs)) - x;
    const h = Math.min(image.height, Math.max(...ys)) - y;
    if (w < 8 || h < 8) return;
    const next = { image: cropImage(image, x, y, w, h), source: cropImage(source, x, y, w, h) };
    apply(next);
    setCorners(defaultCorners(next.image));
  }

  function applyStraighten() {
    const [tl, tr, br, bl] = corners;
    const len = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
    const width = Math.round((len(tl, tr) + len(bl, br)) / 2);
    const height = Math.round((len(tl, bl) + len(tr, br)) / 2);
    if (width < 8 || height < 8) return;
    const quad = corners as [Point, Point, Point, Point];
    void run('Straightening…', async () => {
      const [nextImage, nextSource] = await Promise.all([straighten(image, quad, width, height), straighten(source, quad, width, height)]);
      apply({ image: nextImage, source: nextSource }, 'Straightened. The proportions come from where you placed the corners, so check real measurements separately.');
      setCorners(defaultCorners(nextImage));
    });
  }

  // --- Background ----------------------------------------------------------

  function removeByColour() {
    void run('Removing background…', async () => {
      const mask = await edgeColourMask(source, tolerance);
      const kept = mask.reduce((n, v) => n + (v > 0 ? 1 : 0), 0) / mask.length;
      apply({ image: withMask(source, mask), source }, kept > 0.97 ? 'Little was removed: the background may not be plain. Try a higher tolerance, Smart remove, or the eraser.' : undefined);
    });
  }

  function removeSmart() {
    void run('Smart remove…', async () => {
      const job = smartRemove(source, (stage, fraction) => {
        setBusy(stage === 'download' ? 'Downloading the on-device model (first time only)…' : stage === 'prepare' ? 'Preparing the model…' : 'Finding the furniture…');
        setProgress(stage === 'download' ? fraction : null);
      });
      segmentRun.current = job;
      const mask = await job.result;
      segmentRun.current = null;
      apply({ image: withMask(source, mask), source }, 'Background removed on this device. Use Touch up to fix any edges.');
    });
  }

  function adjustEdges(kind: 'grow' | 'soften', radius: number) {
    void run('Adjusting edges…', async () => {
      const mask = await adjustMask(kind, maskOf(image), image.width, image.height, radius);
      apply({ image: withMask(source, mask), source });
    });
  }

  // --- Pointer (corners and brush) ------------------------------------------

  function toImage(e: { clientX: number; clientY: number }): Point {
    const ctm = overlay.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm);
    return { x: Math.max(0, Math.min(image.width, p.x)), y: Math.max(0, Math.min(image.height, p.y)) };
  }

  function paint(p: Point) {
    const s = stroke.current;
    if (!s) return;
    const r = brushSize / 2;
    const x0 = Math.max(0, Math.floor(p.x - r));
    const x1 = Math.min(image.width - 1, Math.ceil(p.x + r));
    const y0 = Math.max(0, Math.floor(p.y - r));
    const y1 = Math.min(image.height - 1, Math.ceil(p.y + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - p.x) ** 2 + (y - p.y) ** 2 > r * r) continue;
        const i = (y * image.width + x) * 4 + 3;
        s.data[i] = brush === 'erase' ? 0 : source.data[i];
      }
    }
    const ctx = canvasRef.current!.getContext('2d')!;
    const patch = new ImageData(image.width, y1 - y0 + 1);
    patch.data.set(s.data.subarray(y0 * image.width * 4, (y1 + 1) * image.width * 4));
    ctx.putImageData(patch, 0, y0);
  }

  function onPointerDown(e: PointerEvent<SVGSVGElement>) {
    if (tool !== 'touchup' || busy) return;
    overlay.current!.setPointerCapture(e.pointerId);
    stroke.current = { data: new Uint8ClampedArray(image.data), before: state };
    paint(toImage(e));
  }

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    const p = toImage(e);
    setCursor(p);
    if (dragCorner !== null) {
      setCorners(corners.map((c, i) => (i === dragCorner ? p : frameMode === 'crop' ? cropFollow(corners, dragCorner, p, i) : c)));
      return;
    }
    if (stroke.current) paint(p);
  }

  function onPointerUp() {
    setDragCorner(null);
    const s = stroke.current;
    if (!s) return;
    stroke.current = null;
    setHistory((h) => [...h.slice(-11), s.before]);
    setState({ image: { width: image.width, height: image.height, data: s.data }, source });
  }

  const handle = Math.max(image.width, image.height) / 45;

  return (
    <Dialog
      open
      title={title}
      onClose={onCancel}
      className="photo-editor-dialog"
      footer={
        <div className="button-row">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => onSave(image)} disabled={busy !== null}>
            Done
          </button>
        </div>
      }
    >
      <div className="photo-editor">
        <div className="photo-stage">
          {/* As wide as possible while the whole photo stays within about 60% of the screen height. */}
          <div className="photo-canvas-wrap checkerboard" style={{ aspectRatio: `${image.width} / ${image.height}`, width: `min(100%, calc(60dvh * ${image.width / image.height}))` }}>
            <canvas ref={canvasRef} className="photo-canvas" aria-label="The photo being edited; checkered areas are removed background" role="img" />
            <svg
              ref={overlay}
              className={`photo-overlay tool-${tool}`}
              viewBox={`0 0 ${image.width} ${image.height}`}
              preserveAspectRatio="none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => setCursor(null)}
            >
              {tool === 'frame' && (
                <g>
                  <polygon points={corners.map((c) => `${c.x},${c.y}`).join(' ')} className="frame-outline" vectorEffect="non-scaling-stroke" />
                  {corners.map((c, i) => (
                    <circle
                      key={i}
                      cx={c.x}
                      cy={c.y}
                      r={handle}
                      className="frame-handle"
                      role="button"
                      aria-label={['Top-left corner', 'Top-right corner', 'Bottom-right corner', 'Bottom-left corner'][i]}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        const step = e.shiftKey ? 20 : 4;
                        const d: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
                        if (!d[e.key]) return;
                        e.preventDefault();
                        const p = { x: Math.max(0, Math.min(image.width, c.x + d[e.key].x)), y: Math.max(0, Math.min(image.height, c.y + d[e.key].y)) };
                        setCorners(corners.map((q, k) => (k === i ? p : frameMode === 'crop' ? cropFollow(corners, i, p, k) : q)));
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        overlay.current!.setPointerCapture(e.pointerId);
                        setDragCorner(i);
                      }}
                    />
                  ))}
                </g>
              )}
              {tool === 'touchup' && cursor && <circle cx={cursor.x} cy={cursor.y} r={brushSize / 2} className="brush-cursor" vectorEffect="non-scaling-stroke" />}
            </svg>
          </div>
          <p className="studio-status" role="status" aria-live="polite">
            {busy ? (
              <>
                {busy}
                {progress !== null && ` ${Math.round(progress * 100)}%`}
              </>
            ) : (
              (message ?? 'Checkered areas are removed. Nothing is uploaded: all editing happens on this device.')
            )}
          </p>
        </div>

        <div className="photo-tools">
          <div className="button-row">
            <button type="button" className="secondary small" onClick={undo} disabled={history.length === 0 || busy !== null}>
              <Icon name="undo" size={14} /> Undo
            </button>
          </div>
          <SegmentedControl label="Tool" value={tool} options={TOOLS} onChange={setTool} />

          {tool === 'frame' && (
            <div className="tool-panel">
              <div className="button-row">
                <button type="button" className="secondary small" onClick={() => rotate(-90)} disabled={busy !== null}>
                  <Icon name="rotateLeft" size={14} /> Rotate left
                </button>
                <button type="button" className="secondary small" onClick={() => rotate(90)} disabled={busy !== null}>
                  <Icon name="rotateRight" size={14} /> Rotate right
                </button>
              </div>
              <div className="range-field">
                <div className="range-label">
                  <label htmlFor="fine-angle">Level (fine rotation)</label>
                  <output htmlFor="fine-angle">{fineAngle}°</output>
                </div>
                <input id="fine-angle" type="range" min={-20} max={20} step={0.5} value={fineAngle} onChange={(e) => setFineAngle(Number(e.target.value))} />
              </div>
              <button type="button" className="secondary small" onClick={() => rotate(fineAngle)} disabled={fineAngle === 0 || busy !== null}>
                Apply rotation
              </button>
              <SegmentedControl
                label="Corners"
                value={frameMode}
                options={[
                  { value: 'crop', label: 'Crop' },
                  { value: 'straighten', label: 'Straighten' },
                ]}
                onChange={(mode) => {
                  setFrameMode(mode);
                  setCorners(defaultCorners(image));
                }}
              />
              <p className="hint">
                {frameMode === 'crop'
                  ? 'Drag the corners to keep just the furniture.'
                  : 'Taken at an angle? Drag each corner onto a corner of the furniture’s front (or top) and press Straighten. Proportions follow your corners, so check the real size.'}
              </p>
              <button type="button" className="primary small" onClick={frameMode === 'crop' ? applyCrop : applyStraighten} disabled={busy !== null}>
                {frameMode === 'crop' ? 'Apply crop' : 'Straighten'}
              </button>
            </div>
          )}

          {tool === 'background' && (
            <div className="tool-panel">
              <h4>Plain background</h4>
              <div className="range-field">
                <div className="range-label">
                  <label htmlFor="tolerance">Tolerance</label>
                  <output htmlFor="tolerance">{tolerance}</output>
                </div>
                <input id="tolerance" type="range" min={0} max={100} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} />
              </div>
              <button type="button" className="primary small" onClick={removeByColour} disabled={busy !== null}>
                Remove background by colour
              </button>
              <h4>Smart remove</h4>
              <p className="hint">Finds the furniture with a small AI model that runs on this device. The first use downloads about 19 MB from this website; the photo is never sent anywhere.</p>
              {busy && segmentRun.current ? (
                <button type="button" className="secondary small" onClick={() => segmentRun.current?.cancel()}>
                  Cancel
                </button>
              ) : (
                <button type="button" className="secondary small" onClick={removeSmart} disabled={busy !== null}>
                  Smart remove (on device)
                </button>
              )}
              <button type="button" className="link-button" onClick={() => apply({ image: copy(source), source })} disabled={busy !== null}>
                Restore the whole photo
              </button>
            </div>
          )}

          {tool === 'touchup' && (
            <div className="tool-panel">
              <SegmentedControl
                label="Brush"
                value={brush}
                options={[
                  { value: 'erase', label: 'Erase' },
                  { value: 'restore', label: 'Restore' },
                ]}
                onChange={setBrush}
              />
              <div className="range-field">
                <div className="range-label">
                  <label htmlFor="brush-size">Brush size</label>
                  <output htmlFor="brush-size">{brushSize} px</output>
                </div>
                <input id="brush-size" type="range" min={4} max={160} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
              </div>
              <h4>Edges</h4>
              <div className="button-row">
                <button type="button" className="secondary small" onClick={() => adjustEdges('grow', -2)} disabled={busy !== null}>
                  Shrink
                </button>
                <button type="button" className="secondary small" onClick={() => adjustEdges('grow', 2)} disabled={busy !== null}>
                  Grow
                </button>
                <button type="button" className="secondary small" onClick={() => adjustEdges('soften', 2)} disabled={busy !== null}>
                  Soften
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** Corners inset a little from the photo's edges: top-left, top-right, bottom-right, bottom-left. */
function defaultCorners(image: RGBAImage): Point[] {
  const ix = image.width * 0.05;
  const iy = image.height * 0.05;
  return [
    { x: ix, y: iy },
    { x: image.width - ix, y: iy },
    { x: image.width - ix, y: image.height - iy },
    { x: ix, y: image.height - iy },
  ];
}

/** In crop mode the shape stays a rectangle: neighbouring corners follow the dragged one. */
function cropFollow(corners: Point[], dragged: number, p: Point, i: number): Point {
  const c = corners[i];
  const sameX = (dragged === 0 && i === 3) || (dragged === 3 && i === 0) || (dragged === 1 && i === 2) || (dragged === 2 && i === 1);
  const sameY = (dragged === 0 && i === 1) || (dragged === 1 && i === 0) || (dragged === 2 && i === 3) || (dragged === 3 && i === 2);
  return { x: sameX ? p.x : c.x, y: sameY ? p.y : c.y };
}
