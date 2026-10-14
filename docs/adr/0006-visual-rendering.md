# ADR-0006: One furniture model for 2D and 3D, presentation plan and image export

**Status:** Accepted
**Date:** 2026-10-14
**Deciders:** The Progress Quest

## Context

Phase 5 asks for architectural-quality visuals, similar to an illustrated reference floor plan,
in both views:
- furniture that is recognisable (cushions, bedding, shelves, leaves), not coloured blocks;
- natural materials, soft shadows, and refined floors;
- an optional illustrated 2D plan that keeps the precise technical one;
- PNG export.

All of this must stay dimensionally exact, local, light enough for phones, and GitHub
Pages-compatible.

## Decision

### 1. One parts model, two renderers

`render/furnitureParts.ts` describes each piece as **parts** in its own frame:
- **Shapes:** rounded box, cylinder, cone, ellipsoid or leaf.
- **Role:** cushion, pillow, duvet, shelf, book, door, handle, leaf…
- **Surface:** the piece's own material, or a fixed one such as linen bedding, a brass handle or a
  ceramic pot.

The pieces covered:
- **Seating:** sofas (arms, back, seat and back cushions, accent pillows, legs), armchairs,
  dining chairs, office chairs (five-star base).
- **Beds:** frame, headboard, mattress, duvet, throw, pillows.
- **Tables:** tables (top, legs, coffee-table shelf), desks (drawer pedestal).
- **Storage:** bookshelves (shelves, varied books), cabinets, wardrobes, bedside tables (doors,
  drawers, handles), TV units and screens.
- **Décor:** plants (pot, soil, tiers of tilted leaves), floor lamps, vases, rugs.

**The rule:** every part, including its rounding, turn and tilt, stays inside the piece's real
width × depth × height. A test checks every kind at five scales. So nothing looks bigger than the
plan and collision checks say. Pieces smaller than 15 cm fall back to a single rounded block.

Both views use these parts:
- **3D** (`scene3d/three/furnitureLayer.ts`):
  - parts become geometry (`partGeometry.ts`), drawn as one `BatchedMesh` per surface material
    (about 10–15 draw calls for any amount of furniture);
  - geometry is cached and shared by size;
  - rounded boxes are built at exact size so their corners stay round.
- **2D presentation** (`render/planIllustration.ts`):
  - the same parts are painted from above with Canvas 2D (no WebGL), in height order;
  - each piece is cached as a bitmap at the plan's scale.

**Why not draw the 2D illustrations with an orthographic Three.js camera?** It would need WebGL
for basic 2D editing, cost a GPU context, and give a flat, photographic look. The brief asks for an
illustration. Painting the shared parts keeps the two views consistent without that dependency.

### 2. Shared materials

`render/materials.ts` defines each surface once:
- **Surfaces:** wood, fabric, linen, leather, metal, brass, glass, stone, ceramic, plastic,
  paper, foliage, screen, lampshade, soil.
- **Properties:** roughness, metalness, opacity and emissive glow (3D).
- **Texture:** a seamless, pale greyscale tile at a real-world size, generated locally on a
  canvas. No downloads and no licensed assets.

The tile multiplies the part's colour, so the person's chosen colour is kept. In 3D, UVs are in
metres, and wood and brushed-metal grain runs along each face's longer side. The 2D painter uses the
same tiles, pre-shrunk with a manual mip chain to avoid aliasing.

Stone and ceramic became selectable materials. Older versions read them as "custom": no
save-format change.

### 3. Lighting and quality

- **Colour:** neutral tone mapping keeps chosen colours true.
- **Light:** a warm-white hemisphere and a soft key light from the upper left, the same direction
  as the 2D shadows, plus a weak fill.
- **Shadows:** at 60% darkness, with a wide filter.
- **Contact shadows:** a blurred rounded rectangle under each piece. Nearly free, so on at every
  quality whenever shadows are.

| Quality | Shadow map | Materials | Shape detail | Pixel budget |
| --- | --- | --- | --- | --- |
| Low | none (contact shadows only) | plain | plain boxes, 8-sided rounds | ≤ 2 MP, ratio ≤ 1.25 |
| Medium | PCF, 1–2K | textured | 1 rounding segment, 14-sided | ≤ 4 MP |
| High | PCF, 1–2K, wider blur | textured, 8× anisotropy | 2 rounding segments, 20-sided | ≤ 6 MP |

**Auto** picks High on desktops with 8+ GB and 8+ cores, Medium on other desktops and capable
tablets, and Low on phones, low-memory devices and software renderers (SwiftShader, llvmpipe).

**Keeping the GPU cost down:**
- Variance shadow maps were tried for High and dropped: they stalled some GPUs on first use.
- Small details (books, handles, leaves, bedding, doors, drawers) don't cast shadow-map shadows;
  their contact shadow is enough.
- Parts rounded by less than 6 mm share one scaled box, and leaf sizes are rounded to share
  geometry, so a full room needs only a few distinct geometries.

**Ambient occlusion** (Three.js's GTAO/SSAO passes) was considered and not added in this phase:
- it needs a post-processing pipeline and a full-screen pass on every frame, which costs most on
  phones and in software rendering;
- contact shadows plus soft key-light shadows already give the grounding the reference shows.

Its actual cost wasn't measured here. Revisit as an option for High quality.

### 4. Presentation plan

- **A display preference**, not project data: Technical (unchanged) or Presentation.
- **What Presentation shows:**
  - the illustrated piece over an invisible copy of its exact footprint, which still receives
    clicks and drags, so editing and collisions are untouched;
  - a canvas shadow that stays screen-aligned (down and to the right) however the piece is
    turned;
  - the room name and size in the most open part of the floor;
  - no service symbols (outlets, switches, vents, lights) and no clearance zones.
- **Editing aids** (selection outlines, the rotate handle, lock and warning badges) appear on
  request.
- **Photo-topped pieces** keep their real photo.
- **Drawn outlines** get a refined material rendering of their true shape, never invented
  cushions or legs. In 3D, drawn tables stand on a pedestal placed inside their outline.

### 5. Image export

Rendered locally:
- **2D:** the plan is rendered off-screen at a higher Konva pixel ratio, and floor textures are
  regenerated at a matching resolution, so text, lines, textures and illustrations are redrawn
  sharp, not enlarged.
- **3D:** a temporary viewer renders at the target size from a preset camera, copies the frame,
  and frees its graphics context.

**Sizes:** 1080p, 1440p and 4K. Sizes the device can't allocate are disabled.

## Consequences

- **Easier:** one place to improve furniture design for both views; recognisable rooms;
  shareable images.
- **Harder:** more geometry per piece (about 10–60 parts). This is mitigated by batching,
  geometry sharing and quality presets.
- **Limits:**
  - furniture is still procedural, not modelled assets;
  - drawn custom shapes get material detail, not components;
  - 2D illustrations show tops only (a desk's drawers are invisible from above, as in reality).
