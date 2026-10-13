import { memo, useState } from 'react';
import { Arrow, Group, Line, Text } from 'react-konva';
import type Konva from 'konva';
import { layoutStair, stairProblems } from '../../model/stairs';
import type { Point, Staircase } from '../../model/types';
import type { CanvasPalette } from '../../render/palette';
import { FONT_FAMILY } from './RoomShell';
import { interactionEvents, sameDataProps, type ConflictStatus, type InteractionProps } from './shared';
import { flatPx } from './viewport';

interface StairShapeProps extends InteractionProps {
  stair: Staircase;
  scale: number;
  x: number;
  y: number;
  selected: boolean;
  status: ConflictStatus;
  palette: CanvasPalette;
  onTransformEnd: (node: Konva.Node) => void;
}

/**
 * Floor-plan symbol for a staircase: an outline per section, a line per tread, hatched
 * landings, a walking line with an arrow towards the top, and an UP/DN label at the start.
 */
export const StairShape = memo(function StairShape(props: StairShapeProps) {
  const { stair, scale, selected, status, palette } = props;
  const [hovered, setHovered] = useState(false);
  const layout = layoutStair(stair.sections);
  const impossible = stairProblems(stair).length > 0;
  const outlineColor = status === 'warning' || impossible ? palette.warning : selected || hovered ? palette.selection : palette.feature;
  const px = (p: Point) => ({ x: p.x * scale, y: p.y * scale });

  // The arrow always points the way you climb: from the start for "up", towards it for "down".
  const path = layout.path.map(px);
  const arrowPoints = (stair.direction === 'up' ? path : [...path].reverse()).flatMap((p) => [p.x, p.y]);
  const label = stair.direction === 'up' ? 'UP' : 'DN';
  const first = layout.sections[0];
  const labelAt = first ? px({ x: first.entry.x + first.heading.x * 12, y: first.entry.y + first.heading.y * 12 }) : { x: 0, y: 0 };
  const fontSize = Math.max(9, Math.min(13, 30 * scale));

  return (
    <Group ref={props.registerNode} name="object" x={props.x} y={props.y} rotation={stair.rotation} {...interactionEvents(props, setHovered)} onTransformEnd={(e) => props.onTransformEnd(e.currentTarget)}>
      {layout.sections.map((s) => {
        const corners = flatPx(s.corners, scale);
        return (
          <Group key={s.section.id}>
            <Line points={corners} closed fill={palette.featureFill} opacity={0.95} />
            {s.section.kind === 'flight' ? treadLines(s, scale, palette.featureInk) : landingHatch(s, scale, palette.featureInk)}
            <Line points={corners} closed stroke={outlineColor} strokeWidth={selected || status ? 2 : 1.25} dash={impossible ? [6, 4] : undefined} />
          </Group>
        );
      })}
      <Arrow points={arrowPoints} stroke={palette.featureInk} fill={palette.featureInk} strokeWidth={1.25} pointerLength={8} pointerWidth={7} listening={false} />
      <Text
        text={label}
        x={labelAt.x}
        y={labelAt.y}
        rotation={-stair.rotation}
        offsetX={fontSize}
        offsetY={fontSize / 2}
        width={fontSize * 2}
        align="center"
        fontSize={fontSize}
        fontStyle="800"
        fontFamily={FONT_FAMILY}
        fill={palette.featureInk}
        listening={false}
      />
    </Group>
  );
}, sameDataProps);

type Laid = ReturnType<typeof layoutStair>['sections'][number];

/** One line across the flight at each tread boundary. */
function treadLines(s: Laid, scale: number, color: string) {
  const { section, entry, heading } = s;
  const normal = { x: -heading.y, y: heading.x };
  const half = section.width / 2;
  const lines = [];
  for (let k = 1; k < section.steps; k++) {
    const along = (section.length * k) / section.steps;
    const c = { x: entry.x + heading.x * along, y: entry.y + heading.y * along };
    lines.push(
      <Line
        key={k}
        points={[(c.x - normal.x * half) * scale, (c.y - normal.y * half) * scale, (c.x + normal.x * half) * scale, (c.y + normal.y * half) * scale]}
        stroke={color}
        strokeWidth={0.9}
        opacity={0.75}
        listening={false}
      />,
    );
  }
  return <>{lines}</>;
}

/** Light diagonal hatching so landings read as flat floor, distinct from treads. */
function landingHatch(s: Laid, scale: number, color: string) {
  const xs = s.corners.map((p) => p.x * scale);
  const ys = s.corners.map((p) => p.y * scale);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const spacing = 8;
  const lines = [];
  for (let d = minX - (maxY - minY); d < maxX; d += spacing) {
    lines.push(<Line key={d} points={[d, maxY, d + (maxY - minY), minY]} stroke={color} strokeWidth={0.6} opacity={0.3} />);
  }
  return (
    <Group
      listening={false}
      clipFunc={(ctx) => {
        ctx.beginPath();
        s.corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * scale, p.y * scale) : ctx.lineTo(p.x * scale, p.y * scale)));
        ctx.closePath();
      }}
    >
      {lines}
    </Group>
  );
}
