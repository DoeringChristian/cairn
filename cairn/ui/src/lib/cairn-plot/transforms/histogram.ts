/**
 * Client-side histogram helpers.
 *
 * `computeHistogram` mirrors `numpy.histogram` (uniform bins over [min, max],
 * last bin closed) for the Tensor card's client-computed histogram view.
 * `rebinHistograms` resamples a set of per-step histograms (each with its own
 * min/max/edges) onto one common bin grid so they can be stacked into a
 * step × bin heatmap.
 */

export interface HistogramData {
  /** Bin counts, length = number of bins. */
  counts: number[];
  /** Bin edges, length = counts.length + 1. */
  edges: number[];
}

export function computeHistogram(
  values: ArrayLike<number>,
  bins = 64,
): HistogramData {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) {
    min = 0;
    max = 1;
  }
  if (min === max) {
    min -= 0.5;
    max += 0.5;
  }
  const width = (max - min) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    let b = Math.floor((v - min) / width);
    if (b < 0) b = 0;
    if (b >= bins) b = bins - 1;
    counts[b]!++;
  }
  const edges = new Array<number>(bins + 1);
  for (let i = 0; i <= bins; i++) edges[i] = min + i * width;
  return { counts, edges };
}

export interface RebinResult {
  /** Common bin edges, length = bins + 1. */
  yEdges: number[];
  /** Resampled counts, `matrix[stepIdx][binIdx]`. */
  matrix: number[][];
}

export function rebinHistograms(
  perStep: HistogramData[],
  bins = 64,
): RebinResult {
  let gmin = Infinity;
  let gmax = -Infinity;
  for (const s of perStep) {
    if (!s.edges.length) continue;
    gmin = Math.min(gmin, s.edges[0]!);
    gmax = Math.max(gmax, s.edges[s.edges.length - 1]!);
  }
  if (!Number.isFinite(gmin)) {
    gmin = 0;
    gmax = 1;
  }
  if (gmin === gmax) {
    gmin -= 0.5;
    gmax += 0.5;
  }
  const bw = (gmax - gmin) / bins;
  const yEdges = new Array<number>(bins + 1);
  for (let i = 0; i <= bins; i++) yEdges[i] = gmin + i * bw;

  const matrix = perStep.map((s) => {
    const out = new Array<number>(bins).fill(0);
    for (let j = 0; j < s.counts.length; j++) {
      const e0 = s.edges[j]!;
      const e1 = s.edges[j + 1]!;
      const c = s.counts[j]!;
      if (c === 0 || e1 <= e0) continue;
      const srcW = e1 - e0;
      let tb0 = Math.floor((e0 - gmin) / bw);
      let tb1 = Math.floor((e1 - gmin) / bw);
      tb0 = Math.max(0, Math.min(bins - 1, tb0));
      tb1 = Math.max(0, Math.min(bins - 1, tb1));
      for (let tb = tb0; tb <= tb1; tb++) {
        const te0 = gmin + tb * bw;
        const te1 = te0 + bw;
        const ov = Math.min(e1, te1) - Math.max(e0, te0);
        if (ov > 0) out[tb]! += c * (ov / srcW);
      }
    }
    return out;
  });
  return { yEdges, matrix };
}
