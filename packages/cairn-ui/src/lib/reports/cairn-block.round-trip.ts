/**
 * Acceptance core (a): per-card settings + card-structure round-trip
 * fidelity through the ```cairn dialect — the "highest risk" item flagged
 * in docs/superpowers/specs/2026-07-04-ai-authored-reports.md §9.4.1.
 *
 * For each case: build a `ComparisonCard` + its settings blob (as the cells
 * editor would hold them today), run it through
 *   serializeCairnSpec → stringifyCairnSpec → parseCairnSpec → compileCairnBlock
 * and assert the recompiled card + settings are equivalent to the
 * originals. `metricIndexRuns` is a fixture standing in for a live
 * `/api/{run}/sequences` fetch — it's what supplies `context_hash` back to
 * a re-parsed `metric:`-form card (see cairn-block.ts's `selectionForCard`).
 *
 * No test framework is wired into this repo (cairn/ui has no vitest/jest —
 * see package.json). `runCairnBlockRoundTripChecks()` is a plain function a
 * reviewer can read top-to-bottom or execute directly (e.g. via `node
 * --experimental-strip-types` or a one-off esbuild bundle) — see
 * ws-AR1-report.md for the executed results.
 */

import type { SequenceMeta } from "../../api/types";
import type { ComparisonCard } from "../comparisons";
import { compileCairnBlock, parseCairnSpec, serializeCairnSpec, stringifyCairnSpec } from "./cairn-block";
import { buildMetricIndex } from "./metric-index";
import type { CardsBlock } from "./types";

function seqFixture(runId: string, name: string): { runId: string; sequences: SequenceMeta[] } {
  return {
    runId,
    sequences: [{ name, object_type: "scalar", context: null, context_hash: "", min_step: 0, max_step: 10, count: 11 }],
  };
}

interface Case {
  name: string;
  runIds: string[];
  card: ComparisonCard;
  settings: Record<string, unknown>;
  /** Fixture sequences per run, standing in for a live metricIndex fetch. */
  metricIndexRuns: Array<{ runId: string; sequences: SequenceMeta[] }>;
}

const CASES: Case[] = [
  {
    name: "scalar card: log y-scale + smoothing, two runs",
    runIds: ["run_a", "run_b"],
    card: {
      id: "card_scalar_1",
      type: "scalar",
      series: [
        { runId: "run_a", name: "train/loss", context_hash: "" },
        { runId: "run_b", name: "train/loss", context_hash: "" },
      ],
    },
    settings: { version: 1, yScale: "log", smoothing: 0.6 },
    metricIndexRuns: [
      { runId: "run_a", sequences: [{ name: "train/loss", object_type: "scalar", context: null, context_hash: "", min_step: 0, max_step: 100, count: 101 }] },
      { runId: "run_b", sequences: [{ name: "train/loss", object_type: "scalar", context: null, context_hash: "", min_step: 0, max_step: 100, count: 101 }] },
    ],
  },
  {
    name: "image card: external per-run reference/diff baseline",
    runIds: ["run_a", "run_b"],
    card: {
      id: "card_image_1",
      type: "image",
      series: [
        { runId: "run_a", name: "prediction", context_hash: "ctx1" },
        { runId: "run_b", name: "prediction", context_hash: "ctx1" },
      ],
    },
    settings: {
      version: 1,
      reference: { source: "external", externalScope: "per-run" },
    },
    metricIndexRuns: [
      { runId: "run_a", sequences: [{ name: "prediction", object_type: "image", context: null, context_hash: "ctx1", min_step: 0, max_step: 10, count: 11 }] },
      { runId: "run_b", sequences: [{ name: "prediction", object_type: "image", context: null, context_hash: "ctx1", min_step: 0, max_step: 10, count: 11 }] },
    ],
  },
  {
    name: "multi-run card: parallel coordinates over 3 runs",
    runIds: ["run_a", "run_b", "run_c"],
    card: {
      id: "card_parallel_1",
      type: "parallel",
      // Multi-run cards' series[].name is always MULTI_RUN_CARD_LABELS[type]
      // (see cardFromSpec's multi-run branch) — cosmetic, not a real metric.
      series: [
        { runId: "run_a", name: "Parallel Coordinates", context_hash: "" },
        { runId: "run_b", name: "Parallel Coordinates", context_hash: "" },
        { runId: "run_c", name: "Parallel Coordinates", context_hash: "" },
      ],
    },
    settings: { version: 1, axes: ["lr", "batch_size", "final/loss"] },
    metricIndexRuns: [],
  },
  {
    name: "scalar card: metric only on a subset of block runs → falls back to explicit series",
    runIds: ["run_a", "run_b"],
    card: {
      id: "card_scalar_2",
      type: "scalar",
      series: [{ runId: "run_a", name: "val/accuracy", context_hash: "ctx2" }],
    },
    settings: { version: 1, yScale: "linear" },
    metricIndexRuns: [
      { runId: "run_a", sequences: [{ name: "val/accuracy", object_type: "scalar", context: null, context_hash: "ctx2", min_step: 0, max_step: 5, count: 6 }] },
    ],
  },
];

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual(ao[k], bo[k]));
}

function seriesKeySet(card: ComparisonCard): Set<string> {
  return new Set(card.series.map((s) => `${s.runId}::${s.name}`));
}

export interface RoundTripResult {
  name: string;
  pass: boolean;
  detail?: string;
}

/** Run every case in CASES; returns one result per case. */
export function runCairnBlockRoundTripChecks(): RoundTripResult[] {
  return CASES.map((c) => {
    const block: CardsBlock = { id: "blk_test", type: "cards", runIds: c.runIds, cards: [c.card] };
    const settingsByCardId = { [c.card.id]: c.settings };

    const spec = serializeCairnSpec(block, settingsByCardId);
    const yamlText = stringifyCairnSpec(spec);
    let reparsed;
    try {
      reparsed = parseCairnSpec(yamlText);
    } catch (e) {
      return { name: c.name, pass: false, detail: `re-parse failed: ${(e as Error).message}\n---yaml---\n${yamlText}` };
    }

    const metricIndex = buildMetricIndex(c.metricIndexRuns);
    let compiled;
    try {
      compiled = compileCairnBlock(reparsed, metricIndex);
    } catch (e) {
      return { name: c.name, pass: false, detail: `compile failed: ${(e as Error).message}\n---yaml---\n${yamlText}` };
    }

    const newCard = compiled.block.cards[0];
    if (!newCard) return { name: c.name, pass: false, detail: `no card produced\n---yaml---\n${yamlText}` };

    const newSettings = compiled.settings[newCard.id];
    const settingsMatch = deepEqual(newSettings, c.settings);
    const typeMatch = newCard.type === c.card.type;
    const seriesMatch = deepEqual([...seriesKeySet(newCard)].sort(), [...seriesKeySet(c.card)].sort());
    const runsMatch = deepEqual(
      compiled.block.runIds ? [...compiled.block.runIds].sort() : [],
      [...c.runIds].sort(),
    );

    const pass = settingsMatch && typeMatch && seriesMatch && runsMatch;
    return {
      name: c.name,
      pass,
      detail: pass
        ? undefined
        : `settingsMatch=${settingsMatch} typeMatch=${typeMatch} seriesMatch=${seriesMatch} runsMatch=${runsMatch}\n---yaml---\n${yamlText}\n---got settings---\n${JSON.stringify(newSettings)}`,
    };
  });
}

/**
 * Regression coverage for the `runs.selector` empty-series bug (AR1
 * verification finding): `compileCairnBlock` used to always compile a
 * `runs.selector` block's cards against `effectiveRunIds = []`, since only
 * the static `runs.ids` branch of `resolveRuns` fed `effectiveRunIds`. The
 * live-resolved ids (from `useRunSelectorResolution` in `CairnFenceCard`)
 * were never threaded through, so every selector-based `metric:` card
 * compiled with a hardcoded-empty `series: []` — "Empty card." forever,
 * regardless of what the selector actually resolved to.
 *
 * These checks exercise `compileCairnBlock`'s new `opts.resolvedRunIds`
 * param directly (no React/hooks involved — the resolution itself stays in
 * the component; this only checks the pure compile function consumes it).
 */
const SELECTOR_YAML = `
runs:
  selector:
    mode: newest-per-name
cards:
  - metric: train/loss
    type: scalar
`;

export function runCairnBlockSelectorChecks(): RoundTripResult[] {
  const results: RoundTripResult[] = [];

  // 1) resolvedRunIds given → selector block compiles a non-empty series
  //    over exactly the resolved run ids (the bug fix).
  {
    const resolvedRunIds = ["run_x", "run_y"];
    const metricIndex = buildMetricIndex([seqFixture("run_x", "train/loss"), seqFixture("run_y", "train/loss")]);
    let detail: string | undefined;
    let pass = false;
    try {
      const spec = parseCairnSpec(SELECTOR_YAML);
      const compiled = compileCairnBlock(spec, metricIndex, { resolvedRunIds });
      const card = compiled.block.cards[0];
      const hasRunSelector = !!compiled.block.runSelector && compiled.block.runIds === undefined;
      const seriesRunIds = card ? [...new Set(card.series.map((s) => s.runId))].sort() : [];
      const seriesMatch = deepEqual(seriesRunIds, [...resolvedRunIds].sort());
      pass = !!card && card.series.length > 0 && hasRunSelector && seriesMatch;
      if (!pass) {
        detail = `hasRunSelector=${hasRunSelector} seriesMatch=${seriesMatch} series=${JSON.stringify(card?.series)}`;
      }
    } catch (e) {
      detail = `compile failed: ${(e as Error).message}`;
    }
    results.push({ name: "runs.selector + resolvedRunIds → non-empty series over resolved runs", pass, detail });
  }

  // 2) No resolvedRunIds given (e.g. resolution not yet available) →
  //    compiles gracefully to an empty series, not a crash — the loading
  //    state a caller can detect and render around, not a hard failure.
  {
    const metricIndex = buildMetricIndex([]);
    let detail: string | undefined;
    let pass = false;
    try {
      const spec = parseCairnSpec(SELECTOR_YAML);
      const compiled = compileCairnBlock(spec, metricIndex);
      const card = compiled.block.cards[0];
      pass = !!card && card.series.length === 0;
      if (!pass) detail = `expected empty series, got ${JSON.stringify(card?.series)}`;
    } catch (e) {
      detail = `compile failed: ${(e as Error).message}`;
    }
    results.push({ name: "runs.selector without resolvedRunIds → graceful empty series (no crash)", pass, detail });
  }

  // 3) Static `runs.ids` is unaffected by the new opts param — passing an
  //    unrelated `resolvedRunIds` must not leak into a static block's
  //    effective run set.
  {
    const staticYaml = `
runs:
  ids: [run_a, run_b]
cards:
  - metric: train/loss
    type: scalar
`;
    const metricIndex = buildMetricIndex([seqFixture("run_a", "train/loss"), seqFixture("run_b", "train/loss")]);
    let detail: string | undefined;
    let pass = false;
    try {
      const spec = parseCairnSpec(staticYaml);
      const compiled = compileCairnBlock(spec, metricIndex, { resolvedRunIds: ["run_x", "run_y"] });
      const card = compiled.block.cards[0];
      const seriesRunIds = card ? [...new Set(card.series.map((s) => s.runId))].sort() : [];
      pass = deepEqual(seriesRunIds, ["run_a", "run_b"]);
      if (!pass) detail = `expected [run_a, run_b], got ${JSON.stringify(seriesRunIds)}`;
    } catch (e) {
      detail = `compile failed: ${(e as Error).message}`;
    }
    results.push({ name: "runs.ids (static) ignores resolvedRunIds — unaffected by the selector fix", pass, detail });
  }

  return results;
}
