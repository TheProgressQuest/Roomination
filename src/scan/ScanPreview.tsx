import { useMemo } from 'react';
import { featureFrame, toRoom } from '../model/features';
import { boundingBox } from '../model/polygon';
import { roomFootprint, ringsSvgPath } from '../model/shape';
import { stairPolygons } from '../model/stairs';
import type { UnitSystem } from '../model/types';
import { formatLength } from '../model/units';
import { outlineSegments, partitionSegments } from '../model/walls';
import type { BuildResult } from './convert';

interface Props {
  result: BuildResult;
  units: UnitSystem;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * A quick top-down drawing of exactly the project that will be created (or, when the walls
 * can't make a room yet, of the scanned walls). Low-confidence items are dashed; the selected
 * item is outlined in the accent colour. Clicking a shape selects it in the lists beside it;
 * the lists are the accessible way to do everything here.
 */
export function ScanPreview({ result, units, selectedId, onSelect }: Props) {
  const project = result.project;
  const confidence = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of [...result.openings, ...result.objects]) map.set(o.id, o.confidence);
    for (const w of result.walls) map.set(w.id, w.added ? 'added' : w.confidence);
    return map;
  }, [result]);

  if (!project) {
    const points = result.rawWalls.flatMap((w) => [w.a, w.b]);
    if (points.length === 0) return <div className="scan-preview is-empty">Nothing to draw yet.</div>;
    const box = boundingBox(points);
    const pad = 60;
    return (
      <svg className="scan-preview" viewBox={`${box.minX - pad} ${box.minY - pad} ${box.maxX - box.minX + pad * 2} ${box.maxY - box.minY + pad * 2}`} role="img" aria-label="The scanned walls, which don’t make a room yet">
        {result.rawWalls.map((w) => (
          <line key={w.id} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} className="scan-raw-wall" />
        ))}
      </svg>
    );
  }

  const room = project.room;
  const outer = outlineSegments(room);
  const poly = room.outline.map((n) => `${n.x},${n.y}`).join(' ');
  const box = boundingBox(room.outline);
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY);
  const pad = Math.max(50, span * 0.12);
  const text = Math.max(11, span / 38);
  const cls = (id: string, base: string) =>
    [base, confidence.get(id) === 'low' && 'is-low', confidence.get(id) === 'added' && 'is-added', selectedId === id && 'is-selected'].filter(Boolean).join(' ');
  const pick = (id: string) => ({ onClick: () => onSelect(id), 'data-id': id });

  return (
    <svg
      className="scan-preview"
      viewBox={`${box.minX - pad} ${box.minY - pad} ${box.maxX - box.minX + pad * 2} ${box.maxY - box.minY + pad * 2}`}
      role="img"
      aria-label={`Preview of the room: ${outer.length} walls, ${project.features.length} doors and windows, ${project.furniture.length + project.stairs.length} pieces of furniture`}
      style={{ fontSize: text }}
    >
      <polygon points={poly} className="scan-floor" />
      {outer.map((s) => (
        <line key={s.id} x1={s.start.x} y1={s.start.y} x2={s.end.x} y2={s.end.y} className={cls(s.id, 'scan-wall')} {...pick(s.id)} />
      ))}
      {room.partitions.flatMap(partitionSegments).map((s) => (
        <line key={s.id} x1={s.start.x} y1={s.start.y} x2={s.end.x} y2={s.end.y} className={cls(s.id, 'scan-wall is-interior')} {...pick(s.id)} />
      ))}
      {project.stairs.map((s) => (
        <g key={s.id} className={cls(s.id, 'scan-piece')} {...pick(s.id)}>
          {stairPolygons(s).map((p, i) => (
            <polygon key={i} points={p.map((q) => `${q.x},${q.y}`).join(' ')} />
          ))}
        </g>
      ))}
      {project.furniture.map((f) => {
        const front = [toRoom({ x: f.x, y: f.y, angle: f.rotation }, { x: -f.width / 2, y: f.depth / 2 }), toRoom({ x: f.x, y: f.y, angle: f.rotation }, { x: f.width / 2, y: f.depth / 2 })];
        return (
          <g key={f.id} className={cls(f.id, `scan-piece${f.kind === 'fixture' ? ' is-fixture' : ''}`)} {...pick(f.id)}>
            <title>{f.name}</title>
            <path d={ringsSvgPath(roomFootprint(f).rings)} fillRule="evenodd" />
            <line x1={front[0].x} y1={front[0].y} x2={front[1].x} y2={front[1].y} className="scan-front" />
          </g>
        );
      })}
      {project.features.map((feature) => {
        const frame = featureFrame(feature, room);
        const a = toRoom(frame, { x: -feature.width / 2, y: 0 });
        const b = toRoom(frame, { x: feature.width / 2, y: 0 });
        const kind = feature.kind === 'window' ? 'is-window' : feature.doorType === 'opening' ? 'is-doorway' : 'is-door';
        const swing = feature.kind === 'door' && feature.doorType !== 'opening' ? toRoom(frame, { x: -feature.width / 2, y: feature.width }) : null;
        return (
          <g key={feature.id} className={cls(feature.id, `scan-opening ${kind}`)} {...pick(feature.id)}>
            <title>{feature.name}</title>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            {swing && <path d={`M${a.x},${a.y} L${swing.x},${swing.y} A${feature.width},${feature.width} 0 0 0 ${b.x},${b.y}`} className="scan-swing" />}
          </g>
        );
      })}
      {outer.map((s) => {
        // Length labels just outside each wall (the wall's left side faces out).
        const mid = { x: (s.start.x + s.end.x) / 2, y: (s.start.y + s.end.y) / 2 };
        const rad = (s.angle * Math.PI) / 180;
        const out = text * 1.4 + 6;
        const x = mid.x + Math.sin(rad) * out;
        const y = mid.y - Math.cos(rad) * out;
        let angle = s.angle;
        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;
        return (
          <text key={s.id} x={x} y={y} transform={`rotate(${angle} ${x} ${y})`} className="scan-length" textAnchor="middle" dominantBaseline="middle">
            {formatLength(s.length, units)}
          </text>
        );
      })}
    </svg>
  );
}
