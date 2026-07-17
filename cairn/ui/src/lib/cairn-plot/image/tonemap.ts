/**
 * HDR tone-mapping operators for the float-image path (cairn-plot HDR-A).
 *
 * PIPELINE (the HDR image renderer runs these in order, per pixel):
 *
 *   1. EXPOSURE   — `applyExposure(v, ev) = v * 2**ev`, in scene-linear space,
 *                   where `ev` is a stop count (EV). Applied to each channel
 *                   BEFORE tone-mapping.
 *   2. TONE-MAP   — one `TonemapOperator` (`TONEMAP_OPERATORS[name]`): maps the
 *                   exposure-applied scene-linear RGB in [0, ∞) down to
 *                   DISPLAY-LINEAR RGB in [0, 1]. Still LINEAR light — NOT yet
 *                   gamma/sRGB encoded.
 *   3. OUTPUT-ENCODE — `outputEncode(x, tonemap, gamma)`: the last step maps the
 *                   display-linear [0,1] value to a display-referred code value.
 *                   For `tonemap === "srgb"` this is the sRGB OETF; otherwise a
 *                   plain `pow(x, 1/gamma)` power curve (gamma defaults to 1 =
 *                   identity). This is deliberately SPLIT from the tone-map: the
 *                   operator only compresses HDR→[0,1]; the encode is a separate,
 *                   swappable stage.
 *
 * WHY THE SPLIT: "sRGB" and "gamma" are output *transfer functions*, not
 * tone-maps. Keeping them out of `TONEMAP_OPERATORS` means every operator
 * (linear/reinhard/aces/…) can be paired with any output encode, and adding a
 * new HDR operator is a ONE-LINE addition to `TONEMAP_OPERATORS` — it never has
 * to re-implement gamma/sRGB.
 *
 * ADDING AN OPERATOR: add a single entry to `TONEMAP_OPERATORS` below, e.g.
 *   uncharted2: (rgb) => rgb.map(uncharted2Curve) as RgbTriple,
 * and (optionally) widen the `TonemapOperator` union / Python `Literal`. No
 * other renderer/registry change is needed — `HdrImagePane` looks the operator
 * up by name at render time and falls back to `srgb` for an unknown key.
 *
 * PERF: these are plain scalar functions used in the CPU decode loop (v1).
 * The WebGPU engine (`engine/shaders/image.wgsl.ts`) ports the same operators
 * to a GPU fragment shader (see `HdrImagePane`'s module doc).
 */

export type RgbTriple = [number, number, number];

/**
 * The extensible tone-map operator set. Each operator takes exposure-applied
 * scene-linear RGB in [0, ∞) and returns DISPLAY-LINEAR RGB in [0, 1]
 * (pre-gamma / pre-sRGB). Keep it a plain object so adding an operator is a
 * one-line addition (see module doc).
 */
export type TonemapOperator = "linear" | "srgb" | "reinhard" | "aces" | "extended";

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Per-channel Reinhard tone curve: x / (1 + x). Maps [0,∞) → [0,1), 1 → 0.5. */
const reinhardCurve = (x: number): number => {
  const v = x < 0 ? 0 : x;
  return v / (1 + v);
};

/**
 * Narkowicz 2015 ACES filmic approximation, per channel, clamped to [0,1].
 * `(x*(2.51*x+0.03)) / (x*(2.43*x+0.59)+0.14)`. Monotonic on [0,∞); aces(0)=0.
 */
const acesCurve = (x: number): number => {
  const v = x < 0 ? 0 : x;
  const num = v * (2.51 * v + 0.03);
  const den = v * (2.43 * v + 0.59) + 0.14;
  return clamp01(num / den);
};

export const TONEMAP_OPERATORS: Record<string, (rgb: RgbTriple) => RgbTriple> = {
  // Straight clamp — no tone compression, just clip to displayable range.
  linear: ([r, g, b]) => [clamp01(r), clamp01(g), clamp01(b)],
  // Identity tone-map: the HDR→[0,1] step is a clamp; the sRGB OETF is applied
  // by the OUTPUT-ENCODE stage (`outputEncode` with tonemap==="srgb").
  srgb: ([r, g, b]) => [clamp01(r), clamp01(g), clamp01(b)],
  // Reinhard, per-channel (v1 choice; luminance-based Reinhard is a possible
  // future operator). Naturally lands in [0,1) so the clamp is a no-op safety.
  reinhard: ([r, g, b]) => [reinhardCurve(r), reinhardCurve(g), reinhardCurve(b)],
  // ACES filmic (Narkowicz), per channel.
  aces: ([r, g, b]) => [acesCurve(r), acesCurve(g), acesCurve(b)],
  // Extended (HDR-out only): pure identity — no compression, no clamp.
  // Values stay in scene-linear [0, ∞) so a real HDR surface (`rgba16float`
  // + `toneMapping:{mode:'extended'}`, see `engine/webgpu/surface.ts`'s
  // `configureHDRSurface`) can preserve them past 1.0 — Chrome's `'extended'`
  // canvas tone-mapping mode expects EXACTLY this: the shader hands over raw
  // scene-referred values and the OS/display compositor (not this pipeline)
  // maps them to the panel's actual peak brightness. NOT reachable from any
  // user-facing tonemap picker — only `engine/image-engine.ts`'s HDR-out
  // render path selects it (see `renderers/GpuImagePane.tsx`'s `useHdr`).
  extended: ([r, g, b]) => [r, g, b],
};

/** The default operator when none / an unknown key is supplied. */
export const DEFAULT_TONEMAP: TonemapOperator = "srgb";

/** Resolve an operator name to its function, falling back to the default. */
export function getTonemapOperator(
  name: string | undefined | null,
): (rgb: RgbTriple) => RgbTriple {
  return (name && TONEMAP_OPERATORS[name]) || TONEMAP_OPERATORS[DEFAULT_TONEMAP]!;
}

/** Apply an exposure of `ev` stops in scene-linear space: v * 2**ev. */
export function applyExposure(v: number, ev: number): number {
  return v * 2 ** ev;
}

/** The standard sRGB opto-electronic transfer function (linear → sRGB code). */
export function srgbOetf(x: number): number {
  const v = clamp01(x);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/**
 * OUTPUT-ENCODE: map DISPLAY-LINEAR [0,1] → display code value [0,1].
 *
 * Display encoding is INDEPENDENT of the tone-map operator: every operator
 * (`linear`/`srgb`/`reinhard`/`aces`) produces display-LINEAR light, which must
 * be encoded for the sRGB 8-bit framebuffer. So the default is the sRGB OETF for
 * ALL operators — writing raw display-linear values into an sRGB buffer would
 * render midtones too dark. `gamma` is an OPTIONAL override: when the caller
 * passes a positive number, a pure `pow(x, 1/gamma)` curve is used instead of
 * sRGB (gamma=1 → linear/no-encode, for data already in display space).
 */
export function outputEncode(x: number, gamma?: number): number {
  if (typeof gamma === "number" && gamma > 0) {
    return clamp01(Math.pow(clamp01(x), 1 / gamma));
  }
  return srgbOetf(x);
}
