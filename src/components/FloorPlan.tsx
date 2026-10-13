import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Group, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva';
import type Konva from 'konva';
import { clampCenterToRoom } from '../model/geometry';
import type { Furniture, Project } from '../model/types';
import { formatLength, gridSpacing } from '../model/units';

interface FloorPlanProps {
  project: Project;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChangeFurniture: (id: string, changes: Partial<Furniture>) => void;
}

/** Screen space reserved around the room for wall thickness and measurement labels. */
const MAX_PADDING_PX = 56;
const MIN_PADDING_PX = 36;
const WALL_PX = 8;
const FONT_FAMILY = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif';

const COLORS = {
  floor: '#fffaf2',
  gridMinor: '#efe4d3',
  gridMajor: '#e0cfb6',
  wall: '#3d3631',
  label: '#7a6a5c',
  furnitureStroke: 'rgba(61, 54, 49, 0.55)',
  furnitureText: '#3d3631',
  selection: '#d9643a',
};

/**
 * Maps real-world centimetres to screen pixels. The whole room is scaled to fit
 * the available space and centred; nothing outside this object deals in pixels.
 */
interface Viewport {
  scale: number; // pixels per cm
  offsetX: number;
  offsetY: number;
}

export function FloorPlan({ project, selectedId, onSelect, onChangeFurniture }: FloorPlanProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  const { room, units, furniture } = project;

  const viewport = useMemo<Viewport>(() => {
    const padding = Math.min(MAX_PADDING_PX, Math.max(MIN_PADDING_PX, size.width * 0.08));
    const availableW = Math.max(size.width - padding * 2, 1);
    const availableH = Math.max(size.height - padding * 2, 1);
    const scale = Math.min(availableW / room.width, availableH / room.length);
    return {
      scale,
      offsetX: (size.width - room.width * scale) / 2,
      offsetY: (size.height - room.length * scale) / 2,
    };
  }, [size.width, size.height, room.width, room.length]);

  const toScreenX = (cm: number) => viewport.offsetX + cm * viewport.scale;
  const toScreenY = (cm: number) => viewport.offsetY + cm * viewport.scale;
  const toRoomX = (px: number) => (px - viewport.offsetX) / viewport.scale;
  const toRoomY = (px: number) => (px - viewport.offsetY) / viewport.scale;

  const roomW = room.width * viewport.scale;
  const roomH = room.length * viewport.scale;

  // Attach the rotation handle to whichever piece is selected.
  const transformerRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef(new Map<string, Konva.Group>());
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const node = selectedId ? nodeRefs.current.get(selectedId) : undefined;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedId, furniture]);

  /**
   * Konva moves nodes directly while dragging/rotating. When the gesture ends we put
   * the node back where React thinks it is, then dispatch the change. If the change
   * is accepted React re-renders it in the new spot; if it is rejected, the node is
   * already back where it belongs. Either way, the canvas always mirrors the data.
   */
  function resetNode(node: Konva.Node, item: Furniture) {
    node.position({ x: toScreenX(item.x), y: toScreenY(item.y) });
    node.rotation(item.rotation);
  }

  if (size.width === 0 || size.height === 0) {
    return <div ref={containerRef} className="floor-plan" />;
  }

  return (
    <div
      ref={containerRef}
      className="floor-plan"
      role="img"
      aria-label={`Floor plan of ${project.name}: ${formatLength(room.width, units)} wide by ${formatLength(room.length, units)} long, with ${furniture.length} pieces of furniture.`}
    >
      <Stage
        width={size.width}
        height={size.height}
        onMouseDown={(e) => {
          if (isEmptySpace(e.target)) onSelect(null);
        }}
        onTouchStart={(e) => {
          if (isEmptySpace(e.target)) onSelect(null);
        }}
      >
        <Layer listening={false}>
          <Rect
            x={viewport.offsetX - WALL_PX / 2}
            y={viewport.offsetY - WALL_PX / 2}
            width={roomW + WALL_PX}
            height={roomH + WALL_PX}
            fill={COLORS.floor}
            stroke={COLORS.wall}
            strokeWidth={WALL_PX}
            cornerRadius={2}
            shadowColor="#3d3631"
            shadowOpacity={0.12}
            shadowBlur={24}
            shadowOffsetY={8}
          />
          <Grid project={project} viewport={viewport} />
          <DimensionLabels project={project} viewport={viewport} />
        </Layer>

        <Layer>
          {furniture.map((item) => (
            <FurniturePiece
              key={item.id}
              item={item}
              scale={viewport.scale}
              x={toScreenX(item.x)}
              y={toScreenY(item.y)}
              selected={item.id === selectedId}
              registerNode={(node) => {
                if (node) nodeRefs.current.set(item.id, node);
                else nodeRefs.current.delete(item.id);
              }}
              onSelect={() => onSelect(item.id)}
              dragBound={(pos) => {
                const clamped = clampCenterToRoom({ ...item, x: toRoomX(pos.x), y: toRoomY(pos.y) }, room);
                return clamped ? { x: toScreenX(clamped.x), y: toScreenY(clamped.y) } : pos;
              }}
              onDragEnd={(node) => {
                const x = toRoomX(node.x());
                const y = toRoomY(node.y());
                resetNode(node, item);
                onChangeFurniture(item.id, { x, y });
              }}
              onTransformEnd={(node) => {
                // The piece rotates around a fixed centre while the handle is held; on
                // release the reducer slides it back inside the walls if it now overlaps one.
                const rotation = node.rotation();
                resetNode(node, item);
                onChangeFurniture(item.id, { rotation });
              }}
            />
          ))}
          <Transformer
            ref={transformerRef}
            resizeEnabled={false}
            rotateEnabled
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            rotationSnapTolerance={6}
            rotateAnchorOffset={28}
            anchorSize={14}
            anchorCornerRadius={7}
            anchorStroke={COLORS.selection}
            anchorFill="#ffffff"
            borderStroke={COLORS.selection}
            borderStrokeWidth={1.5}
            borderDash={[4, 4]}
            padding={4}
          />
        </Layer>
      </Stage>
    </div>
  );
}

interface FurniturePieceProps {
  item: Furniture;
  scale: number;
  x: number;
  y: number;
  selected: boolean;
  registerNode: (node: Konva.Group | null) => void;
  onSelect: () => void;
  dragBound: (pos: Konva.Vector2d) => Konva.Vector2d;
  onDragEnd: (node: Konva.Node) => void;
  onTransformEnd: (node: Konva.Node) => void;
}

function FurniturePiece({
  item,
  scale,
  x,
  y,
  selected,
  registerNode,
  onSelect,
  dragBound,
  onDragEnd,
  onTransformEnd,
}: FurniturePieceProps) {
  const [hovered, setHovered] = useState(false);
  const w = item.width * scale;
  const h = item.depth * scale;
  // Keep labels readable: flip them when the piece is upside-down.
  const upsideDown = item.rotation > 90 && item.rotation < 270;
  const fontSize = 12;
  const showLabel = w > 36 && h > 18;

  return (
    <Group
      ref={registerNode}
      name="furniture"
      x={x}
      y={y}
      rotation={item.rotation}
      draggable
      dragBoundFunc={dragBound}
      onMouseDown={onSelect}
      onTouchStart={onSelect}
      onMouseEnter={(e) => {
        setHovered(true);
        setCursor(e, 'grab');
      }}
      onMouseLeave={(e) => {
        setHovered(false);
        setCursor(e, '');
      }}
      onDragStart={(e) => setCursor(e, 'grabbing')}
      onDragEnd={(e) => {
        setCursor(e, 'grab');
        onDragEnd(e.currentTarget);
      }}
      onTransformEnd={(e) => onTransformEnd(e.currentTarget)}
    >
      <Rect
        width={w}
        height={h}
        offsetX={w / 2}
        offsetY={h / 2}
        fill={item.color}
        stroke={selected ? COLORS.selection : COLORS.furnitureStroke}
        strokeWidth={selected ? 2 : 1}
        cornerRadius={Math.min(6, w / 4, h / 4)}
        shadowColor="#3d3631"
        shadowOpacity={selected || hovered ? 0.28 : 0.14}
        shadowBlur={selected || hovered ? 12 : 4}
        shadowOffsetY={selected || hovered ? 4 : 2}
      />
      {/* A line along the front edge shows which way the piece faces. */}
      <Line
        points={[-w / 2 + 4, h / 2 - 3, w / 2 - 4, h / 2 - 3]}
        stroke="rgba(61, 54, 49, 0.45)"
        strokeWidth={2}
        lineCap="round"
        listening={false}
      />
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
          fill={COLORS.furnitureText}
          wrap="none"
          ellipsis
          listening={false}
        />
      )}
    </Group>
  );
}

function Grid({ project, viewport }: { project: Project; viewport: Viewport }) {
  const { room, units } = project;
  const { minor, major } = gridSpacing(units, viewport.scale);
  const lines: { points: number[]; major: boolean }[] = [];
  const left = viewport.offsetX;
  const top = viewport.offsetY;
  const right = left + room.width * viewport.scale;
  const bottom = top + room.length * viewport.scale;
  const isMajor = (cm: number) => Math.abs(cm / major - Math.round(cm / major)) < 1e-6;

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
      {lines.map((line, i) => (
        <Line
          key={i}
          points={line.points}
          stroke={line.major ? COLORS.gridMajor : COLORS.gridMinor}
          strokeWidth={1}
        />
      ))}
    </>
  );
}

function DimensionLabels({ project, viewport }: { project: Project; viewport: Viewport }) {
  const { room, units } = project;
  const left = viewport.offsetX;
  const top = viewport.offsetY;
  const roomW = room.width * viewport.scale;
  const roomH = room.length * viewport.scale;
  const gap = WALL_PX + 10;
  const fontSize = 13;
  const labelBox = 160;

  return (
    <>
      {/* Width, along the top wall */}
      <Line points={[left, top - gap, left + roomW, top - gap]} stroke={COLORS.label} strokeWidth={1} />
      <Line points={[left, top - gap - 5, left, top - gap + 5]} stroke={COLORS.label} strokeWidth={1} />
      <Line points={[left + roomW, top - gap - 5, left + roomW, top - gap + 5]} stroke={COLORS.label} strokeWidth={1} />
      <Text
        x={left + roomW / 2 - labelBox / 2}
        y={top - gap - fontSize - 6}
        width={labelBox}
        align="center"
        text={formatLength(room.width, units)}
        fontSize={fontSize}
        fontFamily={FONT_FAMILY}
        fontStyle="600"
        fill={COLORS.label}
      />
      {/* Length, along the left wall */}
      <Line points={[left - gap, top, left - gap, top + roomH]} stroke={COLORS.label} strokeWidth={1} />
      <Line points={[left - gap - 5, top, left - gap + 5, top]} stroke={COLORS.label} strokeWidth={1} />
      <Line points={[left - gap - 5, top + roomH, left - gap + 5, top + roomH]} stroke={COLORS.label} strokeWidth={1} />
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
        fill={COLORS.label}
      />
    </>
  );
}

/** True when a click landed on bare floor or background (not furniture or the rotate handle). */
function isEmptySpace(target: Konva.Node): boolean {
  return !target.findAncestor('.furniture', true) && !target.findAncestor('Transformer');
}

function setCursor(e: Konva.KonvaEventObject<unknown>, cursor: string) {
  const container = e.target.getStage()?.container();
  if (container) container.style.cursor = cursor;
}

/** Tracks an element's rendered size so the canvas can fill its panel responsively. */
function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
