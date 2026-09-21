/** Artifact download and chart export helpers. */

import html2canvas from "html2canvas";

export type ExportFormat = "svg" | "png" | "jpg" | "pdf";

const MIME_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "audio/wav": ".wav",
  "audio/mpeg": ".mp3",
  "video/mp4": ".mp4",
  "text/plain": ".txt",
  "application/json": ".json",
  "text/html": ".html",
  "text/markdown": ".md",
  "application/python-pickle": ".pkl",
  "application/octet-stream": ".bin",
};

/** Trigger a browser download for the given URL. */
export function downloadArtifact(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

/**
 * Build a safe download filename from metric name, step, and MIME type.
 *
 * `application/octet-stream` covers several distinct binary artifact shapes
 * (npy tensors, npz histograms, ...), so it can't be resolved from MIME alone.
 * Callers that know their own on-disk format (typed cards) can pass
 * `extOverride` to bypass the MIME table entirely; generic callers (that only
 * know the MIME type) keep falling back to `.bin` for octet-stream.
 */
export function artifactFilename(
  metricName: string,
  step: number,
  mime?: string | null,
  extOverride?: string,
): string {
  const safe = metricName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ext = extOverride ?? (mime && MIME_EXT[mime]) ?? ".bin";
  return `${safe}_step${step}${ext}`;
}

/** Sanitize a name for use as a filename. */
export function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Download a Blob as a file. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Export tabular data as a CSV file. */
export function downloadCsv(headers: string[], rows: (string | number)[][], filename: string): void {
  const csv = [headers.join(","), ...rows.map(r => r.map(v => typeof v === "string" && v.includes(",") ? `"${v}"` : String(v)).join(","))].join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv" }), filename);
}

/**
 * Export the chart under `container` as a PNG without depending on
 * cairn-plot renderer internals. The app-level rasterizer captures SVG,
 * canvas, and ordinary DOM layers into one image.
 */
export async function exportChartPng(container: HTMLElement, filename: string): Promise<void> {
  try {
    const canvas = await html2canvas(container, { backgroundColor: null, useCORS: true });
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encoding failed")), "image/png");
    });
    downloadBlob(blob, filename);
  } catch (err) {
    console.error("exportChartPng failed", err);
  }
}

/**
 * Export all images in a container as a composite PNG.
 * Finds all <img> elements, draws them into a grid on a canvas.
 */
/**
 * Pane descriptor for the composite image export.
 * Each pane is either a URL to load or an existing canvas element.
 */
export interface CompositePane {
  /** Artifact URL or data URL for the image. */
  url?: string;
  /** Pre-rendered canvas (e.g., colormap-applied image). */
  canvas?: HTMLCanvasElement;
  /** Label shown above the pane (e.g., "Run A" or "REF"). */
  label: string;
  /** If true, this pane is visually grouped with the next pane (e.g., REF+Pred pair). */
  groupWithNext?: boolean;
  /** If true, skip colormap application for this pane (e.g., reference images). */
  skipColormap?: boolean;
}

/**
 * Export an array of image panes as a composite PNG with labels and optional colorbar.
 *
 * @param panes      Structured list of images to render. Each has a URL or canvas + label.
 * @param filename   Base filename (without extension).
 * @param columns    Number of panes per row.
 * @param colorbar   Optional: { lut: 256×3 Uint8Array, name: string } draws a vertical colorbar.
 */
export async function exportImagesAsComposite(
  panes: CompositePane[],
  filename: string,
  columns = 2,
  colorbar?: { lut: Uint8Array; name: string; diverging?: boolean },
): Promise<void> {
  if (panes.length === 0) return;

  // Load all URL-based images, then apply colormap where needed.
  const rawLoaded: Array<HTMLImageElement | HTMLCanvasElement> = await Promise.all(
    panes.map((p) => {
      if (p.canvas) return Promise.resolve(p.canvas);
      if (!p.url) {
        const c = document.createElement("canvas");
        c.width = 64; c.height = 64;
        return Promise.resolve(c);
      }
      return new Promise<HTMLImageElement>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(img);
        img.src = p.url!;
      });
    }),
  );

  // Apply colormap to images that need it (skip canvases — already processed,
  // and skip panes marked skipColormap like REF images).
  const loaded: Array<HTMLImageElement | HTMLCanvasElement> = rawLoaded.map((src, i) => {
    if (!colorbar || panes[i]!.skipColormap || panes[i]!.canvas) return src;
    // Draw the image to a temp canvas, get ImageData, apply LUT, put back
    const img = src as HTMLImageElement;
    const w = img.naturalWidth || img.width || 256;
    const h = img.naturalHeight || img.height || 256;
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext("2d")!;
    tctx.drawImage(img, 0, 0, w, h);
    try {
      const srcData = tctx.getImageData(0, 0, w, h);
      const lut = colorbar.lut;
      const out = new ImageData(w, h);
      const sd = srcData.data;
      const od = out.data;
      for (let j = 0; j < sd.length; j += 4) {
        const avg = (sd[j]! + sd[j + 1]! + sd[j + 2]!) / 3;
        const idx = colorbar.diverging
          ? Math.max(0, Math.min(255, Math.round(128 + (avg / 255) * 127)))
          : Math.max(0, Math.min(255, Math.round(avg)));
        od[j] = lut[idx * 3]!;
        od[j + 1] = lut[idx * 3 + 1]!;
        od[j + 2] = lut[idx * 3 + 2]!;
        od[j + 3] = sd[j + 3]!;
      }
      tctx.putImageData(out, 0, 0);
    } catch {
      // CORS or tainted canvas — fall back to raw image
      return src;
    }
    return tmp;
  });

  // Determine cell size from the first loaded source
  const first = loaded[0]!;
  const cellW = first instanceof HTMLImageElement
    ? (first.naturalWidth || first.clientWidth || 256)
    : (first.width || 256);
  const cellH = first instanceof HTMLImageElement
    ? (first.naturalHeight || first.clientHeight || 256)
    : (first.height || 256);

  const MONO = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
  const labelH = 20;      // label above each image
  const paneGap = 2;      // gap between panes within a group
  const groupGap = 10;    // gap between groups
  const colorbarW = colorbar ? 20 : 0;
  const colorbarTickW = colorbar ? 32 : 0; // space for tick labels
  const colorbarGap = colorbar ? 16 : 0;

  // Layout: figure out groups. Consecutive panes with groupWithNext form groups.
  const groups: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < panes.length; i++) {
    cur.push(i);
    if (!panes[i]!.groupWithNext || i === panes.length - 1) {
      groups.push(cur);
      cur = [];
    }
  }

  // Each group occupies a grid cell. Lay groups out in columns.
  const cols = Math.min(columns, groups.length);
  const rows = Math.ceil(groups.length / cols);

  // Group width = max panes in any group × cellW + gaps
  const maxPanesInGroup = Math.max(...groups.map((g) => g.length));
  const groupW = maxPanesInGroup * cellW + (maxPanesInGroup - 1) * paneGap;
  const groupH = cellH + labelH;

  const totalW = cols * groupW + (cols - 1) * groupGap + colorbarGap + colorbarW + colorbarTickW;
  const totalH = rows * groupH + (rows - 1) * groupGap;

  const canvas = document.createElement("canvas");
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, totalW, totalH);

  // Draw groups
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]!;
    const col = gi % cols;
    const row = Math.floor(gi / cols);
    const gx = col * (groupW + groupGap);
    const gy = row * (groupH + groupGap);

    // Draw a subtle group border if the group has >1 pane
    if (group.length > 1) {
      const gTotalW = group.length * cellW + (group.length - 1) * paneGap;
      ctx.strokeStyle = "#e8ebef";
      ctx.lineWidth = 1;
      ctx.strokeRect(gx - 1, gy - 1, gTotalW + 2, groupH + 2);
    }

    for (let pi = 0; pi < group.length; pi++) {
      const idx = group[pi]!;
      const px = gx + pi * (cellW + paneGap);
      const py = gy;

      // Label above
      ctx.fillStyle = "#656d76";
      ctx.font = MONO;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(panes[idx]!.label, px + cellW / 2, py + labelH - 4, cellW);

      // Image
      ctx.drawImage(loaded[idx]!, px, py + labelH, cellW, cellH);

      // Thin border around image
      ctx.strokeStyle = "#d0d7de";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(px, py + labelH, cellW, cellH);
    }
  }

  // Colorbar
  if (colorbar) {
    const barX = cols * (groupW + groupGap) - groupGap + colorbarGap;
    const barY = labelH;
    const barH = totalH - labelH;

    // Gradient
    for (let py = 0; py < barH; py++) {
      const t = 1 - py / barH;
      const idx = Math.round(t * 255);
      ctx.fillStyle = `rgb(${colorbar.lut[idx * 3]},${colorbar.lut[idx * 3 + 1]},${colorbar.lut[idx * 3 + 2]})`;
      ctx.fillRect(barX, barY + py, colorbarW, 1);
    }
    ctx.strokeStyle = "#d0d7de";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, colorbarW, barH);

    // Tick labels
    ctx.fillStyle = "#1f2328";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("1.0", barX + colorbarW + 4, barY + 6);
    ctx.fillText("0.5", barX + colorbarW + 4, barY + barH / 2);
    ctx.fillText("0.0", barX + colorbarW + 4, barY + barH - 6);

    // Name below colorbar
    ctx.fillStyle = "#656d76";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(colorbar.name, barX + colorbarW / 2 + colorbarTickW / 2, barY - labelH + 2);
  }

  canvas.toBlob((blob) => {
    if (!blob) return;
    downloadBlob(blob, `${filename}.png`);
  }, "image/png");
}

/**
 * Export a Plotly chart. Uses Plotly's built-in toImage/downloadImage.
 */
export async function exportPlotlyChart(
  plotEl: HTMLElement,
  filename: string,
  format: ExportFormat,
): Promise<void> {
  // Plotly attaches to the .js-plotly-plot container
  const plotlyEl = plotEl.querySelector(".js-plotly-plot") ?? plotEl;
  const Plotly = (window as any).Plotly;
  if (!Plotly?.downloadImage) {
    // Fallback: cairn-plot's client-side rasterizer if the Plotly global is
    // not available (rasterizes the plotted SVG to PNG).
    await exportChartPng(plotEl, filename);
    return;
  }
  const plotlyFormat = format === "jpg" ? "jpeg" : format === "pdf" ? "svg" : format;
  await Plotly.downloadImage(plotlyEl, {
    format: plotlyFormat,
    filename,
    width: plotlyEl.clientWidth * 2,
    height: plotlyEl.clientHeight * 2,
    scale: 2,
  });
}
