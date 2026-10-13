# ADR-0001: Polygon rooms, wall segments and staircases

**Status:** Accepted
**Date:** 2026-10-12
**Deciders:** The Progress Quest

## Context

Phases 1–2 modelled a room as a `width × length` rectangle. Its four walls were implicit names
(`'top' | 'right' | 'bottom' | 'left'`), and wall features stored `{ wall, offset }`. Everything
downstream assumed this:

| Concern | Phase 2 representation |
| --- | --- |
| Room | `Room { width, length, height, floor }` |
| Walls | Implicit; one per rectangle side, drawn outside the interior |
| Wall features | `WallPlacement { wall: 'top'…, offset }`, with a local frame from `WALL_ANGLE` |
| Furniture constraint | `clampCenterToRoom`: rotated bounding box clamped to the rectangle |
| Collisions | Convex polygon clipping (Sutherland–Hodgman); furniture vs furniture and feature zones |
| Saving | IndexedDB records validated by `parseProject`, schema v2, migrating v1 |
| Undo/redo | Whole-project snapshots in `editorReducer` |
| Rendering | Konva: a floor `Rect`, four wall rectangles with gaps for openings, local-frame symbols |

Phase 2.5 needs irregular rooms (L, U, alcoves, any simple polygon), editable wall segments,
interior partitions, and staircases. All existing projects must keep working.

## Decision

### 1. The room outline is a closed chain of wall nodes (schema v3)

```ts
interface WallNode { id: string; x: number; y: number; thickness: number }
interface Partition { id: string; nodes: WallNode[] }           // open chain
interface Room {
  outline: WallNode[];      // closed, clockwise on screen; ≥ 3 nodes
  partitions: Partition[];  // freestanding interior walls
  height: number;
  floor: FloorStyle;
}
```

- **Wall segment *i*** runs from node *i* to node *i+1* (wrapping for the outline). **Its id is
  the start node's id**, and `thickness` belongs to that segment.
- Consecutive segments share a node, so **moving a vertex moves both walls, which stay
  connected** by construction. No separate "connections" table can drift out of sync.
- The outline is stored clockwise, so the right-hand normal of every segment points into the
  room. This matches the Phase 2 local frame exactly: x runs along the wall and y points into
  the room. **All door, window, swing and clearance geometry is reused unchanged**; only the
  frame's origin and angle are now computed from the segment.
- **Split wall / add vertex** inserts a node. **Remove vertex / merge walls** deletes one.
  Features on affected segments are re-attached by projecting their world position onto the
  new segment.

### 2. Wall features attach to a segment id

`WallPlacement` becomes `{ type: 'wall', wallId, offset }`, where `offset` is the distance from
the segment's start node to the feature's centre. When a wall moves, the feature keeps its
`(wallId, offset)`, so it moves and rotates with the wall. Door arcs follow automatically
because they're drawn in the wall's frame.

If an edit would leave a wall shorter than a feature on it, the reducer **rejects the edit with
an explanation**. Nothing is deleted or moved off the wall silently.

### 3. Furniture is constrained by the real polygon

- **Containment:** a rotated rectangle is inside the room when its area clipped by the room
  polygon equals its own area. Sutherland–Hodgman accepts a concave subject polygon when the
  clip polygon is convex, so the existing clipper can be reused.
- **Resolution:** a rejected position becomes the nearest valid one.
  - **Dragging:** try the target, then slide along each axis, then binary-search back towards
    the last valid point. Cheap enough to run on every pointer move.
  - **Typed values or rotation:** clamp to the bounding box first, then search outwards in a
    spiral for the nearest valid centre. If none exists, the change is refused with a message.
- For rectangles this gives exactly Phase 1's minimal-move behaviour, so the existing tests
  still apply.
- Partitions and staircases are solid zones in the **existing conflict system** (warning plus
  per-pair override), not hard constraints.

### 4. Staircases are a new object type made of chained sections

```ts
interface StairSection { id; kind: 'flight' | 'landing'; length; width; steps; turn: 'straight' | 'left' | 'right' }
interface Staircase { id; name; x; y; rotation; direction: 'up' | 'down'; rise; sections: StairSection[] }
```

- **Layout:** each section is a rectangle laid out from the previous section's exit.
  - Landings may turn 90° left or right.
  - An **L stair** is flight → turning landing → flight.
  - A **U stair** is flight → landing (turn) → landing (turn) → flight.
  - **Custom** is any sequence.
- **Footprint:** the union of convex section rectangles, so collision code needs no new
  algorithm.
- **Validation:** overlapping sections make an "impossible configuration". The editor shows a
  warning instead of failing.
- Stairs are positioned by their footprint's centre and rotate like furniture.

### 5. Schema v3 migration

`parseProject` accepts v1, v2 and v3. A v1/v2 rectangle becomes a 4-node outline
`(0,0) → (W,0) → (W,L) → (0,L)`, with node ids `wall-top`, `wall-right`, `wall-bottom` and
`wall-left`. Legacy `{ wall, offset }` placements are converted to `{ wallId, offset }`. The
bottom and left walls run backwards in the new model, so their offsets become
`length − offset`.

## Options considered

### A. Closed node chain plus open partition chains (chosen)

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium |
| Connectivity guarantees | Structural: segments share nodes |
| Migration | Simple, lossless |
| Rendering | Straightforward: miter-joined quads per segment |

**Pros:** connected walls can never disconnect, and stable segment ids give features something to
attach to. Polygon algorithms apply directly to the outline.
**Cons:** partitions can't form a general graph (for example, a T-junction is two chains that
merely touch).

### B. General wall graph (nodes and edges, rooms detected as faces)

| Dimension | Assessment |
| --- | --- |
| Complexity | High (face detection, multiple rooms) |
| Connectivity guarantees | Structural |
| Migration | Simple |

**Pros:** supports multi-room floors.
**Cons:** much more code and many more failure modes. Roomination plans one room per project, so
this is premature.

### C. Keep the rectangle and add "cut-outs"

**Pros:** smallest change.
**Cons:** can't express angled walls or arbitrary polygons, and every new feature would need
special cases.

## Consequences

- **Easier:** irregular rooms, per-wall editing, walls that features follow, and a future
  3D extrusion (each segment becomes a wall slab, and the outline becomes the floor).
- **Harder:** furniture containment is no longer a cheap clamp (mitigated by the search
  strategies above). Width/length fields only make sense for rectangular rooms; other shapes
  are edited wall by wall.
- **Revisit:** multi-room floor plans would require option B.

## Action items

1. Polygon utilities: orientation, point-in-polygon, segment intersection, simple-polygon
   check, containment and nearest-valid search.
2. Schema v3 types, migration and validation, plus wall-segment helpers.
3. Reducer actions: vertex move, wall length/angle/thickness, split, remove vertex, merge,
   delete, replace outline, partitions, stairs.
4. Rendering: polygon floor (textures stay anchored to room coordinates), mitered walls with
   openings, partitions, vertex handles, per-wall length labels.
5. Draw Walls tool with snapping (endpoints, walls, grid, alignment, angles), usable by
   keyboard and touch.
6. Stairs model, symbols (treads, arrow, UP/DN, landings) and editor.
