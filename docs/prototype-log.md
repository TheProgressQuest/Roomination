# Prototype log

What the prototype loop has deferred: tests not yet written, known limitations and technical
debt. Every item here is checked before a public release (see
[release-checklist.md](release-checklist.md)). Newest first within each section.

## Deferred tests

| Area | What's missing | Since |
| --- | --- | --- |
| Room scan import | A real RoomSheet scan (iPhone 17 Pro): checked locally by status only (it reads, 4 walls, 1 door, 5 objects, project valid). Still to do: look at it in 2D/3D in Safari against the real room | M1 |
| Room scan import | A real LiDAR Room Scanner "RoomPlan JSON" export (its structure isn't documented) | M1 |
| Room scan import | A real LiDAR scan end to end; real exports from 3D Model Anything | 8A |
| Room scan import | Safari on iPhone and iPad (file picker from Files, the review on touch) | 8A |
| Whole app | Safari and Firefox browser runs (only Chromium is automated) | earlier |
| Whole app | Screen readers (VoiceOver) with real assistive software | earlier |

## Known limitations

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

## Technical debt

| Item | Notes |
| --- | --- |
| `custom.spec.ts` “draws a new outline corner by corner” is flaky on CI | It occasionally lands 2 cm off; it passes on retry |
| GitHub Actions use Node 20 versions of `checkout` / `setup-node` | GitHub warns they're deprecated; update to newer action versions |
| `src/scan/ScanImportDialog.tsx` is large (~700 lines) | Split the tabs into files if it grows |
| Startup download creeping up (293.7 → 297.1 kB gz in 8A) | Watch it; keep new features lazy-loaded |
