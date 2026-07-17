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
 * `group` class). Icons + button chrome follow CardHeader's Font Awesome
 * convention (`fa-solid fa-*`, `h-[22px] min-w-[22px] …`).
 */
import type { CSSProperties } from "react";
import type { DragMode, PlotController } from "../controls/types";
import type { ToolbarConfig } from "../controls/ToolbarConfig";

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

function ToolbarButton({
  icon,
  title,
  active,
  onClick,
}: {
  icon: string;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // The toolbar floats over the plot surface; keep clicks from reaching
        // the chart's pointer/gesture handlers underneath.
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      aria-label={title}
      aria-pressed={active}
      title={title}
      className={[
        "h-[22px] min-w-[22px] inline-flex items-center justify-center rounded text-xs",
        active
          ? "bg-bg-hover text-accent"
          : "text-fg-muted hover:text-fg hover:bg-bg-hover",
      ].join(" ")}
    >
      <i className={`fa-solid ${icon}`} aria-hidden="true" />
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

  const dragGroup = shown("zoom", caps.zoom) || shown("pan", caps.pan);
  const zoomGroup =
    shown("zoomIn", caps.zoom) || shown("zoomOut", caps.zoom);
  const viewGroup =
    shown("autoscale", caps.autoscale) ||
    (shown("reset", caps.reset) && controller.isModified);
  const exportGroup = shown("screenshot", caps.screenshot);

  if (!dragGroup && !zoomGroup && !viewGroup && !exportGroup) return null;

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
        "z-10 flex items-center gap-0.5 rounded border border-border",
        "bg-bg-elevated/90 px-1 py-0.5 shadow-sm backdrop-blur-sm transition-opacity",
        alwaysOn ? "opacity-100" : "opacity-0 group-hover:opacity-100",
      ].join(" ")}
      role="toolbar"
      aria-label="Plot controls"
    >
      {dragGroup && (
        <>
          {shown("zoom", caps.zoom) && (
            <ToolbarButton
              icon="fa-crop-simple"
              title="Box zoom"
              active={controller.dragMode === "zoom"}
              onClick={setMode("zoom")}
            />
          )}
          {shown("pan", caps.pan) && (
            <ToolbarButton
              icon="fa-up-down-left-right"
              title="Pan"
              active={controller.dragMode === "pan"}
              onClick={setMode("pan")}
            />
          )}
        </>
      )}

      {zoomGroup && (
        <>
          {dragGroup && <Divider />}
          {shown("zoomIn", caps.zoom) && (
            <ToolbarButton
              icon="fa-magnifying-glass-plus"
              title="Zoom in"
              onClick={() => controller.zoomIn()}
            />
          )}
          {shown("zoomOut", caps.zoom) && (
            <ToolbarButton
              icon="fa-magnifying-glass-minus"
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
              icon="fa-expand"
              title="Autoscale"
              onClick={() => controller.autoscale()}
            />
          )}
          {shown("reset", caps.reset) && controller.isModified && (
            <ToolbarButton
              icon="fa-house"
              title="Reset view"
              onClick={() => controller.reset()}
            />
          )}
        </>
      )}

      {exportGroup && (
        <>
          {(dragGroup || zoomGroup || viewGroup) && <Divider />}
          <ToolbarButton
            icon="fa-camera"
            title="Download plot as PNG"
            onClick={() => {
              // Screenshot export lands in a later slice (S10); until then the
              // controller's toPNG rejects. Swallow so the placeholder button
              // never throws an unhandled rejection.
              controller.toPNG().catch(() => {});
            }}
          />
        </>
      )}
    </div>
  );
}
