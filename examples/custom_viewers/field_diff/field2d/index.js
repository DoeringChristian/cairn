// 2D field diff viewer: a scalar field logged as
//
//   cairn.Data({"field": (H, W) array}, kind="field/2d")
//
// drawn on a symmetric diverging colormap (0 is always the neutral middle).
// It is a "compare" viewer: when the card pairs the series with a reference
// (gear > Compare), it gets [A, B] and shows A - B (or A | B). Hover a pixel
// for its values.
//
// The colour scale comes from d3-scale, vendored for offline use with
//   cairn viewer add . d3-scale@4
// which wrote ./vendor and the manifest's "imports": {"d3-scale": ...}.
import { scaleLinear } from "d3-scale";
import { onRender, snapshot } from "cairn:sdk";

// ColorBrewer's diverging palettes: [negative, neutral, positive].
const PALETTES = {
  RdBu: ["#2166ac", "#f7f7f7", "#b2182b"],
  PuOr: ["#542788", "#f7f7f7", "#b35806"],
  BrBG: ["#01665e", "#f5f5f5", "#8c510a"],
};

const canvas = document.createElement("canvas");
canvas.style.cssText = "position:absolute;image-rendering:pixelated";
const tip = document.createElement("div");
tip.style.cssText = "position:absolute;pointer-events:none;padding:2px 6px;border-radius:4px;font:11px var(--cairn-mono);" +
  "background:var(--cairn-bg);color:var(--cairn-fg);border:1px solid var(--cairn-border);display:none;white-space:pre";
const legend = document.createElement("div");
legend.style.cssText = "position:absolute;left:6px;bottom:4px;font:11px var(--cairn-font);color:var(--cairn-muted)";
document.body.append(canvas, legend, tip);
const ctx = canvas.getContext("2d");

// A 256-entry lookup table from the d3 scale (parsing colours per pixel would be slow).
function lut(palette) {
  const scale = scaleLinear().domain([-1, 0, 1]).range(PALETTES[palette] ?? PALETTES.RdBu);
  return Array.from({ length: 256 }, (_, i) => scale((i / 255) * 2 - 1).match(/\d+/g).map(Number));
}

// What is drawn, in field pixels: one or two panels (A - B, or A | B side by side).
let shown = null;

onRender(({ inputs, settings, size }) => {
  const [a, b] = inputs.map((input) => input.data.field); // {data, shape: [H, W]}
  const [h, w] = a.shape;
  const mode = b ? settings.mode : "a";
  const panels =
    mode === "diff" ? [{ title: `${inputs[0].label} − ${inputs[1].label}`, value: (i) => a.data[i] - b.data[i] }]
    : mode === "side" ? [{ title: inputs[0].label, value: (i) => a.data[i] }, { title: inputs[1].label, value: (i) => b.data[i] }]
    : [{ title: inputs[0].label, value: (i) => a.data[i] }];

  // Symmetric range: the setting, or the largest |value| shown.
  let range = settings.range;
  if (!(range > 0)) {
    range = 0;
    for (const p of panels) for (let i = 0; i < w * h; i++) range = Math.max(range, Math.abs(p.value(i)));
    range ||= 1;
  }
  const colors = lut(settings.palette);
  const cut = settings.threshold * range;

  // Draw at field resolution; CSS scales it up (pixelated) to fit the frame.
  const gap = panels.length > 1 ? 2 : 0;
  canvas.width = w * panels.length + gap * (panels.length - 1);
  canvas.height = h;
  const img = ctx.createImageData(canvas.width, h);
  panels.forEach((p, k) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = p.value(y * w + x);
        const t = Math.abs(v) < cut ? 0 : Math.max(-1, Math.min(1, v / range));
        const c = colors[Math.round((t + 1) * 127.5)];
        img.data.set([c[0], c[1], c[2], 255], (y * canvas.width + k * (w + gap) + x) * 4);
      }
    }
  });
  ctx.putImageData(img, 0, 0);
  // Keep the field's aspect inside the frame.
  const fit = Math.min(size.width / canvas.width, (size.height - 18) / h);
  const left = (size.width - canvas.width * fit) / 2;
  Object.assign(canvas.style, { width: `${canvas.width * fit}px`, height: `${h * fit}px`, left: `${left}px`, top: "0px" });
  legend.textContent = `${panels.map((p) => p.title).join("  |  ")}   ·   ±${range.toPrecision(3)}   ·   step ${inputs[0].step}`;
  shown = { panels, w, h, gap, fit, left, a, b, labels: inputs.map((i) => i.label), size };
});

// Hover readout: the field values under the pointer.
canvas.addEventListener("pointermove", (e) => {
  if (!shown) return;
  const { w, h, gap, fit, a, b, labels } = shown;
  const fx = Math.floor(e.offsetX / fit), fy = Math.floor(e.offsetY / fit);
  const x = fx % (w + gap);
  if (x >= w || fy >= h) return void (tip.style.display = "none");
  const i = fy * w + x;
  const lines = [`x ${x}  y ${fy}`, `${labels[0]}: ${a.data[i].toPrecision(4)}`];
  if (b) lines.push(`${labels[1]}: ${b.data[i].toPrecision(4)}`, `A − B: ${(a.data[i] - b.data[i]).toPrecision(4)}`);
  tip.textContent = lines.join("\n");
  Object.assign(tip.style, { display: "block", left: `${shown.left + e.offsetX + 12}px`, top: `${e.offsetY + 12}px` });
});
canvas.addEventListener("pointerleave", () => (tip.style.display = "none"));
// The picture for report exports and paused frames: the frame as it looks,
// at screen resolution (without it, the small field-sized canvas is used).
snapshot(() => {
  if (!shown) return null;
  const { size, fit, left } = shown;
  const out = document.createElement("canvas");
  out.width = size.width * size.dpr;
  out.height = size.height * size.dpr;
  const o = out.getContext("2d");
  o.scale(size.dpr, size.dpr);
  o.imageSmoothingEnabled = false;
  o.drawImage(canvas, left, 0, canvas.width * fit, canvas.height * fit);
  o.fillStyle = getComputedStyle(legend).color;
  o.font = getComputedStyle(legend).font;
  o.fillText(legend.textContent, 6, size.height - 6);
  return out;
});
