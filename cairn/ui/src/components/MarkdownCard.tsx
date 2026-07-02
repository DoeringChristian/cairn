/**
 * Markdown card — renders `cairn.Markdown` blobs with GitHub-flavored
 * markdown (tables, task lists, strikethrough, ...).
 *
 * Raw HTML in the source text is NEVER rendered as markup: react-markdown's
 * default escaping stays on (no rehype-raw plugin), so `<script>` or any
 * other tag in logged markdown renders as inert text. Do not add rehype-raw.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { downloadArtifact, artifactFilename } from "../lib/download";
import { type CardSettingsKey } from "../lib/card-settings";
import { useCardDrop } from "../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { seriesKey } from "../lib/series-utils";
import type { SequenceMeta, SequenceResponse } from "../api/types";
import { useCardSeries, useStepSlider, resolveAtStep, useRunInfo, MultiPaneGrid, type BaseCardSettings } from "./card-kit";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import SeriesChipStrip from "./SeriesChipStrip";
import Select from "./settings/Select";
import { useRunSelection, useRunSelectionHasProvider } from "../lib/use-run-selection";
import RunSelectionPanel from "./RunSelectionPanel";
import StepSlider from "./StepSlider";

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

interface MarkdownSettings extends BaseCardSettings {
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  paneWidths?: number[];
  sliderStep?: number;
  fontSize: "xs" | "sm" | "base";
  xAxis?: "step" | "relative_time" | "wall_time";
}

const DEFAULT_MARKDOWN_SETTINGS = (seed: {
  name: string;
  context_hash: string;
}): MarkdownSettings => ({
  version: 1,
  metrics: [seed],
  fontSize: "sm",
});

const FONT_SIZE_CLASS: Record<MarkdownSettings["fontSize"], string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
};

/** `components` override map for react-markdown — theme tokens, no raw HTML. */
const MD_COMPONENTS = {
  h1: (p: React.ComponentProps<"h1">) => <h1 className="mt-3 mb-2 text-lg font-semibold text-fg first:mt-0" {...p} />,
  h2: (p: React.ComponentProps<"h2">) => <h2 className="mt-3 mb-1.5 text-base font-semibold text-fg first:mt-0" {...p} />,
  h3: (p: React.ComponentProps<"h3">) => <h3 className="mt-2 mb-1 text-sm font-semibold text-fg first:mt-0" {...p} />,
  h4: (p: React.ComponentProps<"h4">) => <h4 className="mt-2 mb-1 text-sm font-semibold text-fg-muted first:mt-0" {...p} />,
  p: (p: React.ComponentProps<"p">) => <p className="my-1.5 leading-relaxed text-fg" {...p} />,
  a: (p: React.ComponentProps<"a">) => <a className="text-accent hover:underline" target="_blank" rel="noreferrer noopener" {...p} />,
  ul: (p: React.ComponentProps<"ul">) => <ul className="my-1.5 ml-5 list-disc space-y-0.5" {...p} />,
  ol: (p: React.ComponentProps<"ol">) => <ol className="my-1.5 ml-5 list-decimal space-y-0.5" {...p} />,
  li: (p: React.ComponentProps<"li">) => <li className="text-fg" {...p} />,
  blockquote: (p: React.ComponentProps<"blockquote">) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-fg-muted" {...p} />
  ),
  hr: (p: React.ComponentProps<"hr">) => <hr className="my-3 border-border" {...p} />,
  strong: (p: React.ComponentProps<"strong">) => <strong className="font-semibold text-fg" {...p} />,
  em: (p: React.ComponentProps<"em">) => <em className="italic" {...p} />,
  del: (p: React.ComponentProps<"del">) => <del className="text-fg-subtle" {...p} />,
  code: (p: React.ComponentProps<"code">) => (
    <code className="mono rounded bg-bg-hover px-1 py-0.5 text-[0.85em] text-fg" {...p} />
  ),
  pre: (p: React.ComponentProps<"pre">) => (
    <pre
      className="mono my-2 overflow-auto rounded bg-bg p-3 text-xs text-fg-muted [&>code]:rounded-none [&>code]:bg-transparent [&>code]:p-0"
      {...p}
    />
  ),
  table: (p: React.ComponentProps<"table">) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs" {...p} />
    </div>
  ),
  thead: (p: React.ComponentProps<"thead">) => <thead className="bg-bg-hover" {...p} />,
  th: (p: React.ComponentProps<"th">) => (
    <th className="border border-border px-2 py-1 text-left font-semibold text-fg" {...p} />
  ),
  td: (p: React.ComponentProps<"td">) => <td className="border border-border px-2 py-1 text-fg-muted" {...p} />,
  input: (p: React.ComponentProps<"input">) => (
    <input {...p} disabled className="mr-1 accent-accent align-middle" />
  ),
};

// ---------------------------------------------------------------------------
// Single markdown pane (used in multi-series split view).
// ---------------------------------------------------------------------------
function MarkdownPane({
  runId,
  m,
  targetStep,
  fontSize,
}: {
  runId: string;
  m: { runId?: string; name: string; context_hash: string };
  targetStep: number;
  fontSize: MarkdownSettings["fontSize"];
}) {
  const rid = m.runId ?? runId;
  const q = useSequence(rid, m.name, {
    context: m.context_hash || undefined,
    maxPoints: 200,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );
  const current = useMemo(
    () => resolveAtStep(points, targetStep) ?? points[0],
    [points, targetStep],
  );
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!current?.artifact_hash) {
      setContent("");
      return;
    }
    let cancelled = false;
    fetch(api.artifactUrl(current.artifact_hash))
      .then((r) => r.text())
      .then((text) => { if (!cancelled) setContent(text); })
      .catch((e) => { if (!cancelled) setContent(`*fetch error: ${e.message}*`); });
    return () => { cancelled = true; };
  }, [current?.artifact_hash]);

  if (q.isLoading) {
    return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  if (!current?.artifact_hash) {
    return <div className="text-sm text-fg-muted">no markdown logged yet</div>;
  }
  return (
    <div className={`rounded bg-bg p-3 overflow-auto ${FONT_SIZE_CLASS[fontSize]}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function MarkdownCard({ runId, metric, extraSeries, controlledSeries, settingsKeyOverride, onRemove, autoOpenSettings }: Props) {
  const { settings, updateSettings, effectiveMetrics, allRunIds, multipleRuns } =
    useCardSeries<MarkdownSettings>({
      runId,
      metric,
      extraSeries,
      controlledSeries,
      settingsKeyOverride,
      makeDefaults: (seed, metrics) => ({
        ...DEFAULT_MARKDOWN_SETTINGS(seed),
        metrics,
      }),
    });

  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, updateSettings);

  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 200,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );

  const multiQueries = useQueries({
    queries: effectiveMetrics.length > 1
      ? effectiveMetrics.map((m) => {
          const rid = m.runId ?? runId;
          return {
            queryKey: qk.sequence(rid, m.name, m.context_hash),
            queryFn: () =>
              api.sequence(rid, m.name, {
                context: m.context_hash || undefined,
                maxPoints: 200,
              }),
            refetchInterval: 2_000,
            staleTime: 2_000,
          };
        })
      : [],
  });

  const seriesPoints = useMemo(() => {
    const arr: Array<Array<{ step: number }>> = [points];
    if (effectiveMetrics.length > 1) {
      for (const mq of multiQueries) {
        const pts = (mq.data as SequenceResponse | undefined)?.points ?? [];
        arr.push(pts.filter((p) => p.artifact_hash));
      }
    }
    return arr;
  }, [effectiveMetrics.length, points, multiQueries]);

  const { globalSteps, safeIdx, currentStep, onSliderChange } = useStepSlider({
    seriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings,
  });

  const current = useMemo(() => {
    const exact = points.find((p) => p.step === currentStep && p.artifact_hash);
    if (exact) return exact;
    let best: (typeof points)[number] | undefined;
    for (const p of points) { if (p.step <= currentStep && p.artifact_hash) best = p; else if (p.step > currentStep) break; }
    return best;
  }, [points, currentStep]);

  const [content, setContent] = useState("");
  useEffect(() => {
    if (!current?.artifact_hash) {
      setContent("");
      return;
    }
    let cancelled = false;
    fetch(api.artifactUrl(current.artifact_hash))
      .then((r) => r.text())
      .then((text) => { if (!cancelled) setContent(text); })
      .catch((e) => { if (!cancelled) setContent(`*fetch error: ${e.message}*`); });
    return () => { cancelled = true; };
  }, [current?.artifact_hash]);

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const compSeries = useMemo(
    () => [{ runId, name: metric.name, context_hash: metric.context_hash }],
    [runId, metric.name, metric.context_hash],
  );

  const runMetaVersion = useRunMetadataVersion();

  const { selectedIds, selectedArray, toggle, clear } = useRunSelection();
  const hasSelectionProvider = useRunSelectionHasProvider();

  const { runInfoMap } = useRunInfo(allRunIds);

  const subtitle =
    globalSteps.length > 0
      ? `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`
      : `${metric.count} pts`;

  const isMulti = effectiveMetrics.length > 1;
  const cardRef = useRef<HTMLDivElement>(null);

  const settingsPanel = (
    <Select
      label="Font size"
      value={settings.fontSize}
      onChange={(v) => updateSettings({ fontSize: v as MarkdownSettings["fontSize"] })}
      options={[
        { value: "xs", label: "Extra small" },
        { value: "sm", label: "Small" },
        { value: "base", label: "Base" },
      ]}
    />
  );

  const renderSingleMarkdown = () => {
    if (q.isLoading) {
      return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    if (!current?.artifact_hash) {
      return <div className="text-sm text-fg-muted">no markdown logged yet</div>;
    }
    return (
      <>
        <div className={`flex-1 min-h-0 overflow-auto rounded bg-bg p-3 ${FONT_SIZE_CLASS[settings.fontSize]}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
            {content}
          </ReactMarkdown>
        </div>
        <StepSlider
          points={points}
          currentIndex={safeIdx}
          onChange={onSliderChange}
          xAxis={settings.xAxis}
          onXAxisChange={(m) => updateSettings({ xAxis: m })}
          className="mt-3"
        />
      </>
    );
  };

  const paneKeys = useMemo(() => effectiveMetrics.map(seriesKey), [effectiveMetrics]);
  const paneLabels = useMemo(() => {
    const map = new Map<string, string>();
    if (multipleRuns) {
      for (const m of effectiveMetrics) {
        map.set(seriesKey(m), shortRunLabel(m.runId ?? runId, allRunIds));
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multipleRuns, effectiveMetrics, allRunIds, runId, runMetaVersion]);

  const renderMultiMarkdown = (inModal: boolean) => (
    <>
      <MultiPaneGrid
        paneKeys={paneKeys}
        labels={paneLabels}
        inModal={inModal}
        paneWidths={settings.paneWidths}
        onPaneWidthsChange={(w) => updateSettings({ paneWidths: w })}
        renderPane={(key, i) => {
          const m = effectiveMetrics[i]!;
          return (
            <MarkdownPane
              key={key}
              runId={runId}
              m={m}
              targetStep={currentStep}
              fontSize={settings.fontSize}
            />
          );
        }}
      />
      <StepSlider
        points={points}
        currentIndex={safeIdx}
        onChange={onSliderChange}
        xAxis={settings.xAxis}
        onXAxisChange={(m) => updateSettings({ xAxis: m })}
        className="mt-3"
      />
      <SeriesChipStrip
        metrics={effectiveMetrics}
        controlledSeries={controlledSeries}
        runId={runId}
        allRunIds={allRunIds}
        onMetricsChange={(next) => updateSettings({ metrics: next })}
        onClick={multipleRuns ? toggle : undefined}
        selectedIds={selectedIds}
      />
    </>
  );

  const renderContent = (inModal: boolean) =>
    isMulti ? renderMultiMarkdown(inModal) : renderSingleMarkdown();

  const selectionPanel = !hasSelectionProvider && (
    <RunSelectionPanel
      selectedRunIds={selectedArray}
      allRunIds={allRunIds}
      onClear={clear}
      runInfo={runInfoMap}
      label="Markdown selection"
    />
  );

  return (
    <CardShell
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={300}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={current?.artifact_hash ? () => downloadArtifact(api.artifactUrl(current.artifact_hash!), artifactFilename(metric.name, current.step, current.artifact_mime ?? "text/markdown")) : undefined}
      addToComparisonSlot={<AddToComparisonButton cardType="markdown" series={compSeries} />}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      selectionPanel={selectionPanel}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={<div className="flex flex-col h-full">{renderContent(true)}</div>}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <>
      {renderContent(false)}
      </>
    </CardShell>
  );
}
