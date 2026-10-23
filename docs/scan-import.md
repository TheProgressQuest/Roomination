# Importing a room scan (LiDAR / RoomPlan)

> **Beta: validated with synthetic scans; real LiDAR scan testing pending.**

Roomination can turn a room scanned with an iPhone or iPad into an editable floor plan. This
page explains what it reads, how the conversion works, how accurate it is, what it can't do,
and how a future Roomination iPhone app could fit in.

**Where:** Projects → *Import room scan…*

## What you need

- **A LiDAR scan.** Scanning needs an iPhone or iPad with a LiDAR Scanner (iPhone 12 Pro or a later
  Pro model; iPad Pro from 2020 onwards) running iOS 16 or later, and an app that uses Apple's
  RoomPlan and can export its result. Apple's RoomPlan only works when
  `RoomCaptureSession.isSupported` is true, which needs the LiDAR Scanner.
- **Roomination can't scan.** No website can use the LiDAR Scanner, so neither GitHub Pages nor
  Roomination's web app can run Apple's RoomPlan scanner. Scanning always happens in a native app.
- **Getting the file across.** Send the exported file to the device you plan on with AirDrop or the
  Files app, then choose it in Roomination. On an iPhone or iPad, the file picker opens Files;
  AirDropped files are in *Downloads*.

## Supported files

| File | Where it comes from | What Roomination reads |
| --- | --- | --- |
| `*.json`: RoomPlan `CapturedRoom` | Any app that saves RoomPlan's result with `JSONEncoder` (Apple's sample code does) | Walls, doors, windows, openings, objects, floor outline and room labels (sections) |
| `structure.json`: RoomPlan `CapturedStructure` | Merged multi-room scans (iOS 17+) | The same; for a building with several floors, the floor with the most walls |
| `*.zip`: 3D Model Anything room or session export (`house-capture/5`) | [3D Model Anything](https://github.com/wesbos/3d-model-anything) by Wes Bos | `rooms/room-N.json` (and `structure.json`). With several rooms, you choose one |
| `*.roomination-scan.json` | A future Roomination scanner app, or written by hand | Everything in it (format below) |

**What's never opened in a ZIP:** photos, LiDAR meshes (`.ply`, `.usdz`), depth recordings
(`.f16z`, `.conf`), AR world maps (`.arworldmap`) and raw capture data (`room-N-data.json`).
The importer reads only the ZIP's table of contents and the geometry JSON. The review screen
lists what it left unopened, e.g. "Not opened: 412 photos, 1,830 depth frames, a 3D model and an
AR world map".

## How the conversion works

The code lives in `src/scan/`. The measured scan is read into one shape, `ScanData`
(`types.ts`), and never changed afterwards. The review screen keeps your corrections
separately, and `buildFromScan` (`convert.ts`) re-creates the project from both on every change.
The preview always shows exactly what will be created, and *Reset* always restores the
measurement.

1. **Units and axes.**
   - RoomPlan's metres are multiplied by 100: centimetres, kept to 0.1 cm.
   - Seen from above, RoomPlan's X becomes the plan's x, and Z becomes the plan's y. That is a
     true top view: left and right aren't mirrored.
   - Heights are measured from the floor: the floor surface, or the lowest wall bottom if the
     scan has no floor.
2. **Elements.**
   - Each wall's ends are its centre ± half its width along its own direction.
   - A door or window's position, width, height and sill come from its transform and dimensions.
   - An object's front is its local +z ("usually the front" in RoomPlan), which becomes the
     piece's rotation.
3. **Orientation.**
   - *Line the walls up with the grid* (on by default) turns the plan by the walls' common
     direction. That direction is a length-weighted average, folded into a quarter turn.
   - *Turn left / Turn right* add quarter turns.
   - Turning is rigid: no length or angle inside the room changes.
4. **Outline.**
   - Wall ends within **30 cm** of each other are joined into a corner where the two walls'
     lines cross (or halfway between them for walls that are nearly parallel).
   - The largest closed loop of walls becomes the room outline.
   - Other walls inside it become interior walls. Walls outside it (seen through a doorway) are
     listed and left out.
   - If the walls don't close, gaps of up to 6 m are bridged with walls marked *added*.
   - If the walls can't form a room at all, the scanned floor outline is used.
5. **Doors, windows and openings.**
   - Each one attaches to the wall the scanner linked it to, or the nearest wall within 60 cm,
     at its measured position.
   - RoomPlan's *openings* (doorways with no door) become doors of the new style *No door*.
   - Openings that overlap on the same wall are reported; the later one is left out until you
     adjust it.
6. **Furniture.**
   - Each object becomes the catalogue piece of its category closest in size to the measured box
     (labelled "Roomination's guess"), stretched to exactly the measured width, depth and height.
   - The room labels in iOS 17 scans (kitchen, dining room…) make suitable pieces preferred: a
     sink in the kitchen is a kitchen sink, and one in the bathroom is a vanity.
   - If nothing in the catalogue is close, or the category is unknown, the object is imported as
     a plain box of the measured size.
   - Stairs become a straight staircase.
   - Kitchen, bathroom and laundry pieces are fixtures, so the optimizer leaves them where the
     scan put them.
   - Objects 30 cm or more above the floor (a TV on its unit, a wall cabinet) start unticked,
     because Roomination places furniture on the floor.
7. **Validation.** The finished project goes through exactly the same checks as any project file
   you open (`parseProjectFile`), so a scan can't create a project the rest of the app can't
   handle.

**Stable ids:** walls, openings and objects keep ids derived from the scanner's identifiers
(e.g. `scan-wall-3f2a…`), so importing the same scan twice gives the same ids.

## The scan record kept with the project

A project made from a scan carries a read-only `scan` record (`ScanRecord` in
`src/model/types.ts`). It is saved, exported and re-imported with the project, and checked
like everything else in the file; a damaged record is dropped without affecting the project.
The record holds:
- the source and the date of the import;
- **the transformation:** degrees turned (clockwise, about the scan's origin), the offset
  applied, and whether the walls were straightened or turned by quarter turns;
- **the ceiling:** measured and, if you changed it, corrected;
- **every wall, opening and object**, with what the scanner measured, its category and
  confidence, where it came from (*scanned*, *reconstructed* by Roomination, or *added* by
  you), Roomination's inferred piece, your corrections, and whether it was left out;
- **notes:** what Roomination assumed or asked you to check.

Selecting a scanned piece, door or window shows this under *From the room scan*. Editing the
plan afterwards doesn't change the record: it's the history of the import.

## Accuracy

- **Tolerance:** lengths, sizes and positions match the source to within **0.1 cm** (they're
  stored to a tenth of a centimetre). The tests check this for rectangular, L-shaped and angled
  rooms.
- **Corners:** joining wall ends into corners can move a corner; the importer says by how much
  (the *Check* list gives the largest move), and the Room tab shows each wall's measured and
  final lengths.
- **The limit is the scanner.** RoomPlan's own accuracy depends on the device, the lighting and
  how carefully the room was scanned. Roomination doesn't make measurements more precise than
  the scan.

## Reviewing a scan

- **Room:**
  - the project name;
  - orientation (line up with the grid, quarter turns);
  - ceiling height (measured: the most common wall height, weighted by length);
  - each wall's measured length, confidence and an editable length. Changing a length moves the
    corner at the wall's end.
- **Openings:**
  - include or leave out each door, window or doorway;
  - change its type, width, height and sill height;
  - add ones the scan missed.
- **Furniture:**
  - include or leave out each object;
  - see what the scanner reported (its category, room and measured box) separately from
    Roomination's guess;
  - change the category or the piece it's shown as, or resize it;
  - add pieces the scan missed.
- **Check:** everything to look at, grouped as *Please check*, *Assumed (not measured)* and *For
  your information*. *Show* jumps to the item.

**Confidence:** the scanner's own labels (high, medium, low) are shown as words, never as made-up
percentages. Low-confidence items are dashed in orange on the preview and edged in orange in
the lists.

**Creating:** *Create new project* always makes a new project. Nothing you already have is
changed or overwritten.

## Limitations

- **What the scanner measures.**
  - RoomPlan measures geometry, not appearance: furniture comes in as boxes in 16 categories
    (no lamps, rugs, plants or décor), and colours and styles are catalogue defaults.
  - Wall thickness isn't measured. Walls are drawn 12 cm thick outside the room, so inside
    measurements are as scanned.
  - Door swing and hinge side aren't measured: doors open into the room, hinged on the left.
  - Stairs don't say which end is the bottom.
  - Curved walls are drawn straight between their ends.
- **What Roomination's model can show.**
  - Roomination has one ceiling height per room. Soffits, beams and sloped ceilings are reported,
    not modelled.
  - Furniture stands on the floor, so raised objects start unticked.
  - One room (or one merged structure) is imported at a time; one floor of a multi-storey
    structure.
- **Conditions that mislead the scan.** Mirrors, glass, very dark rooms and clutter can confuse
  LiDAR. Check walls and low-confidence items against the real room.
- **Not yet supported.**
  - LiDAR meshes and photos aren't imported. They could become optional, local-only reference
    layers later (Phase 8C).
  - USDZ files aren't read: the editable plan always comes from structured data.

## Privacy and file safety

- **Everything is local.** The scan is read in your browser. Nothing is uploaded, no server or
  AI service is involved, and the browser tests check that importing makes **no** requests
  outside the app.
- **Only geometry is read.** Photos, meshes, depth data and world maps inside a ZIP are never
  read, let alone decoded or stored. Only the resulting project is saved, in this browser like
  any other.
- **Limits:**
  - **JSON files:** 25 MB at most.
  - **ZIP files:** up to 4 GB, never loaded whole.
  - **Inside a ZIP:**
    - at most 200,000 entries and 60 MB of JSON read in total;
    - each entry's declared size is checked before it's read;
    - decompression stops as soon as an entry produces more than 25 MB, whatever it claims (a
      "ZIP bomb");
    - encrypted entries are refused;
    - every decompressed entry must match its checksum.
  - **Inside a scan:** at most 1,000 walls, 1,000 openings and 2,000 objects; every number must
    be finite and plausible.
  - **Broken elements:** they are skipped with a note saying how many, never silently.
- **Keep real scans out of the repository.** `.gitignore` excludes common scan files
  (`*.ply`, `*.usdz`, `*.arworldmap`, `*.f16z`, `scans/` folders…). Test scans are synthetic
  and generated in `src/scan/samples.ts`.

## The `roomination-scan` format (version 1)

A small file a scanner app can write for Roomination directly. It uses plan terms throughout:
- centimetres, seen from above;
- x to the right, y downwards;
- rotations clockwise in degrees;
- a piece's front at +y.

```json
{
  "format": "roomination-scan",
  "version": 1,
  "units": "cm",
  "name": "Bedroom",
  "walls": [
    { "id": "w1", "start": [0, 0], "end": [420, 0], "height": 250, "confidence": "high" }
  ],
  "openings": [
    { "id": "d1", "kind": "door", "wallId": "w3", "center": [90, 360], "width": 82, "height": 204, "bottom": 0 }
  ],
  "objects": [
    { "id": "o1", "category": "bed", "center": [210, 112], "width": 160, "depth": 205,
      "height": 55, "bottom": 0, "rotation": 0, "confidence": "medium" }
  ],
  "floor": [[0, 0], [420, 0], [420, 360], [0, 360]]
}
```

- **Fields:**
  - `kind` is `door`, `window` or `opening`;
  - categories use RoomPlan's words: bathtub, bed, chair, dishwasher, fireplace, oven,
    refrigerator, sink, sofa, stairs, storage, stove, table, television, toilet, washerDryer;
  - `confidence`, `bottom`, `rotation`, `wallId`, `floor` and `name` are optional.
- **Naming:** save it as `*.roomination-scan.json` (or put it in a ZIP).

## Future iPhone integration (not built yet)

The intended workflow: **scan on iPhone → open Roomination → review the imported room → continue
on iPhone, iPad or Mac.**

### A Roomination scanner app (Phase 8B)

- **Platform:** a small native app (Swift, SwiftUI, Apple's `RoomCaptureView`).
- **Exports:**
  - RoomPlan's own JSON, which the importer already reads, or a `roomination-scan` file;
  - optionally, a 3D Model Anything-compatible bundle, so one importer handles both apps.
- **Requirements:**
  - a Mac with Xcode;
  - an Apple ID: a free account can install on your own device, but the app must be re-signed
    every 7 days;
  - the Apple Developer Program ($99 a year) for TestFlight or the App Store;
  - a LiDAR iPhone or iPad running iOS 16 or later (iOS 17 for room labels and merged rooms).
- **Where it lives:** in its own repository, never part of the GitHub Pages site.
- **Reusing 3D Model Anything:** files from that MIT-licensed app (for example its PLY writer)
  must keep their copyright and licence notice. Its `data/` folder and textures aren't covered
  by its MIT licence and mustn't be reused.

### Getting the file from phone to planner

**Sharing a Wi-Fi network does not share browser storage.** Each browser keeps its own projects;
something has to carry the file across. Options, none needing an account or a server:

| Option | How | Notes |
| --- | --- | --- |
| **AirDrop / Files** (works today) | The scanner app shares the file; choose it in Roomination | Simplest; Apple devices only for AirDrop, any device through Files or a USB stick |
| **Share to Roomination** | Installing Roomination as a web app with a Web Share Target would let the scanner's share sheet hand the file straight over | Needs a web-app manifest and service worker; Web Share Target isn't supported by Safari on iOS yet, so this helps Android/desktop more than iPhone |
| **Direct browser-to-browser (WebRTC)** | Two open Roomination pages connect peer to peer and send the project | WebRTC needs a signalling step to introduce the two devices. Doing that without a server means exchanging the connection offer by QR code (see below). Some networks block direct connections without a relay (TURN) server |
| **QR-code pairing** | One device shows a QR code holding a connection offer (or a short project); the other scans it with its camera | QR codes hold only a few kilobytes, so they carry the WebRTC handshake, not the room itself |
| **Local Wi-Fi transfer** | The scanner app runs a tiny web server on the phone for a moment; Roomination on the Mac downloads the file from it | Needs the native app; browsers may block a secure (HTTPS) page from fetching a plain-HTTP local address, so this works best when the app hands over a link the person opens |

None of these sync automatically. Automatic device sync is out of scope: it would need storage
somewhere both devices can reach, which conflicts with "no accounts, no servers".

## Credits

- **Apple:** RoomPlan's data model follows Apple's documentation for `CapturedRoom`,
  `CapturedRoom.Surface`, `CapturedRoom.Object` and `CapturedStructure`.
- **3D Model Anything:** the `house-capture/5` bundle layout is documented by Wes Bos's
  [3D Model Anything](https://github.com/wesbos/3d-model-anything) (MIT). Roomination reads files
  in that layout; no code from that project is included.
