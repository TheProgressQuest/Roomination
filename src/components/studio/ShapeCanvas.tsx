import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { boundingBox, type Box } from '../../model/polygon';
import { flattenShape, isCurved } from '../../model/shape';
import { edgeLength, insertVertex, moveControl, moveVertex } from '../../model/shapeEdit';
import type { Point, ShapeVertex, UnitSystem } from '../../model/types';
import { formatLength } from '../../model/units';

/**
 * The drawing surface of the furniture studio: an SVG in real centimetres (the viewBox is
 * in cm, so nothing is converted by hand). The front of the piece is at the bottom.
 *
 * Every pointer action has a keyboard or numeric equivalent elsewhere in the studio; here,
 * focused corners also move with the arrow keys (Shift: 10 cm) and Delete removes them.
 */

export type StudioSelection = { kind: 'vertex' | 'edge'; index: number } | null;

export interface TraceReference {
  /** Object URL (or data URL) of the photo. */
  url: string;
  width: number;
  height: number;
  /** Centimetres per photo pixel (set by the person with "Set scale"). */
  cmPerPx: number;
  opacity: number;
}

interface ShapeCanvasProps {
  points: ShapeVertex[];
  /** False while drawing a new outline corner by corner. */
  closed: boolean;
  selection: StudioSelection;
  snap: number;
  units: UnitSystem;
  reference: TraceReference | null;
  /** When set, clicks mark scale points on the photo instead of editing. */
  measuring: Point[] | null;
  touch: boolean;
  onChange: (points: ShapeVertex[], commit: boolean) => void;
  onSelect: (selection: StudioSelection) => void;
  onAddPoint: (p: Point) => void;
  onClose: () => void;
  onDeleteVertex: (index: number) => void;
  onMeasurePoint: (p: Point) => void;
}

type Drag = { kind: 'vertex'; index: number; grab: Point } | { kind: 'c1' | 'c2'; index: number } | null;

const MARGIN = 40;

export function ShapeCanvas(props: ShapeCanvasProps) {
  const { points, closed, selection, snap, units, reference, measuring, touch } = props;
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const latest = useRef(points);
  latest.current = points;

  // The view is fitted when the studio opens and on request; it stays put while editing,
  // so the outline never jumps under the pointer.
  const [view, setView] = useState<Box>(() => fitView(points, reference));
  const [pxPerCm, setPxPerCm] = useState(1);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const measure = () => {
      // A hidden or not-yet-laid-out drawing has no width; keep the last good scale.
      const width = el.getBoundingClientRect().width;
      if (width > 0) setPxPerCm(width / Math.max(1, view.maxX - view.minX));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [view]);
  useEffect(() => {
    if (reference) setView(fitView(latest.current, reference));
  }, [reference]);

  const outline = useMemo(() => (closed && points.length >= 3 ? flattenShape({ points }) : null), [points, closed]);
  /** Handle sizes in cm that look the same on screen at any zoom. */
  const px = (n: number) => n / pxPerCm;
  const handle = px(touch ? 13 : 8);

  function toCm(e: { clientX: number; clientY: number }): Point {
    const el = svg.current!;
    const ctm = el.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm);
    return { x: p.x, y: p.y };
  }
  const snapped = (p: Point): Point => (snap > 0 ? { x: Math.round(p.x / snap) * snap, y: Math.round(p.y / snap) * snap } : { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });

  function startDrag(e: PointerEvent, next: Drag) {
    e.stopPropagation();
    svg.current?.setPointerCapture(e.pointerId);
    setDrag(next);
  }

  function onPointerMove(e: PointerEvent) {
    const p = toCm(e);
    if (!drag) {
      setHover(p);
      return;
    }
    if (drag.kind === 'vertex') {
      const target = snapped({ x: p.x - drag.grab.x, y: p.y - drag.grab.y });
      props.onChange(moveVertex(latest.current, drag.index, target), false);
    } else {
      props.onChange(moveControl(latest.current, drag.index, drag.kind, snapped(p)), false);
    }
  }

  function onPointerUp() {
    if (drag) props.onChange(latest.current, true);
    setDrag(null);
  }

  function onBackgroundDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const p = toCm(e);
    if (measuring) {
      props.onMeasurePoint(p);
      return;
    }
    if (!closed) {
      props.onAddPoint(snapped(p));
      return;
    }
    props.onSelect(null);
  }

  function onVertexKey(e: KeyboardEvent, index: number) {
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
    if (moves[e.key]) {
      e.preventDefault();
      const v = points[index];
      props.onChange(moveVertex(points, index, { x: v.x + moves[e.key].x, y: v.y + moves[e.key].y }), true);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      props.onDeleteVertex(index);
    } else if (e.key === 'Enter' && !closed && index === 0 && points.length >= 3) {
      props.onClose();
    }
  }

  const grid = gridLines(view, pxPerCm);
  const box = outline ? boundingBox(outline) : null;
  const last = points.at(-1);

  return (
    <div className="shape-canvas">
      <svg
        ref={svg}
        className={`shape-canvas-svg ${measuring ? 'is-measuring' : !closed ? 'is-drawing' : ''}`}
        viewBox={`${view.minX} ${view.minY} ${view.maxX - view.minX} ${view.maxY - view.minY}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={closed ? 'Furniture outline. Select a corner and use the arrow keys to move it.' : 'Drawing a new outline. Click to add corners; click the first corner to close it.'}
        onPointerDown={onBackgroundDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
      >
        {reference && (
          <image
            href={reference.url}
            x={(-reference.width * reference.cmPerPx) / 2}
            y={(-reference.height * reference.cmPerPx) / 2}
            width={reference.width * reference.cmPerPx}
            height={reference.height * reference.cmPerPx}
            opacity={reference.opacity}
            preserveAspectRatio="none"
            pointerEvents="none"
          />
        )}
        <g className="shape-grid" pointerEvents="none">
          {grid.minor.map((d, i) => (
            <path key={`n${i}`} d={d} className="minor" vectorEffect="non-scaling-stroke" />
          ))}
          {grid.major.map((d, i) => (
            <path key={`j${i}`} d={d} className="major" vectorEffect="non-scaling-stroke" />
          ))}
        </g>

        {outline && <polygon className="shape-fill" points={outline.map((p) => `${p.x},${p.y}`).join(' ')} vectorEffect="non-scaling-stroke" />}
        {!closed && points.length > 0 && (
          <polyline className="shape-draft" points={[...points, ...(hover && !measuring ? [snapped(hover)] : [])].map((p) => `${p.x},${p.y}`).join(' ')} vectorEffect="non-scaling-stroke" />
        )}

        {/* Edges: a wide invisible stroke makes each one easy to pick. */}
        {closed &&
          points.map((v, i) => {
            const b = points[(i + 1) % points.length];
            const d = isCurved(v) ? `M${v.x},${v.y} C${v.c1!.x},${v.c1!.y} ${v.c2!.x},${v.c2!.y} ${b.x},${b.y}` : `M${v.x},${v.y} L${b.x},${b.y}`;
            const selected = selection?.kind === 'edge' && selection.index === i;
            return (
              <g key={`e${i}`}>
                <path
                  d={d}
                  className="edge-hit"
                  strokeWidth={px(touch ? 24 : 14)}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (!measuring) props.onSelect({ kind: 'edge', index: i });
                  }}
                />
                {selected && <path d={d} className="edge-selected" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
              </g>
            );
          })}

        {/* Lengths along each edge. */}
        {closed &&
          points.map((v, i) => {
            const b = points[(i + 1) % points.length];
            const mid = isCurved(v) ? cubicMid(v, b) : { x: (v.x + b.x) / 2, y: (v.y + b.y) / 2 };
            return (
              <text key={`l${i}`} x={mid.x} y={mid.y - px(8)} className="edge-label" fontSize={px(11)} pointerEvents="none">
                {formatLength(edgeLength(points, i), units)}
              </text>
            );
          })}

        {/* Curve handles. */}
        {closed &&
          points.map((v, i) => {
            if (!isCurved(v)) return null;
            const b = points[(i + 1) % points.length];
            return (
              <g key={`c${i}`} className="curve-handles">
                <line x1={v.x} y1={v.y} x2={v.c1!.x} y2={v.c1!.y} vectorEffect="non-scaling-stroke" />
                <line x1={b.x} y1={b.y} x2={v.c2!.x} y2={v.c2!.y} vectorEffect="non-scaling-stroke" />
                {(['c1', 'c2'] as const).map((which) => (
                  <rect
                    key={which}
                    x={v[which]!.x - handle * 0.8}
                    y={v[which]!.y - handle * 0.8}
                    width={handle * 1.6}
                    height={handle * 1.6}
                    className="curve-handle"
                    role="button"
                    aria-label={`Curve handle ${which === 'c1' ? 1 : 2} of edge ${i + 1}`}
                    onPointerDown={(e) => startDrag(e, { kind: which, index: i })}
                  />
                ))}
              </g>
            );
          })}

        {/* "Add a corner here" on the selected straight or curved edge. */}
        {closed && selection?.kind === 'edge' && (() => {
          const i = selection.index;
          const v = points[i];
          const b = points[(i + 1) % points.length];
          const mid = isCurved(v) ? cubicMid(v, b) : { x: (v.x + b.x) / 2, y: (v.y + b.y) / 2 };
          return (
            <g
              className="insert-handle"
              role="button"
              aria-label={`Add a corner in the middle of edge ${i + 1}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                const more = insertVertex(points, i);
                props.onChange(more, true);
                props.onSelect({ kind: 'vertex', index: i + 1 });
              }}
            >
              <circle cx={mid.x} cy={mid.y} r={handle} />
              <path d={`M${mid.x - handle * 0.5},${mid.y} h${handle} M${mid.x},${mid.y - handle * 0.5} v${handle}`} vectorEffect="non-scaling-stroke" />
            </g>
          );
        })()}

        {/* Corners. */}
        {points.map((v, i) => {
          const selected = selection?.kind === 'vertex' && selection.index === i;
          const closing = !closed && i === 0 && points.length >= 3;
          return (
            <circle
              key={`v${i}`}
              cx={v.x}
              cy={v.y}
              r={closing ? handle * 1.3 : handle}
              className={`vertex ${selected ? 'is-selected' : ''} ${closing ? 'is-closing' : ''}`}
              tabIndex={0}
              role="button"
              aria-label={closing ? 'First corner: select to close the outline' : `Corner ${i + 1}`}
              aria-pressed={selected}
              onFocus={() => closed && props.onSelect({ kind: 'vertex', index: i })}
              onKeyDown={(e) => onVertexKey(e, i)}
              onPointerDown={(e) => {
                if (measuring) return;
                if (closing) {
                  e.stopPropagation();
                  props.onClose();
                  return;
                }
                if (!closed) return;
                props.onSelect({ kind: 'vertex', index: i });
                const p = toCm(e);
                startDrag(e, { kind: 'vertex', index: i, grab: { x: p.x - v.x, y: p.y - v.y } });
              }}
            />
          );
        })}

        {measuring && (
          <g className="measure-marks" pointerEvents="none">
            {measuring.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={handle * 0.7} />
            ))}
            {measuring.length === 2 && <line x1={measuring[0].x} y1={measuring[0].y} x2={measuring[1].x} y2={measuring[1].y} vectorEffect="non-scaling-stroke" />}
          </g>
        )}

        {box && (
          <text x={(box.minX + box.maxX) / 2} y={box.maxY + px(26)} className="front-label" fontSize={px(12)} pointerEvents="none">
            Front ↓
          </text>
        )}
        {!closed && last && (
          <text x={view.minX + px(12)} y={view.minY + px(20)} className="drawing-hint" fontSize={px(13)} pointerEvents="none">
            {points.length < 3 ? 'Click to add corners' : 'Click the first corner (or Close shape) to finish'}
          </text>
        )}
      </svg>
      <div className="shape-canvas-tools">
        <button type="button" className="icon-button small" aria-label="Zoom in" onClick={() => setView(zoom(view, 0.8))}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <button type="button" className="icon-button small" aria-label="Zoom out" onClick={() => setView(zoom(view, 1.25))}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <button type="button" className="icon-button small" aria-label="Fit the outline in view" onClick={() => setView(fitView(points, reference))}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  );
}

function cubicMid(a: ShapeVertex, b: Point): Point {
  return { x: 0.125 * a.x + 0.375 * a.c1!.x + 0.375 * a.c2!.x + 0.125 * b.x, y: 0.125 * a.y + 0.375 * a.c1!.y + 0.375 * a.c2!.y + 0.125 * b.y };
}

/** A view that shows the outline (and the tracing photo) with a margin; at least 2 × 1.4 m. */
export function fitView(points: ShapeVertex[], reference: TraceReference | null): Box {
  const pts: Point[] = points.flatMap((p) => [p, p.c1, p.c2].filter((q): q is Point => q !== undefined));
  if (reference) {
    const hw = (reference.width * reference.cmPerPx) / 2;
    const hh = (reference.height * reference.cmPerPx) / 2;
    pts.push({ x: -hw, y: -hh }, { x: hw, y: hh });
  }
  const box = pts.length > 0 ? boundingBox(pts) : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const w = Math.max(200, box.maxX - box.minX + MARGIN * 2);
  const h = Math.max(140, box.maxY - box.minY + MARGIN * 2);
  return { minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2 };
}

function zoom(view: Box, factor: number): Box {
  const cx = (view.minX + view.maxX) / 2;
  const cy = (view.minY + view.maxY) / 2;
  const w = Math.min(4000, Math.max(20, (view.maxX - view.minX) * factor));
  const h = Math.min(4000, Math.max(14, (view.maxY - view.minY) * factor));
  return { minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2 };
}

/** 10 cm and 50 cm grid lines (thinned out when zoomed far out). */
function gridLines(view: Box, pxPerCm: number): { minor: string[]; major: string[] } {
  const minorStep = pxPerCm * 10 >= 6 ? 10 : 50;
  const majorStep = minorStep === 10 ? 50 : 100;
  const lines = (step: number, skip?: number) => {
    const out: string[] = [];
    for (let x = Math.ceil(view.minX / step) * step; x <= view.maxX; x += step) if (!skip || Math.abs(x % skip) > 1e-6) out.push(`M${x},${view.minY}V${view.maxY}`);
    for (let y = Math.ceil(view.minY / step) * step; y <= view.maxY; y += step) if (!skip || Math.abs(y % skip) > 1e-6) out.push(`M${view.minX},${y}H${view.maxX}`);
    return out;
  };
  return { minor: lines(minorStep, majorStep), major: lines(majorStep) };
}
