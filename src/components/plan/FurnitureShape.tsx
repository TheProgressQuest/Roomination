import { memo, useMemo, useState } from 'react';
import { Circle, Group, Line, Path, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import { polygonArea } from '../../model/polygon';
import { localFootprint, type Ring } from '../../model/shape';
import type { Furniture, Point } from '../../model/types';
import { useAssetImage } from '../useAssetImage';
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
  const outline = useMemo(() => (item.shape ? drawnOutline(item) : null), [item]);
  // A top photo (photo-assisted furniture) is shown as the piece's surface, stretched to its size.
  const photo = useAssetImage(item.appearance?.textures?.top);
  // Drawn outlines are centred on the piece's origin; the Rect's own origin is its top-left corner.
  const photoFill = (centred: boolean) =>
    photo
      ? {
          fillPriority: 'pattern' as const,
          fillPatternImage: photo,
          fillPatternRepeat: 'no-repeat',
          fillPatternScale: { x: w / photo.naturalWidth, y: h / photo.naturalHeight },
          fillPatternOffset: centred ? { x: photo.naturalWidth / 2, y: photo.naturalHeight / 2 } : { x: 0, y: 0 },
        }
      : null;
  const labelAt = outline ? { x: outline.label.x * scale, y: outline.label.y * scale } : { x: 0, y: 0 };

  return (
    <Group ref={props.registerNode} name="object" x={x} y={y} rotation={item.rotation} {...interactionEvents(props, setHovered)} onTransformEnd={(e) => props.onTransformEnd(e.currentTarget)}>
      {outline ? (
        // A drawn outline: exactly the footprint used for collisions (curves flattened to 0.5 cm).
        <>
          <Path
            data={ringsPath(outline.rings, scale)}
            fillRule="evenodd"
            fill={item.color}
            {...photoFill(true)}
            stroke={stroke}
            strokeWidth={strokeWidth}
            dash={status === 'accepted' ? [6, 4] : undefined}
            lineJoin="round"
            shadowColor={palette.shadow}
            shadowOpacity={lifted ? 0.28 : 0.14}
            shadowBlur={lifted ? 12 : 4}
            shadowOffsetY={lifted ? 4 : 2}
            shadowForStrokeEnabled={false}
            perfectDrawEnabled={false}
          />
          {outline.front.map(([a, b], i) => (
            // Edges facing the front are drawn darker, to show which way the piece faces.
            <Line key={i} points={[a.x * scale, a.y * scale, b.x * scale, b.y * scale]} stroke={shade(item.color, -0.4)} strokeWidth={2.5} lineCap="round" listening={false} />
          ))}
        </>
      ) : (
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
        {...photoFill(false)}
      />
      )}
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
      {!isRug && !outline && (
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
          x={labelAt.x}
          y={labelAt.y}
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

/**
 * The flattened outline in local cm, the edges facing the front (+y), and a point well
 * inside the shape for the label (the bounding-box centre may fall outside an L or U shape).
 */
function drawnOutline(item: Furniture): { rings: Ring[]; front: [Point, Point][]; label: Point } {
  const { rings, parts } = localFootprint(item);
  const front: [Point, Point][] = [];
  for (const { outer } of rings) {
    outer.forEach((a, i) => {
      const b = outer[(i + 1) % outer.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      // Outlines are clockwise on screen, so the outward normal is (dy, −dx) / length.
      if (len > 0 && -(b.x - a.x) / len > 0.7) front.push([a, b]);
    });
  }
  // The average of a convex piece's corners is always inside it.
  const biggest = parts.reduce((best, p) => (polygonArea(p) > polygonArea(best) ? p : best), parts[0]);
  const label = { x: biggest.reduce((s, p) => s + p.x, 0) / biggest.length, y: biggest.reduce((s, p) => s + p.y, 0) / biggest.length };
  return { rings, front, label };
}

/** SVG path data for every part and hole, in pixels (filled with the even-odd rule, so holes stay open). */
function ringsPath(rings: Ring[], scale: number): string {
  const loop = (poly: Point[]) => `M${poly.map((p) => `${(p.x * scale).toFixed(2)},${(p.y * scale).toFixed(2)}`).join('L')}Z`;
  return rings.map((r) => [r.outer, ...r.holes].map(loop).join('')).join('');
}
