"""Quantizes the MobileSAM ONNX files for "Select an area" (see public/models/mobilesam/README.md).

Dynamic 8-bit quantization of the matrix multiplications only (convolutions stay 32-bit), with
onnxruntime 1.23.2 and onnx 1.19.1 in an isolated environment, e.g.:

    uv venv --python 3.12 .qenv && uv pip install --python .qenv/bin/python onnxruntime==1.23.2 onnx==1.19.1
    .qenv/bin/python -I tools/quantize-sam.py mobile_sam_image_encoder.onnx encoder.onnx
    .qenv/bin/python -I tools/quantize-sam.py sam_mask_decoder_multi.onnx decoder.onnx

The result is deterministic: the SHA-256 sums in the README are reproduced exactly.
"""
import sys

from onnxruntime.quantization import QuantType, quantize_dynamic

src, dst = sys.argv[1], sys.argv[2]
quantize_dynamic(src, dst, op_types_to_quantize=['MatMul', 'Gemm'], weight_type=QuantType.QUInt8, per_channel=False)
