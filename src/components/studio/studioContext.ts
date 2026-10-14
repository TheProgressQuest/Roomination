import { createContext, useContext } from 'react';
import type { ShapeTemplate } from '../../model/shape';

/** What the furniture studio is opened for. */
export type StudioRequest =
  /** Draw a new piece, optionally starting from a template. */
  | { mode: 'new'; template?: ShapeTemplate }
  /** Edit the shape and look of a piece already in the room (optionally straight in the Shape Builder). */
  | { mode: 'edit'; furnitureId: string; builder?: boolean }
  /** Build a new piece from basic shapes in the Shape Builder. */
  | { mode: 'builder' }
  /** Edit (or place) a saved library item. */
  | { mode: 'library'; libraryId: string }
  /** Start from photographs. */
  | { mode: 'photos' };

export const StudioContext = createContext<(request: StudioRequest) => void>(() => {});

export const useOpenStudio = () => useContext(StudioContext);
