import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { NumberField } from '../components/NumberField';
import { boundingBox } from '../model/polygon';
import { createId } from '../model/sample';
import { footprintArea, localFootprint, ringsSvgPath, shapeRings } from '../model/shape';
import type { BuilderNode, FurnitureShape, Point, PrimitiveKind, ShapeVertex, UnitSystem } from '../model/types';
import { cmToInput, formatLength, inputToCm, inputUnitLabel } from '../model/units';
import {
  PRIMITIVE_LABELS,
  buildShape,
  combine,
  createPrimitive,
  duplicateNode,
  evaluateRecipe,
  findNode,
  isFixedRatio,
  leaves,
  mapNodes,
  nodeBounds,
  nodeLabel,
  parentList,
  recipeFor,
  rotateNode,
  scaleNode,
  separate,
  shapeOutline,
  translateNode,
  type Operation,
} from './recipe';

/**
 * The Shape Builder: make a piece's outline from basic shapes — move, turn and resize them
 * (by dragging or by typing exact sizes), then group, merge, cut out or overlap them. The
 * recipe is saved with the piece, so it can be reopened and changed later.
 *
 * Loaded only when opened (it brings the polygon-clipping library with it).
 */

export interface ShapeBuilderResult {
  shape: FurnitureShape;
  width: number;
  depth: number;
}

interface ShapeBuilderProps {
  /** The shape to start from (its recipe if it has one; otherwise its outline as one part). */
  shape: FurnitureShape | null;
  units: UnitSystem;
  color: string;
  onDone: (result: ShapeBuilderResult) => void;
  onCancel: () => void;
}

type AddableKind = Exclude<PrimitiveKind, 'outline'>;
const ADDABLE = Object.keys(PRIMITIVE_LABELS) as AddableKind[];

type Drag =
  | { kind: 'move'; start: Point; ids: string[] }
  | { kind: 'resize'; id: string; anchor: Point; size: { w: number; h: number } }
  | { kind: 'rotate'; id: string; centre: Point; startAngle: number };

export default function ShapeBuilder({ shape, units, color, onDone, onCancel }: ShapeBuilderProps) {
  const [initial] = useState<BuilderNode[]>(() => (shape ? recipeFor(shape, createId) : [createPrimitive('rectangle', createId())]));
  const [nodes, setNodes] = useState<BuilderNode[]>(initial);
  const [committed, setCommitted] = useState<BuilderNode[]>(initial);
  const [past, setPast] = useState<BuilderNode[][]>([]);
  const [future, setFuture] = useState<BuilderNode[][]>([]);
  const [selected, setSelected] = useState<string[]>(() => (initial.length === 1 ? [initial[0].id] : []));
  const [message, setMessage] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ drag: Drag; base: BuilderNode[] } | null>(null);

  const unit = inputUnitLabel(units);
  const toInput = (cm: number) => Math.round(cmToInput(cm, units) * 100) / 100;
  const toCm = (v: number) => inputToCm(v, units);

  const result = useMemo(() => evaluateRecipe(nodes), [nodes]);
  const summary = useMemo(() => {
    if (!result.shape) return null;
    const box = boundingBox(shapeRings(result.shape).flatMap((r) => r.outer));
    const width = box.maxX - box.minX;
    const depth = box.maxY - box.minY;
    const rings = shapeRings(result.shape);
    return {
      width,
      depth,
      area: footprintArea(localFootprint({ width, depth, shape: result.shape })),
      parts: rings.length,
      holes: rings.reduce((n, r) => n + r.holes.length, 0),
    };
  }, [result]);

  // The view only changes between edits (never mid-drag), so shapes don't slide under the pointer.
  const view = useMemo(() => {
    const all = committed.flatMap((n) => leaves(n)).map((l) => nodeBounds(l));
    const box = all.length ? { minX: Math.min(...all.map((b) => b.minX)), minY: Math.min(...all.map((b) => b.minY)), maxX: Math.max(...all.map((b) => b.maxX)), maxY: Math.max(...all.map((b) => b.maxY)) } : { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    const size = Math.max(box.maxX - box.minX, box.maxY - box.minY, 200) * 1.4;
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    return { x: cx - size / 2, y: cy - size / 2, size };
  }, [committed]);
  const handle = view.size * 0.014;

  function commit(next: BuilderNode[]) {
    setNodes(next);
    if (next === committed) return;
    setPast((p) => [...p.slice(-99), committed]);
    setFuture([]);
    setCommitted(next);
    setMessage(null);
  }
  function undo() {
    const previous = past.at(-1);
    if (!previous) return;
    setPast(past.slice(0, -1));
    setFuture([committed, ...future]);
    setNodes(previous);
    setCommitted(previous);
    setSelected((ids) => ids.filter((id) => findNode(previous, id)));
  }
  function redo() {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast([...past, committed]);
    setNodes(next);
    setCommitted(next);
    setSelected((ids) => ids.filter((id) => findNode(next, id)));
  }

  const selectedNodes = selected.map((id) => findNode(nodes, id)).filter((n): n is BuilderNode => n !== null);
  const single = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const siblings = selected.length >= 2 && parentList(nodes, selected[0]) !== null && selected.every((id) => parentList(nodes, selected[0])!.some((n) => n.id === id));

  function add(kind: AddableKind) {
    // New shapes appear in the middle of the view, nudged so they don't stack exactly.
    const at = { x: Math.round(view.x + view.size / 2 + (nodes.length % 5) * 10), y: Math.round(view.y + view.size / 2 + (nodes.length % 5) * 10) };
    const node = createPrimitive(kind, createId(), at);
    commit([...nodes, node]);
    setSelected([node.id]);
  }

  function applyCombine(type: Operation) {
    // Keep the list order (the first is what a cut is made from).
    const list = parentList(nodes, selected[0]);
    if (!list) return;
    const ordered = list.filter((n) => selected.includes(n.id)).map((n) => n.id);
    const id = createId();
    const next = combine(nodes, ordered, type, id);
    if (!next) {
      setMessage('Choose shapes at the same level of the list to combine them.');
      return;
    }
    commit(next);
    setSelected([id]);
  }

  function separateSelected() {
    if (!single || single.type === 'shape') return;
    commit(separate(nodes, single.id));
    setSelected(single.children.map((c) => c.id));
  }

  function remove() {
    if (selected.length === 0) return;
    commit(mapNodes(nodes, (n) => (selected.includes(n.id) ? null : n)));
    setSelected([]);
  }

  function duplicate() {
    if (selectedNodes.length === 0) return;
    const copies = selectedNodes.map((n) => duplicateNode(n, createId));
    commit([...nodes, ...copies]);
    setSelected(copies.map((c) => c.id));
  }

  function changeSelected(change: (node: BuilderNode) => BuilderNode, done = true) {
    const next = mapNodes(nodes, (n) => (selected.includes(n.id) ? change(n) : n));
    if (done) commit(next);
    else setNodes(next);
  }

  function setSize(node: BuilderNode, width: number | null, depth: number | null) {
    const box = nodeBounds(node);
    const w = box.maxX - box.minX || 1;
    const d = box.maxY - box.minY || 1;
    if (node.type === 'shape') {
      const nextWidth = width ?? node.width;
      const fixed = isFixedRatio(node.kind);
      changeSelected((n) => (n.id === node.id && n.type === 'shape' ? { ...n, width: Math.max(1, nextWidth), depth: fixed ? Math.max(1, nextWidth) : Math.max(1, depth ?? n.depth) } : n));
      return;
    }
    const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    changeSelected((n) => (n.id === node.id ? scaleNode(n, (width ?? w) / w, (depth ?? d) / d, centre) : n));
  }

  // ----- Pointer interaction -----

  function toPlan(e: { clientX: number; clientY: number }): Point {
    const svg = svgRef.current!;
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    return { x: p.x, y: p.y };
  }

  /** The node to act on when a shape is pressed: the selection that contains it, else its top-level part. */
  function targetFor(leafId: string): string {
    const top = nodes.find((n) => findNode([n], leafId))!;
    const chain: BuilderNode[] = [];
    const walk = (n: BuilderNode): boolean => {
      chain.push(n);
      if (n.id === leafId) return true;
      if (n.type !== 'shape' && n.children.some(walk)) return true;
      chain.pop();
      return false;
    };
    walk(top);
    return chain.find((n) => selected.includes(n.id))?.id ?? top.id;
  }

  function onShapeDown(e: ReactPointerEvent, leafId: string) {
    e.stopPropagation();
    const id = targetFor(leafId);
    let ids = selected;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      ids = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
      setSelected(ids);
      return;
    }
    if (!selected.includes(id)) ids = [id];
    setSelected(ids);
    startDrag(e, { kind: 'move', start: toPlan(e), ids });
  }

  function startDrag(e: ReactPointerEvent, d: Drag) {
    svgRef.current?.setPointerCapture(e.pointerId);
    drag.current = { drag: d, base: nodes };
  }

  function onPointerMove(e: ReactPointerEvent) {
    const current = drag.current;
    if (!current) return;
    const p = toPlan(e);
    const { drag: d, base } = current;
    if (d.kind === 'move') {
      const dx = Math.round(p.x - d.start.x);
      const dy = Math.round(p.y - d.start.y);
      setNodes(mapNodes(base, (n) => (d.ids.includes(n.id) ? translateNode(n, dx, dy) : n)));
    } else if (d.kind === 'resize') {
      const sx = Math.max(1, Math.round(p.x - d.anchor.x)) / d.size.w;
      const sy = Math.max(1, Math.round(p.y - d.anchor.y)) / d.size.h;
      setNodes(mapNodes(base, (n) => (n.id === d.id ? scaleNode(n, sx, e.shiftKey ? sx : sy, d.anchor) : n)));
    } else {
      const angle = (Math.atan2(p.y - d.centre.y, p.x - d.centre.x) * 180) / Math.PI;
      // Snaps to 5° steps (hold Alt for free turning).
      const turn = e.altKey ? angle - d.startAngle : Math.round((angle - d.startAngle) / 5) * 5;
      setNodes(mapNodes(base, (n) => (n.id === d.id ? rotateNode(n, turn, d.centre) : n)));
    }
  }

  function onPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    commit(nodes);
  }

  function onKeyDown(e: ReactKeyboardEvent) {
    if (selected.length === 0) return;
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      changeSelected((n) => translateNode(n, dx, dy));
    } else if (e.key === '[' || e.key === ']') {
      e.preventDefault();
      changeSelected((n) => {
        const b = nodeBounds(n);
        return rotateNode(n, e.key === ']' ? 15 : -15, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
      });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove();
    }
  }

  // Undo / redo / duplicate shortcuts while the builder is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function save() {
    const built = buildShape(nodes);
    if (!built.shape) {
      setMessage(built.problem);
      return;
    }
    onDone({ shape: built.shape, width: built.width, depth: built.depth });
  }

  const singleBox = single ? nodeBounds(single) : null;
  const status =
    message ??
    result.problem ??
    (selected.length === 0
      ? 'Add shapes, then drag to move them. Shift-click (or tick in the list) to choose several.'
      : 'Drag to move · corner handle resizes · round handle turns · arrow keys nudge · [ and ] turn 15°.');

  return (
    <Dialog
      open
      title="Combine shapes"
      onClose={onCancel}
      className="studio-dialog builder-dialog"
      footer={
        <div className="studio-footer">
          <p className="hint">The recipe is kept, so you can reopen and change it later.</p>
          <div className="button-row">
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={save} disabled={!result.shape}>
              Use this shape
            </button>
          </div>
        </div>
      }
    >
      <div className="studio">
        <div className="studio-stage">
          <div className="studio-toolbar" role="toolbar" aria-label="Builder tools">
            <button type="button" className="icon-button small" onClick={undo} disabled={past.length === 0} aria-label="Undo" title="Undo (Ctrl/⌘ Z)">
              <Icon name="undo" />
            </button>
            <button type="button" className="icon-button small" onClick={redo} disabled={future.length === 0} aria-label="Redo" title="Redo">
              <Icon name="redo" />
            </button>
            <span className="toolbar-divider" aria-hidden="true" />
            <button type="button" className="secondary small" onClick={() => applyCombine('group')} disabled={!siblings} title="Keep the parts separate but move them together">
              Group
            </button>
            <button type="button" className="secondary small" onClick={() => applyCombine('union')} disabled={!siblings} title="Join into one outline">
              Merge
            </button>
            <button type="button" className="secondary small" onClick={() => applyCombine('subtract')} disabled={!siblings} title="Cut the later shapes out of the first in the list">
              Cut out
            </button>
            <button type="button" className="secondary small" onClick={() => applyCombine('intersect')} disabled={!siblings} title="Keep only where they overlap">
              Overlap
            </button>
            <button type="button" className="secondary small" onClick={separateSelected} disabled={!single || single.type === 'shape'} title="Undo a group, merge, cut or overlap">
              Separate
            </button>
          </div>

          <div className="shape-canvas builder-canvas">
            <svg
              ref={svgRef}
              className="shape-canvas-svg"
              viewBox={`${view.x} ${view.y} ${view.size} ${view.size}`}
              preserveAspectRatio="xMidYMid meet"
              tabIndex={0}
              role="application"
              aria-label="Combine shapes drawing. With shapes chosen, arrow keys move them, [ and ] turn them, Delete removes them."
              onPointerDown={() => setSelected([])}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onKeyDown}
            >
              <defs>
                <pattern id="builder-grid" width={10} height={10} patternUnits="userSpaceOnUse">
                  <path d="M10 0H0V10" fill="none" className="builder-grid-line" strokeWidth={view.size / 1500} />
                </pattern>
              </defs>
              <rect x={view.x} y={view.y} width={view.size} height={view.size} fill="url(#builder-grid)" />
              <text x={view.x + view.size / 2} y={view.y + view.size - handle * 1.5} textAnchor="middle" className="builder-front" fontSize={handle * 2.2}>
                Front
              </text>
              {result.shape && <path d={ringsSvgPath(shapeRings(result.shape))} fillRule="evenodd" fill={color} className="builder-result" strokeWidth={view.size / 500} />}
              {nodes.flatMap(leaves).map((leaf) => (
                <path
                  key={leaf.id}
                  d={vertexPath(shapeOutline(leaf))}
                  fillRule="evenodd"
                  className={`builder-part ${isSelectedLeaf(nodes, selected, leaf.id) ? 'is-selected' : ''}`}
                  strokeWidth={view.size / 400}
                  onPointerDown={(e) => onShapeDown(e, leaf.id)}
                />
              ))}
              {selectedNodes.map((n) => {
                const b = nodeBounds(n);
                return <rect key={n.id} x={b.minX} y={b.minY} width={b.maxX - b.minX} height={b.maxY - b.minY} className="builder-box" strokeWidth={view.size / 500} />;
              })}
              {single && singleBox && (
                <>
                  <line x1={(singleBox.minX + singleBox.maxX) / 2} y1={singleBox.minY} x2={(singleBox.minX + singleBox.maxX) / 2} y2={singleBox.minY - handle * 4} className="builder-box" strokeWidth={view.size / 500} />
                  <circle
                    cx={(singleBox.minX + singleBox.maxX) / 2}
                    cy={singleBox.minY - handle * 4}
                    r={handle}
                    className="builder-handle"
                    aria-label="Turn"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const centre = { x: (singleBox.minX + singleBox.maxX) / 2, y: (singleBox.minY + singleBox.maxY) / 2 };
                      const p = toPlan(e);
                      startDrag(e, { kind: 'rotate', id: single.id, centre, startAngle: (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI });
                    }}
                  />
                  <rect
                    x={singleBox.maxX - handle}
                    y={singleBox.maxY - handle}
                    width={handle * 2}
                    height={handle * 2}
                    className="builder-handle"
                    aria-label="Resize"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      startDrag(e, { kind: 'resize', id: single.id, anchor: { x: singleBox.minX, y: singleBox.minY }, size: { w: singleBox.maxX - singleBox.minX || 1, h: singleBox.maxY - singleBox.minY || 1 } });
                    }}
                  />
                </>
              )}
            </svg>
          </div>

          <p className={`studio-status ${message || result.problem ? '' : 'is-quiet'}`} role="status" aria-live="polite">
            {status}
          </p>
        </div>

        <div className="studio-panel">
          {single && (
            <section className="studio-section" aria-label="Selected shape">
              <h3>{nodeLabel(single)}</h3>
              <NodeFields node={single} unit={unit} toInput={toInput} toCm={toCm} onMove={(dx, dy) => changeSelected((n) => translateNode(n, dx, dy))} onSize={(w, d) => setSize(single, w, d)} onChange={(changes) => changeSelected((n) => (n.type === 'shape' ? ({ ...n, ...changes } as BuilderNode) : n))} onTurn={(deg) => changeSelected((n) => { const b = nodeBounds(n); return rotateNode(n, deg, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }); })} />
              <div className="button-row">
                <button type="button" className="secondary small" onClick={duplicate}>
                  <Icon name="copy" size={16} /> Duplicate
                </button>
                <button type="button" className="danger compact small" onClick={remove}>
                  <Icon name="trash" size={16} /> Delete
                </button>
              </div>
            </section>
          )}

          {selected.length > 1 && (
            <section className="studio-section" aria-label="Several shapes chosen">
              <h3>{selected.length} chosen</h3>
              <p className="hint">{siblings ? 'Group them, merge them into one outline, cut the later ones out of the first, or keep only where they overlap.' : 'To combine shapes, choose ones at the same level of the list.'}</p>
              <div className="button-row">
                <button type="button" className="secondary small" onClick={duplicate}>
                  <Icon name="copy" size={16} /> Duplicate
                </button>
                <button type="button" className="danger compact small" onClick={remove}>
                  <Icon name="trash" size={16} /> Delete
                </button>
              </div>
            </section>
          )}

          <section className="studio-section">
            <h3>Add a shape</h3>
            <div className="builder-add">
              {ADDABLE.map((kind) => (
                <button key={kind} type="button" className="preset builder-add-button" onClick={() => add(kind)}>
                  <PrimitiveIcon kind={kind} />
                  <span>{PRIMITIVE_LABELS[kind]}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="studio-section">
            <h3>Parts</h3>
            {nodes.length === 0 ? (
              <p className="hint">Nothing yet. Add a shape above.</p>
            ) : (
              <NodeTree
                nodes={nodes}
                selected={selected}
                onSelect={(id, add) => setSelected(add ? (selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]) : [id])}
              />
            )}
            <p className="hint">Order matters for Cut out: the first is kept, the ones after it are cut away.</p>
          </section>

          <section className="studio-section">
            <h3>Result</h3>
            {summary ? (
              <p className="builder-summary">
                {formatLength(summary.width, units)} × {formatLength(summary.depth, units)} · {(summary.area / 10_000).toFixed(2)} m²
                {summary.parts > 1 ? ` · ${summary.parts} separate parts` : ''}
                {summary.holes > 0 ? ` · ${summary.holes} ${summary.holes === 1 ? 'hole' : 'holes'}` : ''}
              </p>
            ) : (
              <p className="hint">{result.problem}</p>
            )}
            <p className="hint">Holes and the space between separate parts are free floor: other furniture can stand there.</p>
          </section>
        </div>
      </div>
    </Dialog>
  );
}

function isSelectedLeaf(nodes: BuilderNode[], selected: string[], leafId: string): boolean {
  return selected.some((id) => {
    const n = findNode(nodes, id);
    return n !== null && findNode([n], leafId) !== null;
  });
}

/** SVG path data for an outline with true curves. */
function vertexPath(shape: { points: ShapeVertex[]; holes?: ShapeVertex[][] }): string {
  const loop = (pts: ShapeVertex[]) =>
    `M${pts[0].x},${pts[0].y}` +
    pts
      .map((v, i) => {
        const next = pts[(i + 1) % pts.length];
        return v.c1 && v.c2 ? `C${v.c1.x},${v.c1.y} ${v.c2.x},${v.c2.y} ${next.x},${next.y}` : `L${next.x},${next.y}`;
      })
      .join('') +
    'Z';
  return [shape.points, ...(shape.holes ?? [])].map(loop).join('');
}

interface NodeFieldsProps {
  node: BuilderNode;
  unit: string;
  toInput: (cm: number) => number;
  toCm: (v: number) => number;
  onMove: (dx: number, dy: number) => void;
  onSize: (width: number | null, depth: number | null) => void;
  onChange: (changes: Partial<Extract<BuilderNode, { type: 'shape' }>>) => void;
  onTurn: (degrees: number) => void;
}

/** Exact position, size and angle of the chosen shape or combination. */
function NodeFields({ node, unit, toInput, toCm, onMove, onSize, onChange, onTurn }: NodeFieldsProps) {
  const box = nodeBounds(node);
  const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  const isShape = node.type === 'shape';
  const fixed = isShape && isFixedRatio(node.kind);
  const width = isShape ? node.width : box.maxX - box.minX;
  const depth = isShape ? node.depth : box.maxY - box.minY;
  return (
    <>
      <div className="field-grid two">
        <NumberField label="Across (x)" suffix={unit} value={toInput(centre.x)} onCommit={(v) => onMove(toCm(v) - centre.x, 0)} />
        <NumberField label="Front–back (y)" suffix={unit} value={toInput(centre.y)} onCommit={(v) => onMove(0, toCm(v) - centre.y)} />
        <NumberField
          label={isShape && (node.kind === 'circle' || node.kind === 'arc') ? 'Diameter' : 'Width'}
          suffix={unit}
          min={0}
          value={toInput(width)}
          onCommit={(v) => v > 0 && onSize(toCm(v), null)}
        />
        {!fixed && <NumberField label={isShape && node.kind === 'arc' ? 'Band depth' : 'Depth'} suffix={unit} min={0} value={toInput(depth)} onCommit={(v) => v > 0 && onSize(null, toCm(v))} />}
        {isShape && <NumberField label="Angle" suffix="°" value={Math.round(node.rotation * 10) / 10} onCommit={(v) => onChange({ rotation: ((v % 360) + 360) % 360 })} />}
        {isShape && node.kind === 'polygon' && <NumberField label="Sides" min={3} value={node.sides ?? 6} onCommit={(v) => onChange({ sides: Math.max(3, Math.min(64, Math.round(v))) })} />}
        {isShape && node.kind === 'arc' && <NumberField label="Sweep" suffix="°" min={1} value={node.sweep ?? 180} onCommit={(v) => onChange({ sweep: Math.max(1, Math.min(360, v)) })} />}
      </div>
      <div className="button-row">
        <button type="button" className="secondary small" onClick={() => onTurn(-90)} aria-label="Turn 90° anticlockwise">
          <Icon name="rotateLeft" size={16} /> 90°
        </button>
        <button type="button" className="secondary small" onClick={() => onTurn(90)} aria-label="Turn 90° clockwise">
          <Icon name="rotateRight" size={16} /> 90°
        </button>
      </div>
      {!isShape && <p className="hint">Sizes stretch everything inside. Shapes turned at an angle are scaled evenly so they keep their shape.</p>}
    </>
  );
}

function NodeTree({ nodes, selected, onSelect }: { nodes: BuilderNode[]; selected: string[]; onSelect: (id: string, add: boolean) => void }): ReactNode {
  return (
    <ul className="builder-tree">
      {nodes.map((n) => (
        <li key={n.id}>
          <div className={`builder-row ${selected.includes(n.id) ? 'is-selected' : ''}`}>
            <label className="builder-check">
              <input type="checkbox" checked={selected.includes(n.id)} onChange={() => onSelect(n.id, true)} />
              <span className="visually-hidden">Also choose {nodeLabel(n)}</span>
            </label>
            <button type="button" aria-pressed={selected.includes(n.id)} onClick={(e) => onSelect(n.id, e.shiftKey || e.metaKey || e.ctrlKey)}>
              {nodeLabel(n)}
            </button>
          </div>
          {n.type !== 'shape' && <NodeTree nodes={n.children} selected={selected} onSelect={onSelect} />}
        </li>
      ))}
    </ul>
  );
}

function PrimitiveIcon({ kind }: { kind: AddableKind }) {
  const node = createPrimitive(kind, 'icon');
  const box = nodeBounds(node);
  const size = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 1.15;
  return (
    <svg viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} width={28} height={28} aria-hidden="true">
      <path d={vertexPath(shapeOutline(node))} fillRule="evenodd" className="builder-icon" strokeWidth={size / 18} />
    </svg>
  );
}
