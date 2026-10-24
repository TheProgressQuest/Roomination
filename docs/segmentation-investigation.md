# Step 2 investigation: finding walls, floors and furniture in photos

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
