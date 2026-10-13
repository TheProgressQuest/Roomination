import type Konva from 'konva';

/** Overlap state of an object on the plan. */
export type ConflictStatus = 'warning' | 'accepted' | undefined;

/** Pointer interactions shared by every draggable object on the plan. */
export interface InteractionProps {
  registerNode: (node: Konva.Group | null) => void;
  onSelect: () => void;
  /** Double-click / double-tap. */
  onOpenEditor: () => void;
  dragBound: (pos: Konva.Vector2d) => Konva.Vector2d;
  onDragMove: (node: Konva.Node) => void;
  onDragEnd: (node: Konva.Node) => void;
}

export function setCursor(e: Konva.KonvaEventObject<unknown>, cursor: string) {
  const container = e.target.getStage()?.container();
  if (container) container.style.cursor = cursor;
}

/** Konva event props that wire up `InteractionProps` on a draggable group. */
export function interactionEvents(props: InteractionProps, setHovered: (hovered: boolean) => void) {
  return {
    draggable: true,
    dragBoundFunc: props.dragBound,
    onMouseDown: props.onSelect,
    onTouchStart: props.onSelect,
    onDblClick: props.onOpenEditor,
    onDblTap: props.onOpenEditor,
    onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => {
      setHovered(true);
      setCursor(e, 'grab');
    },
    onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => {
      setHovered(false);
      setCursor(e, '');
    },
    onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => setCursor(e, 'grabbing'),
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => props.onDragMove(e.currentTarget),
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      setCursor(e, 'grab');
      props.onDragEnd(e.currentTarget);
    },
  };
}
