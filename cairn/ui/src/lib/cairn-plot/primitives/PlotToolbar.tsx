/**
 * `primitives/PlotToolbar.tsx` — the cairn-plot answer to Plotly's modebar (S1).
 *
 * A hover-reveal cluster of icon buttons anchored inside a chart's plot area.
 * Its SOLE meaningful input is a {@link PlotController}: every button group is
 * capability-gated off `controller.capabilities`, and every click delegates to
 * a controller method, so the toolbar is renderer-agnostic and holds no chart
 * state of its own. An optional {@link ToolbarConfig} tunes placement / reveal /
 * per-button visibility without touching the controller.
 *
 * Reveal model mirrors CardHeader's grip: the toolbar sits at `opacity-0` and
 * fades to `opacity-100` on `group-hover` (the renderer's root carries the
 * `group` class). Button chrome matches CardHeader's sizing (`h-[22px]
 * min-w-[22px] …`), but the icons are inline SVG (see `ICON_PATHS` below) —
 * the self-contained plot bundle can't depend on the app's CDN Font Awesome.
 */
import type { CSSProperties, ReactNode } from "react";
import type { DragMode, PlotController } from "../controls/types";
import type { ToolbarConfig } from "../controls/ToolbarConfig";
import { downloadBlob } from "./plot-to-png";

export interface PlotToolbarProps {
  /** The imperative facade this modebar drives (the only real input). */
  controller: PlotController;
  /** Optional per-mount tuning (placement / reveal / per-button hiding). */
  config?: ToolbarConfig;
}

const POSITION_STYLE: Record<
  NonNullable<ToolbarConfig["position"]>,
  CSSProperties
> = {
  "top-right": { top: 6, right: 6 },
  "top-left": { top: 6, left: 6 },
  "bottom-right": { bottom: 6, right: 6 },
  "bottom-left": { bottom: 6, left: 6 },
};

// Inline SVG icons. The standalone / self-contained plot bundle can't use the
// app's Font Awesome (it's loaded from a CDN stylesheet, and the emitted HTML's
// CSP blocks external requests), so the modebar ships its own icons. Each uses
// `currentColor` so it inherits the button's text color (active/hover states).
const ICON_PATHS: Record<string, ReactNode> = {
  boxZoom: <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" strokeDasharray="4 3" />,
  // Box-select: a dashed marquee with a filled cursor arrow tucked in a corner.
  select: (
    <>
      <rect x="3" y="3" width="11" height="11" rx="1" strokeDasharray="3 2.5" />
      <path
        d="M12 12l8.5 3.3-3.4 1-1 3.4z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </>
  ),
  // Lasso: a closed freeform loop with a short rope tail + knot.
  lasso: (
    <>
      <path d="M12 4c4.4 0 7.3 2.9 6.6 6.4-0.7 3.5-4.9 5.3-8.8 4.5C6.4 14.2 4.6 11.4 5.7 8.7 6.8 6 9.2 4 12 4z" />
      <path d="M8.7 15.2c-1.3 0.9-1.8 2.3-1.2 3.5" />
      <circle cx="7.7" cy="19.6" r="1.05" fill="currentColor" stroke="none" />
    </>
  ),
  pan: (
    <>
      <path d="M12 2v20M2 12h20" />
      <path d="M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="10.5" cy="10.5" r="7" />
      <path d="M21 21l-5.2-5.2M10.5 7.5v6M7.5 10.5h6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10.5" cy="10.5" r="7" />
      <path d="M21 21l-5.2-5.2M7.5 10.5h6" />
    </>
  ),
  autoscale: (
    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
  ),
  home: (
    <path d="M3 11l9-8 9 8M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5M9.5 21v-6h5v6" />
  ),
  camera: (
    <>
      <path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.3" />
    </>
  ),
};

function Icon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name] ?? null}
    </svg>
  );
}

function ToolbarButton({
  icon,
  label,
  title,
  active,
  disabled,
  onClick,
}: {
  /** Inline-SVG icon name; used when `label` is absent. */
  icon?: string;
  /** Short text label (e.g. "0–255"); rendered instead of an icon. */
  label?: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        // The toolbar floats over the plot surface; keep clicks from reaching
        // the chart's pointer/gesture handlers underneath.
        e.stopPropagation();
        // A disabled button (e.g. the always-shown "home" button while the view
        // is already at home) must never fire its action.
        if (disabled) return;
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      aria-label={title}
      aria-pressed={active}
      aria-disabled={disabled}
      title={title}
      className={[
        // Fixed box size so the toolbar width never changes and buttons don't
        // shift under the cursor (a disabled button keeps its footprint). A
        // text-label button gets horizontal padding + a mono font instead.
        "h-[22px] min-w-[22px] inline-flex items-center justify-center rounded",
        label ? "px-1.5 text-[10px] font-mono" : "text-xs",
        disabled
          ? "opacity-40 cursor-default text-fg-muted"
          : active
            ? "bg-bg-hover text-accent"
            : "text-fg-muted hover:text-fg hover:bg-bg-hover",
      ].join(" ")}
    >
      {label ? <span aria-hidden="true">{label}</span> : <Icon name={icon ?? ""} />}
    </button>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-border" />;
}

/**
 * The modebar. Renders nothing when disabled or when no capability-backed
 * button survives gating (e.g. a controller that advertises nothing).
 */
export default function PlotToolbar({ controller, config }: PlotToolbarProps) {
  if (config?.enabled === false) return null;

  const caps = controller.capabilities;
  const btn = config?.buttons;
  // A button shows when its capability is on AND it isn't explicitly hidden by
  // config. `shown("id", cap)` folds both checks.
  const shown = (id: string, cap: boolean) => cap && btn?.[id] !== false;

  const setMode = (m: DragMode) => () => controller.setDragMode(m);

  const dragGroup =
    shown("zoom", caps.zoom) ||
    shown("pan", caps.pan) ||
    shown("select", caps.select) ||
    shown("lasso", caps.lasso);
  const zoomGroup =
    shown("zoomIn", caps.zoom) || shown("zoomOut", caps.zoom);
  // The reset ("home") button is ALWAYS shown when reset is available (it just
  // renders disabled when the view is already at home), so the group's presence
  // must not depend on `isModified` — otherwise the toolbar width would still
  // flip and shift buttons under the cursor.
  const viewGroup =
    shown("autoscale", caps.autoscale) || shown("reset", caps.reset);
  const exportGroup = shown("screenshot", caps.screenshot);
  const leading = config?.leadingButtons ?? [];

  if (!leading.length && !dragGroup && !zoomGroup && !viewGroup && !exportGroup)
    return null;

  const position = config?.position ?? "top-right";
  const alwaysOn = config?.visibility === "always";

  return (
    <div
      // pointer-events re-enabled here even if a parent disabled them (Heatmap
      // overlays an SVG with pointer-events:none); the toolbar must stay live.
      style={{
        position: "absolute",
        pointerEvents: "auto",
        ...POSITION_STYLE[position],
      }}
      className={[
        // z-20 keeps the toolbar ABOVE the image pane's pixel-value number
        // overlay (which sits at z-10) so the modebar is never painted under
        // the digits.
        "z-20 flex items-center gap-0.5 rounded border border-border",
        "bg-bg-elevated/90 px-1 py-0.5 shadow-sm backdrop-blur-sm transition-opacity",
        alwaysOn ? "opacity-100" : "opacity-0 group-hover:opacity-100",
      ].join(" ")}
      role="toolbar"
      aria-label="Plot controls"
    >
      {leading.length > 0 && (
        <>
          {leading.map((b) => (
            <ToolbarButton
              key={b.id}
              icon={b.icon}
              label={b.label}
              title={b.title}
              active={b.active}
              disabled={b.disabled}
              onClick={b.onClick}
            />
          ))}
          {(dragGroup || zoomGroup || viewGroup || exportGroup) && <Divider />}
        </>
      )}

      {dragGroup && (
        <>
          {shown("zoom", caps.zoom) && (
            <ToolbarButton
              icon="boxZoom"
              title="Box zoom"
              active={controller.dragMode === "zoom"}
              onClick={setMode("zoom")}
            />
          )}
          {shown("pan", caps.pan) && (
            <ToolbarButton
              icon="pan"
              title="Pan"
              active={controller.dragMode === "pan"}
              onClick={setMode("pan")}
            />
          )}
          {shown("select", caps.select) && (
            <ToolbarButton
              icon="select"
              title="Box select"
              active={controller.dragMode === "select"}
              onClick={setMode("select")}
            />
          )}
          {shown("lasso", caps.lasso) && (
            <ToolbarButton
              icon="lasso"
              title="Lasso select"
              active={controller.dragMode === "lasso"}
              onClick={setMode("lasso")}
            />
          )}
        </>
      )}

      {zoomGroup && (
        <>
          {dragGroup && <Divider />}
          {shown("zoomIn", caps.zoom) && (
            <ToolbarButton
              icon="zoomIn"
              title="Zoom in"
              onClick={() => controller.zoomIn()}
            />
          )}
          {shown("zoomOut", caps.zoom) && (
            <ToolbarButton
              icon="zoomOut"
              title="Zoom out"
              onClick={() => controller.zoomOut()}
            />
          )}
        </>
      )}

      {viewGroup && (
        <>
          {(dragGroup || zoomGroup) && <Divider />}
          {shown("autoscale", caps.autoscale) && (
            <ToolbarButton
              icon="autoscale"
              title="Autoscale"
              onClick={() => controller.autoscale()}
            />
          )}
          {shown("reset", caps.reset) && (
            <ToolbarButton
              icon="home"
              title={
                controller.isModified ? "Reset view" : "Reset view (at home)"
              }
              disabled={!controller.isModified}
              onClick={() => controller.reset()}
            />
          )}
        </>
      )}

      {exportGroup && (
        <>
          {(dragGroup || zoomGroup || viewGroup) && <Divider />}
          <ToolbarButton
            icon="camera"
            title="Download plot as PNG"
            onClick={() => {
              // Rasterize the chart and trigger a browser download. Swallow any
              // failure so a rejected export never throws an unhandled rejection.
              controller
                .toPNG({ filename: "plot" })
                .then((b) => downloadBlob(b, "plot.png"))
                .catch(() => {});
            }}
          />
        </>
      )}
    </div>
  );
}
