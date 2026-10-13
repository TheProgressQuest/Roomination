# ADR-0004: Custom-shaped furniture and photo-assisted furniture

**Status:** Accepted
**Date:** 2026-10-13
**Deciders:** The Progress Quest

## Context

Phase 3C lets people draw furniture of any outline (angled loveseats, L-shaped desks, kidney
tables, curved sofas) and build its look from their own photos.

Until now every piece was a rectangle (`width × depth`). Collision checks, room-fit checks and
the optimizer all assume convex rectangles: `rectPolygon`, `clipConvex` and
`convexInsidePolygon`. A concave shape can't use those directly.

Requirements:
- The same footprint must be used everywhere: 2D, 3D, collisions, room fit and the optimizer.
- Curves must look and collide the same.
- Photos must never leave the device.
- Projects and libraries must survive export and reload, including photos.
- Older projects must keep working.

## Decision

### 1. One footprint, defined once (`src/model/shape.ts`)

- **Storage:** a piece may carry an optional `shape: FurnitureShape`. It is a clockwise outline
  in the piece's local frame, in centimetres: x across the width, y across the depth with the
  front at +y, and the origin at the centre of its bounding box. That is exactly the frame
  rectangles already use, so position (x, y) and rotation keep their meaning.
- **Curves:** each vertex may carry two control points (`c1`, `c2`). The edge from that vertex
  to the next is then a cubic Bézier curve. The curve data is saved exactly as entered.
- **Flattening:** for geometry, curves are flattened by subdividing until the chord is within
  **0.5 cm** of the true curve. The bound is guaranteed by
  `n = ⌈√(6·M / (8·tol))⌉`, where M is the largest second difference of the control points.
  The 2D plan and the 3D view draw that same flattened outline, so what you see is what
  collides.
- **One accessor for all consumers:** `furnitureFootprint(item)` returns the flattened local
  outline (or the rectangle, for pieces without a shape) together with a **convex
  decomposition** (ear-clipping triangulation, then greedy merging into convex pieces). It is
  cached per shape object; shapes are immutable in the reducer.
- **Exact maths on concave shapes:** every existing algorithm stays exact by working part by
  part.
  - **Overlap area:** the sum of the convex-part overlaps (the parts don't overlap each other).
  - **Fully inside the room:** every convex part is inside (`convexInsidePolygon`).
  - **Gaps and walkway rasterising:** use the outline (point-in-polygon and edge distances
    already work for concave shapes).
- **Size stays in sync:** `width` and `depth` are kept equal to the outline's bounding box. So
  labels, lists, "against a wall" heuristics and older code keep working. Changing width or
  depth scales the outline proportionally, and that change appears in 2D and 3D at once.
- **Validation:** at least 3 corners, no self-intersection (checked on the flattened outline),
  an area of at least 25 cm², and a size within the room limits. Invalid outlines are refused
  with a plain explanation.

### 2. Furniture clearance

- **Field:** optional `clearance` (cm): space to keep free in front of a piece. It is a zone
  across the piece's width in front of its front edge.
- **Use:** checked like door and outlet clearances. Other solid pieces inside it are reported,
  and they can be accepted like any other overlap. The optimizer treats it the same way.

### 3. Appearance

- **Field:** optional `appearance`:
  - `material`: fabric, leather, wood, metal, glass, plastic or custom;
  - `finish`: matte, satin or gloss;
  - photo textures for the `top`, `front` and `side` surfaces, referenced by asset id;
  - reference photos.
- **Colour:** stays `color`.
- **Materials:** procedural textures are generated locally on a canvas (wood grain, fabric
  weave, brushed metal). No texture library is used.

### 4. Photos: stored once, by content (`src/storage/assets.ts`)

- **Storage:** photos are stored in **IndexedDB** (the existing Dexie database, version 2) as
  Blobs, never as base64 in localStorage.
- **Ids:** an asset's id is the SHA-256 of its bytes. The same photo used by several projects or
  library items is stored once.
- **Before saving:** photos are resized to at most 1600 px (textures to 1024 px) and saved as
  WebP (PNG where WebP isn't supported). Transparency is kept.
- **Quota errors:** reported, never swallowed. `navigator.storage.estimate()` shows usage.
- **Missing photos:** if a referenced photo is missing (e.g. the browser cleared site data),
  the piece falls back to its colour and material. The editor says the photo is missing and
  offers to remove the reference or choose a new one.
- **Deletion:** nothing is deleted silently. Deleting a library item or a piece leaves its
  photos. **Storage → Remove unused photos** lists what would go and asks first.

### 5. Furniture library (`library` table)

- **Contents:** saved templates (name, type, category, size, shape, appearance, clearance,
  photo references), shared by all projects on the device.
- **Actions:** place, edit, duplicate, rename, delete.
- **Thumbnails:** drawn from the outline (SVG), or from a photo when there is one.
- **Labels:** pieces are shown as **Standard**, **Custom** (has a shape) or **Photo-assisted**
  (has photos).

### 6. Export and import

- **Format:** projects without photos export as JSON, exactly as before. Projects with photos
  export as a **ZIP** (`.roomination.zip`, made by fflate, MIT) containing `project.json`
  and `assets/<sha256>.<ext>`.
- **Broken references:** an export never contains references to photos it doesn't include.
- **Checks on import:**
  - only PNG, JPEG and WebP, identified by their bytes (never SVG or anything executable);
  - at most 15 MB per image and 60 MB in total;
  - every image must decode;
  - the hash is recomputed and ids are remapped if it differs;
  - geometry is validated like every other field;
  - zip entries with unexpected names are ignored.

### 7. Photo tools (lazy-loaded `src/photo/`)

- **Loading photos:** upload one or more photos labelled front, side, top or other. They are
  decoded with `createImageBitmap` (respecting camera orientation) and shown as previews.
- **Editing:** crop, rotate (90° steps plus fine angle), and **perspective correction** (drag four
  corners; a homography warp computed in a Web Worker).
- **Background removal, three levels, all on the device:**
  1. **Colour-based (instant, no download):** flood fill from the photo's edges by colour
     similarity, with a tolerance slider. Good for plain walls or floors.
  2. **Smart (optional, local AI):** **U²-Net-p** (Apache-2.0, 4.6 MB) run by
     **onnxruntime-web** (MIT) on WebAssembly, in a Web Worker, with progress and cancel.
     - The model and runtime are **bundled with the site** and downloaded from Roomination's
       own GitHub Pages only when the person clicks *Smart remove* (about 16 MB once, then
       cached by the browser).
     - No WebGPU is required.
     - Nothing is sent anywhere: inference happens on the device.
  3. **Manual:** eraser and restore brushes, edge refinement (shrink, grow, soften), and undo.
- **Why this model:** larger models such as ISNet, BiRefNet or RMBG are better at cluttered
  scenes but are 40–180 MB, or (RMBG) non-commercial.
- **Tracing an outline:** a top photo can be traced by hand in the shape editor, or traced
  automatically from its cut-out. Auto-tracing uses marching squares, then Douglas–Peucker
  simplification, and the result can be edited.
- **Scale:** the person marks a line on the photo and types its real length. A photo is never
  assumed to have a scale, and perspective-distorted photos are explained as approximate.

### 8. Shape editor (lazy-loaded)

- **Layout:** a full-screen dialog with an SVG canvas, grid and snapping.
- **Editing:**
  - draw corners;
  - move, insert and delete corners;
  - type a corner's x/y, an edge's length, or an angle;
  - turn any edge into a curve with two draggable handles, or back into a straight line;
  - scale to an exact overall width and depth.
- **Templates:** rectangle, L-desk, corner table, curved sofa and kidney table.
- **History and photos:** undo, redo, reset, save and cancel; a photo can be shown underneath
  as a tracing reference.
- **Without a mouse:** every pointer action has a numeric or keyboard equivalent.
- **Saving:** goes through the normal reducer as **one** undoable step.

### 9. 3D

- **Custom shapes:** each is extruded from its flattened outline into its own mesh. The top and
  bottom are triangulated and the sides follow the outline. The mesh uses the same footprint,
  position, rotation and height as 2D.
- **Rectangular pieces:** keep their per-type procedural parts. Pieces with a non-default
  material are grouped into one instanced mesh per material.
- **Photo textures:**
  - top photo: projected onto the top face;
  - front photo: projected along the depth axis onto the front-facing sides;
  - side photo: projected onto the sides.
- **What it is not:** this is a recognisable approximation, not a 3D reconstruction. The plain
  geometric model is always available.

### Measured (MacBook, M3 Pro)

- **Collision checks:**
  - all overlaps among 150 custom shapes in a 40-wall room: **6.9 ms**, against 4.4 ms for
    rectangles;
  - one dragged custom piece: **0.4 ms**.
- **Optimizer, L-shaped studio, Standard effort:** **1.3 s** with custom shapes, against 0.85 s
  with rectangles.
- **Smart remove:** model and runtime load and inference complete in about **5–8 s** in the
  browser tests, including the first download from the local server.
- **Download sizes (gzipped):**
  - main bundle: **+7 KB**;
  - studio: **10 KB**, loaded on demand;
  - photo tools: **6 KB**, loaded on demand;
  - AI runtime: **3.7 MB**, loaded only for Smart remove;
  - model: **4.6 MB**, loaded only for Smart remove.

## Options considered

- **Treat custom shapes as their bounding rectangle for collisions:** rejected; the requirement
  is the true footprint.
- **General polygon clipping libraries (e.g. polygon-clipping):** exact for concave shapes but
  slower and an extra dependency. Convex decomposition reuses the existing, tested clipping.
- **Transformers.js with RMBG-1.4 or BiRefNet:** better segmentation, but much larger, and
  RMBG's licence is non-commercial. U²-Net-p is the best small, permissively licensed choice,
  with colour and manual tools as fallbacks.
- **Loading models from Hugging Face at runtime:** rejected in favour of bundling, so the only
  host involved is Roomination's own site.

## Consequences

- **Easier:** any shape works with every existing check and with the optimizer, and photos
  survive reloads, exports and library reuse.
- **Harder:** the save format becomes version 6, and ZIP exports add an import path to keep
  secure.
- **Limits:**
  - automatic tracing and background removal are only as good as the photo;
  - dimensions always come from the person;
  - textures are projected, so photos of curved surfaces stretch.
