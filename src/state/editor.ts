import { findConflicts, type Conflict } from '../model/conflicts';
import {
  allowedPlacement,
  clampFeatureToRoom,
  convertPlacement,
  findOverlappingOpening,
} from '../model/features';
import { MIN_FURNITURE_SIZE, MIN_ROOM_SIZE, normalizeRotation, roundLength } from '../model/geometry';
import { clampFurnitureToRoom, clampStairToRoom } from '../model/placement';
import { applyRoomChange } from '../model/roomChange';
import type { FloorStyle, Furniture, Partition, Placement, Point, Project, Room, RoomFeature, Staircase, UnitSystem, WallNode } from '../model/types';
import {
  MAX_ROOM_SPAN,
  deleteWall,
  findSegment,
  mergeWithNext,
  moveNode,
  normalizeOutline,
  removeNode,
  resizeRectangle,
  setWallAngle,
  setWallLength,
  setWallThickness,
  splitWall,
} from '../model/walls';

/**
 * The editor's state machine. Every change to a project goes through `editorReducer`,
 * which (1) validates it against the geometry rules, (2) records undo history and
 * (3) checks whether the change created new overlaps the user should know about.
 *
 * Undo works by keeping whole snapshots of the project: projects are small, and
 * snapshots can never get out of sync the way hand-written "reverse" operations can.
 */

const HISTORY_LIMIT = 100;
/** Smallest width allowed for a room feature, in cm (outlets are small). */
const MIN_FEATURE_SIZE = 2;
const MAX_CLEARANCE = 500;

export interface Notice {
  /** Increments on every notice so the UI can tell two identical messages apart. */
  id: number;
  message: string;
}

/** Raised when a change creates overlaps the user hasn't accepted yet. */
export interface ConflictPrompt {
  id: number;
  conflicts: Conflict[];
  /** The object whose change caused the conflicts, so messages can name it first. */
  focusId: string | null;
}

export interface EditorState {
  past: Project[];
  present: Project;
  future: Project[];
  /** Explains the most recent rejected change, e.g. "Sofa wouldn't fit". */
  notice: Notice | null;
  /** New, unaccepted overlaps caused by the most recent change. */
  prompt: ConflictPrompt | null;
  /**
   * Merge key of the last commit. Consecutive edits with the same key (e.g. dragging
   * a colour picker or slider) become a single undo step.
   */
  lastMergeKey: string | null;
}

type FeatureChanges = Partial<Omit<RoomFeature, 'id' | 'kind'>>;

export type EditorAction =
  | { type: 'project/replace'; project: Project; resetHistory?: boolean }
  | { type: 'project/rename'; name: string }
  | { type: 'units/set'; units: UnitSystem }
  /** Rectangular rooms only: change width/length (keeping the top-left corner). */
  | { type: 'room/resize'; width: number; length: number }
  | { type: 'room/setHeight'; height: number }
  | { type: 'walls/moveNode'; nodeId: string; to: Point }
  | { type: 'walls/setLength'; wallId: string; length: number }
  | { type: 'walls/setAngle'; wallId: string; angle: number }
  | { type: 'walls/setThickness'; wallId: string; thickness: number }
  /** Inserts a corner `distance` cm along the wall (a new vertex). */
  | { type: 'walls/split'; wallId: string; distance: number; newId: string }
  | { type: 'walls/removeNode'; nodeId: string }
  | { type: 'walls/merge'; wallId: string }
  | { type: 'walls/delete'; wallId: string; newPartitionId: string }
  /** Replaces the whole outline with newly drawn corners. */
  | { type: 'walls/replaceOutline'; nodes: WallNode[] }
  | { type: 'walls/addPartition'; partition: Partition }
  | { type: 'stairs/add'; stair: Staircase }
  | { type: 'stairs/update'; id: string; changes: Partial<Omit<Staircase, 'id'>> }
  | { type: 'stairs/delete'; id: string }
  | { type: 'floor/set'; floor: Partial<FloorStyle>; mergeKey?: string }
  | { type: 'furniture/add'; furniture: Furniture }
  | { type: 'furniture/update'; id: string; changes: Partial<Omit<Furniture, 'id'>>; mergeKey?: string }
  | { type: 'furniture/delete'; id: string }
  | { type: 'feature/add'; feature: RoomFeature }
  | { type: 'feature/update'; id: string; changes: FeatureChanges }
  | { type: 'feature/delete'; id: string }
  | { type: 'overlap/accept'; keys: string[] }
  | { type: 'overlap/revoke'; key: string }
  /** Close the conflict prompt, keeping the change (the warning stays visible). */
  | { type: 'conflict/dismiss' }
  /** "Move it back": undo the change that raised the prompt. */
  | { type: 'conflict/revert' }
  /** Explain something to the user without changing the project. */
  | { type: 'notice/show'; message: string }
  | { type: 'history/undo' }
  | { type: 'history/redo' };

type EditAction = Exclude<
  EditorAction,
  { type: 'history/undo' | 'history/redo' | 'project/replace' | 'conflict/dismiss' | 'conflict/revert' | 'notice/show' }
>;

export function createEditorState(project: Project): EditorState {
  return { past: [], present: project, future: [], notice: null, prompt: null, lastMergeKey: null };
}

export function canUndo(state: EditorState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: EditorState): boolean {
  return state.future.length > 0;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'history/undo':
    case 'conflict/revert': {
      if (!canUndo(state)) return { ...state, prompt: null };
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
        notice: null,
        prompt: null,
        lastMergeKey: null,
      };
    }
    case 'history/redo': {
      if (!canRedo(state)) return state;
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
        notice: null,
        prompt: null,
        lastMergeKey: null,
      };
    }
    case 'conflict/dismiss':
      return state.prompt ? { ...state, prompt: null } : state;
    case 'notice/show':
      return { ...state, notice: { id: (state.notice?.id ?? 0) + 1, message: action.message } };
    case 'project/replace': {
      if (action.resetHistory) return createEditorState(action.project);
      return commit(state, action.project, { promptForConflicts: false });
    }
    default: {
      const result = applyEdit(state.present, action);
      if (typeof result === 'string') {
        return { ...state, notice: { id: (state.notice?.id ?? 0) + 1, message: result } };
      }
      const mergeKey = 'mergeKey' in action ? (action.mergeKey ?? null) : null;
      return commit(state, result, { promptForConflicts: true, mergeKey });
    }
  }
}

/**
 * Records a new project version (unless nothing changed). Also forgets accepted
 * overlaps that no longer exist — so if two pieces are moved apart and later
 * overlap again, the user is asked again — and raises a prompt for new conflicts.
 */
function commit(
  state: EditorState,
  next: Project,
  options: { promptForConflicts: boolean; mergeKey?: string | null },
): EditorState {
  if (next === state.present) return state;

  const after = findConflicts(next);
  const live = new Set(after.map((c) => c.key));
  const acceptedOverlaps = next.acceptedOverlaps.filter((key) => live.has(key));
  if (acceptedOverlaps.length !== next.acceptedOverlaps.length) next = { ...next, acceptedOverlaps };

  let prompt: ConflictPrompt | null = null;
  if (options.promptForConflicts) {
    const before = new Set(findConflicts(state.present).map((c) => c.key));
    const fresh = after.filter((c) => !c.accepted && !before.has(c.key));
    if (fresh.length > 0) prompt = { id: (state.prompt?.id ?? 0) + 1, conflicts: fresh, focusId: changedObjectId(state.present, next) };
  }

  const mergeKey = options.mergeKey ?? null;
  const merging = mergeKey !== null && mergeKey === state.lastMergeKey && state.past.length > 0;
  return {
    // When merging, the previous snapshot already marks the start of this gesture.
    past: merging ? state.past : [...state.past, state.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
    notice: null,
    prompt: merging && !prompt ? state.prompt : prompt,
    lastMergeKey: mergeKey,
  };
}

/**
 * Applies a single edit. Returns the new project, the same project if the edit
 * changed nothing, or an explanation string if the edit was rejected.
 */
function applyEdit(project: Project, action: EditAction): Project | string {
  switch (action.type) {
    case 'project/rename': {
      const name = action.name.trim() || 'Untitled room';
      return name === project.name ? project : { ...project, name };
    }

    case 'units/set':
      return action.units === project.units ? project : { ...project, units: action.units };

    case 'room/resize': {
      for (const value of [action.width, action.length]) {
        if (!Number.isFinite(value) || value < MIN_ROOM_SIZE || value > MAX_ROOM_SPAN) {
          return `Room dimensions must be between ${MIN_ROOM_SIZE} cm and ${MAX_ROOM_SPAN / 100} m.`;
        }
      }
      return roomEdit(project, resizeRectangle(project.room, roundLength(action.width), roundLength(action.length)));
    }

    case 'room/setHeight': {
      if (!Number.isFinite(action.height) || action.height < MIN_ROOM_SIZE || action.height > 2000) return `Ceiling height must be between ${MIN_ROOM_SIZE} cm and 20 m.`;
      return action.height === project.room.height ? project : { ...project, room: { ...project.room, height: roundLength(action.height) } };
    }

    case 'walls/moveNode':
      return roomEdit(project, moveNode(project.room, action.nodeId, { x: roundLength(action.to.x), y: roundLength(action.to.y) }));
    case 'walls/setLength':
      return roomEdit(project, setWallLength(project.room, action.wallId, action.length));
    case 'walls/setAngle':
      return roomEdit(project, setWallAngle(project.room, action.wallId, action.angle));
    case 'walls/setThickness':
      return roomEdit(project, setWallThickness(project.room, action.wallId, action.thickness));
    case 'walls/removeNode':
      return roomEdit(project, removeNode(project.room, action.nodeId));
    case 'walls/merge':
      return roomEdit(project, mergeWithNext(project.room, action.wallId));
    case 'walls/delete':
      return roomEdit(project, deleteWall(project.room, action.wallId, action.newPartitionId), 'reject');
    case 'walls/split':
      return splitWallEdit(project, action.wallId, action.distance, action.newId);
    case 'walls/replaceOutline':
      return roomEdit(project, { ...project.room, outline: normalizeOutline(action.nodes) });
    case 'walls/addPartition':
      return roomEdit(project, { ...project.room, partitions: [...project.room.partitions, action.partition] });

    case 'stairs/add': {
      const placed = clampStairToRoom(sanitizeStair(action.stair), project.room);
      if (!placed) return `“${action.stair.name}” doesn’t fit in this room.`;
      return { ...project, stairs: [...project.stairs, placed] };
    }

    case 'stairs/update': {
      const current = project.stairs.find((s) => s.id === action.id);
      if (!current) return project;
      const merged = sanitizeStair({ ...current, ...action.changes, id: current.id });
      if (merged.sections.length === 0) return 'A staircase needs at least one section.';
      const sizes = merged.sections.flatMap((s) => [s.length, s.width]);
      if (!sizes.every((v) => Number.isFinite(v) && v >= 10 && v <= 2000)) return 'Stair sections must be between 10 cm and 20 m.';
      if (![merged.x, merged.y, merged.rotation, merged.rise].every(Number.isFinite)) return 'Please enter a number.';
      const placed = clampStairToRoom(merged, project.room, { x: current.x, y: current.y });
      if (!placed) return `“${current.name}” wouldn’t fit in the room like that.`;
      return { ...project, stairs: project.stairs.map((s) => (s.id === current.id ? placed : s)) };
    }

    case 'stairs/delete': {
      if (!project.stairs.some((s) => s.id === action.id)) return project;
      return { ...project, stairs: project.stairs.filter((s) => s.id !== action.id) };
    }

    case 'floor/set': {
      const floor = { ...project.room.floor, ...action.floor };
      floor.scale = clampNumber(floor.scale, 0.25, 4);
      floor.intensity = clampNumber(floor.intensity, 0, 1);
      floor.angle = normalizeRotation(floor.angle);
      return { ...project, room: { ...project.room, floor } };
    }

    case 'furniture/add': {
      const placed = clampFurnitureToRoom(sanitizeFurniture(action.furniture), project.room);
      if (!placed) return `“${action.furniture.name}” is too big for this room.`;
      return { ...project, furniture: [...project.furniture, placed] };
    }

    case 'furniture/update': {
      const current = project.furniture.find((f) => f.id === action.id);
      if (!current) return project;
      const merged = sanitizeFurniture({ ...current, ...action.changes, id: current.id });
      if (![merged.x, merged.y, merged.rotation].every(Number.isFinite)) return 'Please enter a number.';
      const sizes = [merged.width, merged.depth, merged.height];
      // Rugs can be very thin, so height only needs to be positive.
      if (!sizes.every((size) => Number.isFinite(size)) || merged.width < MIN_FURNITURE_SIZE || merged.depth < MIN_FURNITURE_SIZE || merged.height <= 0) {
        return `Furniture must be at least ${MIN_FURNITURE_SIZE} cm wide and deep.`;
      }
      // Starting from where it last fitted lets it slide along walls instead of jumping.
      const placed = clampFurnitureToRoom(merged, project.room, { x: current.x, y: current.y });
      if (!placed) return `“${current.name}” wouldn't fit in the room like that.`;
      if (sameValues(placed, current)) return project;
      return { ...project, furniture: project.furniture.map((f) => (f.id === current.id ? placed : f)) };
    }

    case 'furniture/delete': {
      if (!project.furniture.some((f) => f.id === action.id)) return project;
      return { ...project, furniture: project.furniture.filter((f) => f.id !== action.id) };
    }

    case 'feature/add': {
      const result = placeFeature(sanitizeFeature(action.feature), project);
      if (typeof result === 'string') return result;
      return { ...project, features: [...project.features, result] };
    }

    case 'feature/update': {
      const current = project.features.find((f) => f.id === action.id);
      if (!current) return project;
      let merged: RoomFeature = { ...current, ...action.changes, id: current.id, kind: current.kind };
      // Changing a vent between wall / floor / ceiling changes how it is placed.
      merged = convertPlacement(merged, allowedPlacement(merged), project.room);
      const result = placeFeature(sanitizeFeature(merged), project);
      if (typeof result === 'string') return result;
      if (sameValues(result, current) && samePlacement(result.placement, current.placement)) return project;
      return { ...project, features: project.features.map((f) => (f.id === current.id ? result : f)) };
    }

    case 'feature/delete': {
      if (!project.features.some((f) => f.id === action.id)) return project;
      return { ...project, features: project.features.filter((f) => f.id !== action.id) };
    }

    case 'overlap/accept': {
      const keys = action.keys.filter((key) => !project.acceptedOverlaps.includes(key));
      if (keys.length === 0) return project;
      return { ...project, acceptedOverlaps: [...project.acceptedOverlaps, ...keys] };
    }

    case 'overlap/revoke': {
      if (!project.acceptedOverlaps.includes(action.key)) return project;
      return { ...project, acceptedOverlaps: project.acceptedOverlaps.filter((key) => key !== action.key) };
    }
  }
}

/** The furniture piece, feature or staircase that differs between two versions, if exactly one does. */
function changedObjectId(before: Project, after: Project): string | null {
  const previous = new Map<string, unknown>([...before.furniture, ...before.features, ...before.stairs].map((o) => [o.id, o]));
  const changed = [...after.furniture, ...after.features, ...after.stairs].filter((o) => previous.get(o.id) !== o);
  return changed.length === 1 ? changed[0].id : null;
}

/** Runs a wall edit and re-validates everything attached to the walls. */
function roomEdit(project: Project, result: Room | string, orphans: 'reattach' | 'reject' = 'reattach'): Project | string {
  if (typeof result === 'string') return result;
  return applyRoomChange(project, result, orphans);
}

/**
 * Splitting a wall: features beyond the split point move onto the new second half, so
 * they stay exactly where they were. A split can't go through a feature.
 */
function splitWallEdit(project: Project, wallId: string, distance: number, newId: string): Project | string {
  const result = splitWall(project.room, wallId, distance, newId);
  if (typeof result === 'string') return result;
  const blocking = project.features.find(
    (f) => f.placement.type === 'wall' && f.placement.wallId === wallId && Math.abs(f.placement.offset - distance) < f.width / 2,
  );
  if (blocking) return `The split point runs through “${blocking.name}”. Move it or split the wall somewhere else.`;
  const features = project.features.map((f) =>
    f.placement.type === 'wall' && f.placement.wallId === wallId && f.placement.offset > distance
      ? { ...f, placement: { ...f.placement, wallId: newId, offset: f.placement.offset - distance } }
      : f,
  );
  return applyRoomChange({ ...project, features }, result.room);
}

function sanitizeStair(stair: Staircase): Staircase {
  return {
    ...stair,
    name: stair.name.trim() || 'Stairs',
    x: roundLength(stair.x),
    y: roundLength(stair.y),
    rotation: roundLength(normalizeRotation(stair.rotation)),
    rise: Math.max(0, roundLength(stair.rise)),
    sections: stair.sections.map((s) => ({
      ...s,
      length: roundLength(s.length),
      width: roundLength(s.width),
      steps: s.kind === 'flight' ? Math.max(1, Math.round(s.steps)) : 0,
      turn: s.kind === 'landing' ? s.turn : 'straight',
    })),
  };
}

/** Validates a feature's numbers, keeps it inside the room, and stops openings overlapping. */
function placeFeature(feature: RoomFeature, project: Project): RoomFeature | string {
  const numbers = [feature.width, feature.depth, feature.height, feature.elevation, feature.clearance];
  if (!numbers.every(Number.isFinite)) return 'Please enter a number.';
  if (feature.width < MIN_FEATURE_SIZE) return `${feature.name} must be at least ${MIN_FEATURE_SIZE} cm wide.`;
  if (feature.depth < 0 || feature.height < 0 || feature.elevation < 0) return 'Sizes and heights can’t be negative.';
  if (feature.clearance < 0 || feature.clearance > MAX_CLEARANCE) {
    return `Clearance must be between 0 and ${MAX_CLEARANCE / 100} m.`;
  }
  if (feature.kind === 'column' && feature.shape === 'round') feature = { ...feature, depth: feature.width };

  if (feature.placement.type === 'wall' && !findSegment(project.room, feature.placement.wallId)) return 'That wall no longer exists.';
  const placed = clampFeatureToRoom(feature, project.room);
  if (!placed) return `“${feature.name}” is too big for that spot.`;
  const clash = findOverlappingOpening(placed, project.features);
  if (clash) return `“${placed.name}” would overlap “${clash.name}” on that wall.`;
  return placed;
}

/** Normalises rotation and rounds lengths so stored values stay tidy and comparable. */
function sanitizeFurniture(item: Furniture): Furniture {
  return {
    ...item,
    name: item.name.trim() || 'Untitled piece',
    x: roundLength(item.x),
    y: roundLength(item.y),
    width: roundLength(item.width),
    depth: roundLength(item.depth),
    height: roundLength(item.height),
    rotation: roundLength(normalizeRotation(item.rotation)),
  };
}

function sanitizeFeature(feature: RoomFeature): RoomFeature {
  const p = feature.placement;
  const placement: Placement =
    p.type === 'wall'
      ? { ...p, offset: roundLength(p.offset) }
      : { ...p, x: roundLength(p.x), y: roundLength(p.y), rotation: roundLength(normalizeRotation(p.rotation)) };
  return {
    ...feature,
    name: feature.name.trim() || 'Untitled feature',
    placement,
    width: roundLength(feature.width),
    depth: roundLength(feature.depth),
    height: roundLength(feature.height),
    elevation: roundLength(feature.elevation),
    clearance: roundLength(feature.clearance),
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : min;
}

/** Shallow comparison of every primitive field (placement is compared separately). */
function sameValues<T extends object>(a: T, b: T): boolean {
  return (Object.keys(a) as (keyof T)[]).every((key) => key === 'placement' || a[key] === b[key]);
}

function samePlacement(a: Placement, b: Placement): boolean {
  if (a.type === 'wall' && b.type === 'wall') return a.wallId === b.wallId && a.offset === b.offset;
  if (a.type === 'free' && b.type === 'free') return a.x === b.x && a.y === b.y && a.rotation === b.rotation;
  return false;
}
