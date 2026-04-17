import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import { useRuns } from "../api/hooks";
import type { SequenceMeta } from "../api/types";
import { formatDuration, formatRelative } from "../lib/format";
import { groupIntoSections } from "../lib/sections";
import { useWorkspaceVisibility } from "../lib/workspace-visibility";
import CardRenderer from "../components/CardRenderer";
import RunRail from "../components/RunRail";
import RunStatusBadge from "../components/RunStatusBadge";

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const runsQ = useRuns({ project: projectId, limit: 200 });
  const runs = runsQ.data?.runs ?? [];

  // Stable color assignment: sort runs by created_at, assign colors by index.
  const runColors = useMemo(() => {
    const COLORS = [
      "#0969da",
      "#bf8700",
      "#1a7f37",
      "#cf222e",
      "#8250df",
      "#0891b2",
    ];
    const sorted = [...runs].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
    const map = new Map<string, string>();
    sorted.forEach((r, i) => map.set(r.id, COLORS[i % COLORS.length]!));
    return map;
  }, [runs]);

  // Visibility state
  const runIds = useMemo(() => runs.map((r) => r.id), [runs]);
  const vis = useWorkspaceVisibility(projectId ?? "", runIds);
  const visibleRuns = useMemo(
    () => runs.filter((r) => vis.isVisible(r.id)),
    [runs, vis.isVisible],
  );

  // Fetch sequences for visible runs only
  const visibleRunIds = useMemo(
    () => visibleRuns.map((r) => r.id),
    [visibleRuns],
  );
  const seqQueries = useQueries({
    queries: visibleRunIds.map((rid) => ({
      queryKey: ["sequences", rid],
      queryFn: () => api.sequences(rid),
      staleTime: 5000,
    })),
  });

  // Union all metric names across visible runs -> one card per unique (name, object_type)
  const cards = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        object_type: string;
        runs: Array<{ runId: string; context_hash: string }>;
      }
    >();
    seqQueries.forEach((q, idx) => {
      const runId = visibleRunIds[idx];
      if (!runId) return;
      for (const seq of q.data?.sequences ?? []) {
        const key = `${seq.name}::${seq.object_type}`;
        const existing = map.get(key);
        if (existing) {
          existing.runs.push({ runId, context_hash: seq.context_hash });
        } else {
          map.set(key, {
            name: seq.name,
            object_type: seq.object_type,
            runs: [{ runId, context_hash: seq.context_hash }],
          });
        }
      }
    });
    return Array.from(map.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    visibleRunIds,
    seqQueries.map((q) => q.dataUpdatedAt).join("|"),
  ]);

  // Group into sections using the existing grouping logic
  const sections = useMemo(() => {
    const metas: SequenceMeta[] = cards.map((c) => ({
      name: c.name,
      object_type: c.object_type,
      context: null,
      context_hash: "",
      min_step: 0,
      max_step: 0,
      count: 0,
    }));
    return groupIntoSections(metas);
  }, [cards]);

  // Mobile runs list collapsible
  const [mobileRunsOpen, setMobileRunsOpen] = useState(false);

  if (!projectId) return null;
  if (runsQ.isLoading) return <p className="text-fg-muted">Loading...</p>;
  if (runsQ.isError)
    return (
      <p className="text-status-failed">Error: {String(runsQ.error)}</p>
    );

  return (
    <div className="flex gap-4">
      <RunRail
        runs={runs}
        visibility={vis.visibility}
        onToggle={vis.toggle}
        onShowAll={vis.showAll}
        onHideAll={vis.hideAll}
        colors={runColors}
      />

      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="mono text-xl font-semibold">{projectId}</h1>
          <p className="text-sm text-fg-muted">
            {visibleRuns.length} of {runs.length} run(s) visible
          </p>
        </div>

        {/* Mobile runs list (collapsed by default) */}
        {runs.length > 0 && (
          <div className="md:hidden">
            <button
              type="button"
              onClick={() => setMobileRunsOpen((v) => !v)}
              className="mb-2 flex w-full items-center justify-between rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm font-medium"
            >
              <span>
                Runs ({visibleRuns.length}/{runs.length})
              </span>
              <span className="text-fg-muted">
                {mobileRunsOpen ? "\u25B2" : "\u25BC"}
              </span>
            </button>
            {mobileRunsOpen && (
              <div className="mb-4 space-y-1">
                <div className="mb-2 flex gap-2">
                  <button
                    type="button"
                    onClick={vis.showAll}
                    className="rounded border border-border px-2 py-1 text-xs text-fg-muted hover:bg-bg-hover"
                  >
                    Show all
                  </button>
                  <button
                    type="button"
                    onClick={vis.hideAll}
                    className="rounded border border-border px-2 py-1 text-xs text-fg-muted hover:bg-bg-hover"
                  >
                    Hide all
                  </button>
                </div>
                <ul className="flex flex-col gap-2">
                  {runs.map((r) => {
                    const checked = vis.isVisible(r.id);
                    const color = runColors.get(r.id) ?? "#656d76";
                    return (
                      <li
                        key={r.id}
                        className="flex items-start gap-2 rounded-lg border border-border bg-bg-elevated p-3"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => vis.toggle(r.id)}
                          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-2"
                          style={{
                            accentColor: color,
                            borderColor: checked ? color : undefined,
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Link
                              to={`/p/${projectId}/r/${r.id}`}
                              className="mono flex min-h-[44px] items-center text-accent hover:underline"
                            >
                              {r.display_name ?? r.id}
                            </Link>
                            <RunStatusBadge status={r.status} />
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                            <span className="mono">
                              task: {r.task_id.split("/")[1]}
                            </span>
                            <span>
                              started: {formatRelative(r.created_at)}
                            </span>
                            <span className="mono num">
                              dur:{" "}
                              {formatDuration(r.created_at, r.ended_at)}
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Render cards grouped by section */}
        {sections.map((section) => (
          <section key={section.name}>
            <header className="mb-3 flex items-baseline justify-between border-b border-border pb-1">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
                {section.name}
              </h2>
            </header>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {section.items.map((meta) => {
                const card = cards.find(
                  (c) =>
                    c.name === meta.name &&
                    c.object_type === meta.object_type,
                );
                if (!card || card.runs.length === 0) return null;
                // First run is the "primary" -- others are extraSeries
                const primary = card.runs[0]!;
                const seedMetric: SequenceMeta = {
                  name: card.name,
                  object_type: card.object_type,
                  context: null,
                  context_hash: primary.context_hash,
                  min_step: 0,
                  max_step: 0,
                  count: 0,
                };
                const extra = card.runs.slice(1).map((r) => ({
                  runId: r.runId,
                  name: card.name,
                  context_hash: r.context_hash,
                }));
                return (
                  <CardRenderer
                    key={`${card.name}::${card.object_type}`}
                    runId={primary.runId}
                    metric={seedMetric}
                    extraSeries={extra.length > 0 ? extra : undefined}
                    controlledSeries
                    settingsKeyOverride={{
                      runId: `workspace:${projectId}`,
                      metricName: card.name,
                      contextHash: card.object_type,
                    }}
                  />
                );
              })}
            </div>
          </section>
        ))}

        {cards.length === 0 && !runsQ.isLoading && (
          <p className="text-fg-muted">
            {runs.length === 0
              ? "No runs in this project yet."
              : "No metrics logged by any visible run."}
          </p>
        )}
      </div>
    </div>
  );
}
