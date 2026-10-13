/**
 * What the user has selected. Furniture, room features and staircases share one id
 * space ("object"); walls and corners are selected separately because a wall segment's
 * id is the id of its start corner.
 */
export type Selection = { kind: 'object'; id: string } | { kind: 'wall'; id: string } | { kind: 'corner'; id: string } | null;

export type ToolMode = 'select' | 'drawRoom' | 'drawWall';

export const objectId = (selection: Selection): string | null => (selection?.kind === 'object' ? selection.id : null);
