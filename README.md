# Roomination 🏠

*A little less guessing. A lot more room for living.*

A free, open-source, privacy-first room planner by **The Progress Quest**. Everything runs in your
browser: rooms, measurements and layouts are saved on your device (IndexedDB) and are never sent
anywhere. There are no accounts, no analytics, no ads and no servers.

## Features

### Room scan import (Phase 8A, beta)
**Beta: validated with synthetic scans; real LiDAR scan testing pending.**

Turn a room scanned with an iPhone or iPad into a plan you can edit. See
[docs/scan-import.md](docs/scan-import.md) for the details.

- **Where:** Projects → *Import room scan…*
- **What it reads:**
  - Apple RoomPlan JSON;
  - a [3D Model Anything](https://github.com/wesbos/3d-model-anything) room or session .zip;
  - or a documented `roomination-scan` file.
- **No scan to hand?** Try one of the made-up samples in the dialog.
- **Scanning itself** needs a LiDAR iPhone or iPad (iPhone 12 Pro or a later Pro model, iPad Pro
  2020 or later) and an app that uses Apple's RoomPlan. Browsers can't use the LiDAR Scanner, so
  the website can't scan.
- **Review before anything is created:**
  - a live preview of the plan;
  - wall lengths with the scanner's confidence;
  - orientation (line up with the grid, quarter turns) and ceiling height;
  - doors, windows and doorways to keep, retype, resize or add;
  - furniture to keep, reclassify, resize or add.
  - Each object shows what the scanner measured separately from Roomination's guess. Measurements
    can always be reset.
- **Accurate:** sizes and positions are kept to 0.1 cm. Turning the plan never changes a length.
- **Editable:**
  - objects become catalogue pieces stretched to the measured size (or plain boxes);
  - kitchen and bathroom fixtures stay put when you optimise;
  - RoomPlan's open doorways become a new *No door* door style.
- **Always a new project:** importing never overwrites or changes an existing one.
- **Scan history kept with the project:**
  - what the scanner measured;
  - how its coordinates were turned into the plan's;
  - what Roomination inferred or assumed;
  - what you corrected.
  It survives saving, exporting and re-importing, and shows under *From the room scan* when
  you select a scanned piece, door or window.
- **Private:** the scan is read on your device. Photos, meshes, depth data and AR maps in a .zip
  are never opened, and nothing is uploaded.

### Furniture catalogue (Phase 7)
A catalogue of 144 ready-made pieces, so you rarely need to build anything yourself.

- **Rooms:** living room, dining, bedroom, office, kitchen, bathroom, laundry, sauna, outdoor,
  lighting, décor & plants, and rugs.
- **Finding pieces:** search by name or everyday words ("wc", "jacuzzi", "nightstand"), or filter
  by room. Each card shows a picture and the real size.
- **Adding pieces:** click (or tap) a card to add it near the middle of the room, or drag it onto
  the plan where you want it. The old quick-add buttons are still under *Quick add*.
- **Kitchens, bathrooms, laundry and saunas:**
  - Base cabinets, sinks, gas and induction hobs, ovens, dishwashers, fridges, a pantry and
    islands.
  - Toilets, a bidet, vanities, baths, showers and a towel radiator.
  - Washers, dryers and a utility sink.
  - Sauna benches, a heater and a bucket.
  - Hot tubs, outdoor sofas, tables, loungers, a parasol, a fire pit and a barbecue.
- **Fixtures:** these are marked as fixtures, so *Optimize layout* never moves them. You can still
  drag them yourself.
- **Editable:** every piece uses the same drawing system as the rest of the app (2D plan,
  presentation plan and 3D). Pieces built from components can be opened with *Edit components*
  and changed.
- **Private:** everything, pictures included, is drawn on your device; nothing is downloaded. The
  catalogue loads only when you open it.

### Advanced Furniture Builder (Phase 6)
Build your own furniture from parts, so an unusual piece looks like itself in 2D and 3D
instead of a block.

- **Open it from** Furnish → *Build from components*, or a selected piece's *Build from
  components* / *Edit components* button.
- **Components:** base, seat, backrest, armrest, cushion, pillow, headrest, leg, foot,
  tabletop, shelf, drawer, cabinet door, support, decorative detail, or custom.
  - Each has a position, width, depth, height, height above the floor, turn and lean.
  - Its edges can be rounded, bevelled or square, and it has its own material, colour,
    finish, roughness, texture size, fabric pattern and seams.
  - Add, move, resize, turn, duplicate, delete, group, reorder, lock or hide components.
    Attach one to another so it moves and turns with it.
- **Shapes:** box, cylinder or ellipse, soft round (pillows), your own polygon, a curved
  panel, a band that **follows edges of the footprint** (a backrest along an angled side,
  mitred where two sections meet), or **the footprint itself** minus other components (a seat
  cushion that fills an irregular sofa, optionally split into several cushions).
- **Templates:** standard sofa, loveseat, deep-seat loveseat, angled-back loveseat, corner
  sofa, sectional, chaise lounge, armchair, ottoman, circular ottoman, round table, oval
  table, L-shaped desk and an irregular cabinet.
  - Used on a piece already in your room, a template is built onto **your** footprint and
    height. Edges and seats follow your outline, so entering your real measurements reshapes
    them.
- **Views:** a top view (drag to move, round handle to turn, numbered footprint edges), a
  front view (drag up and down to set heights) and an optional live 3D preview. Arrow keys
  nudge, R turns, Ctrl/⌘ Z undoes.
- **Accurate:**
  - The footprint (width × depth, or your drawn outline) is still what collisions and the
    optimizer use.
  - Components that reach outside it, or below the floor, are listed. You choose whether to
    move them or grow the footprint; nothing changes on its own.
  - The piece's height is taken from its tallest component.
- **Materials:** cotton, linen and velvet join fabric, leather, wood, metal, stone, ceramic,
  glass and plastic, with woven stripes, check, herringbone or bouclé. All textures are drawn
  on your device.
- Saved with the project, in exported files and in the furniture library; one Save is one
  undo step.

### Visual rendering (Phase 5)
Rooms look like an interior designer's drawing, in 2D and 3D, without losing a centimetre of
accuracy.

- **One furniture model for both views.** Each piece is built from real components, sized from
  its own width, depth and height:
  - **Seating:** sofas and armchairs (arms, back, separate seat and back cushions, accent
    pillows, legs), dining chairs (seat pad, backrest, legs) and office chairs (five-star base).
  - **Beds:** headboard, mattress, duvet with folds, a throw, and pillows.
  - **Tables:** tables and desks (top, legs, a coffee-table shelf, a desk drawer pedestal).
  - **Storage:** bookshelves (shelves and books), cabinets and wardrobes (doors, drawers,
    handles), TV units and screens.
  - **Décor:** plants (pot, soil, tilted leaves), floor lamps (with a lit shade), vases, rugs.

  Every component stays inside the piece's real size, so nothing looks bigger than the plan
  says and collisions are unchanged.
- **Materials:**
  - Wood, fabric, linen, leather, metal, brass, glass, stone and ceramic, with subtle textures
    generated on your device at real-world scale. No downloads.
  - Your chosen colour is always kept. **Stone** and **ceramic** are new choices in the studio.
- **2D: Technical or Presentation** (above the plan, and in **Design → Presentation plan**):
  - **Technical** is the precise planner you know.
  - **Presentation** draws illustrated furniture with soft shadows, a subtle oak floor, and the
    room's name and size written on the floor. It hides service symbols and clearance zones.
  - Everything can still be selected and moved; **Editing aids** brings back selection
    outlines, the rotate handle and warnings.
  - Choose whether to show labels, room dimensions, the room name, the measurement grid and
    shadows.
- **3D:** rounded upholstery, wooden legs, real shelves and doors, soft daylight from the upper
  left (matching the 2D shadows), soft contact shadows under every piece, and neutral colour
  handling so your colours look as chosen.
- **Quality** (3D toolbar): **Auto**, **Low**, **Medium** or **High**.
  - Low has no shadow maps, plain materials and simpler shapes.
  - High has softer, larger shadows and finer curves.
  - Auto picks High on capable computers, Medium on most devices, and Low on low-memory phones
    and on computers without graphics acceleration.
- **Drawn shapes** keep their exact outline. They get a refined material finish rather than
  invented cushions or legs; drawn tables stand on a pedestal inside their outline. Photo
  furniture keeps your photos.
- **Export image** (download icon above the view):
  - **Views:** a PNG of the 2D plan (Technical or Presentation) or a 3D top-down, isometric or
    eye-level view.
  - **Sizes:** 1080p, 1440p or 4K; sizes your device can't handle are disabled.
  - **Options:** a transparent background, and the room's name and size.
  - Images are drawn fresh at that resolution, never enlarged, and never include the
    interface. Everything happens on your device; nothing is uploaded.
- **Natural palette:** new furniture and the sample room use calm, natural colours (oatmeal,
  linen, sage, oak, walnut…). Existing projects keep their colours.

Design and trade-offs: [ADR-0006](docs/adr/0006-visual-rendering.md).

Measured on a stress project (40 walls, 150 pieces), production build:

| | Apple M3 Pro (GPU, Chrome) | Software rendering (as on CI) |
| --- | --- | --- |
| Open 3D, first frame | 0.44–0.46 s (code download included) | 1.9 s (Auto → Low) |
| Frame rate while orbiting | ~100–110 fps at every quality | Low 26 fps · Medium 12 fps |
| Draw calls / triangles | Low 42 / 38k · Medium 103 / 143k · High 119 / 384k | same |
| 2D: switch to Presentation | 0.22 s | — |
| 2D: dragging a piece | Technical 115 fps · Presentation 89 fps | — |
| Export | 2D 1440p ≈ 0.7 s · 3D 1080p ≈ 3 s · 3D 4K ≈ 3 s | — |
| Main download (gzip) | 268.5 kB (Phase 4: 258.6 kB) | — |
| First load to plan | 162 ms (Phase 4: 160 ms), local | — |

### Design and navigation (Phase 4)
- **The Progress Quest look:** clean neutral surfaces in light mode and blue-black in dark mode,
  with **Savage Ultramarine** (`#1F2BD6`) marking what matters: the active tab, the 2D/3D switch,
  selection, focus and the main action. Every interface colour is a design token in one place
  (`src/styles.css`); text and controls meet WCAG AA contrast in both themes.
- **Your colours stay yours:** floors, walls, furniture and your board settings are never changed
  by the theme.
- **Four tabs** organise the tools panel by what you're doing:
  - **Build:** room size, walls, doors, windows and features, stairs;
  - **Furnish:** standard furniture, custom furniture, the **Shape Builder**, photos, the library,
    checks;
  - **Design:** floor, walls and the board around the room;
  - **Optimize:** the optimizer and the optional **Feng Shui / Harmony** settings.

  Simple controls show first; more detail is a click away. The tabs work with the keyboard (arrow
  keys, Home, End) and the last one you used is remembered on this device. The **2D Plan / 3D
  View** switch always stays above the plan.

### Shape Builder (Phase 4)
Build a piece's outline from basic shapes: **Furnish → Shape Builder**, or **Shape Builder** in a
piece's *Shape & look*.

- **Shapes:** rectangle, square, circle, ellipse, triangle, regular polygon (3–64 sides) and
  curved section (a curved band, like a curved sofa, up to a full ring).
- **Edit:** drag to move; drag the corner handle to resize and the round handle to turn; or type
  exact positions, sizes and angles. Arrow keys nudge (Shift: 10 cm), `[` and `]` turn by 15°,
  Delete removes, Ctrl/⌘ D duplicates, Ctrl/⌘ Z undoes.
- **Choose several:** Shift-click, or tick them in the parts list (handy on touch screens).
- **Combine:**
  - **Group:** parts stay separate but move together, and the gaps between them stay free floor;
  - **Merge:** joins parts into one outline;
  - **Cut out:** cuts the later shapes out of the first (a cut in the middle makes a **hole**);
  - **Overlap:** keeps only the shared area;
  - **Separate:** undoes any of these.
- **Real geometry everywhere:** holes and separate parts are kept in collisions, the room boundary,
  the optimizer, saving, loading, export and the 3D view. A stool can stand in the middle of a
  ring-shaped bench. A circle stays four true curves, so it's round in 2D and 3D.
- **Editable later:** the recipe of shapes and operations is saved with the piece, so you can
  reopen it and move or resize its parts.

### Feng Shui / Harmony (Phase 4, optional)
Off until you switch it on (**Optimize → Feng Shui / Harmony**). It's an interpretive design
tradition, and Roomination treats it that way: it measures a few arrangement ideas from the plan,
labels them as interpretive preferences, and **makes no claims about luck, health or wealth**.

- **Commanding position:** for the bed, desk or main seat (depending on the room's purpose),
  measured from where the person sits or lies and which way they look:
  - can they see the entrance;
  - are they out of the doorway's straight line;
  - is there a solid wall behind them.
- **Bedroom:** room on both sides of a double bed, and balanced bedside tables.
- **Office:** room behind the seated person.
- **Living room:** seats turned towards each other at a sociable distance, and a clear entrance.
- **Flow:** explained as open, direct walking routes (measured), never as an "energy".
- **Bagua map:** an optional, see-through overlay on the floor, drawn underneath the furniture so it
  never gets in the way of selecting or moving anything. Choose a tradition:
  - **Entrance (Western):** a 3 × 3 grid lined up with the main entrance;
  - **Compass (classical):** eight directions around the room's centre. You type which way the top
    of the plan faces; Roomination **never guesses it** and never uses your location or device
    sensors.

  Each area has a short explanation of its traditional association.
- Feng Shui never overrides the hard rules, and it can be switched off completely.

### Room & furniture (Phase 1)
- Rooms with exact measurements, shown in cm or ft/in
- A correctly scaled floor plan with a measurement grid and dimension labels
- Furniture you can drag, rotate (handle, buttons or `R`), resize, recolour and delete
- Nothing can be placed outside the room's real outline, at any rotation, including in L- and U-shaped rooms
- Undo / redo for every change (`Ctrl/⌘ Z`, `Ctrl/⌘ Shift Z`)

### Room features (Phase 2)
Add these from **Room features** in the left panel. Each one has a name, size, position and its own
settings, and supports undo/redo and saving.

| Feature | What it does |
| --- | --- |
| **Door** | Snaps to a wall and cuts a real gap in it. Hinged, double or sliding. Opens in or out, hinged left or right. Shows its swing arc and warns when furniture is in the way. |
| **Window** | Sits in the wall with an architectural symbol. Width, height and sill height. Drag it along its wall or onto another wall. |
| **Vent** | Wall, floor or ceiling mounted, with an adjustable clearance zone. Reports roughly how much of it furniture covers (e.g. “about 20%”). |
| **Outlet / light switch** | Snap to walls. Warn when furniture blocks access, but only furniture tall enough to reach them counts. Outlets can be standard, USB, GFCI or 240 V. |
| **Ceiling light** | Pendant, flush, recessed or chandelier. Drawn translucent and dashed so it reads as “above” the furniture. |
| **Radiator / column** | Fixed objects with editable size, position and optional clearance. |

### Walls & room shape (Phase 2.5)
Find these under **Walls** in the left panel (or **Add → Walls** on a phone).

- **Draw room shape:** click or tap to place corners; tap the first corner (or **Close room**) to
  finish. Rectangles, L- and U-shaped rooms, alcoves and any other non-crossing shape all work.
- **Interior wall:** draw a freestanding partition, as many segments as you like, then **Finish
  wall**.
- **No mouse needed:** while drawing you can type a start point, then each wall's **length and
  angle** (0° right, 90° down, 180° left, 270° up). The keyboard also works: **Enter** finishes,
  **Backspace** removes the last point, **Esc** cancels.
- **Snapping:** to existing corners, onto walls, lining up with other corners, to a grid
  (1–50 cm), and to angle steps (15°/30°/45°/90°). Each can be switched off under **Snapping**.
- **Edit walls & corners:** select any wall (on the plan or in the **Walls** list) to:
  - set its exact **length**, **angle** and **thickness**;
  - **add a corner** in the middle (split the wall), **merge** it with a straight continuation, or
    **delete** it.
  
  Drag the round corner handles to reshape the room, and the connected walls stay joined.
  Corners can also be positioned by typing.
- **Features follow their walls:** doors, windows, outlets, switches, wall vents and radiators move
  and turn with their wall, and door swings rotate with it. Features can be moved to another wall
  from their settings or by dragging.
- **Safe edits:** if a change would make walls cross, turn the room inside out, or leave a wall too
  short for something on it, it's refused with an explanation. Nothing is deleted or moved off a
  wall silently.

### Stairs (Phase 2.5)
- Add **straight**, **L-shaped**, **U-shaped** or **custom** staircases from **Stairs**.
- Set the name, width, direction (up/down), which way it turns, the total rise, the position and
  the rotation.
- Edit each **flight** (length, number of steps) and **landing** (length, and whether the stair
  turns left, right or carries on). Add or remove sections freely.
- Drawn with tread lines, hatched landings, a walking-line arrow and an **UP**/**DN** label.
- Layouts that would overlap themselves are flagged with a warning instead of failing.
- Furniture on a staircase triggers the usual overlap warning, and can be allowed per item.
- Roomination shows rise per step and tread depth as planning estimates only. **It does not check
  building codes or stair safety.**

### Optimize Layout (Phase 3A, improved in Phase 4)
Click **Optimize** in the header, in the **Optimize** tab, or the ✨ button on a phone. Roomination
tries many arrangements **on your device** and suggests up to three genuinely different layouts.

- **Room purpose:** living room, bedroom, home office, studio, dining room or multipurpose.
  Roomination guesses it from the furniture; you can change it. It chooses which pieces matter
  most (for example the bed in a bedroom).
- **Modes** (function / appearance / Feng Shui):
  - **Functional** (85 / 15 / 0): clear doorways and walkways, reachable stairs, vents and outlets,
    and furniture you can actually use.
  - **Balanced:** a slider sets how much function and appearance count.
  - **Aesthetic** (30 / 70 / 0): alignment, balance, tidy spacing, seating and TV facing each
    other.
  - **Feng Shui** (45 / 15 / 40): only when Feng Shui is switched on.
  - **Custom:** your own percentages, which always add up to 100%.
- **Practical in every mode** (Phase 4): a layout that looks tidy but isn't usable scores lower in
  every mode. Roomination checks:
  - space in front of each piece: legroom at a sofa, room to pull out a desk chair, to open
    storage, and to watch a TV;
  - room to get into a double bed from both sides;
  - walking routes that aren't needlessly long.
- **The usual pairings, assumed** (Phase 4): a chair goes with a desk, seats face the TV, the coffee
  table goes in front of the sofa, bedside tables beside the bed, dining chairs around the table.
  They're listed in the dialog, can be switched off, and never override a relationship you set.
- **Hard rules always apply, whatever the emphasis:** pieces stay inside the room's real outline,
  never overlap furniture, walls, columns or radiators, and stay off stairs and out of door swings.
  Overlaps you previously allowed only apply to the exact positions you approved.
- **Your control:**
  - **Lock position:** set it on any piece, or use the lock buttons and *Lock all* in the dialog.
    Locked pieces can't be dragged or moved by the optimizer until you unlock them.
  - **Choose pieces:** decide which pieces the optimizer may move. Rugs are left alone unless you
    include them.
  - **Walls, doors, windows and stairs never move.**
- **Tell it what matters** in each piece's properties, under *Layout planning*:
  - **What it is:** desk, sofa, bed, TV and so on.
  - **Placement preferences:** e.g. near a window, near an outlet, against a wall, facing the TV,
    bed reachable from both sides.
  - **Relationships between specific pieces:** e.g. chair in front of desk, sofa faces TV,
    bedside table beside bed.

  Nothing is assumed from names or categories.
- **Each suggestion shows:**
  - a floor-plan preview (moved pieces dashed), next to your current layout;
  - a measured **before / after table**: overlaps, blocked doors and stairs, reachable floor,
    extra walking, pieces with what they go with, room in front, and the functional, appearance
    and (when on) Feng Shui scores;
  - overall, functional, aesthetic*, Feng Shui* and preference scores;
  - *why it's suggested*, *trade-offs* and *still to look at*;
  - a full **score breakdown** with the measurement behind each number.

  Every explanation comes from a measured difference, e.g. "Moved the Desk 1.8 m closer to an
  outlet". *Aesthetic scores are a matter of taste and are labelled as such.
- **Non-destructive:**
  - **Preview on plan** shows a suggestion without changing anything.
  - **Apply layout** changes only positions and rotations, as one undo step.
  - **Save as layout** keeps it with the project to apply later.
- **Reproducible:** the same room, settings and **seed** always give the same suggestions.
  **New** tries a different seed.
- **Honest when it can't help:** if the furniture can't fit (for example, too much for the floor),
  it explains why instead of inventing a layout. If fewer than three distinct layouts exist, it
  says so.
- **Walkway width** (75 cm by default) is your comfort preference for this plan. **It is not a
  building-code or accessibility check**, and Roomination doesn't verify regulatory compliance.

How it works: a greedy placement (anchors first, at wall-hugging and relationship-based spots)
followed by seeded **simulated annealing**, run in a **Web Worker** so the page stays responsive.
Progress shows as it runs, and **Cancel** stops it at once.

- **Walking space:** measured on a grid with a distance transform and flood fill from each door,
  not just as a percentage of empty floor.
- **Scoring rules, algorithm, measured timings and limitations:** see
  [ADR-0002](docs/adr/0002-layout-optimizer.md).

Why Phase 4 changed it, and the audit that found 27 practical problems hidden behind scores of
97–100: [ADR-0005](docs/adr/0005-design-shape-builder-optimizer-feng-shui.md). Ten realistic test
rooms (`src/optimizer/scenarios.ts`) now check every suggestion for practical sense, not just a high
score.

Typical times on a laptop:
- **Quick:** 0.1–0.4 s.
- **Standard:** 0.6–1.7 s.
- **Thorough:** 2–5.5 s (rooms with up to 11 movable pieces).

### 3D view (Phase 3B)
Switch between **2D Plan** and **3D View** above the canvas. Both show the same project: the 3D
view has no data of its own and updates instantly when you change anything in the plan. Editing
stays in 2D. In 3D you can look around and select furniture.

- **Room:**
  - The floor follows the real room outline, including L-shaped, U-shaped and angled rooms, with
    the same floor pattern at the same real-world scale as the plan.
  - Walls have their real thickness and mitered corners. Interior walls are included.
  - Walls rise to the room's **ceiling height** (Room → Ceiling); changing it never changes the
    plan's measurements.
  - **Wall colour (3D)** lives under Floor & walls.
- **Doors and windows:**
  - They cut real openings through the wall.
  - Doors show their hinge side and swing (shown slightly open), double doors have two leaves,
    and sliding doors have panels.
  - Windows use their width, height and sill height, with a frame and glass.
- **Stairs:** straight, L-shaped, U-shaped and custom stairs are built step by step from their
  rise, with landings. Stairs going down cut through the floor. There is no second floor, and
  nothing here is a building-code check.
- **Furniture:** detailed models per type (see *Visual rendering*). Each stays inside the
  piece's real width, depth and height, keeping its colour and rotation.
- **Camera:**
  - Drag to orbit, scroll or pinch to zoom, and right-drag or two-finger drag to pan.
  - Buttons zoom and fit the room, and three angles are offered: **Isometric**, **Top-down** and
    **Eye level**.
  - Camera moves are short and can be interrupted. With *reduce motion* switched on, they jump
    instead.
- **Walls display:**
  - **Show all walls**.
  - **Dollhouse view** hides the walls between you and the room as you orbit (display only).
- **Selection:**
  - Click or tap furniture to select it. The same piece is selected in the plan, and its name and
    size are shown.
  - On phones and tablets, **Edit** opens the properties.
- **Performance:**
  - Three.js (MIT licence) is bundled with the app, not loaded from a CDN, and only downloads the
    first time you open 3D.
  - It draws only when something changes, and frees all graphics memory when you go back to 2D.
  - Soft shadows can be switched off. They start off on touch devices.
  - Quality presets (see *Visual rendering*) trade detail for speed.
- **If WebGL is unavailable** (or the device reclaims graphics memory), the 3D view explains
  this and offers a way back. The 2D plan always keeps working.

Design and trade-offs: [ADR-0003](docs/adr/0003-3d-view.md).

Measured at Phase 3B, with the simpler furniture of the time, on a stress project (40 walls, 150
pieces, 4 doors, 5 windows and 3 staircases), production build (current figures: *Visual
rendering*):

| | Apple M3 Pro (GPU) | Software rendering (CI) |
| --- | --- | --- |
| Open 3D (first frame) | 0.26 s | 2.3 s |
| Scene build | 7 ms | 8 ms |
| Frame rate while orbiting | 60 fps (display limit) | 35 fps |
| Draw calls / triangles | 53 / 16,772 | 53 / 16,772 |

### Custom and photo furniture (Phase 3C)
Furniture isn't limited to rectangles. In the **Furnish** tab you'll find **Draw custom
furniture**, **Create from photos**, the **Shape Builder** (Phase 4) and your **furniture
library**.

- **Drawing:**
  - Click or tap to place corners, or start from a template: L-shaped desk, corner table, angled
    loveseat, curved sofa or kidney table.
  - Drag corners, add a corner in the middle of an edge, or delete corners.
  - Type exact positions, edge lengths, inside angles and overall width and depth.
  - Turn any edge into a curve (a cubic Bézier curve with two handles).
  - Undo, redo and reset work throughout.
  - Outlines that cross themselves are refused, with an explanation.
  - Everything that can be done with a mouse can also be typed. Corners also move with the arrow
    keys.
- **True footprint everywhere:** the outline (curves flattened to within 0.5 cm) is what
  collisions, the room boundary, clearance checks, rotation, the optimizer and the 3D view all
  use. An L-shaped desk never behaves like its bounding box.
- **Keep clear in front:** a piece can ask for space to be kept free in front of it. It's checked
  like door clearances, and the optimizer won't fill it.
- **Appearance:**
  - Colour, a material (fabric, leather, wood, metal, glass, plastic or custom) and a finish
    (matte, satin or gloss), with a live preview.
  - Materials are generated on your device.
- **Photos:**
  - Add a front, side, top or other photo. One is enough: *for best results, photograph your
    furniture from the front, the side and above.*
  - Crop, rotate, and straighten a photo taken at an angle by dragging its four corners.
  - Remove the background:
    - **by colour**, instantly, for plain walls and floors;
    - with **Room scans** are read in your browser and only their geometry is used. Photos, LiDAR meshes,
depth recordings and AR world maps inside a scan's .zip are never opened. Nothing is uploaded,
and the browser tests check that importing makes no outside requests.

**Smart remove**, a small AI model that runs on your device;
    - **by hand**, with erase and restore brushes, then shrink, grow or soften the edges.
  - Photos can be shown on the top, front and sides of the 3D model.
- **Tracing:** show a photo under the drawing, set its scale by marking a known length (for
  example the sofa's width), then trace the outline by hand or automatically from the cut-out.
  A photo has no scale of its own, and photos taken at an angle distort shapes, so always check
  the measurements.
- **Library:**
  - Save any piece (shape, size, appearance and photos) to reuse in every project on this device.
  - Place, edit, duplicate and delete library pieces.
  - Pieces are labelled **Standard**, **Custom** or **Photo-assisted**.
- **Export:** projects with photos export as a `.roomination.zip` containing the photos. Projects
  without photos still export as JSON.

Design and trade-offs: [ADR-0004](docs/adr/0004-custom-and-photo-furniture.md).

### Smart overlaps
- Items have categories: **furniture**, **rugs & mats** (floor coverings) and **décor**.
- Rugs sit underneath furniture and may overlap anything.
- When a change makes furniture overlap another piece, or intrude on a door swing, vent, outlet,
  radiator, column, staircase or interior wall, both objects are highlighted. A single message then offers **Move it back**
  or **Allow overlap**. Nothing is ever blocked automatically.
- An allowed overlap applies to that **one pair of objects** only. It's saved, can be withdrawn,
  and is forgotten once the objects no longer overlap. Allowing an overlap is never presented as
  "safe".
- **Checks** (in the **Furnish** tab, whose label shows how many are open) lists everything that
  needs a look, plus what you've allowed.
- Overlaps use exact geometry for rotated shapes. While you drag, only the moving item is
  re-checked, so dragging stays smooth and never spams messages.

### Which version am I using?
The tools panel's footer shows the version (the build's commit) and its date. GitHub Pages lets
browsers reuse the page for up to 10 minutes, and an open tab keeps the version it loaded, so
**reload the page** to get the latest release.

### Look & feel
- **Light, dark or system theme**, remembered on this device (see *Design and navigation*).
- **Floors:** plain, hardwood, light oak, dark walnut, ceramic tile, concrete or carpet. You can set
  the colour, pattern size, angle and texture strength. Textures are generated in the browser and
  anchored to the room's corner in real centimetres, so they stay aligned at any zoom.
- **Board** (the area around the room): solid, dots, squares, graph paper or drafting board. You
  can set its colour, spacing and opacity.
- These are visual only. They never change a measurement.

### Projects
- Multiple saved projects. Open, rename, **duplicate** (handy for “Layout A / B / C”) and delete,
  with a confirmation before deleting.
- **Export** a project as a `.roomination.json` file, and **import** one back. Imports always
  create a new project; nothing is silently overwritten.
- Imported files are fully validated, so a damaged or incompatible file shows a message instead of
  crashing. Projects saved by Phase 1 load automatically.

### Works everywhere
- **Desktop:** three panels (tools with their four tabs · plan · properties).
- **Tablet:** the plan takes priority, and the tools panel folds away.
- **Phone:** the plan comes first. A bar underneath offers **Edit**, rotate and delete, and **Add**
  opens a sheet of items, walls and stairs. Double-tap an item to edit it (the Edit button always
  works too).
- **Touch screens:** tap an item to select it, then drag it. Swiping over the plan with nothing
  selected scrolls the page, so you never move furniture by accident. Controls are at least 44 px
  tall on touch screens.

## Run it locally

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
npm run dev      # then open http://localhost:5173
```

Other commands:

```bash
npm test          # unit tests: geometry, walls, stairs, overlaps, editor/undo, storage, 3D scene, performance
npm run test:e2e  # browser tests (Playwright) on the dev server AND the production build
npm run build     # production build into dist/ (static files)
npm run preview   # serve the production build locally
npm run check     # quick: TypeScript + production build
npm run test:smoke  # quick: one short pass through each main workflow (~10 s)
npm run test:full   # everything, as a release needs (unit, browser on both builds, 3D)
```

New features are prototyped on `proto-*` branches with the quick checks, then fully tested before
release: see [docs/release-checklist.md](docs/release-checklist.md) and
[docs/prototype-log.md](docs/prototype-log.md).

Before the first `npm run test:e2e`, install a browser once with `npx playwright install chromium`.
To use an existing Chromium instead, set `PW_CHROMIUM_PATH` to its executable.

## Deploy to GitHub Pages

The repository includes `.github/workflows/deploy.yml`. On every push to `main` it runs the unit
and browser tests, builds the site and publishes it.

1. Push the repository to GitHub.
2. On GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions** (one-time setup).
3. Push to `main`, or run the workflow from the **Actions** tab. The site appears at
   `https://<your-user-or-org>.github.io/<repository-name>/`.

The build uses relative asset paths, so it works from any repository sub-folder without
configuration. GitHub Pages is free for public repositories.

## How the code is organised

| Folder | What lives there |
| --- | --- |
| `src/model/` | Pure logic, all in **centimetres**. Main modules: data shapes (`types.ts`); polygon maths (`polygon.ts`); custom furniture outlines, holes and separate parts, and their convex decomposition (`shape.ts`, `shapeEdit.ts`); the Bagua map (`bagua.ts`); walls and their editing (`walls.ts`, `wallGeometry.ts`); keeping things inside the room (`placement.ts`); re-checking everything after a wall change (`roomChange.ts`); features, stairs, snapping, overlaps (`conflicts.ts`); units; and the sample room. |
| `src/state/` | `editor.ts`, the single reducer every change goes through (validation, overlap prompts, undo history), plus selection, display preferences and the optimizer run state. |
| `src/optimizer/` | The layout optimizer. Main modules: walking-space grid and walking distances (`circulation.ts`); practical checks (`practical.ts`); assumed pairings and room purpose (`semantics.ts`); Feng Shui scoring (`fengShui.ts`); scoring (`scoring.ts`); search (`search.ts`); orchestration (`optimize.ts`); explanations and before/after tables (`explain.ts`); realistic test rooms (`scenarios.ts`); the Web Worker. Pure TypeScript, reusing the model's geometry. |
| `src/builder/` | Lazy-loaded builders: the Shape Builder (recipe maths in `recipe.ts`) and the Advanced Furniture Builder (`FurnitureBuilder.tsx`; edge bands, insets and cut seats in `componentGeometry.ts`; templates in `furniturePresets.ts`), using polygon-clipping. `model/components.ts` holds the lightweight part every view needs (nesting, overflow checks, editing helpers). |
| `src/storage/` | IndexedDB persistence (Dexie: projects, photos, furniture library), import/export validation and migration (schema v1–v7), and ZIP packaging for projects with photos. |
| `src/scan/` | Room-scan import (lazy-loaded): a bounded ZIP reader that opens only geometry (`zip.ts`), readers for RoomPlan JSON and `roomination-scan` files (`roomPlan.ts`, `scanFormat.ts`), the scan-to-project conversion (`convert.ts`, pure and unit-tested), catalogue matching (`furnitureMap.ts`), synthetic sample scans (`samples.ts`) and the review dialog. |
| `src/photo/` | Photo tools (lazy-loaded): image operations (pure, unit-tested), the photo workers, on-device "Smart remove", and outline tracing. |
| `src/components/studio/` | The furniture studio: drawing and editing custom outlines (lazy-loaded). |
| `src/scene3d/` | The 3D view. `model.ts` turns a project into plain shapes (pure, unit-tested, in cm, using the same wall and stair geometry as the plan); `furnitureParts.ts` gives each furniture type its shape; `three/RoomViewer.ts` draws them with Three.js. |
| `src/render/` | Canvas colours per theme; locally generated floor and rug textures; the shared furniture parts model (`furnitureParts.ts`) and surface materials (`materials.ts`) used by both views; the presentation plan's illustrations (`planIllustration.ts`). |
| `src/export/` | Local PNG export of the 2D plan and 3D views. |
| `src/components/` | The interface. `plan/` holds the floor plan canvas (React Konva). |
| `e2e/` | Browser tests (Playwright). |
| `docs/adr/` | Architecture decisions, e.g. [how rooms, walls and stairs are modelled](docs/adr/0001-polygon-rooms-walls-stairs.md). |

**Coordinate system:**
- **Rooms:** the room outline is a clockwise chain of corners, measured in cm on a plane where x
  runs right and y runs down. Each wall runs from one corner to the next, so neighbouring walls
  always share a corner. Interior walls are open chains.
- **Furniture and stairs:** positioned by their centre, with rotation in degrees clockwise.
- **Wall features:** store which wall they're on and their distance from that wall's start, so they
  move with it.
- **Pixels:** exist only inside `components/plan/`.
- **3D:** uses metres, with height pointing up. Plan x becomes 3D x, plan y becomes 3D z, and
  height becomes 3D y. The conversion lives in one function, `toScene`.

Projects saved by earlier versions (rectangles with named walls, no furniture types or locks) are
converted automatically. Older pieces get a type guessed from their name, are unlocked, and have no
preferences. Projects from before the 3D view get the default wall colour (and a 240 cm ceiling if
one is ever missing). No measurement changes.

## Privacy

Roomination makes no network requests of its own, except to download its own files from the
site you opened it from (for example the 3D view or the Smart remove model, only when you use
them). Project data leaves your device only when you
export a file yourself. The layout optimizer runs entirely in your browser (in a bundled Web
Worker), with no AI service, API or account. The 3D view is drawn entirely on your device by the
bundled Three.js, with no external textures, models or services.

**Photos never leave your device:**
- They're edited in your browser.
- They're stored in its IndexedDB.
- They're only ever included in a file when you export one yourself.

**Feng Shui's compass method** uses only the bearing you type in. Roomination never reads your
location, compass or other device sensors.

**Bundled libraries added in Phase 4:** earcut (ISC) triangulates shapes with holes;
polygon-clipping (MIT) does the Shape Builder's merges and cuts, and loads only with the builder.

**Smart remove** uses U²-Net-p (Apache-2.0) run by onnxruntime-web (MIT):
- Both are bundled with Roomination (see `public/models/README.md`).
- The first use downloads about 19 MB from this site, and the browser then caches it.
- Inference runs in a Web Worker on your device. No photo is sent to any server or AI service.

**Select an area** (Match my room → Pick colour → *Selecting an area (AI)*, optional, beta) uses
MobileSAM (Apache-2.0; Segment Anything's mask decoder, Apache-2.0; ONNX export by Acly, MIT),
quantized to 8 bits here, run by the same onnxruntime-web engine:
- Nothing is downloaded until you turn it on. Then 19 MB of model (and up to 14 MB of engine,
  shared with Smart remove) come from this site only, are checked against their SHA-256 sums
  and kept in the browser (see `public/models/mobilesam/README.md`).
- Tap an object or surface: it's outlined on your device, its typical colour is suggested, and
  nothing changes until you apply it (undoable). Photos and masks never leave the device.
- It can be turned off, deleting the downloaded model, at any time; tapping a point works
  without it.

## Known limitations

- **Presentation plan and 3D models:**
  - furniture is generated per type, so a piece looks like a typical sofa or bookshelf of its
    size, not your exact model (use photos for that);
  - drawn custom shapes get a material finish unless you build them from components (Advanced
    Furniture Builder);
  - components are rigid shapes: upholstery doesn't sag or wrinkle, and photos stay with the
    whole piece rather than individual components;
  - wall cabinets, cooker hoods and wall art aren't in the catalogue yet: collisions are checked
    in plan only, so a cabinet hung above a counter would count as overlapping it;
  - from above you only see tops, so a desk's drawers or a wardrobe's doors appear only in 3D;
  - names refine some designs ("desk chair" gets an office chair, "lamp" a floor lamp), so an
    oddly named piece may get a plainer design.
- **Room scans:**
  - furniture is measured as boxes in RoomPlan's 16 categories; looks are catalogue guesses;
  - wall thickness, door swing and which end of a stair is the bottom aren't measured;
  - one ceiling height per room, so soffits and slopes are reported, not modelled;
  - raised objects (a TV on its unit, wall cabinets) start unticked;
  - one room or one floor at a time;
  - LiDAR meshes, photos and USDZ files aren't imported;
  - tested with synthetic scans only so far.
  See [docs/scan-import.md](docs/scan-import.md).
- **Image export:** very large images depend on the device's graphics and memory limits; 4K is
  disabled where the browser can't allocate it. 3D export uses a preset camera, not the exact
  orbit position on screen.
- **Ambient occlusion** isn't used; contact shadows and soft key-light shadows stand in for it.

- **Optimizer — what it changes:** it moves and turns furniture, but never adds, removes or
  resizes it.
- **Optimizer — rotations:** it considers rotations square to the room's walls. Pieces at other
  angles keep their angle only if they aren't moved.
- **Optimizer — rugs:** they aren't arranged unless included, and nothing lines them up with the
  furniture above them.
- **Optimizer — taste:** aesthetic measures encode common conventions (pieces square to walls,
  storage against walls, seating facing the TV). They are a guide, not objective facts.
- **Optimizer — large plans:** very large plans (30+ movable pieces) take proportionally longer.
- **3D — editing:** the 3D view is for looking and selecting; moving, resizing and editing
  happen in the 2D plan.
- **3D — looks:** furniture is procedural (generated from each piece's type and size), not
  modelled from real products. There are no ceilings, per-wall colours, wall-height variations or
  upper floors. Stairs going down show their stairwell, but
  not the room below.
- **3D — window views:** glass is see-through but nothing is shown outside the room.
- **3D — browsers:** the 3D view needs WebGL. Very old devices, some locked-down workplace
  browsers, and browsers with hardware acceleration turned off fall back to a message (the 2D
  plan keeps working). Shadows are switched off automatically on touch devices for very large
  scenes.
- **Photo tools — what they don't do:**
  - They can't measure: sizes come from the numbers you enter.
  - "Straighten" fixes perspective only as well as you place the corners.
  - Automatic tracing and background removal work best on plain backgrounds, and Smart remove
    can miss parts of busy scenes, so the eraser and restore brushes are there to fix that.
- **Photo textures:** these are projected onto flat surfaces, so curved surfaces stretch the
  photo. This is a recognisable approximation, not a 3D scan.
- **Photo formats:** JPEG, PNG and WebP are supported. HEIC opens only in browsers that support
  it (Safari).
- **Photo size:** photos are resized to at most 1600 px.
- **Photo storage:** photos use browser storage. Browsers can clear it under storage pressure or
  if you clear site data, so export projects you care about. **Projects → Photos & storage**
  shows usage and removes unused photos only when you confirm.
- **Custom shapes:**
  - up to 2,000 corners in total (outline, holes and separate parts);
  - curves are flattened to within 0.5 cm for all calculations, and shapes combined in the Shape
    Builder (merged, cut or overlapped) are stored that way, so they lose their exact curves;
  - stretching a group that contains a shape turned at an odd angle scales that shape evenly, so it
    keeps its shape;
  - the 3D model is the outline extruded to the piece's height, a simplified shape;
  - the drawing studio edits the main outline; holes and separate parts are edited in the Shape
    Builder.
- **Optimizer — pairings:** assumed pairings are educated guesses from furniture types (for
  example the nearest chair to a desk). Switch them off, or set your own relationships, when they
  don't fit.
- **Feng Shui:** traditions differ more than any one scoring can capture. The scores are a guide to
  a few common principles, not a full consultation. The Bagua map is drawn under the furniture, so
  some of its labels can be hidden by large pieces (the legend lists every area).
- **Testing coverage:** browser tests run in Chromium, including simulated phones and tablets.
  Safari, Firefox and real touch devices haven't been tested automatically, and screen readers
  haven't been tested with real assistive software. On CI (which has no GPU) the 3D tests use software
  WebGL, so they check behaviour and accuracy rather than real-device speed.

## Licence

MIT © The Progress Quest
