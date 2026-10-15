# ADR-0008: A built-in furniture catalogue

**Status:** Proposed (awaiting review)
**Date:** 2026-10-15
**Deciders:** The Progress Quest

## Context

People want a RoomSketcher-style catalogue of ready-made furniture, including kitchens,
bathrooms, laundry, saunas and outdoor pieces, rather than building pieces themselves.
Constraints:
- local only, no downloads or licensed models;
- GitHub Pages;
- a light first load;
- dimensional accuracy;
- 2D and 3D must agree.

## Decision

- **Catalogue items are generated, not shipped as models.** Each item is a function that
  returns an ordinary furniture template:
  - familiar pieces use the built-in designs (sofa, bed, table…) in typical sizes, colours
    and materials;
  - fixtures, appliances, outdoor and special pieces are built from components (ADR-0007)
    with a small helper (`catalogue/kit.ts`), so they are editable in the builder.
- **Fixtures:**
  - a new furniture kind, `fixture`, marks plumbed or fitted pieces;
  - the optimizer never moves them;
  - a new `water` surface draws baths and hot tubs.
- **Browsing:**
  - search plus room filters;
  - pictures drawn on demand from the plan's own illustrations, only for cards scrolled into
    view;
  - click to add, or drag onto the plan (the plan converts the drop point to room
    centimetres).
- **Loading:** the catalogue (about 11 kB gzipped plus the shared builder geometry) loads only
  when opened. It adds about 2 kB to the first load.

## Options considered

- **Downloadable 3D model packs (glTF):** realistic, but large, licensed per model, and drawn
  differently in 2D and 3D. Rejected for now.
- **A fixed set of rectangles with labels:** cheap, but not recognisable. Rejected.

## Consequences

- **Easier:** furnishing whole homes, including kitchens and bathrooms; pieces stay editable.
- **Harder:** each new item is code. Tests check every item builds, fits its footprint, saves and
  renders.
- **Limits:**
  - collisions are 2D, so wall-mounted items (wall cabinets, hoods, art) are left out until
    height-aware collisions exist;
  - items are stylised, not photographic.
