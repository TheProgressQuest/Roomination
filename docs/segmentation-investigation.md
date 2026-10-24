# Step 2 investigation: finding walls, floors and furniture in photos

> **Update (Step 2A, built):** *Select an area* uses **MobileSAM**, not SlimSAM. Measured on
> WebAssembly, SlimSAM-77's encoder needed about 2 GB of memory per photo, too much for a
> phone; MobileSAM needed about 0.5 GB, was faster and gave equal or better masks. Results are
> at the end of this document.

October 2026, `proto-lidar`. Research only: no model has been downloaded, converted or
integrated. The aim of Step 2 is "Make it look like my room": find the wall, floor, ceiling and
each piece of furniture in the person's own photos, on their device, and take colours and
materials from them.

Sizes come from the published files. Speed and memory on an iPhone are **estimates until
measured**: nobody publishes iPhone Safari figures for these models.

## Candidates

| | DETR ResNet-50 panoptic | RF-DETR-Seg Nano | SlimSAM-77 (uniform) |
| --- | --- | --- | --- |
| What it does | Labels every pixel, and separates individual objects (panoptic) | Finds individual objects and their outlines (instance) | Outlines whatever is at a tapped point or box; no labels |
| Licence | Apache 2.0 (`facebook/detr-resnet-50-panoptic`) | Apache 2.0 (Nano–Large models and code; XL/2XL are under PML 1.0, not considered) | Apache 2.0 (code and the `Xenova/slimsam-77-uniform` conversion; SAM's own weights are Apache 2.0) |
| Classes for a room | COCO panoptic: 80 objects (couch, chair, dining table, bed, TV, potted plant, sink, toilet…) plus 53 "stuff" areas, including merged wall, floor, ceiling, wood floor, cabinet, shelf, rug, curtain, window and door classes (to confirm against the model's own label list) | The 80 COCO objects only: no wall, floor or ceiling | None: the person, or another model, says what to outline |
| Download | 44.5 MB int8 (86.6 MB fp16, 172 MB fp32) | 33.6 M parameters: roughly 35 MB int8 (estimate; no browser build is published) | 13.8 MB int8 (8.9 MB image encoder + 4.9 MB prompt decoder) |
| Runs in the browser | Ready-made for Transformers.js (`Xenova/detr-resnet-50-panoptic`) | Needs our own ONNX export, then onnxruntime-web | Ready-made for Transformers.js |
| Speed (estimate) | Slow: trained at 800 px; likely several seconds per photo on an iPhone without WebGPU, faster with it | Fast: 312 px input, 3.4 ms on a desktop GPU; probably well under a second per photo | Encoder once per photo (about 1–3 s), then each tap almost instantly |
| Memory (estimate) | The highest: a ResNet-50 backbone at 800 px; risky alongside the 3D view on an iPhone | Moderate | Low |
| Matching photo areas to scanned pieces | Yes, by class and instance, when unambiguous (one sofa in the scan, one couch in the photo) | Same, for furniture only | Yes, when the person taps the piece, or when a box comes from a lined-up camera |

## Rejected

- **SegFormer (ADE20K):** the most room-aware classes (150, including wall, floor, ceiling,
  cabinet, shelf) and only 4.4 MB int8, but NVIDIA's weights are licensed for non-commercial
  research or evaluation only, and conversions inherit that restriction.
- **YOLOv8/YOLO11 segmentation:** AGPL-3.0.
- **MediaPipe DeepLab-v3:** small and fast (257 px), but it knows only the 21 PASCAL VOC classes:
  sofa, chair, dining table and potted plant, with no wall, floor, ceiling, shelf or cabinet.

## Matching photo areas to individual scanned pieces

RoomSheet's photos carry no camera position, so a label alone can't say *which* sofa a "couch"
is when the scan has two. Three ways, from most to least automatic:

1. **Unambiguous labels:** one piece of a kind in the scan and one object of that kind in the
   photo (one dining table) can be matched automatically.
2. **A lined-up camera:** after *Line up camera* in Match my room, every scanned box can be
   projected into the photo, and its outline (from any of the models above, or a SlimSAM box
   prompt) matched by overlap. This is geometric and reliable.
3. **One tap:** "tap the sectional in this photo" with SlimSAM. This always works, and keeps the
   person in charge.

## Recommendation for Step 2 (for approval)

Start with **SlimSAM** (small, permissive, ready-made) driven by a tap or a lined-up camera,
and measure DETR panoptic on a real iPhone for the automatic wall/floor/ceiling labels before
committing to its 45 MB download. RF-DETR-Seg is the fast alternative for furniture if DETR
proves too slow, at the cost of exporting it ourselves. Any model would be:
- downloaded only when the person asks, from a pinned version, and kept in the browser cache;
- run entirely on the device (no photo leaves it);
- optional: everything works without it, as today.

## Sources

- [nvidia/segformer-b0-finetuned-ade-512-512](https://huggingface.co/nvidia/segformer-b0-finetuned-ade-512-512)
  and [the SegFormer licence](https://github.com/NVlabs/SegFormer/blob/master/LICENSE) (section 3.3)
- [Xenova/segformer-b0-finetuned-ade-512-512 ONNX files](https://huggingface.co/Xenova/segformer-b0-finetuned-ade-512-512/tree/main/onnx)
- [facebook/detr-resnet-50-panoptic](https://huggingface.co/facebook/detr-resnet-50-panoptic) and
  [its ONNX files](https://huggingface.co/Xenova/detr-resnet-50-panoptic/tree/main/onnx)
- [RF-DETR documentation](https://rfdetr.roboflow.com/latest/)
- [Xenova/slimsam-77-uniform](https://huggingface.co/Xenova/slimsam-77-uniform),
  [its ONNX files](https://huggingface.co/Xenova/slimsam-77-uniform/tree/main/onnx) and
  [SlimSAM](https://github.com/czg1225/SlimSAM)
- [MediaPipe Image Segmenter](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter)
- [WebGPU in major browsers (iOS 26)](https://web.dev/blog/webgpu-supported-major-browsers)

## Step 2A results (October 2026)

Built: *Select an area* in Match my room → Pick colour (tap → outline → suggested colour →
apply or reject). Model: MobileSAM, 8-bit quantized here (19.0 MB; see
`public/models/mobilesam/README.md`). No automatic recognition, matching or 3D shapes.

**Model comparison** (WebAssembly, single thread, Node on a Mac; synthetic 960 × 720 photo):

| | Download | Photo read | Memory, process peak | Mask overlap with the truth (sofa / wall / floor) |
| --- | --- | --- | --- | --- |
| SlimSAM-77, 8-bit | 13.8 MB | 4.4 s | about 2.2 GB | 0.945 / 0.986 / 0.976 |
| MobileSAM, 32-bit | 44.7 MB | 2.7 s | about 0.97 GB | 0.994 / 0.996 / 0.989 |
| **MobileSAM, 8-bit (used)** | **19.0 MB** | **2.6 s** | **about 0.93 GB** | **0.993 / 0.996 / 0.988** |

Colour of the selected area against each surface's true colour: within 1.2 (sofa), 0.7 (wall)
and 0.5 (floor) ΔE (CIE76; about 2 is barely noticeable).

**In browsers, on the person's own photo** (1200 × 1600 after scaling), on a Mac. A physical
iPhone has **not** been tested.

| Browser | Download + start + read the photo | Each tap | Browser memory added |
| --- | --- | --- | --- |
| Chromium, desktop | 3.4 s | 0.5–1.2 s | +468 MB |
| WebKit (Safari's engine), desktop | 3.4 s | 0.4–1.0 s | +378 MB |
| Chromium, iPhone-sized emulation | 3.4 s | 0.6–0.8 s | +654 MB |
| WebKit, iPhone-sized emulation | 3.4 s | 0.4–1.0 s | +327 MB |

Suggested colours against a hand-picked patch of the same surface: sectional 2.4–2.7 ΔE, wall
1.1 ΔE, floor 6 ΔE (the selection covers the whole floor, including its shaded part in front of
the sofa; the patch was a small sunlit corner, so the whole-floor colour is darker, as it is).
Memory is the whole browser's resident memory (including the 3D view), measured with `ps`; the
emulated "iPhone" runs on the Mac's CPU, so its times say nothing about a real phone's.

**WebGPU:** not used. WebAssembly runs everywhere (Safari 16.4+), and with the photo read once
in a few seconds and each tap under a second, it's fast enough; WebGPU would add a second, much
larger engine (28 MB) and a code path to test. Revisit if a real iPhone proves too slow.

## Memory: is it released, and does repeated use grow? (24 October 2026)

Measured on the Mac in Chromium (production build), with synthetic 1600 × 1200 photos, the
3D view open. *Tab* is the tab's process (where the page, its workers and the model's
WebAssembly memory live); *GPU* is the graphics process; *page* and *worker* are the JavaScript
heaps with their buffers (from Chromium's DevTools protocol). Process memory is what the
operating system reports (`ps`), the measure closest to what makes iOS end a page.

| Step | Tab | GPU | Page heap + buffers | Worker heap + buffers |
| --- | --- | --- | --- | --- |
| App + 3D view | 196–226 MB | 158–162 MB | 10 + 2 MB | none |
| 3 photos added | 290–295 MB | 240 MB | 10 + 16 MB | none |
| Model loaded, photo read | 551–558 MB | 230 MB | 10 + 16 MB | 2 + 20 MB |
| After 20 / 40 / 60 selections | 812 / 805 / 706 MB | 231 MB | 11 + 29 MB | 2 + 27–36 MB |
| **Panel closed** (worker stopped) | **195–271 MB** | 150–255 MB | 11 + 2 MB | none |
| 12 cycles of open → read → select → close | rises, then levels off at about 600–650 MB | 176–256 MB | 11 + 2 MB | none |
| After 10 s idle, then simulated critical memory pressure | 549 → 545 MB | 240 MB | 11 + 2 MB | none |

- **The model's memory is in the tab's process,** not the JavaScript heaps: reading a photo
  adds about 260 MB to the tab while the worker's JavaScript stays at 2 MB plus 20–40 MB of
  buffers. The GPU isn't used by the model (the GPU process changes only with the 3D view).
- **Released when the panel closes:** the tab drops back to (or near) where it was before the
  model loaded.
- **Repeated selections don't grow without bound:** 20, 40 and 60 selections stay around
  0.7–0.8 GB.
- **Repeated open/close cycles creep, then level off:** about +15 MB per cycle for the first few,
  settling at about 0.6 GB after 7 cycles (not returned under simulated memory pressure).
  Chromium appears to keep freed memory from discarded workers for reuse; the page's own heaps
  are flat, so it isn't a leak in Roomination's JavaScript. WebKit (Safari) manages memory
  differently: this has to be measured on the iPhone (see iphone-acceptance-test.md).

**Safeguards added:** the project is saved before the model loads or reads a photo (and
whenever the page is hidden), so a page ended for lack of memory loses nothing. If the page
ends during those steps, the feature waits to be turned on again; after two such stops it is
switched off on that device, and picking colours by tapping a point (and everything else) keeps
working. Closing Match my room stops the worker.

## Go / no-go for iPhones (recommendation)

**Ship Select an area as an optional beta, off until turned on, with the safeguards above: a
conditional go, confirmed only by the physical-iPhone test.** On the Mac it adds about
0.26 GB when a photo is read and up to about 0.6 GB during heavy use, on top of the room
planner and 3D view. A recent iPhone (the iPhone 17 Pro has 12 GB) should cope; older iPhones
with 3–4 GB may not. If the iPhone test shows Safari reloading the page during normal use, the
safeguard already turns it off on that device; if it happens on the test iPhone itself, turn
it off for iPhones altogether (`AREA_SELECT_AVAILABLE`, or a check for iOS) and keep the
manual tools, rather than risk the room planner.
