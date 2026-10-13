import { Line, Rect, Text } from 'react-konva';
import { openingSpan } from '../../model/features';
import type { Project, Wall } from '../../model/types';
import { formatLength, gridSpacing } from '../../model/units';
import type { CanvasPalette } from '../../render/palette';
import { PX_PER_CM, floorTexture } from '../../render/textures';
import type { Viewport } from './viewport';

export const FONT_FAMILY = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif';

interface ShellProps {
  project: Project;
  viewport: Viewport;
  palette: CanvasPalette;
}

/** The floor surface (with its texture) and the real-world measurement grid. */
export function RoomFloor({ project, viewport, palette, showGrid }: ShellProps & { showGrid: boolean }) {
  const { room } = project;
  const { scale, offsetX, offsetY } = viewport;
  const texture = floorTexture(room.floor);
  const ratio = scale / PX_PER_CM;

  return (
    <>
      <Rect
        x={offsetX}
        y={offsetY}
        width={room.width * scale}
        height={room.length * scale}
        fill={room.floor.color}
        // The pattern is anchored at the room's top-left corner and scaled from cm,
        // so it stays aligned with real positions at any zoom level.
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
      {showGrid && <MeasurementGrid project={project} viewport={viewport} palette={palette} />}
    </>
  );
}

function MeasurementGrid({ project, viewport, palette }: ShellProps) {
  const { room, units } = project;
  const { minor, major } = gridSpacing(units, viewport.scale);
  const left = viewport.offsetX;
  const top = viewport.offsetY;
  const right = left + room.width * viewport.scale;
  const bottom = top + room.length * viewport.scale;
  const isMajor = (cm: number) => Math.abs(cm / major - Math.round(cm / major)) < 1e-6;
  const lines: { points: number[]; major: boolean }[] = [];
  // On a patterned floor the fine lines compete with planks and grout, so keep only major ones.
  const majorOnly = room.floor.preset !== 'plain';

  // Lines are measured from the room's corner so they line up with real distances.
  for (let i = 1; i * minor < room.width - 1e-6; i++) {
    const px = left + i * minor * viewport.scale;
    lines.push({ points: [px, top, px, bottom], major: isMajor(i * minor) });
  }
  for (let i = 1; i * minor < room.length - 1e-6; i++) {
    const py = top + i * minor * viewport.scale;
    lines.push({ points: [left, py, right, py], major: isMajor(i * minor) });
  }
  return (
    <>
      {lines.filter((line) => line.major || !majorOnly).map((line, i) => (
        <Line key={i} points={line.points} stroke={line.major ? palette.gridMajor : palette.gridMinor} strokeWidth={1} />
      ))}
    </>
  );
}

/**
 * The four walls, drawn outside the interior, with real gaps where doors and
 * windows are (the door/window symbols are drawn into those gaps separately).
 */
export function Walls({ project, viewport, palette }: ShellProps) {
  const { room, features } = project;
  const { scale, offsetX: ox, offsetY: oy, wallPx: t } = viewport;
  const W = room.width * scale;
  const L = room.length * scale;
  const segments: { x: number; y: number; width: number; height: number }[] = [];

  const solidParts = (wall: Wall, length: number): [number, number][] => {
    const gaps = features
      .map(openingSpan)
      .filter((s): s is NonNullable<typeof s> => s !== null && s.wall === wall)
      .sort((a, b) => a.start - b.start);
    const parts: [number, number][] = [];
    let cursor = 0;
    for (const gap of gaps) {
      if (gap.start > cursor) parts.push([cursor, gap.start]);
      cursor = Math.max(cursor, gap.end);
    }
    if (cursor < length) parts.push([cursor, length]);
    return parts;
  };

  for (const [a, b] of solidParts('top', room.width)) segments.push({ x: ox + a * scale, y: oy - t, width: (b - a) * scale, height: t });
  for (const [a, b] of solidParts('bottom', room.width)) segments.push({ x: ox + a * scale, y: oy + L, width: (b - a) * scale, height: t });
  for (const [a, b] of solidParts('left', room.length)) segments.push({ x: ox - t, y: oy + a * scale, width: t, height: (b - a) * scale });
  for (const [a, b] of solidParts('right', room.length)) segments.push({ x: ox + W, y: oy + a * scale, width: t, height: (b - a) * scale });
  // Corner blocks, so walls stay joined even when an opening reaches a corner.
  for (const [x, y] of [[ox - t, oy - t], [ox + W, oy - t], [ox - t, oy + L], [ox + W, oy + L]]) {
    segments.push({ x, y, width: t, height: t });
  }

  return (
    <>
      {segments.map((s, i) => (
        <Rect key={i} {...s} fill={palette.wall} listening={false} />
      ))}
    </>
  );
}

export function DimensionLabels({ project, viewport, palette }: ShellProps) {
  const { room, units } = project;
  const left = viewport.offsetX;
  const top = viewport.offsetY;
  const roomW = room.width * viewport.scale;
  const roomH = room.length * viewport.scale;
  const gap = viewport.wallPx + 10;
  const fontSize = 13;
  const labelBox = 160;
  const tick = (points: number[]) => <Line points={points} stroke={palette.label} strokeWidth={1} />;

  return (
    <>
      {tick([left, top - gap, left + roomW, top - gap])}
      {tick([left, top - gap - 5, left, top - gap + 5])}
      {tick([left + roomW, top - gap - 5, left + roomW, top - gap + 5])}
      <Text
        x={left + roomW / 2 - labelBox / 2}
        y={top - gap - fontSize - 6}
        width={labelBox}
        align="center"
        text={formatLength(room.width, units)}
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
        text={formatLength(room.length, units)}
        fontSize={fontSize}
        fontFamily={FONT_FAMILY}
        fontStyle="600"
        fill={palette.label}
      />
    </>
  );
}
