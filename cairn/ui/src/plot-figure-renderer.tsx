/**
 * The Plotly `figure` standalone adapter — the ONE renderer the `figure` addon
 * (`plot-figure-addon.tsx` → `figure.iife.js`) carries. It STATICALLY imports
 * the pure `Figure` renderer (and thus `plotly.js-dist-min`, ~4.8M), so this
 * module is the sole Plotly entry point and Plotly lives only in the addon
 * bundle — never in core.
 *
 * Two consumers:
 *   - the **inline figure addon** (`plot-figure-addon.tsx`) imports
 *     `FigureStandalone` directly → Plotly bundled into `figure.iife.js`;
 *   - the **code-split server build** (`plot-main.tsx`) `React.lazy`-imports
 *     this module → Plotly stays in its own async `/assets` chunk.
 *
 * `ChartBox` comes from `plot-standalone-helpers` (dependency-light) rather
 * than `plot-renderers`, so importing this module does NOT drag the 2D
 * renderers into the addon bundle.
 */
import Figure from "./lib/cairn-plot/renderers/Figure";
import { ChartBox } from "./plot-standalone-helpers";

type P = Record<string, any>;

const DEFAULT_FIGURE_SETTINGS = {
  displayModeBar: true,
  scrollZoom: false,
  hoverMode: "closest" as const,
  dragMode: "zoom" as const,
  showLegend: true,
};

export function FigureStandalone(p: P) {
  const { height, figure, settings, ...rest } = p;
  return (
    <ChartBox height={height}>
      <Figure
        figure={figure ?? { data: [], layout: {} }}
        settings={{ ...DEFAULT_FIGURE_SETTINGS, ...(settings ?? {}) }}
        style={{ width: "100%", height: "100%" }}
        {...rest}
      />
    </ChartBox>
  );
}

export default FigureStandalone;
