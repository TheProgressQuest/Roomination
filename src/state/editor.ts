import {
  MAX_ROOM_SIZE,
  MIN_FURNITURE_SIZE,
  MIN_ROOM_SIZE,
  clampCenterToRoom,
  normalizeRotation,
  roundLength,
} from '../model/geometry';
import type { Furniture, Project, Room, UnitSystem } from '../model/types';

/**
 * The editor's state machine. Every change to a project goes through `editorReducer`,
 * which (1) validates it against the geometry rules and (2) records undo history.
 *
 * Undo works by keeping whole snapshots of the project: projects are small, and
 * snapshots can never get out of sync the way hand-written "reverse" operations can.
 */

const HISTORY_LIMIT = 100;

export interface Notice {
  /** Increments on every notice so the UI can tell two identical messages apart. */
  id: number;
  message: string;
}

export interface EditorState {
  past: Project[];
  present: Project;
  future: Project[];
  /** Explains the most recent rejected change, e.g. "Sofa wouldn't fit". */
  notice: Notice | null;
}

export type EditorAction =
  | { type: 'project/replace'; project: Project; resetHistory?: boolean }
  | { type: 'project/rename'; name: string }
  | { type: 'units/set'; units: UnitSystem }
  | { type: 'room/resize'; room: Partial<Room> }
  | { type: 'furniture/add'; furniture: Furniture }
  | { type: 'furniture/update'; id: string; changes: Partial<Omit<Furniture, 'id'>> }
  | { type: 'furniture/delete'; id: string }
  | { type: 'history/undo' }
  | { type: 'history/redo' };

export function createEditorState(project: Project): EditorState {
  return { past: [], present: project, future: [], notice: null };
}

export function canUndo(state: EditorState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: EditorState): boolean {
  return state.future.length > 0;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'history/undo': {
      if (!canUndo(state)) return state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
        notice: null,
      };
    }
    case 'history/redo': {
      if (!canRedo(state)) return state;
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
        notice: null,
      };
    }
    case 'project/replace': {
      if (action.resetHistory) return createEditorState(action.project);
      return commit(state, action.project);
    }
    default: {
      const result = applyEdit(state.present, action);
      if (typeof result === 'string') {
        return { ...state, notice: { id: (state.notice?.id ?? 0) + 1, message: result } };
      }
      return commit(state, result);
    }
  }
}

/** Records a new project version, unless nothing actually changed. */
function commit(state: EditorState, next: Project): EditorState {
  if (next === state.present) return state;
  return {
    past: [...state.past, state.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
    notice: null,
  };
}

/**
 * Applies a single edit. Returns the new project, the same project if the edit
 * changed nothing, or an explanation string if the edit was rejected.
 */
function applyEdit(
  project: Project,
  action: Exclude<EditorAction, { type: 'history/undo' | 'history/redo' | 'project/replace' }>,
): Project | string {
  switch (action.type) {
    case 'project/rename': {
      const name = action.name.trim() || 'Untitled room';
      return name === project.name ? project : { ...project, name };
    }

    case 'units/set':
      return action.units === project.units ? project : { ...project, units: action.units };

    case 'room/resize': {
      const room: Room = { ...project.room, ...action.room };
      for (const value of [room.width, room.length, room.height]) {
        if (!Number.isFinite(value) || value < MIN_ROOM_SIZE || value > MAX_ROOM_SIZE) {
          return `Room dimensions must be between ${MIN_ROOM_SIZE} cm and ${MAX_ROOM_SIZE / 100} m.`;
        }
      }
      if (sameRoom(room, project.room)) return project;
      // Shrinking the room nudges furniture inwards; pieces that can't fit block the change.
      const furniture: Furniture[] = [];
      for (const item of project.furniture) {
        const placed = clampCenterToRoom(item, room);
        if (!placed) return `“${item.name}” wouldn't fit in a room that size. Move or shrink it first.`;
        furniture.push(placed);
      }
      return { ...project, room, furniture };
    }

    case 'furniture/add': {
      const placed = clampCenterToRoom(sanitizeFurniture(action.furniture), project.room);
      if (!placed) return `“${action.furniture.name}” is too big for this room.`;
      return { ...project, furniture: [...project.furniture, placed] };
    }

    case 'furniture/update': {
      const current = project.furniture.find((f) => f.id === action.id);
      if (!current) return project;
      const merged = sanitizeFurniture({ ...current, ...action.changes, id: current.id });
      if (![merged.x, merged.y, merged.rotation].every(Number.isFinite)) return 'Please enter a number.';
      const sizes = [merged.width, merged.depth, merged.height];
      if (!sizes.every((size) => Number.isFinite(size) && size >= MIN_FURNITURE_SIZE)) {
        return `Furniture must be at least ${MIN_FURNITURE_SIZE} cm in every direction.`;
      }
      const placed = clampCenterToRoom(merged, project.room);
      if (!placed) return `“${current.name}” wouldn't fit in the room like that.`;
      if (sameFurniture(placed, current)) return project;
      return {
        ...project,
        furniture: project.furniture.map((f) => (f.id === current.id ? placed : f)),
      };
    }

    case 'furniture/delete': {
      if (!project.furniture.some((f) => f.id === action.id)) return project;
      return { ...project, furniture: project.furniture.filter((f) => f.id !== action.id) };
    }
  }
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

function sameRoom(a: Room, b: Room): boolean {
  return a.width === b.width && a.length === b.length && a.height === b.height;
}

function sameFurniture(a: Furniture, b: Furniture): boolean {
  return (Object.keys(a) as (keyof Furniture)[]).every((key) => a[key] === b[key]);
}
