import { useEffect, useRef } from "react";
import type { ColormapName } from "../types";
import { getColormapLUT } from "../colormaps";

// Historical hardcoded tick tables (byte range / signed-diff range), kept
// verbatim so existing call sites (ImageGalleryCard) render byte-for-byte
// unchanged when `min`/`max` are not supplied.
const BYTE_TICKS = [
  { pos: 0, label: "255" },
  { pos: 25, label: "192" },
  { pos: 50, label: "128" },
  { pos: 75, label: "64" },
  { pos: 100, label: "0" },
];
const DIFF_TICKS = [
  { pos: 0, label: "1.0" },
  { pos: 25, label: "0.5" },
  { pos: 50, label: "0.0" },
  { pos: 75, label: "−0.5" },
  { pos: 100, label: "−1.0" },
];

function defaultFormat(v: number): string {
  const rounded = Math.round(v * 100) / 100;
  const s = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  return s.replace("-", "−");
}

export default function Colorbar({
  colormap,
  isDiff,
  min,
  max,
  format,
}: {
  colormap: ColormapName;
  isDiff?: boolean;
  /**
   * Explicit tick-label domain (e.g. a mesh/volume/pointcloud value range).
   * When omitted, falls back to the historical byte range [0,255] (or
   * [-1,1] when `isDiff`) so existing call sites render unchanged.
   */
  min?: number;
  max?: number;
  /** Custom tick-label formatter, used only when `min`/`max` are supplied. */
  format?: (v: number) => string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const lut = getColormapLUT(colormap);
    c.width = 1;
    c.height = 256;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(1, 256);
    for (let i = 0; i < 256; i++) {
      const li = (255 - i) * 3;
      const pi = i * 4;
      img.data[pi] = lut[li]!;
      img.data[pi + 1] = lut[li + 1]!;
      img.data[pi + 2] = lut[li + 2]!;
      img.data[pi + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [colormap]);

  const hasDomain = min != null || max != null;
  const ticks = hasDomain
    ? [0, 25, 50, 75, 100].map((pos) => {
        const lo = min ?? 0;
        const hi = max ?? 1;
        const v = hi - (pos / 100) * (hi - lo);
        return { pos, label: (format ?? defaultFormat)(v) };
      })
    : isDiff
      ? DIFF_TICKS
      : BYTE_TICKS;

  return (
    <div className="flex shrink-0 pl-1 w-14 py-1" style={{ height: "100%" }}>
      <canvas
        ref={canvasRef}
        className="rounded-sm shrink-0"
        style={{ imageRendering: "auto", width: 10, height: "100%" }}
      />
      <div className="relative flex-1 ml-0.5" style={{ height: "100%" }}>
        {ticks.map((t, i) => (
          <span
            key={t.pos}
            className="mono absolute text-[7px] text-fg-muted leading-none whitespace-nowrap"
            style={{
              top: `${t.pos}%`,
              transform:
                i === 0
                  ? "none"
                  : i === ticks.length - 1
                    ? "translateY(-100%)"
                    : "translateY(-50%)",
            }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}
