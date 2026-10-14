import { Group, Line, Text } from 'react-konva';
import type { BaguaMap } from '../../model/bagua';
import type { CanvasPalette } from '../../render/palette';
import { FONT_FAMILY } from './RoomShell';
import { toScreen, type Viewport } from './viewport';

/**
 * The Bagua map drawn on the floor, under the furniture: translucent, clipped to the room,
 * and never in the way (it's on a layer that ignores the pointer).
 */
export function BaguaOverlay({ map, viewport, palette }: { map: BaguaMap; viewport: Viewport; palette: CanvasPalette }) {
  const flat = (poly: { x: number; y: number }[]) => poly.flatMap((p) => {
    const s = toScreen(viewport, p);
    return [s.x, s.y];
  });
  const room = map.room.map((p) => toScreen(viewport, p));
  const fontSize = Math.max(10, Math.min(13, viewport.scale * 9));
  return (
    <Group
      name="bagua"
      clipFunc={(ctx) => {
        ctx.beginPath();
        room.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
      }}
    >
      {map.areas.map((area, i) => (
        <Line key={area.id} points={flat(area.polygon)} closed fill={i % 2 === 0 ? palette.baguaFillA : palette.baguaFillB} stroke={palette.baguaLine} strokeWidth={1} dash={[6, 4]} />
      ))}
      {map.areas.map((area) => {
        const at = toScreen(viewport, area.centre);
        const width = 140;
        return (
          <Group key={`label-${area.id}`} x={at.x - width / 2} y={at.y - fontSize}>
            <Text width={width} align="center" text={area.tag} fontSize={fontSize - 1} fontFamily={FONT_FAMILY} fontStyle="700" fill={palette.baguaInk} />
            <Text y={fontSize + 1} width={width} align="center" text={area.label} fontSize={fontSize - 1} fontFamily={FONT_FAMILY} fill={palette.baguaInk} wrap="word" />
          </Group>
        );
      })}
    </Group>
  );
}
