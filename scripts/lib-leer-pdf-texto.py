"""Saca el texto de un PDF (Laadbon de HG, etc.) y lo escribe en stdout como JSON.

Lo llama scripts/analisis-semanal-empresa.mjs (Node) porque en este portátil el lector
de PDF que funciona es PyMuPDF (pymupdf/fitz); ver la memoria "Recalc de Excel por COM".
Uso: python scripts/lib-leer-pdf-texto.py <ruta.pdf>
"""
import json
import sys

try:
    import pymupdf as fitz  # nombre nuevo
except ImportError:  # pragma: no cover
    import fitz  # nombre clásico

doc = fitz.open(sys.argv[1])
print(json.dumps("\n".join(page.get_text() for page in doc)))
