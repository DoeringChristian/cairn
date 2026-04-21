/**
 * Smart Comparison Wizard — create a comparison by filtering runs on parameters.
 *
 * The user picks parameter keys, selects allowed values, chooses a strategy
 * (latest run per param combo, or all matching), previews results, then creates.
 */

import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useRuns } from "../api/hooks";
import { api } from "../api/client";
import type { Run } from "../api/types";
import {
  createComparison,
  addCardToComparison,
  loadComparisons,
  saveComparisons,
  type SmartFilters,
  type SmartFilterEntry,
} from "../lib/comparisons";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Strategy = "latest" | "all";

interface ParamFilter {
  key: string;
  mode: "values" | "regex";
  /** Selected allowed values (empty = all). */
  values: Set<string>;
  /** Regex pattern when mode is "regex". */
  regex: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** Called after the comparison is created, with the new comparison ID. */
  onCreated: (comparisonId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortRunId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SmartComparisonWizard({
  open,
  onClose,
  projectId,
  onCreated,
}: Props) {
  const [step, setStep] = useState<"filters" | "preview">("filters");
  const [filters, setFilters] = useState<ParamFilter[]>([]);
  const [strategy, setStrategy] = useState<Strategy>("latest");
  const [compName, setCompName] = useState("");
  const [autoCards, setAutoCards] = useState(true);
  const [creating, setCreating] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep("filters");
      setFilters([]);
      setStrategy("latest");
      setCompName("");
      setAutoCards(true);
      setCreating(false);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Prevent body scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Fetch all runs for the project
  const runsQ = useRuns({ project: projectId, limit: 500 });
  const allRuns = runsQ.data?.runs ?? [];

  // Fetch params for all runs
  const runDetailQueries = useQueries({
    queries: open
      ? allRuns.map((r) => ({
          queryKey: ["run", r.id],
          queryFn: () => api.run(r.id),
          staleTime: 60_000,
        }))
      : [],
  });

  // Build param index: key → { runId → value }
  const { paramKeys, paramValues, runParamMap } = useMemo(() => {
    const keySet = new Set<string>();
    const valuesMap = new Map<string, Set<string>>(); // key → unique values
    const rMap = new Map<string, Map<string, string>>(); // runId → { key → value }

    runDetailQueries.forEach((q, idx) => {
      const run = allRuns[idx];
      if (!run || !q.data) return;
      const pmap = new Map<string, string>();
      for (const p of q.data.params ?? []) {
        keySet.add(p.key);
        pmap.set(p.key, p.value);
        const vs = valuesMap.get(p.key) ?? new Set();
        vs.add(p.value);
        valuesMap.set(p.key, vs);
      }
      rMap.set(run.id, pmap);
    });

    return {
      paramKeys: Array.from(keySet).sort(),
      paramValues: valuesMap,
      runParamMap: rMap,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRuns, runDetailQueries.map((q) => q.dataUpdatedAt).join("|")]);

  // Filter matching runs
  const matchedRuns = useMemo(() => {
    if (filters.length === 0) return allRuns;

    let matched = allRuns.filter((run) => {
      const pmap = runParamMap.get(run.id);
      if (!pmap) return false;
      return filters.every((f) => {
        const val = pmap.get(f.key);
        if (val == null) return false;
        if (f.mode === "regex") {
          if (!f.regex) return true; // empty regex = match all
          try {
            return new RegExp(f.regex).test(val);
          } catch {
            return false; // invalid regex matches nothing
          }
        }
        if (f.values.size === 0) return true; // no filter = all values
        return f.values.has(val);
      });
    });

    if (strategy === "latest") {
      // Group by param combo, keep latest per group
      const groups = new Map<string, Run[]>();
      for (const run of matched) {
        const pmap = runParamMap.get(run.id);
        const comboKey = filters.map((f) => pmap?.get(f.key) ?? "").join("||");
        const arr = groups.get(comboKey) ?? [];
        arr.push(run);
        groups.set(comboKey, arr);
      }
      matched = [];
      for (const arr of groups.values()) {
        arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
        matched.push(arr[0]!);
      }
    }

    // Sort by created_at desc
    matched.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return matched;
  }, [allRuns, filters, strategy, runParamMap]);

  // Param filter management
  const addFilter = (key: string) => {
    if (filters.some((f) => f.key === key)) return;
    setFilters((prev) => [...prev, { key, mode: "values", values: new Set(), regex: "" }]);
  };

  const removeFilter = (key: string) => {
    setFilters((prev) => prev.filter((f) => f.key !== key));
  };

  const toggleFilterValue = (key: string, value: string) => {
    setFilters((prev) =>
      prev.map((f) => {
        if (f.key !== key) return f;
        const next = new Set(f.values);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return { ...f, values: next };
      }),
    );
  };

  const toggleFilterMode = (key: string) => {
    setFilters((prev) =>
      prev.map((f) => {
        if (f.key !== key) return f;
        return { ...f, mode: f.mode === "values" ? "regex" : "values" };
      }),
    );
  };

  const setFilterRegex = (key: string, regex: string) => {
    setFilters((prev) =>
      prev.map((f) => (f.key === key ? { ...f, regex } : f)),
    );
  };

  // Create comparison
  const handleCreate = async () => {
    if (matchedRuns.length === 0) return;
    setCreating(true);

    const name = compName.trim() || `Smart comparison (${matchedRuns.length} runs)`;
    const cmp = createComparison(projectId, name);

    // Persist smart filters so the comparison can be refreshed later.
    const smartFilters: SmartFilters = {
      projectId,
      strategy,
      filters: filters.map((f): SmartFilterEntry => ({
        key: f.key,
        mode: f.mode,
        values: Array.from(f.values),
        regex: f.regex,
      })),
    };
    const allComps = loadComparisons(projectId);
    const updated = allComps.map((c) =>
      c.id === cmp.id ? { ...c, smartFilters } : c,
    );
    saveComparisons(projectId, updated);

    if (autoCards) {
      // Fetch sequences for matched runs, build cards
      const selectedIds = matchedRuns.map((r) => r.id);
      const seqResults = await Promise.all(
        selectedIds.map((rid) => api.sequences(rid)),
      );

      const cardMap = new Map<
        string,
        {
          name: string;
          object_type: string;
          series: Array<{ runId: string; name: string; context_hash: string }>;
        }
      >();
      seqResults.forEach((result, idx) => {
        const runId = selectedIds[idx]!;
        for (const seq of result.sequences) {
          const key = `${seq.name}::${seq.object_type}`;
          const existing = cardMap.get(key);
          if (existing) {
            if (!existing.series.some((s) => s.runId === runId && s.name === seq.name)) {
              existing.series.push({ runId, name: seq.name, context_hash: seq.context_hash });
            }
          } else {
            cardMap.set(key, {
              name: seq.name,
              object_type: seq.object_type,
              series: [{ runId, name: seq.name, context_hash: seq.context_hash }],
            });
          }
        }
      });

      for (const card of cardMap.values()) {
        addCardToComparison(projectId, cmp.id, {
          type: card.object_type as "scalar",
          series: card.series,
        });
      }
    }

    setCreating(false);
    onCreated(cmp.id);
    onClose();
  };

  const anyLoading = runsQ.isLoading || runDetailQueries.some((q) => q.isLoading);
  const selectedFilterKeys = new Set(filters.map((f) => f.key));

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />

      <div className="relative z-10 flex flex-col m-6 mx-auto w-full max-w-3xl rounded-lg border border-border bg-bg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">
            Smart Comparison
            {step === "preview" && " — Preview"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg text-lg"
            aria-label="Close"
          >
            {"\u00D7"}
          </button>
        </div>

        {step === "filters" ? (
          <>
            {/* Strategy */}
            <div className="border-b border-border px-4 py-3 flex items-center gap-4">
              <label className="text-xs text-fg-muted">Strategy:</label>
              <label className="inline-flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="strategy"
                  checked={strategy === "latest"}
                  onChange={() => setStrategy("latest")}
                  className="accent-accent"
                />
                Latest run per param combo
              </label>
              <label className="inline-flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="strategy"
                  checked={strategy === "all"}
                  onChange={() => setStrategy("all")}
                  className="accent-accent"
                />
                All matching runs
              </label>
            </div>

            {/* Filters */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
              {anyLoading && paramKeys.length === 0 ? (
                <p className="text-sm text-fg-muted">Loading run parameters...</p>
              ) : (
                <>
                  {/* Active filters */}
                  {filters.length > 0 && (
                    <div className="space-y-3 mb-4">
                      {filters.map((f) => {
                        const allValues = Array.from(paramValues.get(f.key) ?? []).sort();
                        return (
                          <div key={f.key} className="rounded border border-border p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="mono text-xs font-semibold">{f.key}</span>
                                <button
                                  type="button"
                                  onClick={() => toggleFilterMode(f.key)}
                                  className="rounded border border-border-subtle px-1.5 py-0.5 text-[10px] text-fg-muted hover:border-accent hover:text-fg transition-colors"
                                  title={f.mode === "values" ? "Switch to regex" : "Switch to pick values"}
                                >
                                  {f.mode === "values" ? "regex" : "values"}
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeFilter(f.key)}
                                className="text-xs text-fg-subtle hover:text-fg"
                              >
                                {"\u00D7"} Remove
                              </button>
                            </div>
                            {f.mode === "values" ? (
                              <>
                                <div className="flex flex-wrap gap-1.5">
                                  {allValues.map((val) => {
                                    const selected = f.values.size === 0 || f.values.has(val);
                                    return (
                                      <button
                                        key={val}
                                        type="button"
                                        onClick={() => toggleFilterValue(f.key, val)}
                                        className={`mono rounded border px-2 py-0.5 text-xs transition-colors ${
                                          selected
                                            ? "border-accent bg-accent/10 text-accent"
                                            : "border-border-subtle text-fg-subtle hover:border-border hover:text-fg-muted"
                                        }`}
                                      >
                                        {val}
                                      </button>
                                    );
                                  })}
                                </div>
                                {f.values.size === 0 && (
                                  <p className="text-[10px] text-fg-subtle mt-1">All values selected. Click to filter.</p>
                                )}
                              </>
                            ) : (
                              <div>
                                <input
                                  type="text"
                                  value={f.regex}
                                  onChange={(e) => setFilterRegex(f.key, e.target.value)}
                                  placeholder="e.g. ^adam|sgd$"
                                  className="input w-full text-xs mono"
                                />
                                {f.regex && (() => { try { new RegExp(f.regex); return null; } catch { return <p className="text-[10px] text-status-failed mt-1">Invalid regex</p>; } })()}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add filter */}
                  <div>
                    <h4 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
                      Add parameter filter
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {paramKeys.filter((k) => !selectedFilterKeys.has(k)).map((key) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => addFilter(key)}
                          className="mono rounded border border-border-subtle px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg transition-colors"
                        >
                          + {key}
                        </button>
                      ))}
                      {paramKeys.length === 0 && !anyLoading && (
                        <p className="text-xs text-fg-subtle">No parameters found across runs.</p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-border px-4 py-3 flex items-center justify-between">
              <p className="text-xs text-fg-muted">
                {matchedRuns.length} run{matchedRuns.length !== 1 ? "s" : ""} matched
                {" · "}{allRuns.length} total
              </p>
              <button
                type="button"
                onClick={() => setStep("preview")}
                disabled={matchedRuns.length === 0}
                className="btn text-xs px-4"
              >
                Preview {"\u2192"}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Preview */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
              <div className="mb-3">
                <label className="block text-[10px] uppercase tracking-wide text-fg-muted mb-1">
                  Comparison name
                </label>
                <input
                  type="text"
                  value={compName}
                  onChange={(e) => setCompName(e.target.value)}
                  placeholder={`Smart comparison (${matchedRuns.length} runs)`}
                  className="input w-full text-sm"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-fg-muted mb-3">
                <input
                  type="checkbox"
                  checked={autoCards}
                  onChange={(e) => setAutoCards(e.target.checked)}
                  className="accent-accent"
                />
                Auto-populate cards from matched runs' metrics
              </label>

              <h4 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
                Matched runs ({matchedRuns.length})
              </h4>
              <div className="divide-y divide-border-subtle rounded border border-border overflow-hidden">
                {matchedRuns.map((run) => {
                  const pmap = runParamMap.get(run.id);
                  return (
                    <div key={run.id} className="px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="mono font-semibold truncate">
                          {run.display_name ?? shortRunId(run.id)}
                        </span>
                        <span className="text-fg-subtle shrink-0">
                          {new Date(run.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      {filters.length > 0 && pmap && (
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-fg-muted">
                          {filters.map((f) => (
                            <span key={f.key}>
                              <span className="text-fg-subtle">{f.key}:</span>{" "}
                              <span className="mono">{pmap.get(f.key) ?? "—"}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {matchedRuns.length === 0 && (
                  <div className="px-3 py-4 text-sm text-fg-subtle text-center">
                    No runs match the current filters.
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-border px-4 py-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep("filters")}
                className="btn text-xs"
              >
                {"\u2190"} Back
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={matchedRuns.length === 0 || creating}
                className="btn text-xs px-4 bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
              >
                {creating ? "Creating..." : `Create comparison (${matchedRuns.length} runs)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
