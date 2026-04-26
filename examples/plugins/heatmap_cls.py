"""Class-based JS heatmap plugin example."""

from cairn import JSPlugin


class Heatmap(JSPlugin):
    """Canvas 2D heatmap with color mapping and value annotations."""

    name = "heatmap"

    js = """
window.cairn.render = function (msg) {
  const { data, metadata, step } = msg;
  const rows = metadata.rows || 1;
  const cols = metadata.cols || 1;
  const values = new Float32Array(data);

  let min = Infinity, max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  const range = max - min || 1;

  const cellSize = Math.min(60, Math.floor(400 / Math.max(rows, cols)));
  const pad = 40;
  const width = cols * cellSize + pad * 2;
  const height = rows * cellSize + pad * 2;

  document.body.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#c9d1d9";
  ctx.font = "12px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(
    (metadata.label || "Heatmap") + "  \\u2014  step " + step,
    width / 2, 16
  );

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = values[r * cols + c] || 0;
      const t = (v - min) / range;
      const red = Math.round(68 + t * 187);
      const green = Math.round(1 + t * 215);
      const blue = Math.round(84 + (1 - t) * 74 - t * 50);
      ctx.fillStyle = "rgb(" + red + "," + green + "," + blue + ")";

      const x = pad + c * cellSize;
      const y = pad + r * cellSize;
      ctx.fillRect(x, y, cellSize - 1, cellSize - 1);

      if (cellSize >= 30) {
        ctx.fillStyle = t > 0.5 ? "#000" : "#fff";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(v.toFixed(2), x + cellSize / 2, y + cellSize / 2);
      }
    }
  }
};
"""
