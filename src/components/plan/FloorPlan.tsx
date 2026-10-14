import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Circle, Layer, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { findConflicts, isSolid, type Conflict } from '../../model/conflicts';
import { clampFeatureToRoom, featureFrame, snapToWall, type Frame } from '../../model/features';
import { clampFurnitureToRoom, clampStairToRoom } from '../../model/placement';
import { boundingBox, type Box } from '../../model/polygon';
import { snapPoint, type SnapResult, type SnapSettings } from '../../model/snapping';
import type { Furniture, Placement, Point, Project, RoomFeature, Staircase } from '../../model/types';
import { formatLength } from '../../model/units';
import { asRectangle, findSegment, moveNode, outlinePolygon, wallSegments } from '../../model/walls';
import type { CanvasPalette } from '../../render/palette';
import type { Selection, ToolMode } from '../../state/selection';
import { baguaMap } from '../../model/bagua';
import { BaguaOverlay } from './BaguaOverlay';
import { DrawOverlay } from './DrawOverlay';
import { FeatureShape } from './FeatureShape';
import { FurnitureShape } from './FurnitureShape';
import { DimensionLabels, RoomFloor, WallLengthLabels, Walls } from './RoomShell';
import type { ConflictStatus } from './shared';
import { StairShape } from './StairShape';
import { fitViewport, toRoomPoint, toScreen, type Viewport } from './viewport';

interface FloorPlanProps {
  project: Project;
  conflicts: Conflict[];
  selection: Selection;
  palette: CanvasPalette;
  showMeasurementGrid: boolean;
  showClearances: boolean;
  mode: ToolMode;
  /** Points placed so far while drawing walls. */
  draft: Point[];
  snap: SnapSettings;
  /** Touch screens: items must be selected before they can be dragged. */
  touch: boolean;
  /** Previewing a layout: show it, but nothing can be selected or moved. */
  readOnly?: boolean;
  onSelect: (selection: Selection) => void;
  onOpenEditor: (id: string) => void;
  onChangeFurniture: (id: string, changes: Partial<Furniture>) => void;
  onChangeFeature: (id: string, changes: Partial<RoomFeature>) => void;
  onChangeStair: (id: string, changes: Partial<Staircase>) => void;
  onMoveCorner: (nodeId: string, to: Point) => void;
  /** A drawing point was placed (the app decides whether it closes the room). */
  onDraftPoint: (point: Point) => void;
}

/** Features drawn underneath furniture (they sit on the floor). */
const FLOOR_FEATURES = new Set(['column', 'radiator']);
/** Extra screen space (px) taken by per-wall length labels outside the walls. */
const WALL_LABEL_SPACE = 18;
/** How close (in screen px) the pointer must come to something to snap to it. */
const SNAP_PX = 12;

export function FloorPlan(props: FloorPlanProps) {
  const { project, conflicts, selection, palette, mode, draft, onSelect } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  const drawing = mode !== 'select';
  /** Pieces, walls and corners respond to the pointer only when not drawing or previewing. */
  const interactive = !drawing && !props.readOnly;

  // While a corner is being dragged, show the reshaped room live.
  const [cornerDrag, setCornerDrag] = useState<{ id: string; to: Point } | null>(null);
  const shown = useMemo(() => {
    if (!cornerDrag) return project;
    const room = moveNode(project.room, cornerDrag.id, cornerDrag.to);
    return typeof room === 'string' ? project : { ...project, room };
  }, [project, cornerDrag]);
  const { room, furniture, features, stairs } = shown;
  // The Bagua overlay (Feng Shui), only when switched on and shown.
  const bagua = useMemo(() => (shown.fengShui?.enabled && shown.fengShui.showBagua ? baguaMap(shown) : null), [shown]);

  // The view fits the room. While drawing it adds a generous margin so you can draw beyond
  // the old walls without the view re-zooming under your finger; it only grows if a typed
  // point lands outside that margin.
  const bounds = useMemo<Box>(() => {
    const box = boundingBox(outlinePolygon(project.room));
    const thickest = Math.max(...project.room.outline.map((n) => n.thickness));
    const margin = drawing ? Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.2 : thickest;
    const view = { minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin };
    if (!drawing || draft.length === 0) return view;
    const drawn = boundingBox(draft);
    return { minX: Math.min(view.minX, drawn.minX), minY: Math.min(view.minY, drawn.minY), maxX: Math.max(view.maxX, drawn.maxX), maxY: Math.max(view.maxY, drawn.maxY) };
  }, [project.room, draft, drawing]);
  const showCorners = interactive && (selection?.kind === 'wall' || selection?.kind === 'corner');
  // Per-wall lengths: while editing walls, and for irregular rooms where width × length isn't enough.
  const showWallLengths = drawing || showCorners || asRectangle(room) === null;
  const labelRoom = showWallLengths ? WALL_LABEL_SPACE : 0;
  const viewport = useMemo(() => fitViewport(size, bounds, labelRoom), [size, bounds, labelRoom]);
  const roomBox = useMemo(() => boundingBox(outlinePolygon(room)), [room]);

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
   * While dragging, re-check only the moving object and highlight what it would overlap.
   * State only changes when the set of conflicting objects changes, so this stays cheap
   * and never produces repeated messages.
   */
  function updateLiveConflicts(variant: Project, movingId: string, isFurniture: boolean) {
    // Only the moving thing is re-checked: as a piece of furniture, or as an obstacle.
    const found = isFurniture ? findConflicts(variant, movingId) : findConflicts(variant, undefined, movingId);
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

  // Drawing: where the next point would go, snapped.
  const [hover, setHover] = useState<SnapResult | null>(null);
  useEffect(() => {
    if (!drawing) setHover(null);
  }, [drawing]);
  const tolerance = SNAP_PX / viewport.scale;
  function snapDraft(raw: Point): SnapResult {
    // The point just placed isn't a target: snapping onto it would make a zero-length wall.
    const corners = [...wallSegments(project.room).flatMap((s) => [s.start, s.end]), ...draft.slice(0, -1)];
    // When redrawing the room, the old walls are being replaced, so only snap to the new ones.
    const segments = mode === 'drawWall' ? wallSegments(project.room) : [];
    return snapPoint(raw, { corners, segments, previous: draft[draft.length - 1] }, props.snap, tolerance);
  }
  const closing = mode === 'drawRoom' && draft.length >= 3 && hover !== null && Math.hypot(hover.point.x - draft[0].x, hover.point.y - draft[0].y) < 1e-6;

  // Attach the rotation handle to the selected object if it can rotate.
  const transformerRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef(new Map<string, Konva.Group>());
  const selectedObjectId = selection?.kind === 'object' ? selection.id : null;
  const selectedFeature = features.find((f) => f.id === selectedObjectId);
  const rotatable =
    selectedObjectId !== null &&
    (furniture.some((f) => f.id === selectedObjectId && !f.locked) || stairs.some((s) => s.id === selectedObjectId) || (selectedFeature !== undefined && canRotate(selectedFeature)));
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const node = rotatable && selectedObjectId ? nodeRefs.current.get(selectedObjectId) : undefined;
    transformer.nodes(node && interactive ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedObjectId, rotatable, project, interactive]);

  /** Where the piece being dragged last fitted, so it slides along walls instead of jumping. */
  const lastGood = useRef<Point | null>(null);

  /**
   * The latest room, project and view, for drag handlers. Shapes are memoised and may keep
   * an older handler; reading through this ref keeps every handler working on current data.
   */
  const latest = useRef({ shown, room, viewport, props });
  useLayoutEffect(() => {
    latest.current = { shown, room, viewport, props };
  });

  /** Places a drawing point where the user clicked or tapped. */
  function pressWhileDrawing(stage: Konva.Stage | null) {
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const snapped = snapDraft(toRoomPoint(viewport, pointer));
    setHover(snapped);
    props.onDraftPoint(snapped.point);
  }

  const registerNode = (id: string) => (node: Konva.Group | null) => {
    if (node) nodeRefs.current.set(id, node);
    else nodeRefs.current.delete(id);
  };

  /**
   * Konva moves nodes directly while dragging/rotating. When the gesture ends we put the
   * node back where the data says it is, then dispatch the change. If accepted, React
   * re-renders it in the new spot; if rejected, it is already back. Either way the
   * canvas always mirrors the data.
   */
  function resetNode(node: Konva.Node, frame: Frame) {
    node.position({ x: frame.x, y: frame.y });
    node.rotation(frame.angle);
  }

  if (size.width === 0 || size.height === 0) {
    return <div ref={containerRef} className="floor-plan" />;
  }

  const screenFrame = (frame: Frame): Frame => screenFrameOf(frame, viewport);
  const lockedIds = new Set(furniture.filter((f) => f.locked).map((f) => f.id));
  const canDrag = (id: string) => interactive && !lockedIds.has(id) && (!props.touch || id === selectedObjectId);
  const ceilingFeatures = features.filter((f) => f.kind === 'light' || (f.kind === 'vent' && f.ventMount === 'ceiling'));
  const floorFeatures = features.filter((f) => FLOOR_FEATURES.has(f.kind) || (f.kind === 'vent' && f.ventMount === 'floor'));
  const wallFeatures = features.filter((f) => !ceilingFeatures.includes(f) && !floorFeatures.includes(f));

  const renderFurniture = (item: Furniture) => (
    <FurnitureShape
      key={item.id}
      item={item}
      scale={viewport.scale}
      {...toScreen(viewport, item)}
      selected={item.id === selectedObjectId}
      status={statusOf(item.id)}
      palette={palette}
      draggable={canDrag(item.id)}
      registerNode={registerNode(item.id)}
      onSelect={() => latest.current.props.onSelect({ kind: 'object', id: item.id })}
      onOpenEditor={() => latest.current.props.onOpenEditor(item.id)}
      dragBound={(pos) => {
        const { room, viewport } = latest.current;
        const placed = clampFurnitureToRoom({ ...item, ...toRoomPoint(viewport, pos) }, room, lastGood.current ?? item);
        if (placed) lastGood.current = { x: placed.x, y: placed.y };
        return toScreen(viewport, lastGood.current ?? item);
      }}
      onDragMove={(node) => {
        const { shown, viewport } = latest.current;
        const moved = { ...item, ...toRoomPoint(viewport, node.position()) };
        updateLiveConflicts({ ...shown, furniture: shown.furniture.map((f) => (f.id === item.id ? moved : f)) }, item.id, true);
      }}
      onDragEnd={(node) => {
        const { viewport } = latest.current;
        const { x, y } = toRoomPoint(viewport, node.position());
        lastGood.current = null;
        resetNode(node, { ...toScreen(viewport, item), angle: item.rotation });
        endLiveConflicts();
        latest.current.props.onChangeFurniture(item.id, { x, y });
      }}
      onTransformEnd={(node) => {
        // The piece rotates around a fixed centre while the handle is held; on release
        // the reducer slides it back inside the walls if it now overlaps one.
        const rotation = node.rotation();
        resetNode(node, { ...toScreen(latest.current.viewport, item), angle: item.rotation });
        latest.current.props.onChangeFurniture(item.id, { rotation });
      }}
    />
  );

  const renderFeature = (feature: RoomFeature) => {
    const frame = featureFrame(feature, room);
    /** Where the feature would be if dropped at screen position `pos`. */
    const placementAt = (pos: Konva.Vector2d): Placement | null => {
      const { room, viewport } = latest.current;
      const point = toRoomPoint(viewport, pos);
      if (feature.placement.type === 'wall') return snapToWall(point, room, feature.width);
      // Start from where it last fitted, so it slides along walls instead of searching afresh.
      const from = lastGood.current ?? (feature.placement.type === 'free' ? feature.placement : undefined);
      const placement = clampFeatureToRoom({ ...feature, placement: { ...feature.placement, ...point } }, room, from)?.placement ?? null;
      if (placement?.type === 'free') lastGood.current = { x: placement.x, y: placement.y };
      return placement;
    };
    const screenNow = () => screenFrameOf(featureFrame(feature, latest.current.room), latest.current.viewport);
    const wall = feature.placement.type === 'wall' ? findSegment(room, feature.placement.wallId) : null;
    const thickness = (wall?.thickness ?? 0) * viewport.scale;
    const wallBand = wall?.chain === 'outline' ? { top: -thickness, height: thickness } : { top: -thickness / 2, height: thickness };
    return (
      <FeatureShape
        key={feature.id}
        feature={feature}
        frame={screenFrame(frame)}
        scale={viewport.scale}
        wallBand={wallBand}
        selected={feature.id === selectedObjectId}
        status={statusOf(feature.id)}
        showClearance={props.showClearances}
        palette={palette}
        draggable={canDrag(feature.id)}
        registerNode={registerNode(feature.id)}
        onSelect={() => latest.current.props.onSelect({ kind: 'object', id: feature.id })}
        onOpenEditor={() => latest.current.props.onOpenEditor(feature.id)}
        dragBound={(pos) => {
          // Wall features slide along walls and hop to whichever wall is nearest.
          const { room, viewport } = latest.current;
          const placement = placementAt(pos);
          return placement ? toScreen(viewport, featureFrame({ ...feature, placement }, room)) : screenNow();
        }}
        onDragMove={(node) => {
          const { room, shown } = latest.current;
          const placement = placementAt(node.position());
          if (!placement) return;
          node.rotation(featureFrame({ ...feature, placement }, room).angle);
          const moved = { ...feature, placement };
          updateLiveConflicts({ ...shown, features: shown.features.map((f) => (f.id === feature.id ? moved : f)) }, feature.id, false);
        }}
        onDragEnd={(node) => {
          const placement = placementAt(node.position());
          lastGood.current = null;
          resetNode(node, screenNow());
          endLiveConflicts();
          if (placement) latest.current.props.onChangeFeature(feature.id, { placement });
        }}
        onTransformEnd={(node) => {
          const rotation = node.rotation();
          resetNode(node, screenNow());
          if (feature.placement.type === 'free') latest.current.props.onChangeFeature(feature.id, { placement: { ...feature.placement, rotation } });
        }}
      />
    );
  };

  const renderStair = (stair: Staircase) => (
    <StairShape
      key={stair.id}
      stair={stair}
      scale={viewport.scale}
      {...toScreen(viewport, stair)}
      selected={stair.id === selectedObjectId}
      status={statusOf(stair.id)}
      palette={palette}
      draggable={canDrag(stair.id)}
      registerNode={registerNode(stair.id)}
      onSelect={() => latest.current.props.onSelect({ kind: 'object', id: stair.id })}
      onOpenEditor={() => latest.current.props.onOpenEditor(stair.id)}
      dragBound={(pos) => {
        const { room, viewport } = latest.current;
        const placed = clampStairToRoom({ ...stair, ...toRoomPoint(viewport, pos) }, room, lastGood.current ?? stair);
        if (placed) lastGood.current = { x: placed.x, y: placed.y };
        return toScreen(viewport, lastGood.current ?? stair);
      }}
      onDragMove={(node) => {
        const { shown, viewport } = latest.current;
        const moved = { ...stair, ...toRoomPoint(viewport, node.position()) };
        updateLiveConflicts({ ...shown, stairs: shown.stairs.map((s) => (s.id === stair.id ? moved : s)) }, stair.id, false);
      }}
      onDragEnd={(node) => {
        const { viewport } = latest.current;
        const { x, y } = toRoomPoint(viewport, node.position());
        lastGood.current = null;
        resetNode(node, { ...toScreen(viewport, stair), angle: stair.rotation });
        endLiveConflicts();
        latest.current.props.onChangeStair(stair.id, { x, y });
      }}
      onTransformEnd={(node) => {
        const rotation = node.rotation();
        resetNode(node, { ...toScreen(latest.current.viewport, stair), angle: stair.rotation });
        latest.current.props.onChangeStair(stair.id, { rotation });
      }}
    />
  );

  const cornerSegments = wallSegments(project.room);
  const corners = [...project.room.outline, ...project.room.partitions.flatMap((p) => p.nodes)];

  return (
    <div
      ref={containerRef}
      className="floor-plan"
      role="img"
      aria-label={`Floor plan of ${project.name}: about ${formatLength(roomBox.maxX - roomBox.minX, project.units)} by ${formatLength(roomBox.maxY - roomBox.minY, project.units)}, with ${room.outline.length} outer walls, ${furniture.length} items, ${features.length} room features and ${stairs.length} staircases.`}
      // On phones, swiping over an unselected plan scrolls the page instead of grabbing things.
      style={{ touchAction: props.touch && (props.readOnly || (!drawing && !selection)) ? 'pan-y' : 'none' }}
    >
      <Stage
        width={size.width}
        height={size.height}
        onMouseDown={(e) => interactive && isEmptySpace(e.target) && onSelect(null)}
        onTouchStart={(e) => interactive && isEmptySpace(e.target) && onSelect(null)}
        onMouseMove={(e) => {
          if (!drawing) return;
          const pointer = e.target.getStage()?.getPointerPosition();
          if (pointer) setHover(snapDraft(toRoomPoint(viewport, pointer)));
        }}
        onMouseLeave={() => setHover(null)}
        // One pointer event for mouse, pen and touch: listening to both "click" and "tap"
        // would place two points per tap, because touch screens also emit a click.
        onPointerClick={(e) => drawing && e.evt.button === 0 && pressWhileDrawing(e.target.getStage())}
      >
        <Layer listening={false} opacity={mode === 'drawRoom' ? 0.45 : 1}>
          <RoomFloor project={shown} viewport={viewport} palette={palette} showGrid={props.showMeasurementGrid} bounds={roomBox} />
          {bagua && typeof bagua !== 'string' && <BaguaOverlay map={bagua} viewport={viewport} palette={palette} />}
          <DimensionLabels project={shown} viewport={viewport} palette={palette} bounds={roomBox} clearance={labelRoom} />
        </Layer>
        <Layer listening={interactive} opacity={mode === 'drawRoom' ? 0.45 : 1}>
          {/* Bottom to top: rugs, floor features, stairs, furniture, walls & wall features, ceiling. */}
          {furniture.filter((f) => !isSolid(f)).map(renderFurniture)}
          {floorFeatures.map(renderFeature)}
          {stairs.map(renderStair)}
          {furniture.filter(isSolid).map(renderFurniture)}
          <Walls
            project={shown}
            viewport={viewport}
            palette={palette}
            selectedWallId={selection?.kind === 'wall' ? selection.id : null}
            interactive={interactive}
            onSelectWall={(id) => onSelect({ kind: 'wall', id })}
          />
          {wallFeatures.map(renderFeature)}
          {ceilingFeatures.map(renderFeature)}
          {showWallLengths && (
            <WallLengthLabels project={shown} viewport={viewport} palette={palette} highlightId={selection?.kind === 'wall' ? selection.id : null} />
          )}
          {showCorners &&
            corners.map((corner) => {
              const at = toScreen(viewport, cornerDrag?.id === corner.id ? cornerDrag.to : corner);
              const selected = selection?.kind === 'corner' && selection.id === corner.id;
              return (
                <Circle
                  key={corner.id}
                  name="handle"
                  x={at.x}
                  y={at.y}
                  radius={selected ? 9 : 7}
                  fill="#ffffff"
                  stroke={palette.selection}
                  strokeWidth={3}
                  // Large invisible margin: an easy target for fingers.
                  hitStrokeWidth={30}
                  draggable
                  onMouseDown={() => onSelect({ kind: 'corner', id: corner.id })}
                  onTouchStart={() => onSelect({ kind: 'corner', id: corner.id })}
                  onMouseEnter={(e) => {
                    const container = e.target.getStage()?.container();
                    if (container) container.style.cursor = 'move';
                  }}
                  onMouseLeave={(e) => {
                    const container = e.target.getStage()?.container();
                    if (container) container.style.cursor = '';
                  }}
                  dragBoundFunc={(pos) => {
                    // Snap to other corners, walls (not the two that meet here), the grid and alignment.
                    const others = corners.filter((c) => c.id !== corner.id);
                    const touchesCorner = (p: Point) => p.x === corner.x && p.y === corner.y;
                    const segments = cornerSegments.filter((s) => !touchesCorner(s.start) && !touchesCorner(s.end));
                    const snapped = snapPoint(toRoomPoint(viewport, pos), { corners: others, segments }, { ...props.snap, angles: false }, tolerance);
                    return toScreen(viewport, snapped.point);
                  }}
                  onDragMove={(e) => setCornerDrag({ id: corner.id, to: toRoomPoint(viewport, e.target.position()) })}
                  onDragEnd={(e) => {
                    const to = toRoomPoint(viewport, e.target.position());
                    e.target.position(toScreen(viewport, corner));
                    setCornerDrag(null);
                    props.onMoveCorner(corner.id, to);
                  }}
                />
              );
            })}
          <Transformer
            ref={transformerRef}
            resizeEnabled={false}
            rotateEnabled
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            rotationSnapTolerance={6}
            rotateAnchorOffset={28}
            anchorSize={22}
            anchorCornerRadius={11}
            anchorStroke={palette.selection}
            anchorFill="#ffffff"
            borderStroke={palette.selection}
            borderStrokeWidth={1.5}
            borderDash={[4, 4]}
            padding={4}
          />
        </Layer>
        {drawing && (
          <Layer listening={false}>
            <DrawOverlay draft={draft} hover={hover} closing={closing} viewport={viewport} palette={palette} units={project.units} />
          </Layer>
        )}
      </Stage>
    </div>
  );
}

function screenFrameOf(frame: Frame, viewport: Viewport): Frame {
  return { ...toScreen(viewport, frame), angle: frame.angle };
}

/** Lights and round columns look the same at any angle; wall features follow their wall. */
function canRotate(feature: RoomFeature): boolean {
  if (feature.placement.type !== 'free') return false;
  return feature.kind !== 'light' && !(feature.kind === 'column' && feature.shape === 'round');
}

/** True when a click landed on bare floor or background (not an object, wall, handle or rotate handle). */
function isEmptySpace(target: Konva.Node): boolean {
  return !target.findAncestor('.object', true) && !target.hasName('wall') && !target.hasName('handle') && !target.findAncestor('Transformer');
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
