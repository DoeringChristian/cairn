/**
 * `primitives/plot-to-png.ts` — self-contained, client-side PNG export for
 * cairn-plot renderers. No external libraries, no CDN (the standalone bundle
 * forbids both): SVG charts rasterize by inlining computed styles onto a clone
 * (an `<svg>` referencing CSS variables like `var(--color-…)` cannot resolve
 * them once serialized to a `data:` URL), then drawing to a 2D canvas; image
 * panes are already a `<canvas>` and copy straight across.
 *
 * Shared by the SVG-chart controller (`use-chart-controller.ts`), the Scalar
 * controller, and the image-pane controller so every `<PlotToolbar>` camera
 * button produces the same download.
 */

export interface PlotToPngOptions {
  /** Device-pixel multiplier for a crisper export. Default: `devicePixelRatio`
   *  (clamped to [1, 3]). */
  scale?: number;
  /** Fill painted behind transparent content. Default: the nearest opaque
   *  ancestor background, else white. */
  background?: string;
  /** Advisory filename (used by {@link downloadBlob}). */
  filename?: string;
}

// The subset of computed style that actually paints an SVG chart. Copied onto
// the clone so a `data:` URL raster (which sees no stylesheet / CSS vars)
// reproduces the on-screen appearance.
const STYLE_PROPS = [
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity",
  "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "color",
  "font", "font-family", "font-size", "font-weight", "font-style",
  "text-anchor", "dominant-baseline", "visibility", "display",
] as const;

function inlineComputedStyles(src: Element, dst: Element): void {
  const cs = getComputedStyle(src);
  const decl = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";");
  const prev = dst.getAttribute("style");
  dst.setAttribute("style", prev ? `${prev};${decl}` : decl);
  const sc = src.children;
  const dc = dst.children;
  const n = Math.min(sc.length, dc.length);
  for (let i = 0; i < n; i++) inlineComputedStyles(sc[i]!, dc[i]!);
}

function resolveBackground(el: Element): string {
  let node: Element | null = el;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "transparent" && !bg.startsWith("rgba(0, 0, 0, 0)")) return bg;
    node = node.parentElement;
  }
  return "#ffffff";
}

function pickScale(opts?: PlotToPngOptions): number {
  const s =
    opts?.scale ??
    (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  return Math.min(Math.max(s, 1), 3);
}

async function rasterize(
  width: number,
  height: number,
  scale: number,
  background: string,
  draw: (ctx: CanvasRenderingContext2D) => void,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("plot-to-png: 2D canvas context unavailable");
  ctx.scale(scale, scale);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  draw(ctx);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("plot-to-png: toBlob returned null"))),
      "image/png",
    ),
  );
}

function svgToImage(
  svg: SVGSVGElement,
  width: number,
  height: number,
): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineComputedStyles(svg, clone);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const xml = new XMLSerializer().serializeToString(clone);
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("plot-to-png: SVG rasterization failed"));
    img.src = url;
  });
}

/** Rasterize a standalone `<canvas>` (image panes — WebGPU or 2D). */
export async function canvasToPng(
  canvas: HTMLCanvasElement,
  opts?: PlotToPngOptions,
): Promise<Blob> {
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || canvas.width;
  const h = rect.height || canvas.height;
  const bg = opts?.background ?? resolveBackground(canvas);
  return rasterize(w, h, pickScale(opts), bg, (ctx) =>
    ctx.drawImage(canvas, 0, 0, w, h),
  );
}

/**
 * Rasterize a plain `<img>` (the CPU image pane's SDR/verbatim display path,
 * which shows an `<img>` rather than an `<svg>`/`<canvas>`). Exports at the
 * image's DISPLAYED geometry — matching the other paths — but uses the intrinsic
 * `naturalWidth`/`naturalHeight` as the drawn source so a down-scaled display
 * stays crisp. Same-document `data:`/`blob:` sources (our self-contained store)
 * never taint the canvas; a genuinely cross-origin source makes `toBlob`
 * readback throw, which we surface as a clear error.
 */
export async function imageToPng(
  img: HTMLImageElement,
  opts?: PlotToPngOptions,
): Promise<Blob> {
  const rect = img.getBoundingClientRect();
  const w = rect.width || img.naturalWidth || img.width;
  const h = rect.height || img.naturalHeight || img.height;
  const bg = opts?.background ?? resolveBackground(img);
  try {
    return await rasterize(w, h, pickScale(opts), bg, (ctx) =>
      ctx.drawImage(img, 0, 0, w, h),
    );
  } catch (err) {
    throw new Error(
      "plot-to-png: cannot export <img> — the image source appears to be " +
        "cross-origin (tainted canvas). Same-document data:/blob: images " +
        `export fine. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

/** Pick the largest visible `<img>` under `root` (by displayed area). */
function largestVisibleImg(root: HTMLElement): HTMLImageElement | null {
  const imgs = Array.from(root.querySelectorAll("img")) as HTMLImageElement[];
  let best: HTMLImageElement | null = null;
  let bestArea = 0;
  for (const img of imgs) {
    const r = img.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) {
      bestArea = area;
      best = img;
    }
  }
  return best;
}

/** Rasterize an `<svg>` (SVG charts). */
export async function svgToPng(
  svg: SVGSVGElement,
  opts?: PlotToPngOptions,
): Promise<Blob> {
  const rect = svg.getBoundingClientRect();
  const w = rect.width || Number(svg.getAttribute("width")) || 300;
  const h = rect.height || Number(svg.getAttribute("height")) || 150;
  const bg = opts?.background ?? resolveBackground(svg);
  const img = await svgToImage(svg, w, h);
  return rasterize(w, h, pickScale(opts), bg, (ctx) =>
    ctx.drawImage(img, 0, 0, w, h),
  );
}

/**
 * Export the renderable content under `root`. Prefers an `<svg>` chart,
 * compositing any sibling `<canvas>` layers underneath it (Heatmap draws cells
 * to a `<canvas>` with the axes SVG on top); falls back to a lone `<canvas>`.
 * Throws when neither is present.
 */
export async function plotToPng(
  root: HTMLElement,
  opts?: PlotToPngOptions,
): Promise<Blob> {
  const svg = root.querySelector("svg") as SVGSVGElement | null;
  const canvases = Array.from(
    root.querySelectorAll("canvas"),
  ) as HTMLCanvasElement[];
  const rootRect = root.getBoundingClientRect();
  const w = rootRect.width || 300;
  const h = rootRect.height || 150;
  const bg = opts?.background ?? resolveBackground(root);

  if (svg) {
    const sr = svg.getBoundingClientRect();
    const svgImg = await svgToImage(svg, sr.width || w, sr.height || h);
    return rasterize(w, h, pickScale(opts), bg, (ctx) => {
      for (const c of canvases) {
        const cr = c.getBoundingClientRect();
        ctx.drawImage(
          c,
          cr.left - rootRect.left,
          cr.top - rootRect.top,
          cr.width,
          cr.height,
        );
      }
      ctx.drawImage(
        svgImg,
        sr.left - rootRect.left,
        sr.top - rootRect.top,
        sr.width,
        sr.height,
      );
    });
  }
  if (canvases.length) return canvasToPng(canvases[0]!, opts);
  // No SVG and no canvas: the CPU image pane's plain-<img> display path. Fall
  // back to the largest visible <img> so the toolbar's camera button still
  // produces a download instead of silently rejecting.
  const img = largestVisibleImg(root);
  if (img) return imageToPng(img, opts);
  throw new Error("plot-to-png: no <svg>, <canvas>, or <img> found under root");
}

/** Trigger a browser download of a PNG Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
