import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import { useRuns } from "../api/hooks";
import type { SequenceMeta } from "../api/types";
import { formatDuration, formatRelative } from "../lib/format";
import { groupIntoSections } from "../lib/sections";
import { useWorkspaceVisibility } from "../lib/workspace-visibility";
import AddCardModal, { type AddCardSelection } from "../components/AddCardModal";
import CardRenderer from "../components/CardRenderer";
import ParallelCoordsCard from "../components/ParallelCoordsCard";
import ScatterPlotCard from "../components/ScatterPlotCard";
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
          // Only one entry per run per metric (skip duplicate contexts).
          if (!existing.runs.some((r) => r.runId === runId)) {
            existing.runs.push({ runId, context_hash: seq.context_hash });
          }
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



  // Manually added cards (persisted to localStorage)
  const extraCardsKey = `cairn:workspace-extra-cards:${projectId}`;
  const [extraCards, setExtraCards] = useState<
    Array<{ name: string; object_type: string; runs: Array<{ runId: string; context_hash: string }> }>
  >(() => {
    try {
      const stored = localStorage.getItem(extraCardsKey);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(extraCardsKey, JSON.stringify(extraCards));
    } catch {
      // ignore quota errors
    }
  }, [extraCards, extraCardsKey]);
  // Hidden auto-generated cards (persisted)
  const hiddenCardsKey = `cairn:workspace-hidden-cards:${projectId}`;
  const [hiddenCards, setHiddenCards] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(hiddenCardsKey);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  useEffect(() => {
    try { localStorage.setItem(hiddenCardsKey, JSON.stringify([...hiddenCards])); } catch {}
  }, [hiddenCards, hiddenCardsKey]);

  const handleRemoveCard = useCallback((cardIdx: number) => {
    const autoCardCount = cards.length;
    if (cardIdx >= autoCardCount) {
      // Extra card — remove from extraCards
      const extraIdx = cardIdx - autoCardCount;
      setExtraCards((prev) => prev.filter((_, i) => i !== extraIdx));
    } else {
      // Auto-generated card — hide it
      const card = cards[cardIdx];
      if (card) setHiddenCards((prev) => new Set(prev).add(`${card.name}::${card.object_type}`));
    }
  }, [cards]);

  const [addCardOpen, setAddCardOpen] = useState(false);

  const prevExtraCardsLenRef = useRef(extraCards.length);
  const newCardIdxRef = useRef<number | null>(null);

  const handleAddCard = useCallback((sel: AddCardSelection) => {
    setExtraCards((prev) => {
      // The new card will be at allCards index = cards.length + prev.length
      newCardIdxRef.current = cards.length + prev.length;
      return [...prev, sel];
    });
  }, [cards.length]);

  // Merge auto + extra cards, filtering out hidden ones
  const allCards = useMemo(() => {
    const visible = cards.filter((c) => !hiddenCards.has(`${c.name}::${c.object_type}`));
    return [...visible, ...extraCards];
  }, [cards, extraCards, hiddenCards]);

  // Group allCards into sections, preserving duplicates with indices.
  const allSections = useMemo(() => {
    const metas: SequenceMeta[] = allCards.map((c) => ({
      name: c.name,
      object_type: c.object_type,
      context: null,
      context_hash: "",
      min_step: 0,
      max_step: 0,
      count: 0,
    }));
    // Group into sections, but preserve card indices for duplicates.
    const sections = groupIntoSections(metas);
    // Build a map from section name to card indices.
    type IndexedSection = { name: string; cardIndices: number[] };
    const result: IndexedSection[] = [];
    for (const section of sections) {
      const indices: number[] = [];
      // For each item in the section, find ALL matching card indices (not just first)
      const used = new Set<number>();
      for (const item of section.items) {
        for (let i = 0; i < allCards.length; i++) {
          if (used.has(i)) continue;
          if (allCards[i]!.name === item.name && allCards[i]!.object_type === item.object_type) {
            indices.push(i);
            used.add(i);
          }
        }
      }
      if (indices.length > 0) result.push({ name: section.name, cardIndices: indices });
    }
    return result;
  }, [allCards]);

  // Scroll to newly added card and auto-open its settings
  useEffect(() => {
    if (newCardIdxRef.current == null) return;
    if (extraCards.length <= prevExtraCardsLenRef.current) {
      prevExtraCardsLenRef.current = extraCards.length;
      return;
    }
    prevExtraCardsLenRef.current = extraCards.length;
    const targetIdx = newCardIdxRef.current;
    newCardIdxRef.current = null;

    requestAnimationFrame(() => {
      const wrapper = document.querySelector(`[data-cairn-card-idx="${targetIdx}"]`);
      // The wrapper uses display:contents, so find the actual .card element inside
      const cardEl = wrapper?.querySelector(".card") as HTMLElement | null;
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
          const buttons = cardEl.querySelectorAll("button");
          for (let i = buttons.length - 1; i >= 0; i--) {
            if (buttons[i]!.textContent?.includes("\u2699")) {
              buttons[i]!.click();
              break;
            }
          }
        }, 400);
      }
    });
  }, [extraCards.length]);

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

        {/* Add card button */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setAddCardOpen(true)}
            className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-accent hover:text-fg transition-colors"
          >
            <span aria-hidden="true">+</span> Add card
          </button>
        </div>

        <AddCardModal
          open={addCardOpen}
          onClose={() => setAddCardOpen(false)}
          runIds={runIds}
          onAdd={handleAddCard}
        />

        {/* Render cards grouped by section */}
        {allSections.map((section) => (
          <section key={section.name}>
            <header className="mb-3 flex items-baseline justify-between border-b border-border pb-1">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
                {section.name}
              </h2>
            </header>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-cairn-card-grid>
              {section.cardIndices.map((cardIdx) => {
                const card = allCards[cardIdx]!;
                if (card.runs.length === 0) return null;

                let content: React.ReactNode;

                const removeThis = () => handleRemoveCard(cardIdx);

                if (card.object_type === "parallel") {
                  content = (
                    <ParallelCoordsCard
                      runIds={visibleRunIds}
                      runs={visibleRuns}
                      settingsKey={{
                        runId: `workspace:${projectId}`,
                        metricName: "parallel",
                        contextHash: `${cardIdx}`,
                      }}
                      onRemove={removeThis}
                    />
                  );
                } else if (card.object_type === "scatter") {
                  content = (
                    <ScatterPlotCard
                      runIds={visibleRunIds}
                      runs={visibleRuns}
                      settingsKey={{
                        runId: `workspace:${projectId}`,
                        metricName: "scatter",
                        contextHash: `${cardIdx}`,
                      }}
                      onRemove={removeThis}
                    />
                  );
                } else {
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
                  content = (
                    <CardRenderer
                      runId={primary.runId}
                      metric={seedMetric}
                      extraSeries={extra.length > 0 ? extra : undefined}
                      controlledSeries
                      onRemove={removeThis}
                      settingsKeyOverride={{
                        runId: `workspace:${projectId}`,
                        metricName: card.name,
                        contextHash: `${card.object_type}::${cardIdx}`,
                      }}
                    />
                  );
                }

                return (
                  <div key={`${card.name}::${card.object_type}::${cardIdx}`} data-cairn-card-idx={cardIdx} style={{ display: "contents" }}>
                    {content}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {allCards.length === 0 && !runsQ.isLoading && (
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
