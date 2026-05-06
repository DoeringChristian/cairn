/** Artifact download and chart export helpers. */

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
  "application/octet-stream": ".bin",
};

/** Trigger a browser download for the given URL. */
export function downloadArtifact(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

/** Build a safe download filename from metric name, step, and MIME type. */
export function artifactFilename(
  metricName: string,
  step: number,
  mime?: string | null,
): string {
  const safe = metricName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ext = (mime && MIME_EXT[mime]) ?? ".bin";
  return `${safe}_step${step}${ext}`;
}

/** Sanitize a name for use as a filename. */
export function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Download a Blob as a file. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Serialize an SVG element to a standalone SVG string with computed styles
 * inlined so it renders correctly outside the page.
 */
function serializeSvg(svgEl: SVGSVGElement): string {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  // Ensure the SVG has explicit dimensions
  const { width, height } = svgEl.getBoundingClientRect();
  clone.setAttribute("width", String(Math.round(width)));
  clone.setAttribute("height", String(Math.round(height)));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // Inline computed styles on all elements so export is self-contained
  const origEls = svgEl.querySelectorAll("*");
  const cloneEls = clone.querySelectorAll("*");
  for (let i = 0; i < origEls.length; i++) {
    const cs = getComputedStyle(origEls[i]!);
    const el = cloneEls[i]! as SVGElement | HTMLElement;
    // Copy key properties that affect rendering
    for (const prop of ["fill", "stroke", "stroke-width", "stroke-dasharray", "font-size", "font-family", "font-weight", "opacity", "visibility", "display"]) {
      const val = cs.getPropertyValue(prop);
      if (val) el.style.setProperty(prop, val);
    }
  }
  return new XMLSerializer().serializeToString(clone);
}

/**
 * Render an SVG string to a canvas and return it as a Blob.
 */
function svgToRasterBlob(
  svgStr: string,
  width: number,
  height: number,
  format: "png" | "jpg",
  scale = 2,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d")!;
      if (format === "jpg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))),
        format === "jpg" ? "image/jpeg" : "image/png",
        0.95,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("SVG render failed")); };
    img.src = url;
  });
}

/**
 * Export a chart from a container element that contains an SVG (e.g., Recharts).
 * Finds the first `<svg>` child, serializes it, and downloads in the requested format.
 */
export async function exportChartFromContainer(
  container: HTMLElement,
  filename: string,
  format: ExportFormat,
): Promise<void> {
  const svg = container.querySelector("svg");
  if (!svg) return;
  const { width, height } = svg.getBoundingClientRect();
  const svgStr = serializeSvg(svg);

  if (format === "svg") {
    downloadBlob(new Blob([svgStr], { type: "image/svg+xml" }), `${filename}.svg`);
    return;
  }

  if (format === "png" || format === "jpg") {
    const blob = await svgToRasterBlob(svgStr, width, height, format);
    downloadBlob(blob, `${filename}.${format}`);
    return;
  }

  if (format === "pdf") {
    // PDF: export as high-res SVG (vector, opens in any PDF viewer that supports SVG)
    downloadBlob(new Blob([svgStr], { type: "image/svg+xml" }), `${filename}.svg`);
  }
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
    // Fallback: use SVG serialization if Plotly global not available
    await exportChartFromContainer(plotEl, filename, format);
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
