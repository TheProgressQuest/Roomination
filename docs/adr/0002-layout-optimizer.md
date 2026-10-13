# ADR-0002: Layout optimizer

**Status:** Accepted
**Date:** 2026-10-13
**Deciders:** The Progress Quest

## Context

Phase 3A adds **Optimize Layout**: given a room, its fixed architecture and its furniture, suggest
several practical, explainable arrangements. It must:

- run entirely in the browser (no cloud services, works on GitHub Pages);
- never break physical constraints;
- respect locks and user-approved exceptions;
- be reproducible;
- work on phones.

### What already existed and is reused

| Need | Existing code reused |
| --- | --- |
| Inside the real (possibly concave) room | `convexInsidePolygon`, `outlinePolygon` (ADR-0001) |
| Collisions, door swings, vents, outlets, radiators, columns, stairs, interior walls | `findConflicts` / `obstacles` / `featureZones` |
| Wall shapes, stair shapes | `wallBodies`, `stairPolygons`, `layoutStair` |
| Walls, windows, outlets as reference points | `wallSegments`, `featureFrame` |
| Validated, migrated storage | `parseProject` (schema v4 adds the new fields) |
| Undo/redo | Applying a layout is a single `layout/apply` action in `editorReducer` |

The optimizer never re-implements a constraint. "Does this overlap?" is always answered by
`findConflicts`, so the optimizer and the editor's warnings can't disagree.

## Decision

### Hard constraints vs. soft scores

**Hard** constraints: a layout that breaks any of these for a piece it moved is rejected, and no
weighting can trade them away.

- The piece must be fully inside the room outline (concave rooms included).
- No collision with other furniture, walls (including interior walls), columns or radiator
  bodies (`findConflicts` type `collision`).
- Nothing on a staircase.
- Nothing in a door's swing or walkway.

User-approved overlaps cover only the exact positions they were approved for. Once the optimizer
moves either piece, the overlap counts again.

**Soft** measures make up the score. Each is between 0 and 1 and is reported with the
measurement behind it.

| Group | Measure (weight) | How it's measured |
| --- | --- | --- |
| Functional | Doors and stairs reachable (3) | Flood fill on a walkway-width grid from the first door |
| | Walkable floor (2) | Share of open floor within half a walkway of a reachable standing spot |
| | No narrow squeezes (1) | Floor reachable only at 60% of the walkway width |
| | No cut-off corners (1) | Floor unreachable even when squeezing |
| | Furniture is usable (2) | The side you use (front, sides for beds/tables) is reachable |
| | Vents, outlets and radiators clear (2) | Coverage of their zones, from `findConflicts` |
| Aesthetic (subjective) | Lined up with the walls (2) | Angle to the nearest wall direction |
| | TVs, shelves, storage and beds against walls (2) | Back edge within 5–40 cm of a wall, parallel to it |
| | Tidy spacing (1.5) | No awkward 3–25 cm gaps to walls or unrelated pieces |
| | Visual balance (1) | Furniture's centre of mass vs the room's centre |
| | Seating and TV face each other (1.5) | Facing angle (only if there's seating and a TV or coffee table) |
| | Symmetry around the TV (1) | Seating area left vs right of the TV's centre line |
| Preferences | Your preferences and relationships (1) | Mean satisfaction of each chosen preference and relationship |

- **Group scores:** each group score is the weighted mean of its measures, scaled to 0–100.
- **Overall:** `w·Functional + (1 − w)·Aesthetic`.
  - The weight `w` is 0.9 in Functional mode, 0.2 in Aesthetic mode, and the slider value in
    Balanced mode.
  - When the user has set any preferences or relationships, overall instead becomes 70% of
    that blend plus 30% Preferences.

### Walking-space model

Empty area alone is misleading: a room can be half empty yet have a door cut off. So:

1. The room is rasterised into about 2,600 square cells.
2. A chamfer distance transform measures each cell's clearance.
3. A person of the chosen walkway width can stand where the clearance is at least half that
   width.
4. A flood fill from the first door finds what's reachable: other doors, the foot of each
   staircase, and each piece's usable side.

Narrow squeezes and enclosed pockets are measured by repeating the flood fill at 60% of the width.
The walkway width is a comfort preference, not a building standard.

### Search: greedy construction plus simulated annealing

1. **Construction.** Pieces are placed one by one:
   - anchors before the pieces related to them (a desk before its chair, a TV before the sofa
     that faces it), then larger pieces first;
   - each piece takes the best-scoring of a few dozen candidate spots: backs against walls
     (including both sides of interior walls), in front of / beside / near related pieces, and
     seeded random spots on open floor turned square to the walls.
2. **Annealing.** Moves are random shifts (large early, small late), quarter turns, relocations
   to candidate spots, and swaps of similar-sized pieces.
   - Every move must pass the hard constraints before it's scored.
   - Worse layouts are sometimes accepted early on, so the search can escape dead ends.
   - The temperature falls over a **fixed number of steps**.
3. **Profiles.** Runs use the user's emphasis plus contrasting ones (Most functional,
   Balanced, Most aesthetic), with 1–3 restarts depending on effort. When the current layout is
   valid, the first run of each profile starts from it, so a suggestion is never worse than the
   current layout for that emphasis.
4. **Distinct suggestions.** Two layouts count as different only if pieces moved on average at
   least 30 cm (or 8% of the room's size), or a third of the pieces changed direction. If fewer
   than three distinct layouts exist, fewer are returned, with an explanation.
5. **Explanations.**
   - Every sentence comes from a measured before/after difference above a threshold (e.g.
     0.3 m² of walkable floor, 40 cm closer to an outlet).
   - Trade-offs come from the same comparison in the other direction.
   - Locked pieces are listed as kept in place.

**Reproducibility:** a seeded generator (mulberry32) and fixed step counts mean the same project,
settings and seed always give the same result. Results are never time-based.
`ALGORITHM_VERSION` is reported with each result.

**Off the main thread:** the optimizer runs in a bundled Web Worker. Progress is reported every
100 steps, and Cancel terminates the worker. The user's project is only ever changed by an
explicit **Apply layout**, which is one undo step.

## Options considered

| Option | Quality | Speed | Maintainability | Verdict |
| --- | --- | --- | --- | --- |
| Pure random search + scoring | Low (rarely finds good packings) | Fast | Simple | Rejected |
| Constraint solver (CSP/ILP) | High for hard rules | Hard to bound in a browser; needs a library | Complex | Rejected |
| Genetic algorithm | Good | Many evaluations per generation; heavier on phones | Medium | Not needed |
| **Greedy construction + simulated annealing** | Good, especially with relationship-aware candidates | Bounded, tunable steps (0.1–5 s) | Small, readable | **Chosen** |

## Measured performance (Node, Apple Silicon laptop)

| Room | Movable pieces | Quick | Standard | Thorough |
| --- | --- | --- | --- | --- |
| Small bedroom | 5 | 0.18 s | 0.63 s | 1.9 s |
| Large living room | 11 | 0.40 s | 1.69 s | 5.2 s |
| L-shaped studio | 6 | 0.20 s | 0.87 s | 2.7 s |
| Three doors | 4 | 0.12 s | 0.66 s | 2.3 s |
| With stairs | 3 | 0.12 s | 0.66 s | 2.2 s |
| Several locked pieces | 8 | 0.37 s | 1.68 s | 5.5 s |
| Overcrowded (infeasible) | 5 | 5 ms | 10 ms | 16 ms |

One full layout evaluation (circulation, conflicts, scoring) takes about 0.25 ms for the sample room.
In the browser's worker, Standard on the sample room took about 1.3 s.

## Consequences

**Easier:**
- adding new measures (one function plus a weight);
- reusing the walking-space grid for a future 3D walk-through, or for highlighting tight spots
  on the plan.

**Limits:**
- Candidate rotations are square to walls. Arbitrary angles are only kept for pieces that don't
  move.
- Rugs aren't arranged unless the user includes them, and nothing aligns them with the furniture
  above them.
- Aesthetic measures encode common conventions and are a matter of taste.
- The optimizer doesn't add, remove or resize furniture.

**Revisit:** larger rooms (30+ movable pieces) take proportionally longer. Incremental conflict
updates would be the next optimisation if that becomes common.
