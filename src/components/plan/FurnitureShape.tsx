import { memo, useState } from 'react';
import { Circle, Group, Line, Path, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { Furniture } from '../../model/types';
import { readableText, shade, type CanvasPalette } from '../../render/palette';
import { PX_PER_CM, rugTexture } from '../../render/textures';
import { FONT_FAMILY } from './RoomShell';
import { interactionEvents, sameDataProps, type ConflictStatus, type InteractionProps } from './shared';

/** Same padlock as the interface icon (24×24 viewBox). */
const LOCK_PATH = 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4';

interface FurnitureShapeProps extends InteractionProps {
  item: Furniture;
  scale: number;
  x: number;
  y: number;
  selected: boolean;
  status: ConflictStatus;
  palette: CanvasPalette;
  onTransformEnd: (node: Konva.Node) => void;
}

export const FurnitureShape = memo(function FurnitureShape(props: FurnitureShapeProps) {
  const { item, scale, x, y, selected, status, palette } = props;
  const [hovered, setHovered] = useState(false);
  const w = item.width * scale;
  const h = item.depth * scale;
  const isRug = item.category === 'floorCovering';
  const lifted = selected || hovered;
  const texture = isRug ? rugTexture(item.texture, item.color) : null;
  const patternScale = scale / PX_PER_CM;

  const stroke =
    status === 'warning' ? palette.warning : status === 'accepted' ? palette.accepted : selected ? palette.selection : shade(item.color, -0.45);
  const strokeWidth = status === 'warning' ? 2.5 : selected || status === 'accepted' ? 2 : 1;

  // Labels: shrink for small pieces, hide when there is no room; never spill outside.
  const fontSize = Math.max(9, Math.min(12, Math.min(w, h) * 0.32));
  const showLabel = w > 30 && h > fontSize + 6;
  // Keep labels readable: flip them when the piece is upside-down.
  const upsideDown = item.rotation > 90 && item.rotation < 270;

  return (
    <Group ref={props.registerNode} name="object" x={x} y={y} rotation={item.rotation} {...interactionEvents(props, setHovered)} onTransformEnd={(e) => props.onTransformEnd(e.currentTarget)}>
      <Rect
        width={w}
        height={h}
        offsetX={w / 2}
        offsetY={h / 2}
        fill={item.color}
        fillPriority={texture ? 'pattern' : 'color'}
        fillPatternImage={texture?.image as unknown as HTMLImageElement | undefined}
        fillPatternScale={{ x: patternScale, y: patternScale }}
        stroke={stroke}
        strokeWidth={strokeWidth}
        dash={status === 'accepted' ? [6, 4] : undefined}
        cornerRadius={isRug ? Math.min(3, w / 8, h / 8) : Math.min(6, w / 4, h / 4)}
        opacity={isRug ? 0.92 : 1}
        shadowEnabled={!isRug}
        shadowColor={palette.shadow}
        shadowOpacity={lifted ? 0.28 : 0.14}
        shadowBlur={lifted ? 12 : 4}
        shadowOffsetY={lifted ? 4 : 2}
        // Konva performance: draw the shadow once (fill only) and skip the extra buffer canvas.
        shadowForStrokeEnabled={false}
        perfectDrawEnabled={false}
      />
      {isRug && item.texture === 'bordered' && (
        <Rect
          width={Math.max(0, w - 2 * Math.min(10 * scale, w / 6))}
          height={Math.max(0, h - 2 * Math.min(10 * scale, h / 6))}
          offsetX={Math.max(0, w - 2 * Math.min(10 * scale, w / 6)) / 2}
          offsetY={Math.max(0, h - 2 * Math.min(10 * scale, h / 6)) / 2}
          stroke={shade(item.color, -0.25)}
          strokeWidth={Math.max(1.5, 3 * scale)}
          cornerRadius={2}
          listening={false}
        />
      )}
      {!isRug && (
        // A line along the front edge shows which way the piece faces.
        <Line
          points={[-w / 2 + 4, h / 2 - 3, w / 2 - 4, h / 2 - 3]}
          stroke={shade(item.color, -0.4)}
          strokeWidth={2}
          lineCap="round"
          listening={false}
        />
      )}
      {showLabel && (
        <Text
          text={item.name}
          width={w - 8}
          offsetX={(w - 8) / 2}
          offsetY={fontSize / 2}
          rotation={upsideDown ? 180 : 0}
          align="center"
          fontSize={fontSize}
          fontFamily={FONT_FAMILY}
          fontStyle="600"
          fill={readableText(item.color)}
          opacity={isRug ? 0.75 : 1}
          wrap="none"
          ellipsis
          listening={false}
        />
      )}
      {item.locked && (
        // Lock badge in the top-left corner, kept upright.
        <Group x={-w / 2} y={-h / 2} rotation={-item.rotation} listening={false}>
          <Circle radius={9} fill={palette.featureInk} stroke="#ffffff" strokeWidth={1.5} />
          <Path data={LOCK_PATH} stroke="#ffffff" strokeWidth={2} lineCap="round" lineJoin="round" scaleX={0.5} scaleY={0.5} offsetX={12} offsetY={13} />
        </Group>
      )}
      {status === 'warning' && (
        <Group x={w / 2} y={-h / 2} rotation={-item.rotation} listening={false}>
          <Circle radius={8} fill={palette.warning} stroke="#ffffff" strokeWidth={1.5} />
          <Text text="!" fontSize={12} fontStyle="800" fontFamily={FONT_FAMILY} fill="#ffffff" width={16} offsetX={8} offsetY={6} align="center" />
        </Group>
      )}
    </Group>
  );
}, sameDataProps);
