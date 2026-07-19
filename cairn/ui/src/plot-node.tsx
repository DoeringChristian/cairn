/**
 * The recursive cairn-plot compositor (G1). A `PlotDescriptor` is a TREE of
 * `PlotNode`s — `plot` leaves, `grid` layouts, `compare` panes — and this
 * module renders it. `PlotApp` (plot-bootstrap.tsx) is now a thin root wrapper
 * that builds ONE `DataSource` for the whole tree, seeds a `SharedPlotContext`,
 * and mounts `<PlotNodeView node={root} />`.
 *
 * The former flat single-renderer body of `PlotApp` lives on here as
 * `LeafView` (resolveDataProps → bounded wait-for-registration → render via the
 * `*Standalone` adapters in the registry), verbatim in behaviour so the
 * legacy-flat shim path renders identically.
 */
import React, {
  Suspense,
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
} from "react";
import {
  Colorbar,
  CompositeMediaPane,
  parseOverlay,
  resolveImageViewportItems,
  type ColormapName,
  type DataSource,
  type DiffMode,
  type ImageOverlayData,
  type ImageProcessing,
  type Interpolation,
} from "./lib/cairn-plot";
import type { Viewport as ImageViewport } from "./lib/cairn-plot/hooks/use-image-viewport";
import {
  resolveDataProps,
  type CompareNode,
  type DataSpec,
  type GridNode,
  type PlotLeafNode,
  type PlotNode,
  type SharedProps,
} from "./plot-descriptor";
import { getRenderer, onRegister } from "./plot-registry";
import { ChartBox, ChartFillContext } from "./plot-standalone-helpers";

/**
 * How long a `LeafView` waits for a not-yet-registered renderer (an addon
 * `<script>` still parsing) before surfacing "unknown renderer". Reduced from
 * 8000 (O2 review M1): the addon IIFE is emitted synchronously BEFORE the mount
 * push and runs same-page, so registration always wins in practice; this bound
 * only guards a genuinely unknown/misspelled renderer, which shouldn't stall 8s.
 */
const RENDERER_WAIT_MS = 4000;

/** Root-provided context shared by the whole tree: the single `DataSource`,
 *  the nearest grid's `shared` block (colormap/colorRange/reference/…), and
 *  (when that grid opted in via `shared.sync.viewport`) the live viewport-sync
 *  group id for that grid — see `GridView`'s derivation. The SAME id is
 *  threaded to every leaf and drives BOTH sync buses: image panes via
 *  `image-viewport-sync.ts` (`useSyncedImageViewport`) and 2D charts via
 *  `chart-viewport-sync.ts` (`useChartSyncTarget` → `useChartViewport`), so one
 *  flag links a grid's images AND charts. Mirrors the 3D `cameraSyncGroupId`
 *  mechanism (`lib/camera-sync.ts`'s `useCameraSync`), scoped per grid
 *  instead of per card. */
export interface SharedPlotCtx {
  source: DataSource;
  shared?: SharedProps;
  viewportSyncGroupId?: string | null;
}
export const SharedPlotContext = createContext<SharedPlotCtx | null>(null);

function useSharedPlot(): SharedPlotCtx {
  const ctx = useContext(SharedPlotContext);
  if (!ctx) throw new Error("PlotNodeView used outside a SharedPlotContext");
  return ctx;
}

function Message({ text, error }: { text: string; error?: boolean }) {
  return (
    <div className={`card p-4 text-sm ${error ? "text-red-400" : "text-fg-muted"}`}>
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaf — the former flat `PlotApp` body. Resolves the leaf's DataSpec against
// the shared source, waits (bounded) for its renderer to register, and renders
// the registered `*Standalone` adapter. `shared.colormap`/`colorRange` merge in
// BELOW the leaf's own props (leaf props win).
// ---------------------------------------------------------------------------
function LeafView({ node }: { node: PlotLeafNode }) {
  const { source, shared, viewportSyncGroupId } = useSharedPlot();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; props: Record<string, unknown> }
  >({ status: "loading" });
  const [, bumpRegistry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dataProps = await resolveDataProps(node.data, source);
        if (cancelled) return;
        const sharedProps: Record<string, unknown> = {};
        if (shared?.colormap != null) sharedProps.colormap = shared.colormap;
        if (shared?.colorRange != null) sharedProps.colorRange = shared.colorRange;
        // Viewport sync (`shared.sync.viewport`) — threaded down as one group
        // id every synced leaf picks up: `image`/`imagehdr` adapters via
        // `useSyncedImageViewport`, and 2D chart adapters via
        // `ChartSyncBoundary` → `useChartViewport` (see `plot-renderers.tsx`).
        // Harmless on leaves that don't sync (an unused prop), same as
        // `colormap`/`colorRange` above.
        if (viewportSyncGroupId) sharedProps.viewportSyncGroupId = viewportSyncGroupId;
        setState({
          status: "ready",
          props: { ...sharedProps, ...(node.props ?? {}), ...dataProps },
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [node, source, shared, viewportSyncGroupId]);

  // Wait-for-registration: re-render the instant the renderer arrives, else
  // surface a bounded "unknown renderer" error.
  const rendererMissing = state.status === "ready" && !getRenderer(node.renderer);
  useEffect(() => {
    if (state.status !== "ready" || getRenderer(node.renderer)) return;
    const name = node.renderer;
    let settled = false;
    const unsub = onRegister(() => {
      if (!settled && getRenderer(name)) {
        settled = true;
        bumpRegistry((n) => n + 1);
      }
    });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        setState({ status: "error", message: `unknown renderer "${name}"` });
      }
    }, RENDERER_WAIT_MS);
    return () => {
      settled = true;
      unsub();
      clearTimeout(timer);
    };
  }, [state, rendererMissing, node.renderer]);

  if (state.status === "loading") return <Message text="Loading…" />;
  if (state.status === "error") return <Message text={`Plot error: ${state.message}`} error />;
  const Renderer = getRenderer(node.renderer);
  return Renderer ? (
    <Suspense fallback={<Message text="Loading renderer…" />}>
      <Renderer {...state.props} />
    </Suspense>
  ) : (
    <Message text="Loading renderer…" />
  );
}

// ---------------------------------------------------------------------------
// Compare — two DataSpec frames composited into one pane. Resolves each frame's
// URL (image → DataSource lookup, url → verbatim), picks the reference by
// `baselineIndex`, and delegates to `CompositeMediaPane` (which degrades to a
// single "normal" pane if no baseline resolves). Wrapped in `ChartBox` so it
// fills a sized grid cell (fill) or gets a default height standalone.
// ---------------------------------------------------------------------------
function resolveFrame(
  data: DataSpec,
  source: DataSource,
): { url: string | null; overlay?: ImageOverlayData } {
  if (data.kind === "url") {
    return { url: data.src, overlay: parseOverlay(data.metadata) ?? undefined };
  }
  if (data.kind === "image") {
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
    return { url: item?.url ?? null, overlay: item?.overlay ?? undefined };
  }
  // `inline` frames have no image URL — compare needs images.
  return { url: null };
}

function CompareView({ node }: { node: CompareNode }) {
  const { source, shared } = useSharedPlot();
  const a = resolveFrame(node.a, source);
  const b = resolveFrame(node.b, source);
  const baseIdx = node.baselineIndex ?? 0;
  const reference = baseIdx === 0 ? a : b;
  const foreground = baseIdx === 0 ? b : a;

  // F2: honour the compare node's own `props` (interpolation/colormap/diff
  // submode/split/blend/…) — CompareView previously dropped them entirely. A
  // node prop wins over the inherited `shared` block, which wins over defaults.
  const props = (node.props ?? {}) as Record<string, unknown>;
  const colormap =
    (props.colormap as ColormapName | undefined) ??
    (shared?.colormap as ColormapName | undefined) ??
    "viridis";
  const diffSubmode =
    (props.diffSubmode as DiffMode | undefined) ??
    (node.diffSubmode as DiffMode | undefined) ??
    "signed";

  // The split-view separator is a CONTROLLED drag handle: MediaComparePane's
  // divider calls `onSplitPositionChange` but renders `splitPosition` from
  // props, so without local state the separator has nowhere to write and can't
  // move. Own the split position here, seeded from the node's own prop.
  // (`blendAlpha` has no interactive control in the compositor — the blend is a
  // static opacity — so it stays a plain prop.)
  const [splitPos, setSplitPos] = useState<number>(
    (props.splitPosition as number | undefined) ?? 0.5,
  );

  // Own the live viewport (zoom/pan) locally so wheel-zoom + drag-pan work in
  // the compare view exactly like the single ImageStandalone pane. The
  // compositor forwards this SAME zoom/pan to BOTH the baseline and comparison
  // panes, so split/blend/diff zoom in lock-step and the split divider stays
  // aligned. (Previously hardcoded zoom=1/pan=0, so zoom never worked here.)
  const [viewport, setViewport] = useState<ImageViewport>({
    zoom: 1,
    pan: { x: 0, y: 0 },
  });

  return (
    <ChartBox>
      <CompositeMediaPane
        mode={node.mode}
        imageUrl={foreground.url}
        baselineUrl={reference.url}
        diffSubmode={diffSubmode}
        colormap={colormap}
        interpolation={(props.interpolation as Interpolation | undefined) ?? "auto"}
        showAxes={(props.showAxes as boolean | undefined) ?? false}
        processing={props.processing as ImageProcessing | undefined}
        splitPosition={splitPos}
        onSplitPositionChange={setSplitPos}
        blendAlpha={props.blendAlpha as number | undefined}
        zoom={viewport.zoom}
        pan={viewport.pan}
        onViewportChange={setViewport}
        label=""
        overlay={foreground.overlay}
        pixelValueNotation={
          props.pixelValueNotation as "decimal" | "int" | undefined
        }
      />
    </ChartBox>
  );
}

// ---------------------------------------------------------------------------
// Grid — children in a CSS grid. `colWidths`/`rowHeights`: number → `Nfr`,
// string → verbatim CSS. When `rowHeights` is set, cells fill (`height:100%`)
// and `ChartFillContext` publishes `true` so chart leaves fill their cell. A
// single shared `Colorbar` renders beside the grid when `shared.colorbar`.
// ---------------------------------------------------------------------------
function trackList(
  sizes: Array<number | string> | undefined,
  fallbackCount: number,
): string {
  if (!sizes || sizes.length === 0) return `repeat(${fallbackCount}, 1fr)`;
  return sizes.map((s) => (typeof s === "number" ? `${s}fr` : s)).join(" ");
}

function GridView({ node }: { node: GridNode }) {
  const { source, shared: parentShared } = useSharedPlot();
  // Image viewport sync (`shared.sync.viewport`, SharedProps in
  // plot-descriptor.ts) — mirrors `lib/camera-sync.ts`'s `useCameraSync`: a
  // stable id (`useId()`) scoped to THIS grid instance, so a grid's own image
  // leaves mirror each other's zoom/pan, but two different (sibling or
  // nested) synced grids never share a group by default. Called
  // unconditionally (rules-of-hooks) but only consulted when this node
  // actually declares its own `shared.sync.viewport` below.
  const localId = useId();
  const children = node.children ?? [];
  const cols = node.cols ?? node.colWidths?.length ?? children.length ?? 1;
  const fill = !!node.rowHeights && node.rowHeights.length > 0;

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: trackList(node.colWidths, Math.max(cols, 1)),
    width: "100%",
  };
  if (fill) gridStyle.gridTemplateRows = trackList(node.rowHeights, 1);
  if (node.gap != null) {
    gridStyle.gap = typeof node.gap === "number" ? `${node.gap}px` : node.gap;
  }

  // A grid re-seeds the shared context for its subtree (its own `shared` wins,
  // falling back to the parent's for nesting).
  const shared = node.shared ?? parentShared;

  // The group id is derived fresh from THIS node's own `shared.sync.viewport`
  // (never inherited from a parent grid — same "no accidental cross-grid
  // link" scoping `useCameraSync` documents) and only when this node actually
  // re-seeds the context below (`node.shared && node.shared !== parentShared`).
  const viewportSyncGroupId = node.shared?.sync?.viewport ? `plot-grid-viewport-${localId}` : null;

  const grid = (
    <ChartFillContext.Provider value={fill}>
      <div style={gridStyle}>
        {children.map((child, i) => (
          <div key={i} style={fill ? { height: "100%", minWidth: 0 } : { minWidth: 0 }}>
            <PlotNodeView node={child} />
          </div>
        ))}
      </div>
    </ChartFillContext.Provider>
  );

  const body =
    node.shared && node.shared !== parentShared ? (
      <SharedPlotContext.Provider value={{ source, shared, viewportSyncGroupId }}>
        {grid}
      </SharedPlotContext.Provider>
    ) : (
      grid
    );

  // F1: gate the colorbar on the node's OWN `shared.colorbar` (owner-only). A
  // nested grid that merely INHERITS `colorbar:true` (via `shared` above, used
  // for leaf colormap/colorRange) must NOT draw a second colorbar — only the
  // grid that actually declares `colorbar` renders one.
  if (!node.shared?.colorbar) return body;
  const cbColormap = (node.shared.colormap as ColormapName | undefined) ?? "viridis";
  const [min, max] = node.shared.colorRange ?? [undefined, undefined];
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 4, width: "100%" }}>
      <div style={{ flex: 1, minWidth: 0 }}>{body}</div>
      <Colorbar colormap={cbColormap} min={min} max={max} />
    </div>
  );
}

/** Render one node — dispatch on `kind`. */
export function PlotNodeView({ node }: { node: PlotNode }) {
  switch (node.kind) {
    case "plot":
      return <LeafView node={node} />;
    case "grid":
      return <GridView node={node} />;
    case "compare":
      return <CompareView node={node} />;
    default:
      return <Message text={`unknown node kind "${(node as PlotNode).kind}"`} error />;
  }
}
