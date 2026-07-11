/**
 * The plot descriptor — the ONE input that drives the standalone plot bundle
 * (`plot-main.tsx`). It is renderer-props-shaped (design spec §4/§6): it names
 * a renderer, carries that renderer's non-data config `props`, and a `data`
 * spec the bootstrap resolves — through a pluggable `DataSource` — into the
 * renderer's data-contract props (§1).
 *
 * Source order (see `plot-main.tsx`):
 *  - LOCAL default: an inlined `<script type="application/cairn-plot+json">`
 *    blob on the page (self-contained, no URL param);
 *  - ENDPOINT: a `?src=`/`?sid=` URL param pointing at a descriptor the
 *    bootstrap fetches from the repo endpoint.
 *
 * LOCAL vs ENDPOINT is ONE branch in the resolve step: same descriptor shape,
 * same `RENDERER_MAP`, same renderers — only the `DataSource` differs.
 *
 * Phase C's Python emitter builds this exact shape; keep it and the Python
 * `PlotSpec` (Phase C) in lockstep.
 */
import {
  resolveImageViewportItems,
  parseOverlay,
  type DataSource,
} from "./lib/cairn-plot";

/**
 * How the renderer's DATA props are produced.
 *
 *  - `inline`: the data-contract props are plain JSON, carried directly in the
 *    descriptor (2D contracts — Series[]/points[]/matrix/counts+edges/table/
 *    figure). The bootstrap merges `props` straight onto the renderer. No
 *    `DataSource` needed.
 *  - `image`: a content-addressed image artifact (+ optional baseline +
 *    overlay metadata). Resolved via `resolveImageViewportItems` against the
 *    active `DataSource` (LOCAL `data:` URL or ENDPOINT `/api/artifacts/…`),
 *    yielding `{ imageUrl, baselineUrl, overlay }` for `ImagePane`.
 */
export type DataSpec =
  | { kind: "inline"; props: Record<string, unknown> }
  | {
      kind: "image";
      hash: string | null;
      referenceHash?: string | null;
      metadata?: string | null;
    };

export interface PlotDescriptor {
  /** Key into `RENDERER_MAP` (e.g. "scalar", "image", "table", "figure"). */
  renderer: string;
  /** The renderer's non-data config props (§1 "Non-data config props"). */
  props?: Record<string, unknown>;
  /** How to produce the renderer's DATA props. */
  data: DataSpec;
  /** Which `DataSource` the bootstrap builds for `data` resolution.
   *  Optional — omitted (or "local") means the self-contained LOCAL store;
   *  kept optional so it stays in lockstep with the Python `PlotSpec` default
   *  (`mode="local"`). */
  mode?: "local" | "endpoint";
  /** ENDPOINT only: absolute base URL of the repo server (no trailing slash),
   *  used to build `${endpoint}/api/artifacts/${hash}`. */
  endpoint?: string;
}

/**
 * Resolve a descriptor's `DataSpec` → the renderer's DATA props, using the
 * active `DataSource`. The single seam where LOCAL and ENDPOINT converge:
 * every branch below is source-agnostic (it only calls `source.artifactUrl` /
 * `source.bytes`), so the same code path serves both modes.
 */
export async function resolveDataProps(
  data: DataSpec,
  source: DataSource,
): Promise<Record<string, unknown>> {
  switch (data.kind) {
    case "inline":
      return { ...data.props };
    case "image": {
      const res = resolveImageViewportItems(
        {
          hashes: [data.hash ?? null],
          referenceHashes: [data.referenceHash ?? null],
          metadata: [data.metadata ?? null],
        },
        source,
        parseOverlay,
      );
      const item = res.items[0] ?? null;
      const ref = res.referenceItems[0] ?? null;
      return {
        imageUrl: item?.url ?? null,
        baselineUrl: ref?.url ?? null,
        overlay: item?.overlay ?? undefined,
      };
    }
  }
}
