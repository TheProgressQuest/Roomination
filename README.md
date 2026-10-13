# Roomination 🏠

*A little less guessing. A lot more room for living.*

A free, open-source, privacy-first room planner by **The Progress Quest**. Everything runs in your
browser: rooms, measurements and layouts are saved on your device (IndexedDB) and are never sent
anywhere. There are no accounts, no analytics, no ads and no servers.

## Features

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

### Smart overlaps
- Items have categories: **furniture**, **rugs & mats** (floor coverings) and **décor**.
- Rugs sit underneath furniture and may overlap anything.
- When a change makes furniture overlap another piece, or intrude on a door swing, vent, outlet,
  radiator, column, staircase or interior wall, both objects are highlighted. A single message then offers **Move it back**
  or **Allow overlap**. Nothing is ever blocked automatically.
- An allowed overlap applies to that **one pair of objects** only. It's saved, can be withdrawn,
  and is forgotten once the objects no longer overlap. Allowing an overlap is never presented as
  "safe".
- **Checks** in the left panel lists everything that needs a look, plus what you've allowed.
- Overlaps use exact geometry for rotated shapes. While you drag, only the moving item is
  re-checked, so dragging stays smooth and never spams messages.

### Look & feel
- **Light, dark or system theme**, remembered on this device.
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
- **Desktop:** three panels (tools · plan · properties).
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
npm test          # unit tests: geometry, walls, stairs, overlaps, editor/undo, storage, performance
npm run test:e2e  # browser tests (Playwright) on the dev server AND the production build
npm run build     # production build into dist/ (static files)
npm run preview   # serve the production build locally
```

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
| `src/model/` | Pure logic, all in **centimetres**. Main modules: data shapes (`types.ts`); polygon maths (`polygon.ts`); walls and their editing (`walls.ts`, `wallGeometry.ts`); keeping things inside the room (`placement.ts`); re-checking everything after a wall change (`roomChange.ts`); features, stairs, snapping, overlaps (`conflicts.ts`); units; and the sample room. |
| `src/state/` | `editor.ts`, the single reducer every change goes through (validation, overlap prompts, undo history), plus selection and display preferences. |
| `src/storage/` | IndexedDB persistence (Dexie) and import/export validation and migration (schema v1–v3). |
| `src/render/` | Canvas colours per theme and the locally generated floor/rug textures. |
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

Projects saved by earlier versions (rectangles with named walls) are converted automatically.

## Privacy

Roomination makes no network requests of its own. Project data leaves your device only when you
export a file yourself.

## Licence

MIT © The Progress Quest
