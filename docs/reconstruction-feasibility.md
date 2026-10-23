# Reconstruct My Room: feasibility assessment

October 2026, `proto-lidar`. This is what's possible in a free, private web app that runs on
phones and computers, and what the proof of concept built. It compares the options with Wes
Bos's *3D Model Anything* (commit `31b2dc9`, MIT code; studied read-only, nothing copied).

## 1. Where Wes's fidelity actually comes from

| Mechanism | How his pipeline does it | Where it runs | In a browser? |
| --- | --- | --- | --- |
| Camera-positioned photos | His iPhone app records each photo's exact position, direction and lens (`photos/photos.json`) | Custom Swift app, built with Xcode; not on the App Store | Reading them: yes. Recording them: no (Safari can't use ARKit or LiDAR) |
| LiDAR mesh and depth | `mesh/room-N.ply`, depth frames at 256 × 192, 5 per second | Same app | Reading: yes. Recording: no |
| Coloured mesh | Python + Open3D fuses depth and colours each vertex from the best photo, checking visibility by ray casting (`reconstruct_bundle.py`) | Desktop Python (NumPy, Open3D, Pillow) | Not practical (Open3D has no maintained WebAssembly build) |
| **Object-specific geometry** | **About 16,500 lines of hand- and agent-written Three.js for one office.** The office chair alone is 874 lines | An AI coding agent plus a person, over many iterations | This is the fidelity. It isn't automatic anywhere |
| Photo-derived materials | Photos cropped and fitted by the agent; Poly Haven and ambientCG textures | Agent | Partly (Roomination already cuts textures from photos) |
| Geometry-to-photo alignment | Matched-camera renders beside the posed photo | Agent + `agent-browser` | Yes (Roomination's *Line up camera*) |
| Comparison and refinement | Scripts capture and stitch images; **they don't judge similarity**: the agent and person do | Agent | Yes, as tools; judging stays human |

**Conclusion.** His results come from (a) evidence a browser can't record and (b) a large
amount of object-by-object modelling by an agent. Neither is something an ordinary Roomination
user can run, and the brief rules out requiring Claude Code. So the realistic target is: use
whatever evidence a phone already produces, plus tools a person can drive in a few minutes per
object.

## 2. Ways to rebuild an object, assessed

| Approach | Dependencies | Licence | Phone (Safari) | Expected fidelity | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Shape from silhouettes + projected photos** (built) | None: about 400 lines of TypeScript | Ours | Yes: rebuilding takes 27 ms in WebKit, 93 ms at a 6× slower CPU | Outline and photo surface exact; hollows (bowls, recessed dials) filled; backs plain unless photographed | **Built.** Works for any object with clear outlines |
| Mesh import (GLB/USDZ from Scaniverse, Polycam or Apple's Object Capture) | Three.js's own loaders (MIT, already a dependency) | User's own scans | Viewing yes; capture happens in the free phone app | Highest: real geometry and photo texture | **Recommended next.** Not built yet |
| TripoSR, single image → 3D, in browser | `onnxruntime-web` + a 485 MB int8 model; the object must be cut out first | MIT (weights and code) | Unproven: nobody publishes iPhone timings or memory; the 485 MB download alone rules out casual use | Plausible, but the back and sides are invented, untextured or vertex-coloured, and blobby on hard edges | Not now. Revisit if a smaller model appears |
| Stable Fast 3D | PyTorch + GPU | Stability Community Licence (free under US$1M revenue only) | No | Good | Rejected: licence and no browser runtime |
| TRELLIS / TRELLIS.2 | PyTorch, roughly 16 GB+ GPU | MIT | No | Very good | Desktop-only. A possible optional "process on your computer" path later |
| Hunyuan3D 2.x | PyTorch + GPU | Tencent licence excludes the EU, UK and South Korea | No | Very good | Rejected: territorial licence |
| Photogrammetry (COLMAP, OpenMVS, Meshroom) | C++, CUDA for dense steps | BSD / MPL 2.0 / AGPL mix | No maintained WebAssembly build; phone memory too small | Excellent with 30–100 photos | Desktop-only. The free phone apps above already do this on-device |
| Gaussian splats (Brush trains in the browser) | Rust + WebGPU | Apache 2.0 | Brush's web training is documented for desktop Chrome; Safari 26 now has WebGPU, but nobody has tested training on iPhone | Photo-real views, but not an editable, measurable object | Not suitable: no clean dimensions, collisions or editing |
| Single-image depth (Depth Anything V2 *Small*) | `transformers.js`, about 50 MB at fp16 | Apache 2.0 (Small only; Base and Large are non-commercial) | Plausible with WebGPU; untested | A 2.5D relief of the visible side only | Optional refinement later, not a reconstruction |

None of these needs an account, a subscription or a cloud service. The rejected rows are about
licence terms or hardware, not cost.

## 3. Richer scan evidence

| Evidence | Who produces it today | Status in Roomination |
| --- | --- | --- |
| RoomPlan walls, openings, object boxes | RoomSheet (`captured-room.json`), Wes's app | Imported (beta) |
| LiDAR mesh | Wes's app (`.ply`), Scaniverse, Polycam (GLB/OBJ/USDZ) | Skipped. Next step: optional, visual-only layer |
| Depth frames | Wes's app only | Skipped. Useful only for desktop fusion |
| Posed photos + intrinsics | Wes's app only (`photos.json`) | Skipped. Next step: set the matched camera automatically from a photo's pose (replaces lining it up by hand) |
| Spatial photo metadata (iPhone HEIC depth) | iPhone Camera (Portrait, spatial photos) | Not investigated in code. Safari exposes the picture but not the depth map through ordinary file input |

RoomSheet exports none of the extra evidence, so with the user's current app, improvement
comes from photos taken separately and lined up by hand. All extra evidence would stay in its
own layer, never changing the measured room.

## 4. What the proof of concept does

**Reconstruct (Match my room → Rebuild object).** Select any measured piece. For each view
(front, right or left side, top) you:

1. drag four corners onto the object in any reference photo (multiple photos supported; *Zoom
   in on the corners* for small objects);
2. tap the background in the straightened preview to trim it (magic wand, compared with the
   tapped colour), optionally marking the outline *symmetrical*;
3. choose *Use as the … view*.

The piece is redrawn as the intersection of the outlines (surface nets with sub-cell
interpolation), with each photo projected onto the surfaces that face it. Unseen surfaces take
the side's (or front's) average colour; trimmed background is padded with edge colours.

**Separation of evidence:**

- The rebuilt look (`photoModel`) is visual only. Width, depth, height, footprint, collisions,
  the plan and *Rests on* all keep using the measurements.
- A piece whose outlines fill their photos is drawn as its exact box (12 triangles).

**Inspect, correct, undo:**

- every view can be removed;
- *Show the rebuilt look* toggles it off for comparison;
- every step is one undoable edit.

**Save and export:**

- *Save to my library* keeps it with its photos, and placing it again lands on the selected
  shelf or surface;
- project export (ZIP) carries the photos;
- photos are kept in their own table, and a clean-up never removes a saved project's photos
  (that was a bug, fixed here).

**Compare (Line up camera → Compare):**

- *Overlay* blends the photo over the view;
- *Side by side* splits the view at a movable divider;
- *Differences* uses a difference blend, where matching areas go dark and misalignments and
  colour differences stay bright.

Saved views keep the pose and photo. Nothing decides automatically whether a reconstruction
is "accurate": one matching angle doesn't prove the others.

## 5. Benchmark against 3D Model Anything

| | Wes's office | Roomination prototype |
| --- | --- | --- |
| Capture | Custom LiDAR app: mesh, depth, posed photos | RoomSheet JSON + ordinary photos |
| Object modelling | Agent-written code per object (hundreds of lines each) | Outlines from 1–3 photos per object, in-app, in a few minutes |
| Fidelity | Near photo-real in matched views, including concave detail and accurate backs | Recognisable: correct outline, carved fronts and grilles from the photo; hollows filled; plain backs; flat lighting of photographed shading |
| Needs | Xcode, a Mac, Python, an AI agent | A phone or computer browser |
| Cost of a new object | Hours of agent and person time | Minutes; no code |

## 6. Limitations

- Silhouettes can't see hollows: a mug's inside, a recessed speaker and a chair's gap under
  the seat stay filled unless another view's outline cuts them away.
- Photos include their own lighting and shadows; the 3D lighting is added on top.
  *Brightness* when cutting textures compensates partly.
- Perspective correction assumes the four corners lie on one flat rectangle; for rounded fronts
  it's approximate.
- A three-quarter photo of a box shows two faces, but its side view is foreshortened and less
  sharp than a straight-on photo.
- Grid resolution: 40 cells along the longest side (about 9 mm on a 35 cm radio), with smoothing.
- On a phone, selecting the object means leaving the panel and coming back.

## Sources

- [3D Model Anything](https://github.com/wesbos/3d-model-anything) (README, ASSETS-LICENSE.md,
  apps/house-capture/README.md, skill outline): read 2026-10-23
- [TripoSR](https://github.com/VAST-AI-Research/TripoSR): MIT; about 6 GB VRAM by default
- [TripoSR ONNX for WebGPU](https://huggingface.co/cgb/triposr-onnx-webgpu): 485 MB int8;
  cut-out required
- [Stable Fast 3D licence](https://stability.ai/license) ·
  [Hunyuan3D 2.0 licence](https://huggingface.co/tencent/Hunyuan3D-2/blob/main/LICENSE) ·
  [TRELLIS.2](https://huggingface.co/microsoft/TRELLIS.2-4B/blob/main/README.md)
- [Brush](https://github.com/ArthurBrussee/brush) (Apache 2.0)
- [Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2) (Small: Apache 2.0)
- [Scaniverse on the App Store](https://apps.apple.com/us/app/-/id1541433223): free; on-device;
  mesh exports
- WebGPU in Safari 26 (WWDC25 WebKit notes)
