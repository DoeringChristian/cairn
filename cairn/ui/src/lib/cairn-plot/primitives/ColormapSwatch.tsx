import type { ColormapName } from "../types";
import { getColormapLUT } from "../colormaps";

export default function ColormapSwatch({
  colormap,
}: {
  colormap: ColormapName;
}) {
  const lut = getColormapLUT(colormap);
  const stops: string[] = [];
  for (let i = 0; i < 256; i += 32) {
    stops.push(`rgb(${lut[i * 3]},${lut[i * 3 + 1]},${lut[i * 3 + 2]})`);
  }
  stops.push(
    `rgb(${lut[255 * 3]},${lut[255 * 3 + 1]},${lut[255 * 3 + 2]})`,
  );
  const gradient = `linear-gradient(to right, ${stops.join(", ")})`;
  return (
    <div className="flex items-center gap-2 py-1">
      <div
        className="h-3 flex-1 rounded border border-border"
        style={{ background: gradient }}
      />
      <span className="text-[10px] text-fg-subtle mono">0</span>
      <span className="text-[10px] text-fg-subtle mono">1</span>
    </div>
  );
}
