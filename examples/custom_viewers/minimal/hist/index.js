// A minimal cairn custom viewer: draws a logged 1-D array as bars.
//
// It runs in a sandboxed frame: no network, no cookies, no access to the app.
// Everything it gets comes through `cairn:sdk` (docs: guides/custom-viewers.md).
// `cairn-viewer.json` next to this file says which data it accepts and which
// settings it has; the card's gear shows those settings.
import { onRender } from "cairn:sdk";

// One canvas filling the frame.
const canvas = document.createElement("canvas");
document.body.append(canvas);
const ctx = canvas.getContext("2d");

// Called on every change: the step (slider), the settings, the size, the theme.
//   inputs[0].data  what was logged; a dict of arrays arrives as
//                   {name: {data: TypedArray, shape: [...], dtype: "float32"}}
//   settings        this card's values of the manifest's settings
//   size            {width, height, dpr}: the frame in CSS pixels
//   theme           the app's colours: {bg, fg, muted, accent, font, ...}
onRender(({ inputs, settings, size, theme }) => {
  // Crisp on high-DPI screens: draw in device pixels, measure in CSS pixels.
  canvas.width = size.width * size.dpr;
  canvas.height = size.height * size.dpr;
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  ctx.clearRect(0, 0, size.width, size.height);

  // The logged array: cairn.Data({"values": arr}, kind="demo/hist").
  let values = Array.from(inputs[0].data.values.data);
  // A "Data" tab setting: bars as fractions of the total.
  if (settings.normalize) {
    const total = values.reduce((a, b) => a + b, 0) || 1;
    values = values.map((v) => v / total);
  }

  // A "Display" tab setting: the bar colour ("accent" follows the app's theme).
  ctx.fillStyle = settings.color === "accent" ? theme.accent : settings.color;
  const max = values.reduce((a, b) => Math.max(a, b), 1e-12);
  const w = size.width / values.length;
  const top = 18; // room for the caption
  values.forEach((v, i) => {
    const h = (v / max) * (size.height - top);
    ctx.fillRect(i * w + 1, size.height - h, Math.max(1, w - 2), h);
  });

  ctx.fillStyle = theme.muted;
  ctx.font = `11px ${theme.font}`;
  ctx.fillText(`step ${inputs[0].step} · max ${max.toPrecision(3)}`, 4, 12);
});
// Snapshots (paused frames, report exports) default to the first <canvas>.
