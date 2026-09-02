import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSequence } from "../api/hooks";
import { safeJsonParse } from "../lib/format";
import { downloadArtifact, artifactFilename } from "../lib/download";
import { api } from "../api/client";
import { useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import type { SequenceMeta } from "../api/types";
import {
  Heatmap,
  HistogramPlot,
  computeHistogram,
  COLORMAP_OPTIONS as LIB_COLORMAP_OPTIONS,
  type ColormapName,
} from "../lib/public-plot";
import { parseNpy, type NpyArray } from "../lib/parse-npy";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import StepSlider from "./StepSlider";
import Select from "./settings/Select";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";
import { useStepSlider, resolveAtStep, type BaseCardSettings } from "./card-kit";

interface Props {
  runId: string;
  metric: SequenceMeta;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

interface TensorMeta {
  shape: number[];
  dtype: string;
  min: number;
  max: number;
  mean: number;
  size_bytes: number;
}

type ViewMode = "stats" | "histogram" | "heatmap";

interface TensorSettings extends BaseCardSettings {
  viewMode: ViewMode;
  colormap: ColormapName;
  logY: boolean;
  bins: number;
  /** Indices for all-but-last-two dimensions when slicing an ND tensor. */
  sliceIndices?: number[];
  sliderStep?: number;
  xAxis?: "step" | "relative_time" | "wall_time";
}

const DEFAULT_TENSOR_SETTINGS: TensorSettings = {
  version: 1,
  viewMode: "heatmap",
  colormap: "turbo",
  logY: false,
  bins: 64,
};

const COLORMAP_OPTIONS: Array<{ value: ColormapName; label: string }> =
  LIB_COLORMAP_OPTIONS.map((o) => ({ value: o.id, label: o.label }));

const SIZE_CAP = 10 * 1024 * 1024;

function fmtSig(n: number, sig = 4): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "0";
  return Number(n.toPrecision(sig)).toString();
}

/** C- or Fortran-order strides for a shape. */
function strides(shape: number[], fortran: boolean): number[] {
  const n = shape.length;
  const st = new Array<number>(n).fill(1);
  if (fortran) {
    for (let k = 1; k < n; k++) st[k] = st[k - 1]! * shape[k - 1]!;
  } else {
    for (let k = n - 2; k >= 0; k--) st[k] = st[k + 1]! * shape[k + 1]!;
  }
  return st;
}

/** Extract the trailing 2D slice `[rows, cols]` at the given leading indices. */
function sliceMatrix(
  data: Float64Array,
  shape: number[],
  fortran: boolean,
  leading: number[],
): number[][] {
  const n = shape.length;
  const rows = shape[n - 2]!;
  const cols = shape[n - 1]!;
  const st = strides(shape, fortran);
  let base = 0;
  for (let k = 0; k < n - 2; k++) {
    const idx = Math.max(0, Math.min(shape[k]! - 1, leading[k] ?? 0));
    base += idx * st[k]!;
  }
  const rs = st[n - 2]!;
  const cs = st[n - 1]!;
  const m: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = new Array(cols);
    for (let c = 0; c < cols; c++) row[c] = data[base + r * rs + c * cs]!;
    m.push(row);
  }
  return m;
}

async function fetchNpy(hash: string): Promise<NpyArray> {
  const res = await fetch(api.artifactUrl(hash));
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return parseNpy(await res.arrayBuffer());
}

export default function TensorCard({
  runId,
  metric,
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
}: Props) {
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );

  const settingsKey = useMemo(
    () =>
      settingsKeyOverride ?? {
        runId,
        metricName: metric.name,
        contextHash: metric.context_hash,
      },
    [settingsKeyOverride, runId, metric.name, metric.context_hash],
  );
  const [settings, updateSettings] = useCardSettings(
    settingsKey,
    DEFAULT_TENSOR_SETTINGS,
  );

  const { safeIdx, currentStep, onSliderChange } = useStepSlider({
    seriesPoints: [points],
    persistedIdx: settings.sliderStep,
    updateSettings,
  });
  const current = useMemo(
    () => resolveAtStep(points, currentStep) ?? points[0],
    [points, currentStep],
  );
  const meta = useMemo(
    () => safeJsonParse<TensorMeta>(current?.artifact_metadata),
    [current],
  );

  const shape = meta?.shape ?? [];
  const ndim = shape.length;
  const tooBig = (meta?.size_bytes ?? 0) > SIZE_CAP;

  // Resolve the effective view: fall back to stats for oversized blobs and to
  // histogram when a heatmap is requested for a < 2D tensor.
  let effectiveView: ViewMode = settings.viewMode;
  if (tooBig) effectiveView = "stats";
  else if (effectiveView === "heatmap" && ndim < 2) effectiveView = "histogram";

  const needsBlob = effectiveView !== "stats";
  const npyQuery = useQuery({
    queryKey: ["cairn-npy", current?.artifact_hash],
    queryFn: () => fetchNpy(current!.artifact_hash!),
    enabled: !!current?.artifact_hash && needsBlob,
    staleTime: Infinity,
  });
  const arr = npyQuery.data;

  const histogram = useMemo(() => {
    if (effectiveView !== "histogram" || !arr) return null;
    return computeHistogram(arr.data, settings.bins);
  }, [effectiveView, arr, settings.bins]);

  const leadingDims = ndim > 2 ? shape.slice(0, ndim - 2) : [];
  const matrix = useMemo(() => {
    if (effectiveView !== "heatmap" || !arr || arr.shape.length < 2) return null;
    return sliceMatrix(
      arr.data,
      arr.shape,
      arr.fortranOrder,
      settings.sliceIndices ?? [],
    );
  }, [effectiveView, arr, settings.sliceIndices]);

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const compSeries = useMemo(
    () => [{ runId, name: metric.name, context_hash: metric.context_hash }],
    [runId, metric.name, metric.context_hash],
  );

  const shapeLabel = ndim > 0 ? shape.join("×") : "scalar";
  const subtitle =
    points.length > 0
      ? `${shapeLabel} · ${meta?.dtype ?? "?"} · step ${current?.step ?? "—"} (${safeIdx + 1}/${points.length})`
      : `${metric.count} pts`;

  const cardRef = useRef<HTMLDivElement>(null);

  const statsGrid = meta && (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-fg-muted">
      <span>shape</span>
      <span className="mono num">{shapeLabel}</span>
      <span>dtype</span>
      <span className="mono num">{meta.dtype}</span>
      <span>min</span>
      <span className="mono num">{fmtSig(meta.min)}</span>
      <span>max</span>
      <span className="mono num">{fmtSig(meta.max)}</span>
      <span>mean</span>
      <span className="mono num">{fmtSig(meta.mean)}</span>
      <span>size</span>
      <span className="mono num">{meta.size_bytes} B</span>
    </div>
  );

  const renderBody = () => {
    if (q.isLoading) {
      return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    if (!current?.artifact_hash || !meta) {
      return <div className="text-sm text-fg-muted">no tensor logged yet</div>;
    }

    if (effectiveView === "stats") {
      return (
        <div className="flex-1 min-h-0 overflow-auto">
          {statsGrid}
          {tooBig && (
            <p className="mt-2 text-xs text-fg-subtle">
              Blob exceeds 10MB — showing stats only.
            </p>
          )}
        </div>
      );
    }

    if (npyQuery.isLoading) {
      return <div className="flex-1 min-h-0 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    if (npyQuery.isError || !arr) {
      return (
        <div className="flex-1 min-h-0 text-xs text-fg-muted">
          could not read tensor blob
        </div>
      );
    }

    if (effectiveView === "histogram") {
      return (
        <div className="flex-1 min-h-0">
          {histogram && (
            <HistogramPlot
              view="bars"
              counts={histogram.counts}
              edges={histogram.edges}
              logY={settings.logY}
            />
          )}
        </div>
      );
    }

    // heatmap
    return (
      <div className="flex-1 min-h-0">
        {matrix ? (
          <Heatmap
            matrix={matrix}
            colormap={settings.colormap}
            min={meta.min}
            max={meta.max}
            logColor={settings.logY}
            originTop
            xLabel={`dim ${ndim - 1}`}
            yLabel={`dim ${ndim - 2}`}
            valueLabel="value"
          />
        ) : (
          <div className="text-xs text-fg-muted">tensor is not 2D</div>
        )}
      </div>
    );
  };

  const renderContent = () => (
    <>
      {renderBody()}
      {points.length > 1 && (
        <StepSlider
          points={points}
          currentIndex={safeIdx}
          onChange={onSliderChange}
          xAxis={settings.xAxis}
          onXAxisChange={(m) => updateSettings({ xAxis: m })}
          className="mt-3"
        />
      )}
    </>
  );

  const settingsPanel = (
    <>
      <Select<ViewMode>
        label="View"
        value={settings.viewMode}
        onChange={(v) => updateSettings({ viewMode: v })}
        options={[
          { value: "stats", label: "Stats" },
          { value: "histogram", label: "Histogram" },
          { value: "heatmap", label: "Heatmap" },
        ]}
        description={
          ndim < 2 && settings.viewMode === "heatmap"
            ? "Heatmap needs a 2D+ tensor; showing histogram."
            : undefined
        }
      />
      {settings.viewMode === "histogram" && (
        <Slider
          label="Bins"
          value={settings.bins}
          onChange={(v) => updateSettings({ bins: Math.round(v) })}
          min={8}
          max={256}
          step={8}
        />
      )}
      {(settings.viewMode === "histogram" || settings.viewMode === "heatmap") && (
        <Toggle
          label={settings.viewMode === "heatmap" ? "Log color scale" : "Log Y axis"}
          checked={settings.logY}
          onChange={(v) => updateSettings({ logY: v })}
        />
      )}
      {settings.viewMode === "heatmap" && (
        <Select<ColormapName>
          label="Colormap"
          value={settings.colormap}
          onChange={(v) => updateSettings({ colormap: v })}
          options={COLORMAP_OPTIONS}
        />
      )}
      {settings.viewMode === "heatmap" &&
        leadingDims.map((dim, k) => (
          <Slider
            key={k}
            label={`Slice dim ${k} (0–${dim - 1})`}
            value={Math.min(dim - 1, settings.sliceIndices?.[k] ?? 0)}
            onChange={(v) => {
              const next = [...(settings.sliceIndices ?? leadingDims.map(() => 0))];
              next[k] = Math.round(v);
              updateSettings({ sliceIndices: next });
            }}
            min={0}
            max={dim - 1}
            step={1}
          />
        ))}
      <div className="mt-2">{statsGrid}</div>
    </>
  );

  return (
    <CardShell cardKind="tensor"
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={300}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={
        current?.artifact_hash
          ? () =>
              downloadArtifact(
                api.artifactUrl(current.artifact_hash!),
                artifactFilename(metric.name, current.step, current.artifact_mime, ".npy"),
              )
          : undefined
      }
      addToComparisonSlot={
        <AddToComparisonButton cardType="tensor" series={compSeries} />
      }
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={<div className="flex h-full flex-col">{renderContent()}</div>}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <>{renderContent()}</>
    </CardShell>
  );
}
