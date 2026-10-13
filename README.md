# Roomination 🏠

*A little less guessing. A lot more room for living.*

A free, open-source, privacy-first room planner by **The Progress Quest**. Everything runs in your
browser: rooms, measurements and layouts are saved on your device (IndexedDB) and are never sent
anywhere. There are no accounts, no analytics, no ads and no servers.

## Features

### Room & furniture (Phase 1)
- Rectangular rooms with exact measurements, shown in cm or ft/in
- A correctly scaled floor plan with a measurement grid and dimension labels
- Furniture you can drag, rotate (handle, buttons or `R`), resize, recolour and delete
- Nothing can be placed outside the room, at any rotation
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

### Smart overlaps
- Items have categories: **furniture**, **rugs & mats** (floor coverings) and **décor**.
- Rugs sit underneath furniture and may overlap anything.
- When a change makes furniture overlap another piece, or intrude on a door swing, vent, outlet,
  radiator or column, both objects are highlighted. A single message then offers **Move it back**
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
  opens a sheet of items. Double-tap an item to edit it (the Edit button always works too).

## Run it locally

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
npm run dev      # then open http://localhost:5173
```

Other commands:

```bash
npm test         # unit tests: geometry, overlaps, editor/undo, storage, import validation
npm run build    # production build into dist/ (static files)
npm run preview  # serve the production build locally
```

## Deploy to GitHub Pages

The repository includes `.github/workflows/deploy.yml`, which tests, builds and publishes the site
on every push to `main`.

1. Push the repository to GitHub.
2. On GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions** (one-time setup).
3. Push to `main`, or run the workflow from the **Actions** tab. The site appears at
   `https://<your-user-or-org>.github.io/<repository-name>/`.

The build uses relative asset paths, so it works from any repository sub-folder without
configuration. GitHub Pages is free for public repositories.

## How the code is organised

| Folder | What lives there |
| --- | --- |
| `src/model/` | Data shapes (`types.ts`), geometry, polygon maths, room features (`features.ts`), overlap detection (`conflicts.ts`), units and the sample room. All lengths are **centimetres**. |
| `src/state/` | `editor.ts`, the single reducer every change goes through (validation, overlap prompts, undo history), and display preferences. |
| `src/storage/` | IndexedDB persistence (Dexie) and import/export validation and migration. |
| `src/render/` | Canvas colours per theme and the locally generated floor/rug textures. |
| `src/components/` | The interface. `plan/` holds the floor plan canvas (React Konva). |

**Coordinate system:** the origin is the room's top-left inside corner, x runs right and y runs
down. Furniture is positioned by its centre, and rotation is in degrees clockwise. Wall features
store which wall they're on plus their distance along it. Pixels exist only inside
`components/plan/`.

## Privacy

Roomination makes no network requests of its own. Project data leaves your device only when you
export a file yourself.

## Licence

MIT © The Progress Quest
