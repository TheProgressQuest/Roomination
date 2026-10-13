import {
  boundingBox,
  findSelfIntersection,
  isClockwise,
  pointInPolygon,
  polygonArea,
  projectOntoSegment,
  segmentsIntersect,
  type Box,
  type Polygon,
} from './polygon';
import type { Partition, Point, Room, WallNode } from './types';

/**
 * Wall segments derived from the room's node chains, plus pure editing operations.
 *
 * Every edit returns either a new Room or a plain-language reason it was refused.
 * Edits never touch furniture or features; the editor reducer re-validates those
 * afterwards (see `applyRoomChange`).
 */

/** Shortest wall allowed, in cm. */
export const MIN_WALL_LENGTH = 10;
export const MIN_WALL_THICKNESS = 2;
export const MAX_WALL_THICKNESS = 100;
export const DEFAULT_WALL_THICKNESS = 12;
/** Smallest room area allowed, in cm² (0.5 m²). */
const MIN_ROOM_AREA = 5_000;
export const MAX_ROOM_SPAN = 10_000;

export interface WallSegment {
  /** Same as the start node's id. */
  id: string;
  /** 'outline' or the id of the partition it belongs to. */
  chain: string;
  index: number;
  start: Point;
  end: Point;
  thickness: number;
  length: number;
  /** Direction from start to end, clockwise degrees from +x. */
  angle: number;
}

function segmentFrom(chain: string, index: number, a: WallNode, b: WallNode): WallSegment {
  return {
    id: a.id,
    chain,
    index,
    start: { x: a.x, y: a.y },
    end: { x: b.x, y: b.y },
    thickness: a.thickness,
    length: Math.hypot(b.x - a.x, b.y - a.y),
    angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  };
}

export function outlineSegments(room: Pick<Room, 'outline'>): WallSegment[] {
  const n = room.outline.length;
  return room.outline.map((node, i) => segmentFrom('outline', i, node, room.outline[(i + 1) % n]));
}

export function partitionSegments(partition: Partition): WallSegment[] {
  return partition.nodes.slice(0, -1).map((node, i) => segmentFrom(partition.id, i, node, partition.nodes[i + 1]));
}

/** Every wall: outer walls first, then interior partitions. */
export function wallSegments(room: Pick<Room, 'outline' | 'partitions'>): WallSegment[] {
  return [...outlineSegments(room), ...room.partitions.flatMap(partitionSegments)];
}

export function findSegment(room: Pick<Room, 'outline' | 'partitions'>, wallId: string): WallSegment | null {
  return wallSegments(room).find((s) => s.id === wallId) ?? null;
}

export function outlinePolygon(room: Pick<Room, 'outline'>): Polygon {
  return room.outline.map(({ x, y }) => ({ x, y }));
}

export function roomBounds(room: Pick<Room, 'outline'>): Box {
  return boundingBox(outlinePolygon(room));
}

export function roomArea(room: Pick<Room, 'outline'>): number {
  return polygonArea(outlinePolygon(room));
}

/** A frame on a wall: origin `offset` cm along it, local x along the wall, local y into the room. */
export function pointAlong(segment: WallSegment, offset: number): Point {
  const t = segment.length === 0 ? 0 : offset / segment.length;
  return { x: segment.start.x + (segment.end.x - segment.start.x) * t, y: segment.start.y + (segment.end.y - segment.start.y) * t };
}

/** A clockwise rectangle outline with its top-left inner corner at the origin. */
export function rectangleOutline(width: number, length: number, makeId: () => string, thickness = DEFAULT_WALL_THICKNESS): WallNode[] {
  return [
    { id: makeId(), x: 0, y: 0, thickness },
    { id: makeId(), x: width, y: 0, thickness },
    { id: makeId(), x: width, y: length, thickness },
    { id: makeId(), x: 0, y: length, thickness },
  ];
}

/** Width and length if the outline is an axis-aligned rectangle, otherwise null. */
export function asRectangle(room: Pick<Room, 'outline'>): { width: number; length: number; minX: number; minY: number } | null {
  if (room.outline.length !== 4) return null;
  const axisAligned = outlineSegments(room).every((s) => Math.abs(s.start.x - s.end.x) < 1e-6 || Math.abs(s.start.y - s.end.y) < 1e-6);
  if (!axisAligned) return null;
  const box = roomBounds(room);
  return { width: box.maxX - box.minX, length: box.maxY - box.minY, minX: box.minX, minY: box.minY };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Explains what is wrong with a room's walls, or returns null if they are valid. */
export function validateRoom(room: Pick<Room, 'outline' | 'partitions'>): string | null {
  const poly = outlinePolygon(room);
  if (poly.length < 3) return 'A room needs at least three walls.';
  const segments = outlineSegments(room);
  const short = segments.findIndex((s) => s.length < MIN_WALL_LENGTH);
  if (short !== -1) return `Wall ${short + 1} would be shorter than ${MIN_WALL_LENGTH} cm.`;
  const crossing = findSelfIntersection(poly);
  if (crossing) return `Walls ${crossing[0] + 1} and ${crossing[1] + 1} would cross each other. A room’s outline can’t overlap itself.`;
  // Dragging a corner far enough can fold the outline over without any walls crossing;
  // every wall's "inside" would then face outwards.
  if (!isClockwise(poly)) return 'That would turn the room inside out. Move the corner back towards the room.';
  if (polygonArea(poly) < MIN_ROOM_AREA) return 'The room would be too small (under 0.5 m²).';
  const box = boundingBox(poly);
  if (box.maxX - box.minX > MAX_ROOM_SPAN || box.maxY - box.minY > MAX_ROOM_SPAN) return 'The room would be larger than 100 m across.';

  for (const partition of room.partitions) {
    if (partition.nodes.length < 2) return 'An interior wall needs two ends.';
    for (const segment of partitionSegments(partition)) {
      if (segment.length < MIN_WALL_LENGTH) return `Interior walls must be at least ${MIN_WALL_LENGTH} cm long.`;
      if (!segmentInsidePolygon(segment.start, segment.end, poly)) return 'Interior walls must stay inside the room.';
    }
  }
  return null;
}

/** Whether point p lies inside the polygon or on its boundary (within `tolerance` cm). */
export function insideOrOnBoundary(p: Point, poly: Polygon, tolerance = 0.5): boolean {
  if (pointInPolygon(p, poly)) return true;
  return poly.some((a, i) => projectOntoSegment(p, a, poly[(i + 1) % poly.length]).distance <= tolerance);
}

/**
 * Whether segment ab stays inside a (possibly concave) polygon. The segment is cut at
 * every boundary crossing; each piece's midpoint must be inside or on the boundary.
 */
export function segmentInsidePolygon(a: Point, b: Point, poly: Polygon): boolean {
  const ts = [0, 1];
  for (let i = 0; i < poly.length; i++) {
    const c = poly[i];
    const d = poly[(i + 1) % poly.length];
    const t = intersectionParameter(a, b, c, d);
    if (t !== null) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  for (let i = 0; i < ts.length - 1; i++) {
    if (ts[i + 1] - ts[i] < 1e-9) continue;
    const mid = (ts[i] + ts[i + 1]) / 2;
    if (!insideOrOnBoundary({ x: a.x + (b.x - a.x) * mid, y: a.y + (b.y - a.y) * mid }, poly)) return false;
  }
  return insideOrOnBoundary(a, poly) && insideOrOnBoundary(b, poly);
}

/** Where along ab (0–1) it crosses segment cd, or null if they don't cross. */
function intersectionParameter(a: Point, b: Point, c: Point, d: Point): number | null {
  if (!segmentsIntersect(a, b, c, d)) return null;
  const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(denominator) < 1e-12) return null; // parallel overlap: endpoints already cover it
  return ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator;
}

/**
 * Ensures the outline winds clockwise (so each wall's right side faces into the room).
 * Only for freshly drawn outlines: reversing changes which node starts each wall, so
 * existing wall ids would point at different walls afterwards.
 */
export function normalizeOutline(outline: WallNode[]): WallNode[] {
  if (isClockwise(outline)) return outline;
  // Reversing the order flips each segment's direction; keep each wall's thickness with
  // the wall it belongs to by shifting thicknesses one step.
  const reversed = [...outline].reverse();
  return reversed.map((node, i) => ({ ...node, thickness: reversed[(i + 1) % reversed.length].thickness }));
}

// ---------------------------------------------------------------------------
// Editing operations
// ---------------------------------------------------------------------------

type Chain = { kind: 'outline' } | { kind: 'partition'; index: number };

function locateNode(room: Room, nodeId: string): { chain: Chain; index: number } | null {
  const i = room.outline.findIndex((n) => n.id === nodeId);
  if (i !== -1) return { chain: { kind: 'outline' }, index: i };
  for (let p = 0; p < room.partitions.length; p++) {
    const j = room.partitions[p].nodes.findIndex((n) => n.id === nodeId);
    if (j !== -1) return { chain: { kind: 'partition', index: p }, index: j };
  }
  return null;
}

function chainNodes(room: Room, chain: Chain): WallNode[] {
  return chain.kind === 'outline' ? room.outline : room.partitions[chain.index].nodes;
}

function withChainNodes(room: Room, chain: Chain, nodes: WallNode[]): Room {
  if (chain.kind === 'outline') return { ...room, outline: nodes };
  return { ...room, partitions: room.partitions.map((p, i) => (i === chain.index ? { ...p, nodes } : p)) };
}

/** The node that ends wall `wallId`. */
function endNodeOf(room: Room, wallId: string): { chain: Chain; index: number } | null {
  const start = locateNode(room, wallId);
  if (!start) return null;
  const nodes = chainNodes(room, start.chain);
  if (start.chain.kind === 'outline') return { chain: start.chain, index: (start.index + 1) % nodes.length };
  return start.index + 1 < nodes.length ? { chain: start.chain, index: start.index + 1 } : null;
}

export function moveNode(room: Room, nodeId: string, to: Point): Room | string {
  const at = locateNode(room, nodeId);
  if (!at) return 'That corner no longer exists.';
  const nodes = chainNodes(room, at.chain).map((n, i) => (i === at.index ? { ...n, x: to.x, y: to.y } : n));
  return withChainNodes(room, at.chain, nodes);
}

/** Changes a wall's length by moving its end node along the wall's current direction. */
export function setWallLength(room: Room, wallId: string, length: number): Room | string {
  const segment = findSegment(room, wallId);
  const end = endNodeOf(room, wallId);
  if (!segment || !end) return 'That wall no longer exists.';
  if (!Number.isFinite(length) || length < MIN_WALL_LENGTH) return `Walls must be at least ${MIN_WALL_LENGTH} cm long.`;
  const rad = (segment.angle * Math.PI) / 180;
  const endNode = chainNodes(room, end.chain)[end.index];
  return moveNode(room, endNode.id, { x: segment.start.x + Math.cos(rad) * length, y: segment.start.y + Math.sin(rad) * length });
}

/** Turns a wall around its start node, keeping its length. */
export function setWallAngle(room: Room, wallId: string, angle: number): Room | string {
  const segment = findSegment(room, wallId);
  const end = endNodeOf(room, wallId);
  if (!segment || !end) return 'That wall no longer exists.';
  if (!Number.isFinite(angle)) return 'Please enter a number.';
  const rad = (angle * Math.PI) / 180;
  const endNode = chainNodes(room, end.chain)[end.index];
  return moveNode(room, endNode.id, { x: segment.start.x + Math.cos(rad) * segment.length, y: segment.start.y + Math.sin(rad) * segment.length });
}

export function setWallThickness(room: Room, wallId: string, thickness: number): Room | string {
  if (!Number.isFinite(thickness) || thickness < MIN_WALL_THICKNESS || thickness > MAX_WALL_THICKNESS) {
    return `Wall thickness must be between ${MIN_WALL_THICKNESS} and ${MAX_WALL_THICKNESS} cm.`;
  }
  const at = locateNode(room, wallId);
  if (!at) return 'That wall no longer exists.';
  return withChainNodes(room, at.chain, chainNodes(room, at.chain).map((n, i) => (i === at.index ? { ...n, thickness } : n)));
}

/** Inserts a corner `distance` cm along a wall, splitting it in two. Returns the new node's id too. */
export function splitWall(room: Room, wallId: string, distance: number, newId: string): { room: Room; newId: string } | string {
  const segment = findSegment(room, wallId);
  const at = locateNode(room, wallId);
  if (!segment || !at) return 'That wall no longer exists.';
  if (distance < MIN_WALL_LENGTH || segment.length - distance < MIN_WALL_LENGTH) {
    return `Each part of a split wall must be at least ${MIN_WALL_LENGTH} cm long.`;
  }
  const p = pointAlong(segment, distance);
  const nodes = [...chainNodes(room, at.chain)];
  nodes.splice(at.index + 1, 0, { id: newId, x: p.x, y: p.y, thickness: segment.thickness });
  return { room: withChainNodes(room, at.chain, nodes), newId };
}

/** Removes a corner, joining the two walls that met there. */
export function removeNode(room: Room, nodeId: string): Room | string {
  const at = locateNode(room, nodeId);
  if (!at) return 'That corner no longer exists.';
  const nodes = chainNodes(room, at.chain);
  if (at.chain.kind === 'outline' && nodes.length <= 3) return 'A room needs at least three walls.';
  if (at.chain.kind === 'partition' && nodes.length <= 2) return 'An interior wall needs two ends. Delete the wall instead.';
  const remaining = nodes.filter((_, i) => i !== at.index);
  // The wall that started at the removed corner disappears; the previous wall now
  // reaches the next corner and keeps its own thickness.
  return withChainNodes(room, at.chain, remaining);
}

/** Two walls can merge if they meet at a corner, point the same way and match in thickness. */
export function canMergeWithNext(room: Room, wallId: string): boolean {
  const segment = findSegment(room, wallId);
  const end = endNodeOf(room, wallId);
  if (!segment || !end) return false;
  const next = findSegment(room, chainNodes(room, end.chain)[end.index].id);
  if (!next || next.chain !== segment.chain) return false;
  // How far the direction changes at the shared corner, normalised to 0–180°.
  const bend = Math.abs(((next.angle - segment.angle + 540) % 360) - 180);
  return bend < 1 && Math.abs(next.thickness - segment.thickness) < 1e-6;
}

export function mergeWithNext(room: Room, wallId: string): Room | string {
  if (!canMergeWithNext(room, wallId)) return 'Only straight, matching walls that continue each other can be merged.';
  const end = endNodeOf(room, wallId)!;
  return removeNode(room, chainNodes(room, end.chain)[end.index].id);
}

/**
 * Deletes a wall. An interior wall segment is removed (splitting its chain if it was in
 * the middle). An outer wall can't leave a gap in the room, so its neighbours are
 * joined instead by removing its end corner.
 */
export function deleteWall(room: Room, wallId: string, newPartitionId: string): Room | string {
  const at = locateNode(room, wallId);
  if (!at) return 'That wall no longer exists.';
  if (at.chain.kind === 'outline') {
    const end = endNodeOf(room, wallId)!;
    return removeNode(room, room.outline[end.index].id);
  }
  const partition = room.partitions[at.chain.index];
  const before = partition.nodes.slice(0, at.index + 1);
  const after = partition.nodes.slice(at.index + 1);
  const pieces: Partition[] = [];
  if (before.length >= 2) pieces.push({ id: partition.id, nodes: before });
  if (after.length >= 2) pieces.push({ id: before.length >= 2 ? newPartitionId : partition.id, nodes: after });
  const partitions = [...room.partitions];
  partitions.splice(at.chain.index, 1, ...pieces);
  return { ...room, partitions };
}

export function deletePartition(room: Room, partitionId: string): Room {
  return { ...room, partitions: room.partitions.filter((p) => p.id !== partitionId) };
}

/** Resizes a rectangular room, keeping its top-left corner fixed. */
export function resizeRectangle(room: Room, width: number, length: number): Room | string {
  const rect = asRectangle(room);
  if (!rect) return 'Only rectangular rooms can be resized by width and length. Edit individual walls instead.';
  const sx = width / rect.width;
  const sy = length / rect.length;
  const scale = (p: Point) => ({ x: rect.minX + (p.x - rect.minX) * sx, y: rect.minY + (p.y - rect.minY) * sy });
  return {
    ...room,
    outline: room.outline.map((n) => ({ ...n, ...scale(n) })),
    partitions: room.partitions.map((p) => ({ ...p, nodes: p.nodes.map((n) => ({ ...n, ...scale(n) })) })),
  };
}

/** Index of the outline wall nearest a point (used to re-attach features). */
export function nearestWall(room: Pick<Room, 'outline' | 'partitions'>, p: Point, minLength = 0): { segment: WallSegment; offset: number; distance: number } | null {
  let best: { segment: WallSegment; offset: number; distance: number } | null = null;
  for (const segment of wallSegments(room)) {
    if (segment.length < minLength) continue;
    const projection = projectOntoSegment(p, segment.start, segment.end);
    if (!best || projection.distance < best.distance) best = { segment, offset: projection.t * segment.length, distance: projection.distance };
  }
  return best;
}
