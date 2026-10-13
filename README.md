# Roomination 🏠

*A little less guessing. A lot more room for living.*

A free, open-source, privacy-first room planner by **The Progress Quest**. Everything runs in your
browser: your room measurements and designs are saved on your device (IndexedDB) and are never sent
anywhere.

## Status: Phase 1 (functional MVP)

- Rectangular room with exact measurements (cm or ft/in display)
- Correctly scaled 2D floor plan with a measurement grid and dimension labels
- Add rectangular furniture, then drag, rotate (handle, buttons, or `R`), resize, recolour and delete it
- Furniture can never be placed outside the room, at any rotation
- Undo / redo (`Ctrl/⌘ Z`, `Ctrl/⌘ Shift Z`)
- Autosaves locally; includes a sample living room

## Running it locally

```bash
npm install
npm run dev      # then open http://localhost:5173
```

Other commands:

```bash
npm test         # unit tests (geometry rules, editor/undo, storage)
npm run build    # production build into dist/ (static files, GitHub Pages ready)
npm run preview  # serve the production build locally
```

## How the code is organised

| Folder | What lives there |
| --- | --- |
| `src/model/` | Data shapes (`types.ts`), geometry rules, unit conversion, sample room. All lengths are **centimetres**. |
| `src/state/` | `editor.ts`, the single reducer every change goes through (validation + undo history). |
| `src/storage/` | Local persistence with Dexie (IndexedDB), and validation of saved data. |
| `src/components/` | The UI: floor plan canvas (React Konva), tools panel, properties panel. |

**Coordinate system:** origin at the room's top-left inside corner, x to the right, y downward,
furniture positioned by its centre, rotation in degrees clockwise. Pixels exist only inside
`FloorPlan.tsx`.

## Licence

MIT
