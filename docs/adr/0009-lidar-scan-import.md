# ADR-0009: Importing LiDAR room scans

**Status:** Proposed (awaiting review)
**Date:** 2026-10-23
**Deciders:** The Progress Quest

## Context

People with a LiDAR iPhone or iPad can scan a room with Apple's RoomPlan in a minute. Turning
that scan into a Roomination plan saves measuring by hand.

Constraints:
- Roomination is a static GitHub Pages site: no servers, accounts, analytics, paid AI or uploads.
- Browsers can't use the LiDAR Scanner, so scanning must happen in a native app.
- Scans can include photos, depth recordings and AR maps of someone's home: very private data.
- The plan must stay editable and accurate; LiDAR measures geometry, not appearance.

Wes Bos's open-source *3D Model Anything* (MIT code) already captures RoomPlan scans and exports
documented bundles (`house-capture/5`) whose `rooms/room-N.json` is RoomPlan's own JSON.

## Decision

- **Build the web importer first (Phase 8A), with no native code.**
  - It reads RoomPlan JSON (`CapturedRoom` and `CapturedStructure`), 3D Model Anything ZIPs and
    a documented `roomination-scan/1` file (see `docs/scan-import.md`).
  - It reads the formats only; no code is copied from other projects.
- **Measurements and interpretation are kept apart.**
  - The scan is read into an immutable `ScanData` (cm, plan axes).
  - The person's corrections live in a separate `Review`.
  - A pure `buildFromScan(scan, review)` produces the project and is re-run on every change.
  - Confidence is the scanner's own label, never a percentage.
- **Use existing systems.**
  - The outline is an ordinary clockwise wall chain with stable ids.
  - Openings are ordinary wall features.
  - Furniture comes from the catalogue, stretched to the measured box with the existing
    `scaleShape` and `scaleComponents`.
  - The result is validated with `parseProjectFile`, the same as any opened file.
- **Geometry:**
  - wall ends within 30 cm join where the walls' lines cross;
  - the largest loop is the outline; interior walls become partitions;
  - gaps are closed with marked walls, falling back to the scanned floor outline;
  - optional rigid straightening uses the length-weighted wall direction folded mod 90°.
- **Privacy by construction.**
  - A purpose-built ZIP reader reads only the table of contents and geometry JSON, through
    `Blob.slice`, so photos, meshes, depth frames and world maps are never read.
  - Sizes and decompression output are bounded, and checksums are verified.
- **Always a new project.** Importing never overwrites anything.
- **New door style `opening`** ("No door") for RoomPlan's doorways. Older app versions read it
  as a hinged door, so the schema version is unchanged.
- **The importer is lazy-loaded.** The importer and the catalogue it maps to load only when the
  dialog opens.

## Options considered

### A: Web importer for existing exports (chosen)
| Dimension | Assessment |
| --- | --- |
| Complexity | Medium: parsing, outline tracing, review UI |
| Cost | None: no Apple developer account needed |
| Privacy | Strong: reads geometry only, on the device |
| Reach | Anyone with a LiDAR device and an exporting app |

### B: Native Roomination scanner app first
| Dimension | Assessment |
| --- | --- |
| Complexity | High: Swift, signing, device testing |
| Cost | Mac + Xcode; $99/year for TestFlight / App Store |
| Privacy | Strong if it exports only geometry |
| Reach | Needs distribution through TestFlight or the App Store |

Deferred to Phase 8B. Its export will match formats the importer already reads.

### C: Forking 3D Model Anything as the companion app
Its features exceed what Roomination needs: house history, relocalisation, automatic photos,
depth recording and AI-agent reconstruction. Forking it would mean maintaining that code and
handling much more private data. It can be used unchanged to make scans today. Selected MIT
files may be reused in 8B, keeping their notice.

### D: Reconstructing from the mesh or photos
Not suitable for a static site, and it's not needed for an editable plan. Meshes and photos may
become optional, local-only reference layers (8C).

## Consequences

- **Easier:** starting a project from a real room in minutes; future scanner apps only need to
  write a documented file.
- **Harder:** the review screen is a sizeable new UI, and RoomPlan's format may change between
  iOS versions (unknown fields are ignored; missing ones produce notes).
- **Revisit:**
  - multi-floor and multi-room import;
  - ceiling variations;
  - wall-mounted furniture;
  - mesh and photo layers (8C);
  - the native app (8B).

## Action items

1. [x] Importer, review screen, synthetic fixtures, unit and browser tests.
2. [ ] Test with real scans from a LiDAR device (needs the person's device; never committed).
3. [ ] Phase 8B: native scanner app, in its own repository.
4. [ ] Phase 8C: optional mesh and photo reference layers; photo-guided custom furniture.
