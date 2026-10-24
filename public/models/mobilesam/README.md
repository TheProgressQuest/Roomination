# MobileSAM model ("Select an area")

Two files used by *Select an area* in Match my room: tap a sofa, a wall or a floor in a photo and
the area is outlined, so its colour can be measured. They run entirely in the browser
(onnxruntime-web, WebAssembly, in a worker); photos and masks are never sent anywhere. They are
downloaded only when the person turns the feature on, checked against the SHA-256 sums below,
and kept in the browser's cache.

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `encoder.onnx` | 14,273,500 | `b69539ee6a956091b44fd8c81ed9c89c6339f2a78f4ed51888b1121dfd2b7797` |
| `decoder.onnx` | 4,742,230 | `9b379aa76d28aba44a50eb657dfa5b8cb1922a1e0af5278a245bd1837396bbd3` |

## Where they come from

- **Model:** MobileSAM (TinyViT image encoder distilled from Segment Anything) by Chaoning Zhang
  et al., https://github.com/ChaoningZhang/MobileSAM — Apache License 2.0.
- **Mask decoder:** Segment Anything by Meta AI, https://github.com/facebookresearch/segment-anything
  — Apache License 2.0.
- **ONNX export:** https://huggingface.co/Acly/MobileSAM (MIT licence), revision
  `0d3b403339b4674a82493d5e97964dd78089ddc8`:
  - `mobile_sam_image_encoder.onnx` (28,157,093 bytes, SHA-256
    `580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749`), exported with its
    preprocessing (normalise, pad to 1024);
  - `sam_mask_decoder_multi.onnx` (16,496,559 bytes, SHA-256
    `8976b90a87ba50a6a72217a5ff994f7d25ce16f2229fcc1ed259e1294c622ffe`).
- **Changes made here:** dynamic 8-bit quantization of the matrix multiplications (convolutions
  unchanged) with `tools/quantize-sam.py` (onnxruntime 1.23.2). On a synthetic room photo the
  quantized and original files give the same mask quality (intersection over union 0.99 for a
  sofa, a wall and a floor).

The Apache License 2.0 is in `LICENSE-Apache-2.0.txt`.

## Why MobileSAM rather than SlimSAM

SlimSAM-77 (`Xenova/slimsam-77-uniform`, Apache 2.0) is smaller to download (13.8 MB quantized)
but its image encoder needed about 2 GB of memory per photo on WebAssembly, too much for a
phone. MobileSAM needed about 0.5 GB and was faster (2.6 s against 4.4 s per photo on a Mac),
with equal or better masks.
