"""URL-referenced images — client-side fetch + decode (EXR over HTTP).

Demonstrates ``cp.Image(url=...)``: the emitted HTML keeps the URL verbatim
(nothing is embedded), and the BROWSER fetches + sniffs + decodes the blob at
view time — including formats a browser can't ``<img>``-decode, like OpenEXR
(decoded by cairn-plot's built-in pure-TS reader: single-part scanline,
HALF/FLOAT channels, NONE/ZIP/ZIPS compression).

Sources are the ASWF openexr-images sample repo (served with CORS ``*``):

* ``WideColorGamut.exr`` — ZIP-compressed RGB → decodes and renders in the
  float-HDR pane (tone-map/exposure controls live).
* ``Desk.exr`` — PIZ-compressed → decoded by the vendored FULL decoder
  (PIZ/PXR24/B44/DWA), off the main thread in a Web Worker.

NOTE: viewing needs NETWORK access (the whole point — the images are
referenced, not baked), so this stays a separate example: the offline demo
gallery and the ``smoke:plot`` CI gate must not depend on the network.

Run:  PYTHONPATH=. python examples/demo_url_images.py [-o out.html]
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cairn_plot as cp

ASWF = "https://raw.githubusercontent.com/AcademySoftwareFoundation/openexr-images/main"


def build_report() -> "cp.Report":
    return (
        cp.Report(title="cairn-plot — URL-referenced images")
        .md(
            "## EXR fetched + decoded client-side\n"
            "The HTML below embeds **no image bytes** — each pane holds only a URL. "
            "The browser fetches the blob and cairn-plot's decoder registry sniffs "
            "(content-type → extension → magic bytes) and decodes it.\n"
        )
        .md(
            "### ZIP EXR (supported) — `TestImages/WideColorGamut.exr`\n"
            "ZIP-compressed RGB half-float; decoded by the built-in EXR reader "
            "(native `DecompressionStream` + predictor/interleave inversion) into "
            "the float-HDR pane — tone-map and exposure are live."
        )
        .add(cp.Image(url=f"{ASWF}/TestImages/WideColorGamut.exr", tonemap="aces"))
        .md(
            "### PIZ EXR — `ScanLines/Desk.exr`\n"
            "PIZ (wavelet+Huffman — OpenEXR's historic default) is decoded by the "
            "vendored full EXR decoder, running **off the main thread** in a Web "
            "Worker. The full decoder also covers PXR24, B44(A), and DWAA/DWAB."
        )
        .add(cp.Image(url=f"{ASWF}/ScanLines/Desk.exr"))
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("-o", "--out", default="/tmp/cairn-url-images.html")
    args = ap.parse_args()
    path = build_report().save(args.out)
    size_kb = Path(path).stat().st_size // 1024
    print(f"Rendered URL-image demo → {path}  ({size_kb} KB; needs network to view)")
    print(f"Open it:  open {path}")


if __name__ == "__main__":
    main()
