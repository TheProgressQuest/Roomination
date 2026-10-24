# Prototype log

What the prototype loop has deferred: tests not yet written, known limitations and technical
debt. Every item here is checked before a public release (see
[release-checklist.md](release-checklist.md)). Newest first within each section.

## Deferred tests

| Area | What's missing | Since |
| --- | --- | --- |
| Select an area (Step 2A) | A physical iPhone: time to read a photo, memory (the browser grew by 0.3–0.65 GB on a Mac), behaviour when Safari runs short of memory, and touch taps on the photo. Safari on a real Mac/iPhone (only Playwright's WebKit was run), private browsing (Cache Storage may be unavailable: the model then downloads each time), offline use after the first download, and HEIC photos | S2A |
| Scan classification (Step 1) | A real iPhone/Safari import of a RoomSheet package with photos: HEIC photos (only JPEG/PNG were tested; HEIC opens only where the browser can decode it), memory with 7 full-size photos, and the review's join checkbox on touch. Other scanner exports' attributes (3D Model Anything rooms use the same RoomPlan JSON, untested with attributes) | S1 |
| Photos & scans, Create furniture | Real iPhone and Safari: the two choosers, the *Shown in 3D* selector's disabled choices (VoiceOver reads them as dimmed), and *Photos for <piece>* in the stacked phone layout | UX |
| Real-object test | The radio test in [real-object-test.md](real-object-test.md) on a real iPhone: import time, memory peak, frame rate, budget fallback, persistence and transfer. Prepared, not yet run | M8 |
| Real-object test | iPhone file picker: whether .glb files are selectable with the importer's file-type filter (iOS may not know the GLB type and grey it out) | M8 |
| 3D model import | A real phone scan end to end (Reality Composer USDZ, Scaniverse GLB): only CC0 models (Poly Haven) and synthetic files were tested; the USDZ was packaged from Poly Haven's USD files | M7 |
| 3D model import | Real iPhone: memory and frame rate with several models; file picking of multi-file glTF in Files; the preview's touch orbit | M7 |
| 3D model import | Full regression with the new Content Security Policy (production only): smoke tests pass; check Smart remove, image export and the optimizer worker | M7 |
| Reconstruct | A real iPhone run: rebuild time, memory with several rebuilt objects, touch dragging of corners and tap-to-trim (only WebKit and slowed-down Chromium were measured; their 3D frame times are software-rendered and not meaningful) | M6 |
| Reconstruct | Safari Private Browsing end to end on a device (fixed: photos are now stored as plain bytes; verified in WebKit's private sessions only) | M6 |
| Reconstruct | Rebuilt objects in the 2D presentation plan (they draw as their ordinary look there) | M6 |
| Decorate My Room | Dragging resting items in 2D and 3D on touch; the Surface picker on iPhone; items on a support that's then resized narrower (they keep their place, possibly past its edge) | M5 |
| Decorate My Room | Grouping several loose items without a tray (only "rest on" grouping exists) | M5 |
| Room scan import | A real RoomSheet scan (iPhone 17 Pro): checked locally by status only (it reads, 4 walls, 1 door, 5 objects, project valid). Still to do: look at it in 2D/3D in Safari against the real room | M1 |
| Room scan import | A real LiDAR Room Scanner "RoomPlan JSON" export (its structure isn't documented) | M1 |
| Room scan import | A real LiDAR scan end to end; real exports from 3D Model Anything | 8A |
| Room scan import | Safari on iPhone and iPad (file picker from Files, the review on touch) | 8A |
| Whole app | Safari and Firefox browser runs (only Chromium is automated) | earlier |
| Whole app | Screen readers (VoiceOver) with real assistive software | earlier |

## Known limitations

- **Select an area (Step 2A, 24 Oct 2026, beta, optional):** MobileSAM instead of the approved
  SlimSAM (SlimSAM needed about 2 GB per photo; see docs/segmentation-investigation.md). Limits:
  - one photo at a time; the selection resets when the photo changes;
  - the suggestion is the typical colour of the selected area as photographed (after the
    photo's colour correction), so shading and lighting are part of it: a shaded floor suggests
    a darker colour than its sunlit corner;
  - masks follow what the model sees as one thing: a sofa's chaise may come out without the
    rest (use *Larger area*), a rug may join a floor (use *Leave out*);
  - adds 19 MB of model files to the website (downloaded only on use) and 5 kB (compressed) to
    Match my room's code; the start-up download is unchanged.
- **Scan classification (Step 1, 24 Oct 2026):** the scanner's object details (sofa, table,
  storage and chair types) and links are now used, recorded and shown as the scanner's; a desk
  is Roomination's inference from a chair linked to a cabinet. Still limited:
  - RoomPlan has no "desk" or "ottoman" type: a desk without a linked chair stays storage, and
    an ottoman may come in as a sofa or not at all;
  - the joined sectional's height is the taller part's; its arm and back heights are the
    catalogue's proportions, not measured;
  - a sectional's "front" is where its short side reaches; a scan whose short side stands
    behind the long side is turned round (the boxes stay as measured);
  - chairs tucked under a table or desk are no longer overlap warnings when armless, facing it
    and partly under a top at least 60 cm high; armchairs, chairs turned away and chairs entirely
    underneath still are, and every other check (doors, vents, walkways) still applies.
- **First real open-plan scan (RoomSheet, 24 Oct 2026):** fixed: when the scanned walls don't
  close (three walls meeting at a stair wall made the tracer give up), the floor outline is used,
  and the scanned walls along it were added again as interior walls (doubled lengths, false
  overlap warnings). Still as designed but confusing on a real room:
  - the scanner records labelled boxes only (sofa, table, storage, chair); its USDZ files hold
    boxes with no textures, so pieces get catalogue looks and default colours;
  - fixed in Step 1: "storage", tables, sofas and chairs were guessed from size alone (a desk
    became a sideboard, a rectangular table a round one, an L-shaped sofa two sofas), and
    dining chairs tucked under a table were flagged as overlaps;
  - the package's reference photos can now be added to Match my room at import (Step 1), but
    colours and textures still come from Match my room, by hand.
- **Testing on another device (M8):** web apps can only store photos and models on https://
  (or localhost) pages: browsers withhold the hashing they use on plain http:// network
  addresses. `npm run phone-test` serves the build over HTTPS with a test certificate limited
  to local addresses (kept in `~/.roomination-phone-test`). Opening a dev server by its IP
  address over http now shows a clear message instead of "storage may be full". The live site
  (https) is unaffected.
- **Moving between devices:** projects move by **Export file / Import file** (the zip carries
  photos and models). *My Library* belongs to each browser and isn't exported; a future sync or
  library export would be needed for that.
- **Large scan textures:** an Object Capture USDZ can carry 4K–8K textures; they're decoded at
  full size while previewing (then saved at most 2048 px). Watch memory on the iPhone with big
  scans.
- **Import 3D model (M7, prototype):** see [3d-model-import.md](3d-model-import.md).
  - **Formats:** GLB, glTF (multi-file) and USDZ/USDC/USDA. No OBJ/FBX/PLY; no Draco, meshopt
    or KTX2; no EXR textures.
  - **Fitting:** the model is fitted to the measured box: non-proportional sizes stretch it. The
    pivot is always the centre of its base (bounding box); there's no manual offset or crop.
    Crop tables and floors in the scanning app.
  - **No simplification:** models are refused above 1M triangles, and pieces over the
    per-quality budget show a plain box.
  - **Selection** shows the outline only (no blue tint on model materials).
  - **The 2D plan** shows the piece's ordinary look, not the model.
- **Fitting scanned fixtures (fixed in M7):** a model is now fitted so its body (a vanity's
  worktop) meets the measured height, with taps and vessel basins standing above at real size.
  Before, the whole model including the tap was squeezed into the measured height, putting
  worktops about 16 cm too low. Projects fitted before the fix keep the old geometry until the
  model is chosen again (*Change model…*) or the scan is re-imported.
 see [reconstruction-feasibility.md](reconstruction-feasibility.md).
  - **Shape from outlines:** hollows that no outline shows stay filled; backs and bottoms are a
    plain average colour unless photographed; the grid is 40 cells along the longest side.
  - **Photos carry their own lighting**, and the 3D lights add more; brightness is a manual fix.
  - **Trimming** is a magic wand compared with the tapped colour: shaded background needs
    another tap. The outline is smoothed (about 1% of the patch).
  - **Not built:** mesh (GLB/USDZ) import, posed-photo camera setup, depth evidence, automatic
    mismatch detection.
  - **Visual only:** measurements, collisions and the plan ignore the rebuilt look.
  - **On phones**, selecting the object means closing the panel, tapping the object, and
    reopening the panel.

  - **Resting:** an item rests on one support (`restsOn`) and is carried when the support moves,
    turns or rises; nesting works (bottle → tray → vanity). Deleting a support deletes what's on
    it (Undo restores both). Items aren't kept inside the surface's outline if dragged off it.
  - **Auto-placement:** a small accessory added while a piece is selected lands on that piece's
    worktop or highest surface, at its centre with a small nudge; other surfaces are chosen under
    *Rests on*.
  - **Accessories:** 17 generic procedural items (bottles, pump and spray, jar, cup, candle,
    tray, soap dish, two-tier organiser, basket, lidded box, towels, cloth, books, succulent,
    spare roll). No labels or brands; no textured printing.
  - **Shower curtain:** new *Sheer fabric* material (38% opaque, casts no shadow map); folds vary
    repeatably in width, depth and hem. Optional pattern (striped variant; any part's pattern
    can be changed in the studio). Fabric doesn't move or drape.
  - **Ambient occlusion:** not added. Screen-space AO would need a post-processing pass (a
    second full-screen render with depth and normals): roughly 2–6 ms per frame on a phone at
    full resolution, it blocks the renderer's built-in antialiasing, and it halos thin parts
    such as shelves and rods. Small objects get the existing soft contact shadow at their
    resting height instead, plus the existing edge darkening.
- **Fidelity pass (M2.7):**
  - **Lighting balance:** indoors (under the ceiling), daylight drops to 30% and fittings
    provide most of the light. Tuned against one bathroom photo; check other room types and
    daylight-filled rooms.
  - **Grout:** lighter than the tile on dark tiles, darker on pale ones. There's no tile-size
    or grout-width control beyond pattern size.
  - **Granite / laminate:** a procedural fleck pattern, not a photo; no worktop edge profile.
  - **Shaker fronts:** only on the drop-in vanity so far.
  - **Doorways:** what's beyond is a dim plain surface, not the next room.
  - **Edge darkening:** fixed width (28 cm) and strength; not true ambient occlusion.
  - **GLB fixture models:** not added (licence and realism review in the report).

- **Colour correction, lighting, ceiling, doors and trim (M2.6):**
  - **White balance:** taken from one surface the person picks. An off-white surface (a cream
    toilet seat) skews everything, so the panel suggests plain white plastic or paint in good
    light.
  - **Fittings:** light from fittings casts no shadows. Medium draws 4 lights and High 8; any
    more are left out. Daylight dims to 72% when the camera is under the ceiling.
  - **Light brightness:** lumens are scaled to sit alongside Roomination's (non-physical)
    daylight, so brightness is relative, not photometric. Colour temperature is shown against a
    5,000 K white point.
  - **Ceiling:** flat, at the measured height, with no soffits or slopes. It's shown only from
    inside the room, below it.
  - **Doors:** the open angle changes only the 3D drawing; the plan always keeps the full swing
    clear.
  - **Trim:** on outer walls only (not interior walls). There is no apron below window sills.
  - **Mirror reflections:** captured from one point.
  - **Through openings:** nothing beyond a doorway is drawn (the background shows).

- **Real-room comparison (bathroom, M2.5):** see the visual differences in the owner's report.
  Not modelled yet:
  - ceilings (the sky shows above the walls at eye level);
  - how far a door is open (always drawn 30% ajar);
  - part-height wall finishes (backsplash, tiled lower walls).
  Lights don't emit light.

- **Reflections (M2.4):**
  - Medium and High add a soft generic room environment (not the real room) to glossy surfaces;
  - on High, mirrors reflect the actual room, captured from one point in front of the first
    mirror, so reflections are approximate and every mirror shows the same capture;
  - measured on this Mac's headless browser: CPU time per frame 0.3 ms (Low), 0.4 ms (Medium),
    0.4 ms (High); the mirror capture costs about 75 ms, once, 200 ms after the room or
    furniture last changed; GPU time and real-device frame rates are not measured yet.

- **Camera matching (M2.3):**
  - lined up by eye, with no automatic calibration;
  - lens presets assume iPhone Pro focal lengths (13, 24 and 48 mm equivalent) and a photo that
    isn't cropped;
  - the 3D view is shrunk to the photo's shape beside the panel, so it can be small on laptop
    screens;
  - orbiting is paused while matching, and saved views reopen through the panel.

- **Match My Room (M2.2):**
  - wall colours and textures show in 3D only, not on the 2D plan; floor photo textures show in
    both;
  - photos carry their own lighting, so sampled colours and textures may be darker than the
    real surface (a brightness slider is offered);
  - perspective is corrected only from the four corners the person places;
  - a photo texture on a component-built piece replaces its detailed parts with a plain
    textured block (the existing photo-furniture behaviour);
  - every applied texture is stored as a new image, and unused ones are removed only by
    *Projects → Photos & storage*.

- **Raised and wall-mounted pieces (M2.1):**
  - collisions use height ranges for furniture against furniture, but raised pieces skip the
    floor clearance zones in front of other furniture;
  - door swings and other feature zones still apply up to the piece's top;
  - the optimizer ignores raised pieces entirely.
- **Mirrors:** they look like polished glass but don't reflect yet (true reflections are planned
  for the renderer milestone and need performance measurement).
- **Vanity merge:** a raised basin sitting on a floor cabinet is shown as one vanity (the basin is
  listed, unticked). A basin on a table or shelf would be treated the same.

- **Sinks:** RoomPlan measures only the basin. A raised sink is shown as a unit from the floor to
  the basin's top (labelled assumed); a wall-hung basin needs changing by hand.
- **Guesses in bathrooms:** low storage can come out as a dresser; change it in the review.
- **RoomSheet packages:** only `captured-room.json` (the original capture) is read. Edits made in
  RoomSheet (`model-edits.json`) aren't applied, because their format isn't documented.
- **Real scans on the live site:** until Milestone 1 is released, choose the unzipped
  `captured-room.json` (the live importer doesn't recognise the RoomSheet .zip yet).
- **Room scan import (beta):**
  - validated with synthetic scans only;
  - Safari can't use the iPhone's LiDAR, so a separate scanning app is needed;
  - USDZ isn't read;
  - one ceiling height per room;
  - wall thickness, door swing and stair direction are assumed;
  - furniture comes in as boxes with catalogue looks;
  - meshes and photos aren't imported.
  See [scan-import.md](scan-import.md).

## Design review (October 2026): decisions needed

From a scan of every main screen and dialog at phone, tablet and desktop sizes, light and
dark, normal and large text. Layout bugs were fixed (see git log); these need a decision:

| Issue | Notes |
| --- | --- |
| ~~Optimize appears three times~~ | Done: the Optimize tab is its only entry point (the header and bottom-bar buttons are gone). Tests open it via the tab |
| ~~Four ways to give a piece a photo or scan look~~ | Done: each piece has one *Photos & scans* section (Apply photos to surfaces / Rebuild shape from photos / Import a 3D scan) and one *Shown in 3D* choice (Standard model / Photo rebuild / 3D scan; looks it doesn't have are disabled with a reason). It uses the existing on/off flags, so saved projects, Undo, My Library and exports are unchanged and older projects read the same. New pieces: Furnish → *From photos or a 3D scan…*. Match my room keeps the room tools; for a piece it opens as *Photos for <piece>* |
| ~~Three ways to build custom furniture~~ | Done: one *Create furniture…* chooser (Draw its outline / Combine shapes / Build from parts), the last-used method preselected (remembered in this browser only). Editing a piece still opens its tool directly. Saved formats unchanged |
| ~~Plan style twice~~ | Done: only under Design → *Presentation plan* (saved preference unchanged). The toolbar keeps the quick *Editing aids* switch while Presentation is on |
| **Edits hidden by a model** | Improved: the note now points to *Shown in 3D → Standard model*. A bigger fix would hide or merge those controls |
| **Match my room on phones** | Stacks below the 3D view; selecting an object to rebuild means leaving the panel |
| **Phone 3D view** | Improved: the camera choice stays; walls, shadows, ceiling, quality and Match my room fold behind *Options*; the scene fills the screen height (it starts ~160px higher); zoom/fit and the tip moved to the top, clear of the bottom bar. Still open: a full bottom sheet for properties (today: the bottom bar's *Edit* opens a modal), and the two-row phone header |

Smaller, left as they are: corner handles in the outline editors are 26 px on touch (WCAG's
minimum is 24 px; 44 px would crowd the drawing); the photo's remove button has a 44 px hit
area but a 22 px look.

## Technical debt

| Item | Notes |
| --- | --- |
| Imported models: one draw call per mesh in the model, per piece (shared geometry and materials, not instanced) | Fine for a few; instance repeated models if rooms get many |
| Rebuilt objects are one unbatched mesh each, about 10k triangles for a curved object (12 for a box) | Fine for a few; add simplification of flat areas before rooms have many |
| Resting items add one contact-shadow quad and a few parts each | 30 accessories in the bathroom: 54 draw calls, 23k triangles, 0.6 ms CPU per frame; measure on an iPhone with a fuller room |
| Lighting retune (M2.7) changes every interior view | Re-check the existing 3D screenshots and other rooms before release |
| Light cost on the GPU | Only CPU frame time is measured (under 1 ms at Low, Medium and High with a fitting, the ceiling and a mirror); measure frame rates on an iPhone and iPad with several lights before release |
| Lights, trim and door controls | Only desktop Chromium; check touch sizes in the Light and Trim controls on iPhone (44 px) |
| Part textures (M2.5) draw each textured part as its own mesh (not batched) | Fine for a few parts; measure if a room gets dozens |
| Match My Room panel touch targets | Some panel buttons are the small (32 px) size; check on iPhone and iPad before release (44 px rule) |
| Full regression not run for M2.1–M2.4 | Only targeted tests, the 3D suite and smoke tests; run `npm run test:full` before release |
| Match My Room panel (~400 lines) | Tested on desktop with synthetic photos; touch dragging of corners not yet tried on an iPhone |
| New fixtures (vanities, mirrors, lights, curtain, towel bar) only checked in synthetic screenshots | Look at them on a real device and at eye level |
| `custom.spec.ts` “draws a new outline corner by corner” is flaky on CI | It occasionally lands 2 cm off; it passes on retry |
| GitHub Actions use Node 20 versions of `checkout` / `setup-node` | GitHub warns they're deprecated; update to newer action versions |
| `src/scan/ScanImportDialog.tsx` is large (~700 lines) | Split the tabs into files if it grows |
| Startup download creeping up (293.7 → 297.1 kB gz in 8A) | Watch it; keep new features lazy-loaded |
