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

/** A source pixel covering at least this many screen px triggers the overlay. */
export const PIXEL_VALUE_MIN_SCREEN_PX = 30;

export interface PixelSample {
  /** One text line per value (e.g. `["255","128","0"]` or `["1.23e+02"]`). */
  lines: string[];
  /** Displayed-pixel luminance in [0,1], used to pick a legible text colour. */
  luminance: number;
}

export type PixelSampler = (px: number, py: number) => PixelSample | null;

export interface PixelValueOverlayProps {
  /** The displayed <img>/<canvas> — its live rect gives the on-screen image. */
  imageElRef: React.RefObject<HTMLElement | null>;
  naturalWidth: number;
  naturalHeight: number;
  /** Viewport — used only to retrigger a redraw when the user zooms/pans. */
  zoom: number;
  pan: { x: number; y: number };
  /** Per-pixel value/luminance accessor over the RAW source buffer. */
  sample: PixelSampler;
  /** Bump to force a redraw when the underlying source buffer changes. */
  version?: number;
}

export default function PixelValueOverlay({
  imageElRef,
  naturalWidth,
  naturalHeight,
  zoom,
  pan,
  sample,
  version = 0,
}: PixelValueOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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

    if (!imgEl || naturalWidth <= 0 || naturalHeight <= 0) return;

    const box = imgEl.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;

    // object-contain fit: image region + screen px per source pixel.
    const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
    if (scale < PIXEL_VALUE_MIN_SCREEN_PX) return; // below threshold: nothing.

    const dispW = naturalWidth * scale;
    const dispH = naturalHeight * scale;
    // image top-left in canvas-local (CSS px) coords.
    const imgLeft = box.left + (box.width - dispW) / 2 - canvasRect.left;
    const imgTop = box.top + (box.height - dispH) / 2 - canvasRect.top;

    // Visible source-pixel window (clip to the canvas viewport).
    const x0 = Math.max(0, Math.floor((0 - imgLeft) / scale));
    const x1 = Math.min(naturalWidth, Math.ceil((cssW - imgLeft) / scale));
    const y0 = Math.max(0, Math.floor((0 - imgTop) / scale));
    const y1 = Math.min(naturalHeight, Math.ceil((cssH - imgTop) / scale));
    if (x1 <= x0 || y1 <= y0) return;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const pad = scale * 0.14;
    const avail = scale - pad * 2;

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const s = sample(px, py);
        if (!s || s.lines.length === 0) continue;
        const lc = s.lines.length;
        let maxChars = 1;
        for (const ln of s.lines) if (ln.length > maxChars) maxChars = ln.length;

        // Fit font to both the height (stacked lines) and width (longest line).
        const byHeight = avail / (lc * 1.15);
        const byWidth = (avail / (maxChars * 0.62)) || byHeight;
        const fontH = Math.min(byHeight, byWidth, 24);
        if (fontH < 6) continue; // too small to be legible — skip this pixel.

        const cx = imgLeft + (px + 0.5) * scale;
        const cy = imgTop + (py + 0.5) * scale;
        const lineH = fontH * 1.15;
        const dark = s.luminance <= 0.55;
        ctx.font = `${fontH}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.lineWidth = Math.max(1.4, fontH * 0.16);
        ctx.strokeStyle = dark ? "rgba(0,0,0,0.75)" : "rgba(255,255,255,0.85)";
        ctx.fillStyle = dark ? "#ffffff" : "#000000";

        let ly = cy - (lc * lineH) / 2 + lineH / 2;
        for (const ln of s.lines) {
          ctx.strokeText(ln, cx, ly);
          ctx.fillText(ln, cx, ly);
          ly += lineH;
        }
      }
    }
  }, [imageElRef, naturalWidth, naturalHeight, sample]);

  // Redraw on viewport / data / mount changes.
  useEffect(() => {
    draw();
  }, [draw, zoom, pan.x, pan.y, version]);

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
