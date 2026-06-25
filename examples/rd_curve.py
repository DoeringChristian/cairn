"""Rate-distortion curve for point-cloud compression codecs.

Simulates several codecs, each evaluated at multiple quality levels.
Every (codec, quality) pair is a separate Cairn run so the results can
be compared on a scatter plot (X = bits per point, Y = PSNR, Color = codec).

The memory breakdown between positions and normals is logged as separate
params so it can be inspected per-run or used as a scatter-plot axis.

Usage::

    uv run cairn init /tmp/cairn-demo
    CAIRN_REPO=/tmp/cairn-demo/.cairn uv run python examples/rd_curve.py
    uv run cairn ui --repo /tmp/cairn-demo/.cairn

Then open the project page, add a **Scatter Plot** card, and set:

- X axis → ``bpp`` (param)
- Y axis → ``psnr_db`` (param)
- Color  → ``codec`` (param)

A second scatter card with X = ``bpp.positions``, Y = ``bpp.normals``
shows the per-attribute breakdown.
"""

from __future__ import annotations

import math
import random

import cairn

CODECS: dict[str, dict] = {
    "draco": {"base_bpp": 1.2, "psnr_offset": 38.0, "pos_frac": 0.70},
    "octree": {"base_bpp": 2.0, "psnr_offset": 42.0, "pos_frac": 0.80},
    "gpcc": {"base_bpp": 0.8, "psnr_offset": 35.0, "pos_frac": 0.65},
    "learned": {"base_bpp": 0.5, "psnr_offset": 33.0, "pos_frac": 0.55},
}

QUALITY_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8]


def simulate(codec_cfg: dict, quality: int) -> dict:
    """Return synthetic RD metrics for one (codec, quality) point."""
    random.seed(hash((codec_cfg["base_bpp"], quality)))
    q = quality / len(QUALITY_LEVELS)

    bpp = codec_cfg["base_bpp"] * (0.3 + 0.9 * q) + random.uniform(-0.05, 0.05)
    psnr = codec_cfg["psnr_offset"] + 12.0 * math.log1p(q * 5) + random.uniform(-0.3, 0.3)
    pos_frac = codec_cfg["pos_frac"] + random.uniform(-0.03, 0.03)

    return {
        "bpp": round(bpp, 4),
        "psnr_db": round(psnr, 2),
        "bpp.positions": round(bpp * pos_frac, 4),
        "bpp.normals": round(bpp * (1 - pos_frac), 4),
    }


def main() -> None:
    for codec_name, cfg in CODECS.items():
        for quality in QUALITY_LEVELS:
            rd = simulate(cfg, quality)

            run = cairn.Run(
                project="rd-curve",
                name=f"{codec_name}-q{quality}",
                tags=[codec_name, f"q{quality}"],
            )

            run["codec"] = codec_name
            run["quality"] = quality
            run["bpp"] = rd["bpp"]
            run["psnr_db"] = rd["psnr_db"]
            run["bpp.positions"] = rd["bpp.positions"]
            run["bpp.normals"] = rd["bpp.normals"]

            run.finish()
            print(f"{codec_name} q{quality}: {rd['bpp']:.3f} bpp, {rd['psnr_db']:.1f} dB")

    print(f"\nLogged {len(CODECS) * len(QUALITY_LEVELS)} runs to project 'rd-curve'.")


if __name__ == "__main__":
    main()
