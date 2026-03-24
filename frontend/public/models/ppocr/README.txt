PP-OCRv5 Mobile Models for ONNX Runtime Web
=============================================

This directory should contain the following files:

1. det_mobile.onnx  — PP-OCRv5 detection model (text box locator, ~4.7 MB)
2. rec_mobile.onnx  — PP-OCRv5 English recognition model (text reader, ~7.7 MB)
3. ppocr_keys.txt   — Character dictionary

How to obtain the models:

  Option A — Use pre-converted ONNX models (recommended):

    Clone https://github.com/MeKo-Christian/paddleocr-onnx and follow their
    GitHub Actions workflow to export PP-OCRv5 models to ONNX.

    Alternatively, check HuggingFace for pre-converted ONNX models:
    https://huggingface.co/monkt/paddleocr-onnx

  Option B — Manual conversion:

    a) Download PaddleOCR v5 inference models from HuggingFace:
       - Detection:   https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det
       - Recognition: https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec

    b) Extract and convert to ONNX using paddle2onnx:
       pip install paddle2onnx
       paddle2onnx --model_dir PP-OCRv5_mobile_det \
         --model_filename inference.pdmodel \
         --params_filename inference.pdiparams \
         --save_file det_mobile.onnx --opset_version 11
       paddle2onnx --model_dir en_PP-OCRv5_mobile_rec \
         --model_filename inference.pdmodel \
         --params_filename inference.pdiparams \
         --save_file rec_mobile.onnx --opset_version 11

       Note: PaddlePaddle 3.0+ uses inference.json instead of inference.pdmodel.
       If conversion fails, use the MeKo-Christian/paddleocr-onnx tool from Option A.

    c) Download English dictionary:
       https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/en_dict.txt

  Place all three files in this directory (frontend/public/models/ppocr/).
