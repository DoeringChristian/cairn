/**
 * PixelValueOverlay — a TEV-style per-pixel numeric value overlay.
 *
 * When the user zooms in far enough that ONE source pixel covers enough screen
 * space to fit a short number (>= `PIXEL_VALUE_MIN_SCREEN_PX`), this draws each
 * VISIBLE pixel's value(s) centred on the pixel — exactly like the EXR/HDR
 * viewer TEV. Below the threshold it draws nothing (zero cost).
 *
 * Design (self-contained; data-in-props):
 *  - It is a single absolutely-positioned <canvas> laid OVER the image, OUTSIDE
 *    the zoom/pan CSS transform, so its text stays crisp at any zoom (no raster
 *    up-scaling). Position is derived from the displayed image element's live
 *    on-screen rect (`getBoundingClientRect`, already post zoom/pan), so we
 *    never reconstruct the transform math ourselves.
 *  - object-contain letterboxing is applied to that box to find the actual
 *    image region and the per-source-pixel screen size (== the trigger metric).
 *  - Only the on-screen pixel window is iterated (clipped to the canvas rect),
 *    so the drawn count is bounded (each pixel is >= ~30px, so a few hundred at
 *    most). Redraws on zoom / pan / resize / source-data change.
 *  - `pointer-events: none` so wheel-zoom, drag-pan and the split divider under
 *    it keep working untouched.
 *  - Auto-contrast: text colour is chosen per pixel from the displayed pixel's
 *    luminance (black on light, white on dark) with an opposite-colour halo.
 */
import { useCallback, useEffect, useRef } from "react";
import { useDevicePixelRatio } from "../hooks/use-device-pixel-ratio";

/** A source pixel covering at least this many screen px triggers the overlay. */
export const PIXEL_VALUE_MIN_SCREEN_PX = 30;

/**
 * Per-channel tint colours for R / G / B digits. Vivid but bright enough to
 * stay readable on any pixel background — the contrast halo drawn behind them
 * (an opposite-luminance stroke) guarantees legibility even when a channel's
 * tint matches the underlying pixel (e.g. a red digit over a red pixel).
 */
export const CHANNEL_COLORS = ["#ff5a5a", "#39d353", "#5b9bff"] as const;

/**
 * How the overlay prints a channel value.
 *  - `"decimal"` — float where **1.0 = SDR white** (HDR floats exceed 1.0).
 *  - `"int"`     — integer scale where **255 = 1.0 = SDR white** (HDR exceeds 255).
 * The convention maps consistently across the 8-bit (`uint8`) and float
 * (`unit`) pipelines: a stored `uint8` value is `v/255` in decimal; a `unit`
 * float value is `v*255` in int. HDR values > 1.0 are shown, never clamped.
 */
export type PixelValueNotation = "decimal" | "int";

/** Value scale of a raw sample: `uint8` = 0..255 stored bytes; `unit` = float
 *  scene value where 1.0 is SDR white (the HDR pipeline). */
export type PixelValueScale = "uint8" | "unit";

/** Compact float formatting: 3 sig figs, scientific for tiny/huge magnitudes. */
function formatFloat(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e4)) return v.toExponential(1);
  return String(Number(v.toPrecision(3)));
}

/**
 * Format one raw channel value for display under the current notation.
 * Shared by every sampler so int↔decimal stays consistent for both pipelines.
 */
export function formatChannelValue(
  value: number,
  scale: PixelValueScale,
  notation: PixelValueNotation,
): string {
  if (scale === "uint8") {
    // Stored 0..255. int → as-is; decimal → v/255 (255 → 1.0 = white).
    return notation === "int" ? String(Math.round(value)) : formatFloat(value / 255);
  }
  // `unit`: float scene value, 1.0 = white. int → v*255 (255 = white, HDR > 255);
  // decimal → the float as-is (HDR > 1.0 shown, not clamped).
  return notation === "int" ? formatFloat(value * 255) : formatFloat(value);
}

export interface PixelSample {
  /** One text line per value (e.g. `["255","128","0"]` or `["1.23e+02"]`). */
  lines: string[];
  /** Displayed-pixel luminance in [0,1], used to pick a legible text colour. */
  luminance: number;
  /**
   * Optional per-line fill colours (index-aligned to `lines`). A non-null
   * entry tints that line (channel-coloured R/G/B digits); `null`/`undefined`
   * falls back to per-pixel auto-contrast (black on light, white on dark).
   * The legibility halo is always contrast-based, independent of this.
   */
  colors?: (string | null)[];
}

export type PixelSampler = (
  px: number,
  py: number,
  notation: PixelValueNotation,
) => PixelSample | null;

export interface PixelValueOverlayProps {
  /** The displayed <img>/<canvas> — its live rect gives the on-screen image. */
  imageElRef: React.RefObject<HTMLElement | null>;
  naturalWidth: number;
  naturalHeight: number;
  /** Viewport — used only to retrigger a redraw when the user zooms/pans. */
  zoom: number;
  pan: { x: number; y: number };
  /** Per-pixel value/luminance accessor over the RAW source buffer. The current
   *  notation is passed so the sampler formats its lines consistently. */
  sample: PixelSampler;
  /** Notation for the printed values (`decimal` = 1.0 white / `int` = 255 white). */
  notation?: PixelValueNotation;
  /** Bump to force a redraw when the underlying source buffer changes. */
  version?: number;
  /** Called when the overlay's active state changes (true once zoomed in far
   *  enough that per-pixel numbers are being drawn). Lets the host show a
   *  notation toggle only while the numbers are visible. */
  onActiveChange?: (active: boolean) => void;
  /**
   * The currently-DISPLAYED portion of the source image, as a `[0,1]`-normalized
   * `{x,y,w,h}` window over `[naturalWidth, naturalHeight]` — top-down, same
   * convention as `renderers/GpuImagePane.tsx`'s `viewportToUvRect()` BEFORE
   * any backend-specific display flip. Default `{x:0,y:0,w:1,h:1}` (the whole
   * image, matching every prior caller's behaviour exactly).
   *
   * Needed by the GPU panes (`GpuImagePane`/`GpuComparePane`): unlike the
   * legacy CSS-`transform:scale(zoom)` panes — whose `imageElRef` element
   * physically GROWS on screen at higher zoom, so `getBoundingClientRect()`
   * already encodes the zoom and the old naturalWidth/Height-only math was
   * correct — the GPU panes zoom by sampling a smaller crop into an
   * UNCHANGING canvas CSS box (`w-full h-full`, sized by the container, never
   * by zoom). Without this, `draw()` would always compute the SAME
   * zoom-invariant scale (as if the whole image were shown at zoom=1), so the
   * "zoom in until pixels are big enough" trigger could never fire and no
   * per-pixel numbers would ever appear on a GPU pane, however far zoomed in.
   */
  sourceWindow?: { x: number; y: number; w: number; h: number };
}

const FULL_SOURCE_WINDOW = { x: 0, y: 0, w: 1, h: 1 };

export default function PixelValueOverlay({
  imageElRef,
  naturalWidth,
  naturalHeight,
  zoom,
  pan,
  sample,
  notation = "decimal",
  version = 0,
  onActiveChange,
  sourceWindow = FULL_SOURCE_WINDOW,
}: PixelValueOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(false);
  // Q22 fix: self-contained dpr tracking (per this file's own convention —
  // no external hook required of the host pane) so this overlay's own
  // backing store stays crisp when `devicePixelRatio` changes without a
  // container resize (e.g. dragging the window to a different-DPI display)
  // — `draw()` below already re-reads `window.devicePixelRatio` fresh every
  // call, it just needs a trigger to actually redraw.
  const dpr = useDevicePixelRatio();
  const onActiveChangeRef = useRef(onActiveChange);
  onActiveChangeRef.current = onActiveChange;
  const reportActive = useCallback((active: boolean) => {
    if (active === activeRef.current) return;
    activeRef.current = active;
    onActiveChangeRef.current?.(active);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const imgEl = imageElRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW === 0 || cssH === 0) return;
    if (canvas.width !== Math.round(cssW * dpr)) canvas.width = Math.round(cssW * dpr);
    if (canvas.height !== Math.round(cssH * dpr)) canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (!imgEl || naturalWidth <= 0 || naturalHeight <= 0) {
      reportActive(false);
      return;
    }

    const box = imgEl.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) {
      reportActive(false);
      return;
    }

    // The DISPLAYED sub-image, in source pixels: `sourceWindow` (default the
    // whole image) selects a `[0,1]`-normalized crop of
    // `[naturalWidth, naturalHeight]` — object-contain fits THIS crop into
    // `box` (not necessarily the full natural size; see the prop doc for why
    // GPU panes need this).
    const srcOriginX = sourceWindow.x * naturalWidth;
    const srcOriginY = sourceWindow.y * naturalHeight;
    const visibleW = sourceWindow.w * naturalWidth;
    const visibleH = sourceWindow.h * naturalHeight;
    if (visibleW <= 0 || visibleH <= 0) {
      reportActive(false);
      return;
    }

    // object-contain fit: image region + screen px per source pixel.
    const scale = Math.min(box.width / visibleW, box.height / visibleH);
    if (scale < PIXEL_VALUE_MIN_SCREEN_PX) {
      reportActive(false); // below threshold: nothing drawn.
      return;
    }

    const dispW = visibleW * scale;
    const dispH = visibleH * scale;
    // image top-left in canvas-local (CSS px) coords.
    const imgLeft = box.left + (box.width - dispW) / 2 - canvasRect.left;
    const imgTop = box.top + (box.height - dispH) / 2 - canvasRect.top;

    // Visible source-pixel window (clip to both the crop and the canvas viewport).
    const x0 = Math.max(Math.floor(srcOriginX), Math.floor(srcOriginX + (0 - imgLeft) / scale));
    const x1 = Math.min(Math.ceil(srcOriginX + visibleW), Math.ceil(srcOriginX + (cssW - imgLeft) / scale));
    const y0 = Math.max(Math.floor(srcOriginY), Math.floor(srcOriginY + (0 - imgTop) / scale));
    const y1 = Math.min(Math.ceil(srcOriginY + visibleH), Math.ceil(srcOriginY + (cssH - imgTop) / scale));
    if (x1 <= x0 || y1 <= y0) {
      reportActive(false);
      return;
    }
    reportActive(true); // zoomed in far enough — numbers are being drawn.

    // Q19: clip ALL drawing to the DISPLAYED IMAGE's own on-screen rect — the
    // intersection of the actual image bounds `[0,naturalWidth] x
    // [0,naturalHeight]` with `sourceWindow`'s crop, mapped through the same
    // `imgLeft/imgTop + (coord - srcOrigin) * scale` transform used below.
    // `sourceWindow` alone (the crop rect) is NOT enough: when zoomed out
    // past the image's native size (Q18), `sourceWindow` extends past
    // `[0,1]` into the checkerboard border, so its on-screen box is BIGGER
    // than the actual image — without this clip, a halo/stroke drawn near
    // that border could bleed onto the checkerboard.
    const imageLeft = imgLeft + (0 - srcOriginX) * scale;
    const imageTop = imgTop + (0 - srcOriginY) * scale;
    const imageRight = imgLeft + (naturalWidth - srcOriginX) * scale;
    const imageBottom = imgTop + (naturalHeight - srcOriginY) * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(imageLeft, imageTop, imageRight - imageLeft, imageBottom - imageTop);
    ctx.clip();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const pad = scale * 0.14;
    const avail = scale - pad * 2;

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        // Q19: only draw a pixel INSIDE the actual image bounds — never a
        // pixel `sample()` might (incorrectly, for some future caller) still
        // return a value for outside `[0,naturalWidth) x [0,naturalHeight)`.
        if (px < 0 || py < 0 || px >= naturalWidth || py >= naturalHeight) continue;
        const s = sample(px, py, notation);
        if (!s || s.lines.length === 0) continue;
        const lc = s.lines.length;
        let maxChars = 1;
        for (const ln of s.lines) if (ln.length > maxChars) maxChars = ln.length;

        // Fit font to both the height (stacked lines) and width (longest line).
        const byHeight = avail / (lc * 1.15);
        const byWidth = (avail / (maxChars * 0.62)) || byHeight;
        const fontH = Math.min(byHeight, byWidth, 24);
        if (fontH < 6) continue; // too small to be legible — skip this pixel.

        const cx = imgLeft + (px - srcOriginX + 0.5) * scale;
        const cy = imgTop + (py - srcOriginY + 0.5) * scale;
        const lineH = fontH * 1.15;
        const dark = s.luminance <= 0.55;
        const autoFill = dark ? "#ffffff" : "#000000";
        ctx.font = `${fontH}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.lineWidth = Math.max(1.4, fontH * 0.16);
        // Halo/outline is always the opposite-luminance stroke so channel-tinted
        // digits stay readable on ANY pixel background.
        ctx.strokeStyle = dark ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.9)";

        let ly = cy - (lc * lineH) / 2 + lineH / 2;
        for (let k = 0; k < s.lines.length; k++) {
          const ln = s.lines[k]!;
          ctx.strokeText(ln, cx, ly);
          ctx.fillStyle = s.colors?.[k] ?? autoFill;
          ctx.fillText(ln, cx, ly);
          ly += lineH;
        }
      }
    }
    ctx.restore(); // matches the ctx.save()/clip() above.
  }, [imageElRef, naturalWidth, naturalHeight, sample, notation, reportActive, sourceWindow]);

  // Redraw on viewport / data / notation / mount / dpr changes.
  useEffect(() => {
    draw();
  }, [draw, zoom, pan.x, pan.y, version, notation, sourceWindow, dpr]);

  // Redraw on container resize (fit box changes -> pixel size changes).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-10"
      aria-hidden
    />
  );
}

/**
 * A tiny toggle for the pixel-value notation. Controlled: the host owns the
 * `notation` state (seeded from a prop) so the overlay stays self-contained.
 * Render it only while the overlay is active (zoomed in) — the host tracks
 * that via `PixelValueOverlay`'s `onActiveChange`.
 */
export function PixelNotationToggle({
  notation,
  onChange,
  className = "",
}: {
  notation: PixelValueNotation;
  onChange: (n: PixelValueNotation) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange(notation === "int" ? "decimal" : "int");
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={`absolute top-1 right-1 z-20 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-fg-muted backdrop-blur-sm hover:text-fg ${className}`}
      title="Pixel-value notation: 0–255 integer (255 = white) vs 0–1 float (1.0 = white)"
    >
      {notation === "int" ? "0–255" : "0–1"}
    </button>
  );
}
