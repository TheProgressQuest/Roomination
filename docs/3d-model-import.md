# Importing real 3D scans (prototype)

Roomination can show a real, textured 3D model of an object, scanned with a free phone app,
in place of its ordinary look. The model is read and stored on your device; nothing is uploaded.

## 1. Scan the object (iPhone)

| App | Free? | How to export |
| --- | --- | --- |
| **Reality Composer** (Apple, iOS 17+; *Object Capture*) | Yes | Scan the object → *Share* → *Export* → **USDZ** → Save to Files |
| **Scaniverse** | Yes | Scan in *Small object* mode → *Share* → *Export model* → **GLB** (or USDZ) → Save to Files |
| **Polycam** | Free tier | Export **GLB** (some exports need a paid plan) |

Tips:

- Put the object on a plain surface with soft, even light, and walk all the way round it.
- Crop away the table or floor in the scanning app before exporting.
- Choose a medium or "reduced" detail level. Phones draw a few hundred thousand triangles
  comfortably, and Roomination refuses more than 1,000,000.

## 2. Import it

1. **Furnish → Custom furniture & library → Import 3D model (GLB, USDZ)**. On a phone, it's
   in **Add**.
   - To place it straight onto furniture, select that piece first (a shelf, a worktop).
   - To give a piece already in the room this model as its look, open the piece's properties
     and choose **3D model → Use a 3D model…**.
2. **Choose model file…** and pick the `.glb` or `.usdz`. For a `.gltf`, select it together
   with its `.bin` and texture files.
3. Check the **preview** (drag to look around):
   - If it's lying down, use **Tip forward** or **Tip sideways** until it stands.
   - Use **Turn** until its front faces the blue arrow.
4. Enter its **real size**: one measurement is enough, because *Keep its proportions* scales
   the others.
5. **Add to room** (and, by default, also to *My Library* for other projects).

Afterwards it's an ordinary piece: move it, put it on a shelf (*Rests on*), resize it, or open
**3D model** in its properties:

- *Show the 3D model* switches between the model and the piece's ordinary look.
- *Keep its proportions when resizing* makes one dimension scale the others.
- *Turn model 90°*, *Restore proportions*, *Replace…* and *Remove model* do what they say.

## Supported formats

| Format | Status |
| --- | --- |
| **GLB** (glTF 2 binary) | Supported: geometry, PBR materials and textures |
| **glTF** (.gltf + .bin + textures) | Supported, when all its files are chosen together |
| **USDZ** (USDC or USDA inside) | Supported via Three.js's USD loader: geometry and PNG/JPEG textures. EXR textures can't be shown |
| Loose .usdc / .usda | Geometry; textures only if their files are chosen too |
| OBJ, FBX, PLY, STL, LAS, SPZ, .reality | Not supported: export GLB or USDZ instead (a message says so) |
| Draco, meshopt or KTX2 compression | Not supported: needs a decoder from the web, which Roomination doesn't download |

The model is kept as one GLB, re-saved by Roomination:

- textures at most 2048 px, or 1024 px with *Light (for phones)*;
- JPEG unless a texture needs transparency;
- at most 40 MB.

It's included in project exports (`assets/<id>.glb`) and in *My Library*.

## What stays measured

The piece's width, depth and height are what count:

- The model is drawn to fill that box, standing on its base and centred, so a scan's own origin
  or units never matter.
- Placement, collisions, *Rests on*, the 2D plan and the optimizer all use the box.
- The model never changes the measurements.

## Phones and performance

Imported models share a triangle budget per 3D quality: **Low 150,000**, **Medium 600,000** and
**High 1,500,000**. Pieces beyond it, and any model that can't be read, show a plain box at
their measured size instead.

## Security checks

Files are checked before any loader sees them (`src/mesh/inspect.ts`):

- **Format:** recognised by its bytes, not its name.
- **GLB:** header and chunk lengths are checked.
- **References:** web addresses, absolute paths and `..` are refused, so a model can only read
  the files you chose (or data embedded in it).
- **USDZ archives:** limited to 200 MB unpacked and 2,000 entries (zip bombs), with no unsafe
  paths, and the model layer must be at the top (which keeps the loader from looking for
  textures on the web).
- **Size limits:** 80 MB of files, 1,000,000 triangles, 5,000 parts.
- **While loading:** every reference resolves only to the chosen files' blob URLs; anything
  else resolves to nothing.
- **Stored model:** re-exported by Roomination, so it never contains the original file's extra
  data.
- **Project packages:** models inside them get the same checks and must be self-contained.
- **Production builds:** a Content Security Policy blocks images, fetches and media from other
  sites, as a second line of defence.

The USD loader is a large parser running in the page. A malicious file could make it slow or
crash the tab, but it can't reach the network or your other data.
