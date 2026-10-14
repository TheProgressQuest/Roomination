import { Group, Line, Text } from 'react-konva';
import type { Box } from '../../model/polygon';
import type { Project } from '../../model/types';
import { formatLength, gridSpacing } from '../../model/units';
import { wallBodies } from '../../model/wallGeometry';
import { outlinePolygon, wallSegments } from '../../model/walls';
import type { CanvasPalette } from '../../render/palette';
import { PX_PER_CM, floorTexture } from '../../render/textures';
import { flatPx, flatScreen, type Viewport } from './viewport';

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
  const ratio = viewport.scale / PX_PER_CM;
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
