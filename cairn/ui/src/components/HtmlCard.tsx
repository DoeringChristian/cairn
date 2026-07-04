/**
 * HTML card — renders `cairn.Html` blobs inside a sandboxed iframe.
 *
 * Security contract (do not weaken): logged HTML is NEVER rendered inline in
 * the host document. It only ever runs inside an `<iframe sandbox="allow-scripts"
 * srcdoc=...>` — no `allow-same-origin`, no `allow-top-navigation`, no
 * `allow-popups`, no `allow-forms`. This gives the iframe an opaque origin
 * (no access to cairn's cookies/localStorage/DOM) while still letting the
 * user's inline `<script>` run for interactive reports (mirrors the JS
 * plugin sandbox in PluginCard.tsx).
 *
 * Auto-height: a tiny shim (same idea as PluginCard's JS plugin shim) is
 * injected into the srcdoc; it watches `document.documentElement` with a
 * ResizeObserver and posts `cairn:resize` (the plugin postMessage protocol)
 * to the host. If no resize message ever arrives, the card falls back to a
 * fixed height from settings.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
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
import { useCardSeries, useStepSlider, resolveAtStep, useRunInfo, MultiPaneGrid, useIframeAutoHeight, type BaseCardSettings } from "./card-kit";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import SeriesChipStrip from "./SeriesChipStrip";
import Toggle from "./settings/Toggle";
import Slider from "./settings/Slider";
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

interface HtmlSettings extends BaseCardSettings {
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  paneWidths?: number[];
  sliderStep?: number;
  /** Auto-size the iframe to its content height via the resize shim. */
  autoHeight: boolean;
  /** Used when autoHeight is off, or before the first resize message. */
  fixedHeight: number;
  xAxis?: "step" | "relative_time" | "wall_time";
}

const DEFAULT_HTML_SETTINGS = (seed: {
  name: string;
  context_hash: string;
}): HtmlSettings => ({
  version: 1,
  metrics: [seed],
  autoHeight: true,
  fixedHeight: 300,
});

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 2000;

/**
 * postMessage listener shim, adapted from PluginCard's JS plugin shim.
 *
 * A sandboxed `srcdoc` iframe's layout is not guaranteed to have settled by
 * the time `load` fires or `ResizeObserver.observe()` delivers its initial
 * callback — both can (and do) report `scrollHeight === 0` a moment before
 * the real content lays out, with no further ResizeObserver callback ever
 * firing afterward for static content. So on top of the (always-on, event
 * driven) ResizeObserver/MutationObserver, re-post on a short bounded
 * schedule of timeouts anchored to `load` to catch that late settle. The
 * schedule is fixed-length (never an unbounded interval/poll), so content
 * that legitimately never grows past height 0 just stops posting after the
 * last scheduled retry instead of spinning forever.
 *
 * Measurement: the height is taken from `document.body`, NOT from
 * `document.documentElement.scrollHeight` — the latter is clamped by the
 * browser to be at least the iframe's current viewport height, so once the
 * host makes the iframe tall the reported height can never go back down
 * (it ratchets: whatever height the host applies becomes the floor the
 * shim reports back, and the card can grow but never shrink).
 * `body.scrollHeight` has no such clamp; we take
 * max(body.scrollHeight, body.offsetHeight) — scrollHeight wins when
 * content overflows the body's box, offsetHeight when the body has
 * explicit height/borders — and add the body's top/bottom margins (8px
 * each by default) so content isn't clipped by them. Fallback for a
 * document with no body: the html element's own border-box rect height
 * (its box tracks content when `height` is auto, and is not viewport
 * clamped, unlike its scrollHeight). Known limitation: absolutely
 * positioned content that escapes the body's scrollable overflow
 * (positioned against the initial containing block) isn't counted — the
 * only measure that would catch it is the clamped
 * documentElement.scrollHeight, which would reintroduce the ratchet.
 */
const RESIZE_SHIM = `<script>(function(){function height(){var b=document.body;if(!b)return Math.ceil(document.documentElement.getBoundingClientRect().height);var m=0;try{var s=getComputedStyle(b);m=(parseFloat(s.marginTop)||0)+(parseFloat(s.marginBottom)||0)}catch(e){}return Math.ceil(Math.max(b.scrollHeight,b.offsetHeight)+m)}function post(){try{parent.postMessage({type:"cairn:resize",height:height(),protocolVersion:1},"*")}catch(e){}}try{new ResizeObserver(post).observe(document.body||document.documentElement)}catch(e){}try{new MutationObserver(post).observe(document.body||document.documentElement,{childList:true,subtree:true})}catch(e){}window.addEventListener("load",function(){post();[0,100,300,1000].forEach(function(d){setTimeout(post,d)})});post();})();</script>`;

function injectResizeShim(html: string): string {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${RESIZE_SHIM}</body>`);
  if (/<\/html>/i.test(html)) return html.replace(/<\/html>/i, `${RESIZE_SHIM}</html>`);
  return html + RESIZE_SHIM;
}

// ---------------------------------------------------------------------------
// Single HTML pane — sandboxed iframe + auto-height for ONE metric entry.
// ---------------------------------------------------------------------------
function HtmlPane({
  runId,
  m,
  targetStep,
  autoHeight,
  fixedHeight,
}: {
  runId: string;
  m: { runId?: string; name: string; context_hash: string };
  targetStep: number;
  autoHeight: boolean;
  fixedHeight: number;
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

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!current?.artifact_hash) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    let cancelled = false;
    setError(null);
    fetch(api.artifactUrl(current.artifact_hash))
      .then((r) => r.text())
      .then((html) => { if (!cancelled) iframe.srcdoc = injectResizeShim(html); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [current?.artifact_hash]);

  // Host-side resize subscription is the shared card-kit hook (the same one
  // PluginCard uses) — see useIframeAutoHeight for the timing/guard rationale
  // (h=0 ignored, source+type checks, clamp). Until a message arrives it
  // returns undefined; we fall back to `fixedHeight` so the pane starts at the
  // configured size exactly as before.
  const measuredHeight = useIframeAutoHeight(iframeRef, {
    min: MIN_HEIGHT,
    max: MAX_HEIGHT,
    enabled: autoHeight,
  });

  if (error) {
    return <div className="rounded bg-bg p-2 text-xs text-status-failed overflow-auto"><pre>{error}</pre></div>;
  }
  if (!current?.artifact_hash) {
    return <div className="text-sm text-fg-muted">no HTML logged yet</div>;
  }
  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-scripts"
      className="w-full rounded border-0 bg-bg"
      style={{ height: autoHeight ? (measuredHeight ?? fixedHeight) : fixedHeight }}
      title={`HTML: ${m.name}`}
    />
  );
}

export default function HtmlCard({ runId, metric, extraSeries, controlledSeries, settingsKeyOverride, onRemove, autoOpenSettings }: Props) {
  const { settings, updateSettings, effectiveMetrics, allRunIds, multipleRuns } =
    useCardSeries<HtmlSettings>({
      runId,
      metric,
      extraSeries,
      controlledSeries,
      settingsKeyOverride,
      makeDefaults: (seed, metrics) => ({
        ...DEFAULT_HTML_SETTINGS(seed),
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
    <>
      <Toggle
        label="Auto-height"
        checked={settings.autoHeight}
        onChange={(v) => updateSettings({ autoHeight: v })}
        description={'Resize to the document’s content height via the "cairn:resize" postMessage shim. Falls back to a fixed height if the document never posts a size.'}
      />
      <Slider
        label="Fixed height"
        value={settings.fixedHeight}
        onChange={(v) => updateSettings({ fixedHeight: v })}
        min={MIN_HEIGHT}
        max={MAX_HEIGHT}
        step={20}
        format={(v) => `${v}px`}
      />
    </>
  );

  const renderSingleHtml = () => {
    if (q.isLoading) {
      return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    return (
      <>
        <div className="flex-1 min-h-0 overflow-auto">
          <HtmlPane
            runId={runId}
            m={effectiveMetrics[0]!}
            targetStep={currentStep}
            autoHeight={settings.autoHeight}
            fixedHeight={settings.fixedHeight}
          />
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

  const renderMultiHtml = (inModal: boolean) => (
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
            <HtmlPane
              key={key}
              runId={runId}
              m={m}
              targetStep={currentStep}
              autoHeight={settings.autoHeight}
              fixedHeight={settings.fixedHeight}
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
    isMulti ? renderMultiHtml(inModal) : renderSingleHtml();

  const selectionPanel = !hasSelectionProvider && (
    <RunSelectionPanel
      selectedRunIds={selectedArray}
      allRunIds={allRunIds}
      onClear={clear}
      runInfo={runInfoMap}
      label="HTML selection"
    />
  );

  return (
    <CardShell cardKind="html"
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={360}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={current?.artifact_hash ? () => downloadArtifact(api.artifactUrl(current.artifact_hash!), artifactFilename(metric.name, current.step, current.artifact_mime ?? "text/html")) : undefined}
      addToComparisonSlot={<AddToComparisonButton cardType="html" series={compSeries} />}
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
