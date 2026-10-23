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

## Technical debt

| Item | Notes |
| --- | --- |
| Match My Room panel touch targets | Some panel buttons are the small (32 px) size; check on iPhone and iPad before release (44 px rule) |
| Full regression not run for M2.1–M2.4 | Only targeted tests, the 3D suite and smoke tests; run `npm run test:full` before release |
| Match My Room panel (~400 lines) | Tested on desktop with synthetic photos; touch dragging of corners not yet tried on an iPhone |
| New fixtures (vanities, mirrors, lights, curtain, towel bar) only checked in synthetic screenshots | Look at them on a real device and at eye level |
| `custom.spec.ts` “draws a new outline corner by corner” is flaky on CI | It occasionally lands 2 cm off; it passes on retry |
| GitHub Actions use Node 20 versions of `checkout` / `setup-node` | GitHub warns they're deprecated; update to newer action versions |
| `src/scan/ScanImportDialog.tsx` is large (~700 lines) | Split the tabs into files if it grows |
| Startup download creeping up (293.7 → 297.1 kB gz in 8A) | Watch it; keep new features lazy-loaded |
