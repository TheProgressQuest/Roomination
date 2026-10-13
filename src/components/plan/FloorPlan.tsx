import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Layer, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { findConflicts, isSolid, type Conflict } from '../../model/conflicts';
import { WALL_ANGLE, clampFeatureToRoom, featureFrame, snapToWall, type Frame } from '../../model/features';
import { clampCenterToRoom } from '../../model/geometry';
import type { Furniture, Placement, Project, RoomFeature } from '../../model/types';
import { formatLength } from '../../model/units';
import type { CanvasPalette } from '../../render/palette';
import { FeatureShape } from './FeatureShape';
import { FurnitureShape } from './FurnitureShape';
import { DimensionLabels, RoomFloor, Walls } from './RoomShell';
import type { ConflictStatus } from './shared';
import { fitViewport, toRoomPoint, toScreen } from './viewport';

interface FloorPlanProps {
  project: Project;
  conflicts: Conflict[];
  selectedId: string | null;
  palette: CanvasPalette;
  showMeasurementGrid: boolean;
  showClearances: boolean;
  onSelect: (id: string | null) => void;
  onOpenEditor: (id: string) => void;
  onChangeFurniture: (id: string, changes: Partial<Furniture>) => void;
  onChangeFeature: (id: string, changes: Partial<RoomFeature>) => void;
}

/** Features drawn underneath furniture (they sit on the floor). */
const FLOOR_FEATURES = new Set(['column', 'radiator']);

export function FloorPlan(props: FloorPlanProps) {
  const { project, conflicts, selectedId, palette, onSelect, onOpenEditor, onChangeFurniture, onChangeFeature } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  const { room, furniture, features } = project;
  const viewport = useMemo(() => fitViewport(size, room), [size, room]);

  // Conflicts found while a drag is in progress (before the change is committed).
  const [liveConflictIds, setLiveConflictIds] = useState<Set<string> | null>(null);
  const liveKeyRef = useRef('');

  const statusById = useMemo(() => {
    const map = new Map<string, ConflictStatus>();
    for (const c of conflicts) {
      for (const id of [c.itemId, c.otherId]) {
        if (!c.accepted) map.set(id, 'warning');
        else if (!map.has(id)) map.set(id, 'accepted');
      }
    }
    return map;
  }, [conflicts]);
  const statusOf = (id: string): ConflictStatus => (liveConflictIds ? (liveConflictIds.has(id) ? 'warning' : undefined) : statusById.get(id));

  /**
   * While dragging, re-check only the moving object and highlight what it would
   * overlap. State only changes when the set of conflicting objects changes, so
   * this stays cheap and never produces repeated messages.
   */
  function updateLiveConflicts(variant: Project, movingId: string, isFeature: boolean) {
    const found = isFeature ? findConflicts(variant).filter((c) => c.otherId === movingId) : findConflicts(variant, movingId);
    const ids = new Set<string>();
    for (const c of found) {
      if (c.accepted) continue;
      ids.add(c.itemId);
      ids.add(c.otherId);
    }
    const key = [...ids].sort().join(',');
    if (key !== liveKeyRef.current) {
      liveKeyRef.current = key;
      setLiveConflictIds(ids);
    }
  }

  function endLiveConflicts() {
    liveKeyRef.current = '';
    setLiveConflictIds(null);
  }

  // Attach the rotation handle to the selected object if it can rotate.
  const transformerRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef(new Map<string, Konva.Group>());
  const selectedFeature = features.find((f) => f.id === selectedId);
  const rotatable = selectedId !== null && (furniture.some((f) => f.id === selectedId) || (selectedFeature !== undefined && canRotate(selectedFeature)));
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const node = rotatable && selectedId ? nodeRefs.current.get(selectedId) : undefined;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedId, rotatable, project]);

  const registerNode = (id: string) => (node: Konva.Group | null) => {
    if (node) nodeRefs.current.set(id, node);
    else nodeRefs.current.delete(id);
  };

  /**
   * Konva moves nodes directly while dragging/rotating. When the gesture ends we put
   * the node back where the data says it is, then dispatch the change. If accepted,
   * React re-renders it in the new spot; if rejected, it is already back. Either
   * way the canvas always mirrors the data.
   */
  function resetNode(node: Konva.Node, frame: { x: number; y: number; angle: number }) {
    node.position({ x: frame.x, y: frame.y });
    node.rotation(frame.angle);
  }

  if (size.width === 0 || size.height === 0) {
    return <div ref={containerRef} className="floor-plan" />;
  }

  const screenFrame = (frame: Frame): Frame => ({ ...toScreen(viewport, frame), angle: frame.angle });
  const rugs = furniture.filter((f) => !isSolid(f));
  const solids = furniture.filter(isSolid);
  const ceilingFeatures = features.filter((f) => f.kind === 'light' || (f.kind === 'vent' && f.ventMount === 'ceiling'));
  const floorFeatures = features.filter((f) => FLOOR_FEATURES.has(f.kind) || (f.kind === 'vent' && f.ventMount === 'floor'));
  const wallFeatures = features.filter((f) => !ceilingFeatures.includes(f) && !floorFeatures.includes(f));

  const renderFurniture = (item: Furniture) => (
    <FurnitureShape
      key={item.id}
      item={item}
      scale={viewport.scale}
      {...toScreen(viewport, item)}
      selected={item.id === selectedId}
      status={statusOf(item.id)}
      palette={palette}
      registerNode={registerNode(item.id)}
      onSelect={() => onSelect(item.id)}
      onOpenEditor={() => onOpenEditor(item.id)}
      dragBound={(pos) => {
        const clamped = clampCenterToRoom({ ...item, ...toRoomPoint(viewport, pos) }, room);
        return clamped ? toScreen(viewport, clamped) : pos;
      }}
      onDragMove={(node) => {
        const moved = { ...item, ...toRoomPoint(viewport, node.position()) };
        updateLiveConflicts({ ...project, furniture: furniture.map((f) => (f.id === item.id ? moved : f)) }, item.id, false);
      }}
      onDragEnd={(node) => {
        const { x, y } = toRoomPoint(viewport, node.position());
        resetNode(node, { ...toScreen(viewport, item), angle: item.rotation });
        endLiveConflicts();
        onChangeFurniture(item.id, { x, y });
      }}
      onTransformEnd={(node) => {
        // The piece rotates around a fixed centre while the handle is held; on
        // release the reducer slides it back inside the walls if it now overlaps one.
        const rotation = node.rotation();
        resetNode(node, { ...toScreen(viewport, item), angle: item.rotation });
        onChangeFurniture(item.id, { rotation });
      }}
    />
  );

  const renderFeature = (feature: RoomFeature) => {
    const frame = featureFrame(feature, room);
    /** Where the feature would be if dropped at screen position `pos`. */
    const placementAt = (pos: Konva.Vector2d): Placement | null => {
      const point = toRoomPoint(viewport, pos);
      if (feature.placement.type === 'wall') return snapToWall(point, room, feature.width);
      const placed = clampFeatureToRoom({ ...feature, placement: { ...feature.placement, ...point } }, room);
      return placed?.placement ?? null;
    };
    return (
      <FeatureShape
        key={feature.id}
        feature={feature}
        frame={screenFrame(frame)}
        scale={viewport.scale}
        wallPx={viewport.wallPx}
        selected={feature.id === selectedId}
        status={statusOf(feature.id)}
        showClearance={props.showClearances}
        palette={palette}
        registerNode={registerNode(feature.id)}
        onSelect={() => onSelect(feature.id)}
        onOpenEditor={() => onOpenEditor(feature.id)}
        dragBound={(pos) => {
          // Wall features slide along walls and hop to whichever wall is nearest.
          const placement = placementAt(pos);
          if (!placement) return pos;
          return toScreen(viewport, featureFrame({ ...feature, placement }, room));
        }}
        onDragMove={(node) => {
          const placement = placementAt(node.position());
          if (!placement) return;
          if (placement.type === 'wall') node.rotation(WALL_ANGLE[placement.wall]);
          const moved = { ...feature, placement };
          updateLiveConflicts({ ...project, features: features.map((f) => (f.id === feature.id ? moved : f)) }, feature.id, true);
        }}
        onDragEnd={(node) => {
          const placement = placementAt(node.position());
          resetNode(node, screenFrame(frame));
          endLiveConflicts();
          if (placement) onChangeFeature(feature.id, { placement });
        }}
        onTransformEnd={(node) => {
          const rotation = node.rotation();
          resetNode(node, screenFrame(frame));
          if (feature.placement.type === 'free') onChangeFeature(feature.id, { placement: { ...feature.placement, rotation } });
        }}
      />
    );
  };

  return (
    <div
      ref={containerRef}
      className="floor-plan"
      role="img"
      aria-label={`Floor plan of ${project.name}: ${formatLength(room.width, project.units)} wide by ${formatLength(room.length, project.units)} long, with ${furniture.length} items and ${features.length} room features.`}
    >
      <Stage
        width={size.width}
        height={size.height}
        onMouseDown={(e) => isEmptySpace(e.target) && onSelect(null)}
        onTouchStart={(e) => isEmptySpace(e.target) && onSelect(null)}
      >
        <Layer listening={false}>
          <RoomFloor project={project} viewport={viewport} palette={palette} showGrid={props.showMeasurementGrid} />
          <DimensionLabels project={project} viewport={viewport} palette={palette} />
        </Layer>
        <Layer>
          {/* Bottom to top: rugs, floor-standing features, furniture, walls & wall features, ceiling. */}
          {rugs.map(renderFurniture)}
          {floorFeatures.map(renderFeature)}
          {solids.map(renderFurniture)}
          <Walls project={project} viewport={viewport} palette={palette} />
          {wallFeatures.map(renderFeature)}
          {ceilingFeatures.map(renderFeature)}
          <Transformer
            ref={transformerRef}
            resizeEnabled={false}
            rotateEnabled
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            rotationSnapTolerance={6}
            rotateAnchorOffset={28}
            anchorSize={16}
            anchorCornerRadius={8}
            anchorStroke={palette.selection}
            anchorFill="#ffffff"
            borderStroke={palette.selection}
            borderStrokeWidth={1.5}
            borderDash={[4, 4]}
            padding={4}
          />
        </Layer>
      </Stage>
    </div>
  );
}

/** Lights and round columns look the same at any angle; wall features follow their wall. */
function canRotate(feature: RoomFeature): boolean {
  if (feature.placement.type !== 'free') return false;
  return feature.kind !== 'light' && !(feature.kind === 'column' && feature.shape === 'round');
}

/** True when a click landed on bare floor or background (not an object or the rotate handle). */
function isEmptySpace(target: Konva.Node): boolean {
  return !target.findAncestor('.object', true) && !target.findAncestor('Transformer');
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

