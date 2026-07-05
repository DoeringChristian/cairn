/**
 * Regression coverage for the RBUG hydrate fold-in (WS-NR1 deliverable 4):
 * `parseReportMarkdown`'s callers (`ReportEditorPage`'s hydrate effect and
 * `exitMarkdownView`) must thread the live-resolved project run pool into
 * `compileCairnBlock` for `runs.selector` blocks, or a selector-bound card
 * compiles with `series: []` — permanently losing its metric identity (no
 * render-time rebind, `rebindCardsToMetricIndex` in
 * lib/comparisons/rebuild-cards.ts, can recover a name from an empty
 * series, since its "grow into new runs" branch requires exactly one shared
 * `name` across existing series entries).
 *
 * Same convention as the other `*.round-trip.ts` files in this directory: no
 * test framework is wired into this repo — `runHydrateResolvedRunsChecks()`
 * is a plain function, executed ad hoc (see the ws-NR1 report for results).
 */

import type { Run } from "../../api/types";
import { isCardsBlock } from "./types";
import { parseReportMarkdown } from "./markdown-source";
import type { RoundTripResult } from "./markdown-source.round-trip";

function fakeRun(id: string, displayName: string, createdAt: string): Run {
  return {
    id,
    project_id: "proj",
    display_name: displayName,
    created_at: createdAt,
    ended_at: null,
    status: "running",
    exit_code: null,
    git_sha: null,
    git_dirty: null,
    git_branch: null,
    cli_args: null,
    env_snapshot: null,
    hostname: null,
    user: null,
    tags: null,
    notes: null,
  };
}

const ALL_RUNS: Run[] = [
  fakeRun("run_a", "ablate-1", "2026-07-01T00:00:00Z"),
  fakeRun("run_b", "ablate-2", "2026-07-02T00:00:00Z"),
];

const SELECTOR_SOURCE = [
  "```cairn",
  "id: blk1",
  "runs:",
  "  selector: { mode: newest-per-name, namePattern: ablate-* }",
  "cards:",
  "  - type: scalar",
  "    metric: val/loss",
  "```",
].join("\n");

export function runHydrateResolvedRunsChecks(): RoundTripResult[] {
  const results: RoundTripResult[] = [];

  // (1) Without `allProjectRuns` (old callers / back-compat): the selector
  // can't resolve synchronously, so the block compiles with an empty run
  // set — documented, not a regression (matches CairnFenceCard's own
  // "resolving…" transient state before its first fetch lands).
  {
    const parsed = parseReportMarkdown(SELECTOR_SOURCE);
    const block = parsed.blocks[0];
    const pass = !!block && isCardsBlock(block) && block.cards.length === 1 && block.cards[0]!.series.length === 0;
    results.push({
      name: "selector block, no allProjectRuns -> empty series (documented baseline)",
      pass,
      detail: pass ? undefined : JSON.stringify(block),
    });
  }

  // (2) With `allProjectRuns` threaded (the fix): the block resolves its
  // selector synchronously via resolveRunSelectorFromRuns and compiles a
  // card with non-empty series bound to the resolved runs, immediately —
  // no separate async rebind needed to see real data on first hydrate.
  {
    const parsed = parseReportMarkdown(SELECTOR_SOURCE, undefined, { allProjectRuns: ALL_RUNS });
    const block = parsed.blocks[0];
    const card = block && isCardsBlock(block) ? block.cards[0] : undefined;
    const seriesRunIds = (card?.series ?? []).map((s) => s.runId).sort();
    const pass =
      !!block &&
      isCardsBlock(block) &&
      block.cards.length === 1 &&
      seriesRunIds.length === 2 &&
      seriesRunIds[0] === "run_a" &&
      seriesRunIds[1] === "run_b" &&
      card!.series.every((s) => s.name === "val/loss");
    results.push({
      name: "selector block + allProjectRuns -> non-empty series bound to resolved runs (the fix)",
      pass,
      detail: pass ? undefined : JSON.stringify(block),
    });
  }

  // (3) Static `runs.ids` blocks are unaffected by `allProjectRuns` — the
  // static-ids branch never consults it (compileCairnBlock only reads
  // `opts.resolvedRunIds` when the spec is selector-based).
  {
    const source = [
      "```cairn",
      "id: blk2",
      "runs:",
      "  ids: [run_a]",
      "cards:",
      "  - type: scalar",
      "    metric: val/loss",
      "```",
    ].join("\n");
    const parsed = parseReportMarkdown(source, undefined, { allProjectRuns: ALL_RUNS });
    const block = parsed.blocks[0];
    const card = block && isCardsBlock(block) ? block.cards[0] : undefined;
    const pass = !!card && card.series.length === 1 && card.series[0]!.runId === "run_a";
    results.push({
      name: "static runs.ids block ignores allProjectRuns (unchanged)",
      pass,
      detail: pass ? undefined : JSON.stringify(block),
    });
  }

  return results;
}
