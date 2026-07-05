/**
 * Cards block editor/viewer for a report — bound to either a static set of
 * runIds or a dynamic `RunSelector` (see lib/run-selector.ts), holding a
 * list of ComparisonCard[] that render live via CardRenderer.
 *
 * Mirrors ComparePage's ComparisonCardRenderer dispatch and its runs-picker
 * affordance (ComparisonRunsPanel), but scopes card settings under
 * `reportRunId(reportId)` instead of `compareRunId`. The RunSelector form +
 * "auto" badge/refresh mirror ComparePage's own `ComparisonRunsPanel`
 * RunSelector UI — same mechanism (RunSelectorBadge, rebuildCardsFromRuns),
 * same look, different binding target (a block's cards vs. a whole
 * comparison).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import AddCardModal, { type AddCardSelection } from "../AddCardModal";
import CardRenderer from "../CardRenderer";
import ReorderableCardGrid from "../ReorderableCardGrid";
import RunSelectorBadge from "../RunSelectorBadge";
import { CardMutationContext } from "../../lib/card-settings";
import {
  isMultiRunCardType,
  rebindCardsToMetricIndex,
  rebindCardsToRuns,
  rebuildCardsFromRuns,
  type ComparisonCard,
} from "../../lib/comparisons";
import { cardFromSpec, cardSettingsKeyForReport, useMetricIndex, type CardsBlock } from "../../lib/reports";
import { describeRunSelector, DEFAULT_RUN_SELECTOR_N, type QueryRunSelector } from "../../lib/run-selector";
import { useRunSelectorResolution } from "../../api/hooks";
import { disambiguateRunLabels, useRunMetadataVersion } from "../../lib/run-label";
import type { Run, SequenceMeta } from "../../api/types";

interface Props {
  projectId: string;
  reportId: string;
  block: CardsBlock;
  editMode: boolean;
  allProjectRuns: Run[];
  onChange: (next: CardsBlock) => void;
}

const DEFAULT_QUERY_SELECTOR: QueryRunSelector = { kind: "query", mode: "newest-per-name", n: DEFAULT_RUN_SELECTOR_N };

export default function ReportCardsBlock({ projectId, reportId, block, editMode, allProjectRuns, onChange }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [resetting, setResetting] = useState(false);

  const staticRunIds = block.runIds ?? [];
  // A CardsBlock's runSelector, when present, is always a query selector in
  // this UI (the "static" case is expressed via `runIds` with no
  // runSelector at all) — narrow so the form below can read/patch
  // query-only fields without a union check at every access.
  const selector: QueryRunSelector | undefined =
    block.runSelector?.kind === "query" ? block.runSelector : undefined;

  const resolution = useRunSelectorResolution(projectId, selector);
  const runIds = selector ? resolution.runIds : staticRunIds;

  // Render-only rebind (never persisted/autosaved — see handleRefresh's and
  // the auto-rebind effect's doc below for the persisting counterpart): a
  // selector block's *persisted* `cards` can be stale relative to `runIds`
  // right after this report was hydrated from its markdown `source` (a fresh
  // parse has no live-resolved runs to compile against) or between edits.
  // Viewers never trigger a save (B2), but they should still see cards bound
  // to the currently-resolved runs rather than a frozen/stale snapshot —
  // this mirrors the ```cairn fence preview's own `opts.resolvedRunIds`
  // handling (cairn-block.ts), just without ever calling `onChange`.
  const { index: liveMetricIndex } = useMetricIndex(selector ? runIds : []);
  const displayCards = useMemo(
    () => (selector ? rebindCardsToMetricIndex(block.cards, runIds, liveMetricIndex) : block.cards),
    [selector, block.cards, runIds, liveMetricIndex],
  );

  const includedSet = useMemo(() => new Set(runIds), [runIds]);
  const candidates = useMemo(
    () => allProjectRuns.filter((r) => !includedSet.has(r.id)),
    [allProjectRuns, includedSet],
  );
  const includedRuns = useMemo(
    () => runIds.map((id) => allProjectRuns.find((r) => r.id === id)).filter((r): r is Run => r !== undefined),
    [runIds, allProjectRuns],
  );

  const metaVersion = useRunMetadataVersion();
  const chipLabels = useMemo(() => disambiguateRunLabels(runIds), [runIds, metaVersion]);
  const candidateLabels = useMemo(
    () => disambiguateRunLabels(allProjectRuns.map((r) => r.id)),
    [allProjectRuns, metaVersion],
  );

  const addRuns = (ids: string[]) => {
    const next = Array.from(new Set([...staticRunIds, ...ids]));
    onChange({ ...block, runIds: next });
  };
  const removeRun = (id: string) => {
    onChange({
      ...block,
      runIds: staticRunIds.filter((r) => r !== id),
      cards: block.cards.map((c) => ({ ...c, series: c.series.filter((s) => s.runId !== id) })),
    });
  };

  const toggleAutoMode = () => {
    if (selector) {
      // Switch back to static: keep whatever runs are currently resolved.
      onChange({ ...block, runSelector: undefined, runIds: resolution.runIds });
    } else {
      onChange({ ...block, runSelector: { ...DEFAULT_QUERY_SELECTOR } });
    }
  };

  const updateSelector = (patch: Partial<QueryRunSelector>) => {
    if (!selector) return;
    onChange({ ...block, runSelector: { ...selector, ...patch } });
  };

  // Re-resolve which runs currently match, then REBIND the existing cards to
  // that run set (keep curated cards/order, re-derive series) rather than
  // discarding and regrowing one card per metric — see rebindCardsToRuns.
  // Only mutates in edit mode: a viewer clicking "refresh" should re-resolve
  // for display purposes only, never overwrite the persisted card set.
  const handleRefresh = async () => {
    setRebuilding(true);
    try {
      const freshRunIds = await resolution.refresh();
      if (!editMode) return;
      const cards = await rebindCardsToRuns(block.cards, freshRunIds);
      onChange({ ...block, cards });
    } finally {
      setRebuilding(false);
    }
  };

  // Explicit, destructive "start over" action — full regrow (one card per
  // (name, object_type) across the block's runs), discarding curated
  // cards/order/overlays. Edit-mode only; the auto "refresh" above no longer
  // does this implicitly (see rebindCardsToRuns).
  const handleResetFromRuns = async () => {
    if (runIds.length === 0) return;
    setResetting(true);
    try {
      const cards = await rebuildCardsFromRuns(runIds);
      onChange({ ...block, cards });
    } finally {
      setResetting(false);
    }
  };

  // Auto-rebind: when a selector block's resolved run set changes while in
  // edit mode, rebind existing cards to the new runs automatically (mirrors
  // the ```cairn fence path's `opts.resolvedRunIds` handling) so cards don't
  // go stale between explicit refreshes — the #44 fix. Never runs in view
  // mode (no mutation/autosave for viewers) and never regrows the card set.
  const resolvedRunIdsKey = selector ? runIds.join("|") : "";
  const lastReboundKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editMode || !selector) return;
    if (block.cards.length === 0) return;
    const boundRunIds = new Set(block.cards.flatMap((c) => c.series.map((s) => s.runId)));
    const resolvedSet = new Set(runIds);
    const isStale =
      boundRunIds.size !== resolvedSet.size || [...resolvedSet].some((id) => !boundRunIds.has(id));
    if (!isStale) return;
    // Guard against re-running for a key we already rebound (e.g. while the
    // async rebind for this exact run set is in flight, or after it landed
    // and block.cards was updated but still doesn't perfectly match, which
    // can happen for curated overlay cards that intentionally don't grow).
    if (lastReboundKeyRef.current === resolvedRunIdsKey) return;
    lastReboundKeyRef.current = resolvedRunIdsKey;
    let cancelled = false;
    void (async () => {
      const rebound = await rebindCardsToRuns(block.cards, runIds);
      if (!cancelled) onChange({ ...block, cards: rebound });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, selector, resolvedRunIdsKey]);

  // AddCardSelection → ComparisonCard is the shared `cardFromSpec` (see
  // lib/reports/card-from-spec.ts) — also consumed by the ```cairn dialect
  // interpreter (lib/reports/cairn-block.ts), so the two authoring paths
  // build cards identically.
  const onAddCard = (sel: AddCardSelection) => {
    onChange({ ...block, cards: [...block.cards, cardFromSpec(sel)] });
  };

  const removeCard = (cardId: string) => {
    onChange({ ...block, cards: block.cards.filter((c) => c.id !== cardId) });
  };

  const reorderCards = (fromId: string, toId: string) => {
    const cards = [...block.cards];
    const fromIdx = cards.findIndex((c) => c.id === fromId);
    const toIdx = cards.findIndex((c) => c.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = cards.splice(fromIdx, 1);
    cards.splice(toIdx, 0, moved!);
    onChange({ ...block, cards });
  };

  return (
    // WS-NR1 (B7/edit-mode gating): freeze every card's persisted settings
    // (step/iteration, compare mode, yScale, …) outside edit mode — see
    // CardMutationContext's doc. `editMode` here is this block's real
    // edit-mode flag; CairnFenceCard (the ```cairn fence preview) passes its
    // own threaded `editMode`, defaulting to `false` for a pure viewer.
    <CardMutationContext.Provider value={editMode}>
    <div>
      {(editMode || selector) && (
        <div className="mb-3 card p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs uppercase tracking-wide text-fg-muted">
              Runs in this block ({runIds.length})
            </span>
            <div className="flex items-center gap-2">
              {selector && (
                <RunSelectorBadge
                  title={describeRunSelector(selector)}
                  count={resolution.runIds.length}
                  isRefreshing={rebuilding || resolution.isFetching}
                  onRefresh={() => void handleRefresh()}
                />
              )}
              {editMode && (
                <button
                  type="button"
                  onClick={toggleAutoMode}
                  className="inline-flex h-6 items-center justify-center rounded border border-border bg-bg px-2 text-[10px] text-fg-muted hover:border-accent hover:text-fg"
                  title={selector ? "Switch to a fixed run list" : "Switch to a dynamic run selector"}
                >
                  {selector ? "Use static runs" : "Use auto (query)"}
                </button>
              )}
              {editMode && (
                <button
                  type="button"
                  onClick={() => void handleResetFromRuns()}
                  disabled={resetting || runIds.length === 0}
                  className="inline-flex h-6 items-center justify-center rounded border border-border bg-bg px-2 text-[10px] text-fg-muted hover:border-accent hover:text-fg disabled:opacity-40"
                  title="Discard current cards and regrow one card per metric across this block's runs"
                >
                  {resetting ? "Resetting…" : "Reset cards from runs"}
                </button>
              )}
              {editMode && !selector && (
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  className="inline-flex h-6 items-center justify-center rounded border border-border bg-bg px-2 text-[10px] text-fg-muted hover:border-accent hover:text-fg"
                >
                  {pickerOpen ? "Done" : `+ Add runs (${candidates.length} available)`}
                </button>
              )}
            </div>
          </div>

          {editMode && selector && (
            <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="text-[10px] text-fg-muted">
                Name pattern
                <input
                  type="text"
                  value={selector.namePattern ?? ""}
                  onChange={(e) => updateSelector({ namePattern: e.target.value || undefined })}
                  placeholder="e.g. training-*"
                  className="input mt-0.5 w-full text-xs"
                />
              </label>
              <label className="text-[10px] text-fg-muted">
                Tags (comma-sep)
                <input
                  type="text"
                  value={(selector.tags ?? []).join(", ")}
                  onChange={(e) =>
                    updateSelector({
                      tags: e.target.value
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="e.g. prod, nightly"
                  className="input mt-0.5 w-full text-xs"
                />
              </label>
              <label className="text-[10px] text-fg-muted">
                Mode
                <select
                  value={selector.mode}
                  onChange={(e) => updateSelector({ mode: e.target.value as QueryRunSelector["mode"] })}
                  className="input mt-0.5 w-full text-xs"
                >
                  <option value="latest-n">Latest N</option>
                  <option value="newest-per-name">Newest per name</option>
                </select>
              </label>
              <label className="text-[10px] text-fg-muted">
                N
                <input
                  type="number"
                  min={1}
                  value={selector.n ?? DEFAULT_RUN_SELECTOR_N}
                  onChange={(e) => updateSelector({ n: Math.max(1, Number(e.target.value) || 1) })}
                  className="input mt-0.5 w-full text-xs"
                />
              </label>
            </div>
          )}

          {selector ? (
            runIds.length === 0 ? (
              <p className="text-xs text-fg-subtle">No runs currently match this selector.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {includedRuns.map((r) => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-1 rounded border border-border-subtle bg-bg-hover px-1.5 py-0.5 text-[11px] mono text-fg"
                    title={r.id}
                  >
                    {chipLabels[r.id] ?? r.id.slice(0, 6)}
                  </span>
                ))}
              </div>
            )
          ) : (
            <>
              {staticRunIds.length === 0 ? (
                <p className="text-xs text-fg-subtle">No runs yet. Click "Add runs" to pick some.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {includedRuns.map((r) => {
                    const label = chipLabels[r.id] ?? r.id.slice(0, 6);
                    return (
                      <span
                        key={r.id}
                        className="group/chip inline-flex items-center gap-1 rounded border border-border-subtle bg-bg-hover px-1.5 py-0.5 text-[11px] mono"
                        title={r.id}
                      >
                        <span className="text-fg">{label}</span>
                        <button
                          type="button"
                          onClick={() => removeRun(r.id)}
                          className="text-fg-subtle hover:text-status-failed"
                          aria-label={`Remove ${label}`}
                          title={`Remove ${label}`}
                        >
                          {"×"}
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {pickerOpen && (
                <div className="mt-2 border-t border-border-subtle pt-2">
                  {candidates.length === 0 ? (
                    <p className="text-xs text-fg-subtle">All project runs already included.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                      {candidates.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => addRuns([r.id])}
                          className="inline-flex items-center gap-1 rounded border border-border-subtle bg-bg px-1.5 py-0.5 text-[11px] mono text-fg-muted hover:border-accent hover:text-fg"
                          title={r.id}
                        >
                          <span aria-hidden="true">+</span>
                          {candidateLabels[r.id] ?? r.id.slice(0, 6)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {editMode && (
        <>
          <AddCardModal open={addCardOpen} onClose={() => setAddCardOpen(false)} runIds={runIds} onAdd={onAddCard} />
          <div className="mb-3">
            <button
              type="button"
              onClick={() => setAddCardOpen(true)}
              disabled={runIds.length === 0}
              className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-accent hover:text-fg transition-colors disabled:opacity-40"
              title={runIds.length === 0 ? "Add runs to this block first" : undefined}
            >
              <span aria-hidden="true">+</span> Add card
            </button>
          </div>
        </>
      )}

      {displayCards.length === 0 ? (
        <div className="card p-4 text-sm text-fg-muted">
          {runIds.length === 0
            ? "No runs bound to this block yet."
            : editMode
              ? 'No cards yet. Click "Add card" to pick metrics from this block\'s runs.'
              : "No cards in this block."}
        </div>
      ) : (
        <ReorderableCardGrid
          cards={displayCards.map((card) => ({
            key: card.id,
            content: (
              <ReportCardRenderer
                reportId={reportId}
                card={card}
                onRemove={editMode ? () => removeCard(card.id) : undefined}
              />
            ),
          }))}
          onReorder={editMode ? reorderCards : undefined}
        />
      )}
    </div>
    </CardMutationContext.Provider>
  );
}

function ReportCardRenderer({
  reportId,
  card,
  onRemove,
}: {
  reportId: string;
  card: ComparisonCard;
  onRemove?: () => void;
}) {
  const runIds = useMemo(() => Array.from(new Set(card.series.map((s) => s.runId))), [card.series]);

  if (isMultiRunCardType(card.type)) {
    return (
      <CardRenderer
        kind="multi-run"
        cardType={card.type}
        runIds={runIds}
        settingsKey={cardSettingsKeyForReport(reportId, card)}
        onRemove={onRemove}
      />
    );
  }

  const primary = card.series[0];
  if (!primary) {
    return (
      <div data-cairn-card className="card p-4 text-sm text-fg-muted flex items-baseline justify-between gap-2">
        <span>Empty card.</span>
        {onRemove && (
          <button type="button" className="btn text-xs" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
    );
  }

  const seedMetric: SequenceMeta = {
    name: primary.name,
    object_type: card.type,
    context: null,
    context_hash: primary.context_hash,
    min_step: 0,
    max_step: 0,
    count: 0,
  };

  return (
    <CardRenderer
      runId={primary.runId}
      metric={seedMetric}
      extraSeries={card.series.slice(1)}
      controlledSeries
      onRemove={onRemove}
      settingsKeyOverride={cardSettingsKeyForReport(reportId, card)}
    />
  );
}
