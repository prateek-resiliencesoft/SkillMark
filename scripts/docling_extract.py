#!/usr/bin/env python3
"""Convert a local file to Markdown via the Docling Python library (no HTTP).

https://github.com/docling-project/docling

Usage:
  python3 scripts/docling_extract.py /path/to/file.pdf
  python3 scripts/docling_extract.py /path/to/scan.pdf --ocr
  python3 scripts/docling_extract.py /path/to/cv.png --ocr --max-pages 50

Stdout = Markdown. Exit 0 on success, non-zero on failure (message on stderr).
"""
from __future__ import annotations

import argparse
import sys


def build_converter(*, ocr: bool):
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        PdfPipelineOptions,
        TableFormerMode,
        TableStructureOptions,
    )
    from docling.document_converter import DocumentConverter, PdfFormatOption

    opts = PdfPipelineOptions()
    opts.do_ocr = ocr
    opts.do_table_structure = True
    opts.table_structure_options = TableStructureOptions(mode=TableFormerMode.FAST)
    # Skip image export — CVs only need text; keeps memory/CPU down.
    opts.generate_page_images = False
    opts.generate_picture_images = False

    format_options: dict = {
        InputFormat.PDF: PdfFormatOption(pipeline_options=opts),
    }
    # ImageFormatOption when available (avoids IMAGE→PDF backend deprecation).
    try:
        from docling.document_converter import ImageFormatOption  # type: ignore

        format_options[InputFormat.IMAGE] = ImageFormatOption(pipeline_options=opts)
    except Exception:
        format_options[InputFormat.IMAGE] = PdfFormatOption(pipeline_options=opts)

    return DocumentConverter(format_options=format_options)


def main() -> int:
    parser = argparse.ArgumentParser(description="Docling local file → Markdown")
    parser.add_argument("path", help="Absolute path to PDF/DOCX/image")
    parser.add_argument(
        "--ocr",
        action="store_true",
        help="Enable OCR (slower; for scans/images). Default: off (fast born-digital).",
    )
    parser.add_argument("--max-pages", type=int, default=50)
    args = parser.parse_args()

    try:
        converter = build_converter(ocr=args.ocr)
        result = converter.convert(args.path, max_num_pages=args.max_pages)
        md = result.document.export_to_markdown()
    except ModuleNotFoundError:
        print(
            "docling is not installed. Run: pip install -r requirements-docling.txt",
            file=sys.stderr,
        )
        return 2
    except Exception as err:  # noqa: BLE001 — surface any convert failure to Node
        print(f"docling convert failed: {err}", file=sys.stderr)
        return 1

    sys.stdout.write(md or "")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
