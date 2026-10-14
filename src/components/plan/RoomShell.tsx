import { Group, Line, Text } from 'react-konva';
import { boundingBox, pointInPolygon, type Box } from '../../model/polygon';
import type { Project } from '../../model/types';
import { formatLength, gridSpacing } from '../../model/units';
import { wallBodies } from '../../model/wallGeometry';
import { asRectangle, outlinePolygon, roomArea, wallSegments } from '../../model/walls';
import type { CanvasPalette } from '../../render/palette';
import { floorTexture, patternScale } from '../../render/textures';
import { flatPx, flatScreen, toScreen, type Viewport } from './viewport';

export const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

interface ShellProps {
  project: Project;
  viewport: Viewport;
  palette: CanvasPalette;
}

/** The floor surface (with its texture) and the real-world measurement grid, clipped to the room. */
export function RoomFloor({ project, viewport, palette, showGrid, bounds }: ShellProps & { showGrid: boolean; bounds: Box }) {
  const { room } = project;
  const texture = floorTexture(room.floor);
  const ratio = texture ? patternScale(texture, viewport.scale) : 1;
  const outline = outlinePolygon(room);

  return (
    // The group's origin is the room's (0, 0), so the texture is anchored to real
    // room coordinates and stays aligned at any zoom level or room shape.
    <Group x={viewport.offsetX} y={viewport.offsetY} listening={false}>
      <Line
        points={flatPx(outline, viewport.scale)}
        closed
        fill={room.floor.color}
        fillPriority={texture ? 'pattern' : 'color'}
        fillPatternImage={texture?.image as unknown as HTMLImageElement | undefined}
        fillPatternRepeat="repeat"
        fillPatternScale={{ x: ratio, y: ratio }}
        fillPatternRotation={room.floor.angle}
        shadowColor={palette.shadow}
        shadowOpacity={0.14}
        shadowBlur={24}
        shadowOffsetY={8}
      />
      {showGrid && (
        <Group
          clipFunc={(ctx) => {
            ctx.beginPath();
            outline.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * viewport.scale, p.y * viewport.scale) : ctx.lineTo(p.x * viewport.scale, p.y * viewport.scale)));
            ctx.closePath();
          }}
        >
          <MeasurementGrid project={project} scale={viewport.scale} palette={palette} bounds={bounds} />
        </Group>
      )}
    </Group>
  );
}

function MeasurementGrid({ project, scale, palette, bounds }: { project: Project; scale: number; palette: CanvasPalette; bounds: Box }) {
  const { minor, major } = gridSpacing(project.units, scale);
  // On a patterned floor the fine lines compete with planks and grout, so keep only major ones.
  const step = project.room.floor.preset !== 'plain' ? major : minor;
  const isMajor = (cm: number) => Math.abs(cm / major - Math.round(cm / major)) < 1e-6;
  const lines: { points: number[]; major: boolean }[] = [];
  // Lines sit on multiples of the step from the room's origin, so they line up with real distances.
  for (let x = Math.ceil(bounds.minX / step) * step; x <= bounds.maxX; x += step) {
    lines.push({ points: [x * scale, bounds.minY * scale, x * scale, bounds.maxY * scale], major: isMajor(x) });
  }
  for (let y = Math.ceil(bounds.minY / step) * step; y <= bounds.maxY; y += step) {
    lines.push({ points: [bounds.minX * scale, y * scale, bounds.maxX * scale, y * scale], major: isMajor(y) });
  }
  return (
    <>
      {lines.map((line, i) => (
        <Line key={i} points={line.points} stroke={line.major ? palette.gridMajor : palette.gridMinor} strokeWidth={1} />
      ))}
    </>
  );
}

interface WallsProps extends ShellProps {
  selectedWallId: string | null;
  /** Walls are selectable in select mode; not while drawing. */
  interactive: boolean;
  onSelectWall: (wallId: string) => void;
}

/** Every wall at its real thickness, with real gaps where doors and windows are. */
export function Walls({ project, viewport, palette, selectedWallId, interactive, onSelectWall }: WallsProps) {
  return (
    <>
      {wallBodies(project.room, project.features).map((body, i) => {
        const selected = body.wallId === selectedWallId;
        return (
          <Line
            key={`${body.wallId}-${i}`}
            name="wall"
            points={flatScreen(body.polygon, viewport)}
            closed
            fill={selected ? palette.selection : palette.wall}
            stroke={selected ? palette.selection : palette.wall}
            strokeWidth={0.5}
            // A wider invisible hit area makes thin walls easy to tap.
            hitStrokeWidth={14}
            listening={interactive}
            onMouseDown={() => onSelectWall(body.wallId)}
            onTouchStart={() => onSelectWall(body.wallId)}
            onMouseEnter={(e) => {
              const container = e.target.getStage()?.container();
              if (container) container.style.cursor = 'pointer';
            }}
            onMouseLeave={(e) => {
              const container = e.target.getStage()?.container();
              if (container) container.style.cursor = '';
            }}
          />
        );
      })}
    </>
  );
}

/**
 * Overall width and length of the room's bounding box. `clearance` pushes the lines further
 * out when per-wall length labels are showing, so the two never overlap.
 */
export function DimensionLabels({ project, viewport, palette, bounds, clearance = 0 }: ShellProps & { bounds: Box; clearance?: number }) {
  const { units } = project;
  const left = viewport.offsetX + bounds.minX * viewport.scale;
  const top = viewport.offsetY + bounds.minY * viewport.scale;
  const roomW = (bounds.maxX - bounds.minX) * viewport.scale;
  const roomH = (bounds.maxY - bounds.minY) * viewport.scale;
  const thickest = Math.max(...project.room.outline.map((n) => n.thickness)) * viewport.scale;
  const gap = thickest + 10 + clearance;
  const fontSize = 13;
  const labelBox = 160;
  const tick = (points: number[]) => <Line points={points} stroke={palette.label} strokeWidth={1} />;

  return (
    <Group listening={false}>
      {tick([left, top - gap, left + roomW, top - gap])}
      {tick([left, top - gap - 5, left, top - gap + 5])}
      {tick([left + roomW, top - gap - 5, left + roomW, top - gap + 5])}
      <Text
        x={left + roomW / 2 - labelBox / 2}
        y={top - gap - fontSize - 6}
        width={labelBox}
        align="center"
        text={formatLength(bounds.maxX - bounds.minX, units)}
        fontSize={fontSize}
        fontFamily={FONT_FAMILY}
        fontStyle="600"
        fill={palette.label}
      />
      {tick([left - gap, top, left - gap, top + roomH])}
      {tick([left - gap - 5, top, left - gap + 5, top])}
      {tick([left - gap - 5, top + roomH, left - gap + 5, top + roomH])}
      <Text
        x={left - gap - fontSize - 6}
        y={top + roomH / 2 + labelBox / 2}
        width={labelBox}
        align="center"
        rotation={-90}
        text={formatLength(bounds.maxY - bounds.minY, units)}
        fontSize={fontSize}
        fontFamily={FONT_FAMILY}
        fontStyle="600"
        fill={palette.label}
      />
    </Group>
  );
}

/**
 * A length label beside each wall — outside outer walls (on the board, clear of the
 * furniture), beside interior walls. Shown while editing walls and for irregular rooms,
 * where the overall width × length no longer tells the whole story.
 */
export function WallLengthLabels({ project, viewport, palette, highlightId }: ShellProps & { highlightId: string | null }) {
  const fontSize = 11;
  return (
    <Group listening={false}>
      {wallSegments(project.room).map((wall) => {
        if (wall.length * viewport.scale < 40) return null;
        const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
        const rad = (wall.angle * Math.PI) / 180;
        // Outer walls: step outward past the wall's thickness. Interior walls: step to one side.
        const away = wall.chain === 'outline' ? wall.thickness + 10 / viewport.scale : wall.thickness / 2 + 9 / viewport.scale;
        const x = viewport.offsetX + (mid.x + Math.sin(rad) * away) * viewport.scale;
        const y = viewport.offsetY + (mid.y - Math.cos(rad) * away) * viewport.scale;
        // Keep text upright: flip labels on walls that point "backwards".
        const angle = wall.angle > 90 || wall.angle <= -90 ? wall.angle + 180 : wall.angle;
        const highlighted = wall.id === highlightId;
        return (
          <Text
            key={wall.id}
            x={x}
            y={y}
            rotation={angle}
            text={formatLength(wall.length, project.units)}
            width={120}
            offsetX={60}
            offsetY={fontSize / 2}
            align="center"
            fontSize={fontSize}
            fontStyle={highlighted ? '800' : '600'}
            fontFamily={FONT_FAMILY}
            fill={highlighted ? palette.selection : palette.feature}
          />
        );
      })}
    </Group>
  );
}

/**
 * The room's name and size written on the floor, like an architectural drawing. It sits in
 * the most open part of the floor, so furniture rarely covers it.
 */
export function RoomLabel({ project, viewport, palette }: ShellProps) {
  const outline = outlinePolygon(project.room);
  const box = boundingBox(outline);
  const rect = asRectangle(project.room);
  const size = rect ? `${formatLength(rect.width, project.units)} × ${formatLength(rect.length, project.units)}` : areaText(roomArea(project.room), project.units);
  const pieces = project.furniture.filter((f) => f.category !== 'floorCovering');
  // The point inside the room farthest from any piece of furniture (on a coarse grid).
  let best = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  let bestClear = -Infinity;
  for (let i = 1; i < 12; i++) {
    for (let j = 1; j < 12; j++) {
      const p = { x: box.minX + ((box.maxX - box.minX) * i) / 12, y: box.minY + ((box.maxY - box.minY) * j) / 12 };
      if (!pointInPolygon(p, outline)) continue;
      const clear = Math.min(
        ...pieces.map((f) => Math.hypot(f.x - p.x, f.y - p.y) - Math.hypot(f.width, f.depth) / 2),
        // Keep away from the walls too.
        ...outline.map((c) => Math.hypot(c.x - p.x, c.y - p.y) * 0.5),
        Infinity,
      );
      if (clear > bestClear) {
        bestClear = clear;
        best = p;
      }
    }
  }
  const at = toScreen(viewport, best);
  const name = project.name.toUpperCase();
  // Fit the name inside the room: shrink the type on small screens, and keep the block within the walls.
  const roomWidth = (box.maxX - box.minX) * viewport.scale;
  const roomHeight = (box.maxY - box.minY) * viewport.scale;
  const longest = Math.max(name.length * 0.68 + 1.2, size.length * 0.55);
  const fontSize = Math.max(7, Math.min(15, viewport.scale * 9, (roomWidth * 0.6) / longest));
  if (fontSize * 2.6 > roomHeight * 0.5) return null;
  const width = Math.min(roomWidth * 0.62, longest * fontSize + 8);
  const left = viewport.offsetX + box.minX * viewport.scale;
  const x = Math.min(Math.max(at.x - width / 2, left + roomWidth * 0.04), left + roomWidth * 0.96 - width);
  return (
    <Group x={x} y={at.y - fontSize} listening={false}>
      <Text text={name} width={width} align="center" fontSize={fontSize} fontStyle="700" letterSpacing={fontSize * 0.08} fontFamily={FONT_FAMILY} fill={palette.roomLabel} wrap="none" ellipsis />
      <Text y={fontSize + 4} text={size} width={width} align="center" fontSize={fontSize * 0.92} fontFamily={FONT_FAMILY} fill={palette.roomLabel} wrap="none" />
    </Group>
  );
}

function areaText(cm2: number, units: Project['units']): string {
  return units === 'metric' ? `${(cm2 / 10_000).toFixed(1)} m²` : `${Math.round((cm2 / 10_000) * 10.7639)} sq ft`;
}
