import { furniturePolygon } from '../model/conflicts';
import { doorLeaves, featureFrame, toRoom } from '../model/features';
import { arcPoints, boundingBox, type Polygon } from '../model/polygon';
import { stairPolygons } from '../model/stairs';
import type { Project } from '../model/types';
import { wallBodies } from '../model/wallGeometry';
import { outlinePolygon } from '../model/walls';

interface LayoutPreviewProps {
  project: Project;
  /** Pieces that moved compared with the current layout (outlined dashed). */
  movedIds: Set<string>;
  label: string;
}

/**
 * A small, static floor-plan picture of a layout, drawn with the same geometry as the
 * main plan (walls, door swings, stairs, furniture). SVG keeps it crisp at any size.
 */
export function LayoutPreview({ project, movedIds, label }: LayoutPreviewProps) {
  const walls = wallBodies(project.room, project.features);
  const box = boundingBox(walls.flatMap((w) => w.polygon).concat(outlinePolygon(project.room)));
  const pad = 10;
  const viewBox = `${box.minX - pad} ${box.minY - pad} ${box.maxX - box.minX + pad * 2} ${box.maxY - box.minY + pad * 2}`;
  const points = (poly: Polygon) => poly.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <svg className="layout-preview" viewBox={viewBox} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      <polygon points={points(outlinePolygon(project.room))} fill={project.room.floor.color} />
      {project.stairs.flatMap(stairPolygons).map((poly, i) => (
        <polygon key={`s${i}`} points={points(poly)} className="preview-stairs" />
      ))}
      {project.furniture
        .filter((f) => f.category === 'floorCovering')
        .map((f) => (
          <polygon key={f.id} points={points(furniturePolygon(f))} fill={f.color} opacity={0.45} />
        ))}
      {project.furniture
        .filter((f) => f.category !== 'floorCovering')
        .map((f) => (
          <polygon key={f.id} points={points(furniturePolygon(f))} fill={f.color} className={movedIds.has(f.id) ? 'preview-moved' : 'preview-piece'} />
        ))}
      {walls.map((w, i) => (
        <polygon key={`w${i}`} points={points(w.polygon)} className="preview-wall" />
      ))}
      {project.features
        .filter((f) => f.kind === 'door')
        .flatMap((door) =>
          doorLeaves(door).map((leaf, i) => {
            const frame = featureFrame(door, project.room);
            const arc = arcPoints(leaf.hinge.x, leaf.hinge.y, leaf.radius, leaf.closedDeg, leaf.openDeg, 10).map((p) => toRoom(frame, p));
            const hinge = toRoom(frame, leaf.hinge);
            return <polyline key={`${door.id}${i}`} points={points([hinge, ...arc, hinge])} className="preview-door" />;
          }),
        )}
    </svg>
  );
}
