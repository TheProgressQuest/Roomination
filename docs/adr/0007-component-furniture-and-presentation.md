# ADR-0007: Component-built furniture, and a more architectural presentation plan

**Status:** Accepted
**Date:** 2026-10-14
**Deciders:** The Progress Quest

## Context

A drawn custom outline was shown as a block: an irregular loveseat became a prism with
cushion-coloured sides. People need to build recognisable furniture of their own, with real
measurements, without modelling software, and see it the same way in the 2D presentation
plan and in 3D. Separately, the presentation plan still looked noticeably less polished than
professional architectural renderings.

Constraints are unchanged: everything local, no external services, GitHub Pages, the
technical plan exact and WebGL-free, and the first load kept light.

## Decision

### 1. Components on top of the footprint

A piece may carry `components` (base, seat, backrest, armrest, cushion, pillow, headrest,
leg, foot, tabletop, shelf, drawer, door, support, detail, custom, group). Each has a
position, size, elevation, turn, lean, shape, edge style, material, finish, roughness,
texture scale, fabric pattern, seams, and lock/hide flags. A component may have a parent, and
then moves and turns with it.

**The footprint stays the source of truth for collisions and the optimizer.** Components only
decide how the piece looks. Any that reach outside the footprint or below the floor are
listed in the builder. Nothing is fixed silently; a plain footprint can be grown to fit when
the person asks.

Shapes:
- box, cylinder or ellipse, soft round, polygon, curved panel;
- **edge**: a band following one or more footprint edges (backrests, arms), mitred where two
  sections meet;
- **footprint**: the footprint inset, minus chosen components, optionally split into
  cushions.

Edge and footprint components are recomputed from the footprint whenever it changes. So a
template rebuilds itself to the person's own measurements.

### 2. Geometry only where it's needed

Bands, insets and cuts need polygon clipping. They are computed in the lazily loaded builder
(`builder/componentGeometry.ts`, using the existing polygon-clipping dependency) and stored as
outlines. The plan and the 3D view draw stored outlines, with no geometry library in the main
bundle. Offsets are built directly (mitred, bevelled when sharp); polygon-clipping only cuts a
few simple shapes, and retries on a coarser grid if its arithmetic fails.

### 3. One new part shape for both renderers

Components become the shared `FurniturePart`s from ADR-0006, with one new shape: **prism**,
an upright extrusion of an outline.
- **3D:** `ExtrudeGeometry` with a rounded or chamfered bevel pulled inside the outline
  (`bevelOffset = −radius`), so nothing grows past its measured size.
- **2D:** the outline with rounded corners.

Per-part look overrides (pattern, texture scale, roughness, finish) extend the 3D material
batch key.

### 4. Presentation plan

Changes, from the comparison with a professional rendering:
- **Crease shadows:** each part casts a soft shadow onto the parts painted beneath it.
- **Domed upholstery:** a blurred darkening along each part's own outline, with a faint
  highlight on the lit edge. This replaces the centred radial "puff".
- Single soft seam lines; rounded prism corners.
- Windows drawn as glazing in the wall, brass door leaves with a thin solid swing, white
  radiator panels.
- Softer rug borders; a clean board unless Grid is on.

### 5. Top-down WebGL rendering: evaluated, not adopted

A prototype rendered each piece from above with an orthographic Three.js camera and the 3D
view's lights and materials.
- **Strength:** real self-shadowing.
- **Weaknesses:**
  - flat top surfaces (straight-down light);
  - slightly shifted colours;
  - hidden parts (a TV's stand) showing as black blocks;
  - every 2D plan would need Three.js (~163 kB gzipped) and a GPU context;
  - the editor depends on WebGL, against the requirements.

The Canvas painter now reproduces the main benefit (crease shadows) without any of that. The
prototype was removed; it could return as an opt-in High-quality export path.

### Materials

Cotton (twill), linen and velvet join the selectable materials. Woven patterns (stripes,
check, herringbone, bouclé) are drawn into the shared procedural tiles. Older versions read
the new materials as "custom". The schema version is unchanged: components are an optional
field that older versions ignore.

## Consequences

- **Easier:** recognisable custom furniture from measurements; templates that adapt to any
  footprint; the same object in 2D and 3D.
- **Harder:** a second, larger editor to maintain. Stored outlines can go stale if a
  footprint is changed outside the app's own flows; reopening the builder recomputes them.
- **Limits:**
  - components are rigid shapes, not soft-body upholstery;
  - nested children of a turned parent stretch approximately when a piece is resized;
  - photos stay piece-level, not per-component;
  - kitchens, bathrooms and appliances are still not modelled.
