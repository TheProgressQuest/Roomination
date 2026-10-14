# ADR-0005: TPQ redesign, Shape Builder, optimizer audit and Feng Shui

**Status:** Accepted
**Date:** 2026-10-13
**Deciders:** The Progress Quest

## Context

Phase 4 asks for five things:
- the Savage Ultramarine identity, replacing the brown and beige look;
- simpler navigation;
- a Shape Builder that combines basic shapes;
- an optimizer whose suggestions make practical sense;
- an optional Feng Shui mode with a Bagua map.

## 1. Brand and design tokens

- **The brand colour:** the Brand Foundation names *Savage Ultramarine*, but neither it nor the
  Brand Deck gives a value. The deck only uses slate `#345161`, pale blue `#DCEBFF` and the
  blue-blacks `#141A24`, `#0C1018` and `#0A0E14`. When asked, the creator chose
  **`#1F2BD6`**.
- **Usage:** following the brand guidance ("a quest marker… not loud"), ultramarine marks
  selection, active controls, focus, navigation and the primary action. It is not used for
  every surface.
- **Light theme:** cool near-white neutrals.
- **Dark theme:** the deck's blue-blacks. On dark surfaces the accent is lightened to keep
  contrast.
- **Tokens:** all colours live as CSS custom properties, in one place in `styles.css`. Canvas
  colours read the same values through `render/palette.ts`.
- **Contrast (measured):** body text 16–17:1; muted text ≥ 5.9:1; ultramarine on white 8.8:1
  (dark theme: 6.5:1); white on ultramarine 8.8:1. Text-field and menu edges use a separate
  `--field-border` token at ≥ 3:1 (WCAG 1.4.11); decorative dividers stay lighter.
- **Type:** the system font (it's tuned for legibility on each platform), replacing the rounded
  face of the earlier look.
- **Room materials:** furniture colours, floors, walls and board styles are the person's own and
  are never changed by the theme.

## 2. Navigation

- **Tabs:** the tools panel becomes four tabs, each showing simple controls first and advanced
  ones folded:
  - **Build:** room, walls, doors and windows, stairs, features;
  - **Furnish:** standard furniture, custom furniture, Shape Builder, photos, library;
  - **Design:** floor, walls and the board around the room (3D options stay in the 3D view's own
    toolbar, where their effect is visible);
  - **Optimize:** the room's purpose, a button for the optimizer (modes, weights and pairings live
    in its dialog), Feng Shui and the Bagua map.
- **Remembered:** the last tab is kept in `localStorage` (a convenience only; Build if storage is
  blocked).
- **Checks badge:** the Furnish tab shows how many overlaps are open, so problems aren't hidden by
  the tabs.
- **Unchanged:** the 2D/3D switch stays above the canvas.
- **Keyboard:** tabs follow the ARIA tabs pattern (arrow keys).
- **Phones:** the same tabs sit above the panel, below the plan.

## 3. Shape Builder

### Shapes

- **Shapes that can have holes:** a piece's outline gains optional `holes` and `islands`.
  `points` stays the main outer ring, so older code and files are unaffected. An island is a
  separate outline with its own holes, for grouped pieces that don't touch.
- **The footprint:** `localFootprint` triangulates rings with holes using **earcut** (ISC,
  3 KB), then merges triangles into convex pieces as before. Because those pieces tile the
  solid area exactly:
  - collisions and room fit stay exact;
  - holes are free space (a chair can stand in the middle of a ring-shaped bench).
- **Drawing:** 2D draws the rings with the even-odd rule. 3D extrudes them with their holes.

### Building blocks

- **Shape kinds:** rectangle, square, circle, ellipse, triangle, regular polygon, curved section
  (a band of a ring, up to a full ring with a hole), and outlines drawn in the studio (an existing
  drawn outline opens in the builder as one part; a plain rectangle opens as a rectangle).
- **Curves stay curves:** a circle and an ellipse are four cubic Bézier curves, so they stay
  truly round (flattened to within 0.5 cm, like every curve).

### Operations

- **Group:** keeps parts separate but moves them as one.
- **Merge (union):** joins parts into one footprint.
- **Subtract:** removes one shape from another.
- **Intersect:** keeps only the shared area.
- **Separate:** undoes a group or merge.
- **Library:** the boolean maths is done by **polygon-clipping** (MIT, Martinez–Rueda with
  robust predicates). It loads only inside the builder: results are stored as plain outlines,
  so nothing else needs it.
- **Editable sources:** the builder's tree of shapes and operations is saved with the piece
  (`shape.source`), so a merged sofa can be reopened and its parts moved or resized. The saved
  outline is always recomputed from that tree, never edited separately.

## 4. Optimizer audit (before any fix)

- **Method:** ten realistic scenarios (`optimizer/scenarios.ts`), with no hand-drawn
  relationships, as in most people's projects. The Standard search was run on each, and every
  suggestion was checked with `practical.ts`.
- **What it found:** **every suggestion scored 97–100, yet there were 27 practical problems**:

| Problem | Count | Example |
| --- | --- | --- |
| Related pieces far apart | 19 | bedside tables up to 145 cm from the bed; a desk chair 452 cm from the desk; a coffee table 209 cm from the sofa |
| Facing something too close | 6 | a TV 74 cm from an obstacle; a sofa with 43 cm of legroom |
| Cramped desk | 1 | 2 cm to pull the chair out |
| Blocked bed side | 1 | one side 2 cm from the wall |

### Causes

- **Incomplete furniture semantics:** without hand-drawn relationships, the optimizer didn't
  know that a chair goes with a desk, a sofa with the TV, or a bedside table with the bed.
- **Missing constraints:**
  - nothing measured the space in front of a piece;
  - a chair counted as "usable" from any side;
  - bed sides were checked only when the person had asked for it.
- **Scoring weights:** sofa → TV orientation counted only as *appearance*, which Functional
  mode almost ignores. The scores saturated, so the search couldn't tell a good layout from a
  bad one.
- **Not at fault:**
  - geometry (collisions, room fit);
  - the search itself (construction followed by simulated annealing).

### Fixes

- **Assumed pairings** (`semantics.ts`):
  - desk ↔ nearest chair;
  - seating → TV;
  - coffee table in front of the main sofa;
  - bedside tables beside the bed;
  - dining chairs around the table.

  They're shown in the interface, can be switched off, and never override a relationship the
  person drew. They're worked out once per run, from the starting layout.
- **Practical measurements:**
  - space in front of each piece: legroom 45 cm, desk chair pull-out 75 cm, storage doors
    60 cm, TV viewing 120 cm;
  - space beside double beds;
  - walking detours: Dijkstra walking distances against the same walks with no movable
    furniture.
- **Practicality applies in every mode:** the overall score is multiplied by ×0.5 (thoroughly
  impractical) up to ×1 (practical). Looks or Feng Shui can never excuse a chair facing a
  wall.
- **Candidates:** the search now also tries a "commanding" desk position (out from the wall,
  with the person's back to it), and uses pairings for placement order and positions.
- **Bugs found and fixed:**
  - rays starting flush against a wall missed it, so the space measured as unlimited;
  - 32-bit walking distances compared against 64-bit ones made the shortest-path search loop
    (one evaluation took 9 s).
- **After the fixes:** **0 practical problems across all 30 suggestions**, with about 0.5 ms
  per evaluation. The scenario tests keep it that way.

## 5. Modes and weights

- **Modes:** Functional (85/15/0), Aesthetic (30/70/0), Balanced (the existing slider), Feng
  Shui (45/15/40, only when Feng Shui is switched on) and Custom (the person's percentages,
  rescaled to add up to 100). The figures are function / appearance / Feng Shui.
- **Formula:** overall = 70% × the weighted blend + 30% × the person's own preferences, then
  scaled by practicality.
- **Hard rules:** never part of any weighting. A layout that breaks them is rejected.
- **Purpose:** the room purpose (guessed from the furniture, and changeable) chooses which pieces
  the commanding position applies to, and which Feng Shui principles apply.

## 6. Feng Shui / Harmony (optional, interpretive)

- **Commanding position:** for beds, desks and the main seating, measured from the
  *occupant*: where they sit and which way they look, not the furniture's centre.
  - **Sees the entrance:** the angle between their gaze and the door. Full credit within 80°,
    none beyond 135°.
  - **Not in line with the doorway:** they shouldn't sit in the doorway's straight-ahead
    corridor.
  - **Support:** a wall behind them (for a bed, the headboard), reduced when there's a window
    behind the bed.
- **Bedroom:**
  - room on both sides of a double bed;
  - balance from bedside tables on both sides.
- **Office:** an uncramped workspace, measured as clear space behind the seated person.
- **Living room:**
  - conversational seating, turned towards each other within a sociable distance;
  - an open entrance.
- **Flow:** reachable floor and walking directness, explained as a *practical approximation* of
  the openness some approaches emphasise. No physical "energy" is invented.
- **Language:** all of it is labelled as interpretive preference. No claims about luck, health
  or wealth.

## 7. Bagua map (optional)

- **The two traditions are kept separate:**
  - **Entrance (Western / BTB):** a 3×3 grid over the room's bounds, aligned to the wall with
    the main entrance. The entrance wall is the "front" row.
  - **Compass (classical):** eight directional sectors around the room's centre. This needs the
    room's real north bearing, typed in by the person. It's never inferred from the screen, and
    device sensors and location are never used.
- **Overlay:** a semi-transparent layer under the furniture, so it never captures clicks or
  drags.
- **Explanations:** each area has a short label and explanation, presented as educational and
  interpretive.

## 8. Verification

- **Unit tests:** holes (area, a stool inside a ring bench, overlapping holes refused, save and
  load, damaged recipes dropped, 3D extrusion with inward-facing hole walls, round circles), the
  builder's recipes (every shape, merge, cut, overlap, group, separate, transforms, curved sections),
  the Bagua map in both traditions, custom-weight rebalancing, and the ten optimizer scenarios.
- **Browser tests:** tabs with the keyboard, brand colours, Feng Shui and the Bagua overlay (it
  tints the floor and never blocks selecting furniture), the compass bearing, optimizer modes and
  the before/after table, the Shape Builder end to end (including reopening a saved recipe), holes
  and round shapes in the real 3D view, and every tab and dialog at 320, 375, 430, 768, 1024 and
  1440 px wide.
- **Bundle:** the main bundle is unchanged in size (about 836 kB, 258 kB gzipped); polygon-clipping
  is only in the lazy Shape Builder chunk (50 kB).

## Consequences

- **Easier:**
  - suggestions now make practical sense without the person drawing relationships;
  - round and composite furniture is first-class.
- **Harder:**
  - the save format is version 7 (Feng Shui settings, optimizer weights and purpose, shape
    holes and sources);
  - two small, permissively licensed libraries are added (earcut in the main app,
    polygon-clipping inside the builder only).
- **Limits:**
  - pairings are assumptions;
  - Feng Shui traditions vary more than any one scoring can capture;
  - the optimizer considers rotations square to the walls only.
