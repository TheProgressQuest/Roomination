import { Circle, Group, Line, Text } from 'react-konva';
import type { SnapResult } from '../../model/snapping';
import type { Point, UnitSystem } from '../../model/types';
import { formatLength } from '../../model/units';
import type { CanvasPalette } from '../../render/palette';
import { FONT_FAMILY } from './RoomShell';
import { flatScreen, toScreen, type Viewport } from './viewport';

interface DrawOverlayProps {
  draft: Point[];
  /** Where the next point would go (snapped), while the pointer hovers. */
  hover: SnapResult | null;
  closing: boolean;
  viewport: Viewport;
  palette: CanvasPalette;
  units: UnitSystem;
}

/** The walls being drawn: placed points, the next wall as a preview, snapping guides, and its length/angle. */
export function DrawOverlay({ draft, hover, closing, viewport, palette, units }: DrawOverlayProps) {
  const last = draft[draft.length - 1];
  const next = hover?.point;
  const accent = palette.selection;
  const label = last && next ? `${formatLength(Math.hypot(next.x - last.x, next.y - last.y), units)} · ${Math.round(((Math.atan2(next.y - last.y, next.x - last.x) * 180) / Math.PI + 360) % 360)}°` : null;
  const labelAt = last && next ? toScreen(viewport, { x: (last.x + next.x) / 2, y: (last.y + next.y) / 2 }) : null;

  return (
    <Group listening={false}>
      {hover?.guides.map((g, i) => (
        <Line key={i} points={flatScreen([g.from, g.to], viewport)} stroke={palette.ceiling} strokeWidth={1} dash={[4, 4]} />
      ))}
      {draft.length > 1 && <Line points={flatScreen(draft, viewport)} stroke={accent} strokeWidth={4} lineCap="round" lineJoin="round" />}
      {last && next && <Line points={flatScreen([last, next], viewport)} stroke={accent} strokeWidth={3} dash={[8, 6]} lineCap="round" />}
      {draft.map((p, i) => {
        const s = toScreen(viewport, p);
        const isStart = i === 0 && draft.length >= 3;
        return <Circle key={i} x={s.x} y={s.y} radius={isStart ? (closing ? 11 : 8) : 5} fill={isStart ? '#ffffff' : accent} stroke={accent} strokeWidth={isStart ? 3 : 0} />;
      })}
      {next && (
        <Circle {...toScreen(viewport, next)} radius={hover?.kind === 'endpoint' ? 9 : 6} stroke={accent} strokeWidth={2} fill={hover?.kind === 'none' ? undefined : 'rgba(255,255,255,0.8)'} />
      )}
      {label && labelAt && (
        <Text
          x={labelAt.x + 10}
          y={labelAt.y - 22}
          text={label}
          fontSize={12}
          fontStyle="700"
          fontFamily={FONT_FAMILY}
          fill={accent}
          padding={3}
        />
      )}
    </Group>
  );
}
