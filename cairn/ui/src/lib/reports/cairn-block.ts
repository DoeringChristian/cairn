/**
 * The ```cairn dialect: a declarative YAML card spec that compiles 1:1 to a
 * `CardsBlock` (see docs/superpowers/specs/2026-07-04-ai-authored-reports.md
 * §2). This is a pure parser — no `eval`, no JS execution, no sandbox. A
 * malformed spec throws `CairnBlockError`; callers (the ```cairn render
 * component, the markdown⇄blocks bridge) catch it and render/emit an inline
 * error instead of crashing the report.
 *
 * Grammar (see the spec doc for the authoritative version):
 *
 *   runs:
 *     ids: [run_abc, run_def]                 # → CardsBlock.runIds
 *     # or
 *     selector: { mode: newest-per-name, namePattern: "train-*", tags: [prod], n: 5 }
 *                                              # → CardsBlock.runSelector (query)
 *   title: "Validation metrics"                # optional
 *   cards:
 *     - metric: train/loss                     # series card
 *       type: scalar                           # optional if unambiguous
 *       settings: { yScale: log }               # → card-settings store
 *     - type: parallel                          # multi-run card (no `metric`)
 *     - type: scalar                             # manual-series (explicit overlay)
 *       series: [{ runId: run_a, name: loss, context_hash: "" }]
 *
 * Field → existing-model mapping:
 *   runs.ids            → CardsBlock.runIds
 *   runs.selector        → CardsBlock.runSelector (QueryRunSelector)
 *   cards[].metric+.type → cardFromSpec({kind:"series", ...})
 *   cards[].type (multi-run, no metric/series) → cardFromSpec({kind:"multi-run", ...})
 *   cards[].series       → cardFromSpec({kind:"manual-series", ...})
 *   cards[].settings     → returned `settings` map (cardId → settings), the
 *                          caller writes it via saveCardSettings/cardSettingsKeyForReport.
 */

import { parse as parseYamlDoc, stringify as stringifyYamlDoc } from "yaml";
import {
  isMultiRunCardType,
  MULTI_RUN_CARD_LABELS,
  type ComparisonCard,
  type ComparisonSeriesRef,
  type MultiRunCardType,
} from "../comparisons";
import type { QueryRunSelector, RunSelector } from "../run-selector";
import { cardFromSpec, type AddCardSelection } from "./card-from-spec";
import { newId } from "./ids";
import type { MetricIndex } from "./metric-index";
import type { CardsBlock } from "./types";

export class CairnBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CairnBlockError";
  }
}

/** Raw shape of a `runs.selector` entry before validation. */
interface CairnRunsSelectorInput {
  mode?: unknown;
  namePattern?: unknown;
  tags?: unknown;
  n?: unknown;
}

interface CairnRunsInput {
  ids?: unknown;
  selector?: CairnRunsSelectorInput;
}

interface CairnCardInput {
  metric?: unknown;
  type?: unknown;
  settings?: unknown;
  series?: unknown;
}

/** The parsed (but not yet compiled) YAML document. */
export interface CairnSpec {
  /**
   * Optional block-id carry-through, used by the markdown⇄blocks serializer
   * (lib/reports/markdown-source.ts) for id stability across a cells⇄markdown
   * toggle. Not meaningful for hand/AI-authored specs — omit it; a fresh id
   * is assigned. (Prose `MarkdownBlock`s have no equivalent hidden channel
   * under the no-raw-HTML sanitization contract, so their ids always
   * regenerate on parse — see markdown-source.ts's module doc.)
   */
  id?: string;
  runs?: CairnRunsInput;
  title?: string;
  cards?: CairnCardInput[];
}

export interface CompiledCairnBlock {
  block: CardsBlock;
  /** cardId → inline settings, to be written via saveCardSettings. */
  settings: Record<string, unknown>;
}

/** Parse a ```cairn fence body into a validated spec. Never returns partial/undefined shapes silently — throws CairnBlockError with a message a human (or AI) can act on. */
export function parseCairnSpec(source: string): CairnSpec {
  let doc: unknown;
  try {
    doc = parseYamlDoc(source);
  } catch (e) {
    throw new CairnBlockError(`YAML parse error: ${(e as Error).message}`);
  }
  if (doc == null) return {};
  if (typeof doc !== "object" || Array.isArray(doc)) {
    throw new CairnBlockError("a ```cairn block must be a YAML mapping with `runs`/`title`/`cards` keys");
  }
  const d = doc as Record<string, unknown>;
  if (d.id !== undefined && typeof d.id !== "string") {
    throw new CairnBlockError("`id` must be a string");
  }
  if (d.title !== undefined && typeof d.title !== "string") {
    throw new CairnBlockError("`title` must be a string");
  }
  if (d.cards !== undefined && !Array.isArray(d.cards)) {
    throw new CairnBlockError("`cards` must be a list");
  }
  if (d.runs !== undefined && (typeof d.runs !== "object" || d.runs === null || Array.isArray(d.runs))) {
    throw new CairnBlockError("`runs` must be a mapping (`ids: [...]` or `selector: {...}`)");
  }
  return d as CairnSpec;
}

function validateRunSelector(sel: CairnRunsSelectorInput): RunSelector {
  if (sel.mode !== "latest-n" && sel.mode !== "newest-per-name") {
    throw new CairnBlockError('runs.selector.mode must be "latest-n" or "newest-per-name"');
  }
  if (sel.namePattern !== undefined && typeof sel.namePattern !== "string") {
    throw new CairnBlockError("runs.selector.namePattern must be a string");
  }
  if (sel.tags !== undefined && (!Array.isArray(sel.tags) || !sel.tags.every((t) => typeof t === "string"))) {
    throw new CairnBlockError("runs.selector.tags must be a list of strings");
  }
  if (sel.n !== undefined && (typeof sel.n !== "number" || !Number.isFinite(sel.n))) {
    throw new CairnBlockError("runs.selector.n must be a number");
  }
  const out: QueryRunSelector = { kind: "query", mode: sel.mode };
  if (sel.namePattern !== undefined) out.namePattern = sel.namePattern as string;
  if (sel.tags !== undefined) out.tags = sel.tags as string[];
  if (sel.n !== undefined) out.n = sel.n as number;
  return out;
}

function resolveRuns(spec: CairnSpec): { runIds?: string[]; runSelector?: RunSelector } {
  if (!spec.runs) return {};
  const { ids, selector } = spec.runs;
  if (ids !== undefined && selector !== undefined) {
    throw new CairnBlockError("runs: specify only one of `ids` or `selector`, not both");
  }
  if (ids !== undefined) {
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) {
      throw new CairnBlockError("runs.ids must be a list of run-id strings");
    }
    return { runIds: ids as string[] };
  }
  if (selector !== undefined) {
    if (typeof selector !== "object" || selector === null) {
      throw new CairnBlockError("runs.selector must be a mapping");
    }
    return { runSelector: validateRunSelector(selector) };
  }
  return {};
}

/** Build one card's AddCardSelection from its spec entry + the block's resolved runIds/metricIndex. */
function selectionForCard(c: CairnCardInput, index: number, metricIndex: MetricIndex, runIds: string[]): AddCardSelection {
  if (c.series !== undefined) {
    if (!Array.isArray(c.series)) throw new CairnBlockError(`cards[${index}].series must be a list`);
    if (typeof c.type !== "string" || c.type.length === 0) {
      throw new CairnBlockError(`cards[${index}]: an explicit \`series\` overlay requires \`type\``);
    }
    const series: ComparisonSeriesRef[] = c.series.map((s, i) => {
      if (typeof s !== "object" || s === null) {
        throw new CairnBlockError(`cards[${index}].series[${i}] must be a mapping`);
      }
      const r = s as Record<string, unknown>;
      if (typeof r.runId !== "string" || typeof r.name !== "string") {
        throw new CairnBlockError(`cards[${index}].series[${i}] must have string \`runId\` and \`name\``);
      }
      return { runId: r.runId, name: r.name, context_hash: typeof r.context_hash === "string" ? r.context_hash : "" };
    });
    return { kind: "manual-series", object_type: c.type, series };
  }

  if (c.metric === undefined) {
    // No metric, no explicit series → a workspace-level multi-run card.
    if (typeof c.type !== "string" || !isMultiRunCardType(c.type)) {
      throw new CairnBlockError(
        `cards[${index}]: specify a \`metric\`, an explicit \`series\`, or a multi-run \`type\` (one of parallel/scatter/bar/tile)`,
      );
    }
    const cardType: MultiRunCardType = c.type;
    return {
      kind: "multi-run",
      cardType,
      name: MULTI_RUN_CARD_LABELS[cardType],
      runs: runIds.map((runId) => ({ runId, context_hash: "" })),
    };
  }

  if (typeof c.metric !== "string" || c.metric.length === 0) {
    throw new CairnBlockError(`cards[${index}].metric must be a non-empty string`);
  }
  const metric = c.metric;

  let objectType: string;
  if (c.type !== undefined) {
    if (typeof c.type !== "string" || c.type.length === 0) {
      throw new CairnBlockError(`cards[${index}].type must be a non-empty string`);
    }
    objectType = c.type;
  } else {
    const matches = Array.from(metricIndex.values()).filter((e) => e.name === metric);
    if (matches.length === 0) {
      throw new CairnBlockError(
        `cards[${index}]: cannot infer \`type\` for metric "${metric}" — no matching sequence found on this block's runs; specify \`type\` explicitly`,
      );
    }
    if (matches.length > 1) {
      const types = matches.map((m) => m.object_type).join(", ");
      throw new CairnBlockError(
        `cards[${index}]: metric "${metric}" is ambiguous (found as ${types}) — specify \`type\` explicitly`,
      );
    }
    objectType = matches[0]!.object_type;
  }

  // Enrich with real context_hash where the metricIndex has data for this
  // (metric, type, run) combo; otherwise fall back to "" (no context) for
  // every block runId so the card still renders (e.g. sequences not yet
  // fetched, or a metric that doesn't exist on every run).
  const known = metricIndex.get(`${metric}::${objectType}`);
  const knownByRun = new Map((known?.runs ?? []).map((r) => [r.runId, r.context_hash]));
  const runs = runIds.map((runId) => ({ runId, context_hash: knownByRun.get(runId) ?? "" }));

  return { kind: "series", name: metric, object_type: objectType, runs };
}

/**
 * Compile a validated `CairnSpec` into a `CardsBlock` + inline settings map.
 * `metricIndex` should already be scoped to the block's *resolved* runIds
 * (static `runs.ids`, or the live-resolved ids of `runs.selector` — see the
 * ```cairn render component, which does the resolution before calling this).
 *
 * `opts.resolvedRunIds`, when given, is the live-resolved run id set for a
 * `runs.selector` block (computed by the caller via
 * `useRunSelectorResolution` — this function stays pure and does no
 * resolution itself). It's only consulted when the spec uses `runs.selector`;
 * a static `runs.ids` block always uses its own ids verbatim.
 */
export function compileCairnBlock(
  spec: CairnSpec,
  metricIndex: MetricIndex,
  opts?: { id?: string; resolvedRunIds?: string[] },
): CompiledCairnBlock {
  const { runIds, runSelector } = resolveRuns(spec);
  const effectiveRunIds = runIds ?? (runSelector ? (opts?.resolvedRunIds ?? []) : []);

  const cards: ComparisonCard[] = [];
  const settings: Record<string, unknown> = {};
  (spec.cards ?? []).forEach((c, i) => {
    if (typeof c !== "object" || c === null) {
      throw new CairnBlockError(`cards[${i}] must be a mapping`);
    }
    const sel = selectionForCard(c, i, metricIndex, effectiveRunIds);
    const card = cardFromSpec(sel);
    cards.push(card);
    if (c.settings !== undefined) {
      if (typeof c.settings !== "object" || c.settings === null) {
        throw new CairnBlockError(`cards[${i}].settings must be a mapping`);
      }
      settings[card.id] = c.settings;
    }
  });

  const block: CardsBlock = {
    id: opts?.id ?? spec.id ?? newId(),
    type: "cards",
    ...(spec.title !== undefined ? { title: spec.title } : {}),
    ...(runSelector ? { runSelector } : { runIds: effectiveRunIds }),
    cards,
  };
  return { block, settings };
}

/** True when every series entry shares one metric name (the precondition for the compact `metric:` form). */
function seriesShareOneName(card: ComparisonCard): string | null {
  if (card.series.length === 0) return null;
  const names = new Set(card.series.map((s) => s.name));
  return names.size === 1 ? card.series[0]!.name : null;
}

/**
 * Serialize a `CardsBlock` (+ its inline settings map) to a ```cairn spec —
 * the inverse of `parseCairnSpec` + `compileCairnBlock`. Prefers the compact
 * `metric:`/`type:` forms when they round-trip losslessly (single metric
 * name; for a static run set, series covers exactly the block's runIds), and
 * falls back to the fully-explicit `series:` (manual-series) form otherwise
 * — which is *always* lossless, since `cardFromSpec`'s manual-series branch
 * copies `series` verbatim.
 */
export function serializeCairnSpec(block: CardsBlock, settingsByCardId: Record<string, unknown> = {}): CairnSpec {
  const doc: CairnSpec = { id: block.id };

  if (block.runSelector && block.runSelector.kind === "query") {
    const sel = block.runSelector;
    const selectorOut: CairnRunsSelectorInput = { mode: sel.mode };
    if (sel.namePattern !== undefined) selectorOut.namePattern = sel.namePattern;
    if (sel.tags !== undefined) selectorOut.tags = sel.tags;
    if (sel.n !== undefined) selectorOut.n = sel.n;
    doc.runs = { selector: selectorOut };
  } else {
    doc.runs = { ids: block.runIds ?? [] };
  }
  if (block.title !== undefined) doc.title = block.title;

  const staticRunIdSet = block.runSelector ? null : new Set(block.runIds ?? []);

  doc.cards = block.cards.map((card): CairnCardInput => {
    const cardSettings = settingsByCardId[card.id];
    const settingsField = cardSettings !== undefined ? { settings: cardSettings } : {};

    if (isMultiRunCardType(card.type)) {
      return { type: card.type, ...settingsField };
    }

    const name = seriesShareOneName(card);
    const seriesRunIds = new Set(card.series.map((s) => s.runId));
    const coversBlockRuns =
      staticRunIdSet === null || (seriesRunIds.size === staticRunIdSet.size && [...seriesRunIds].every((id) => staticRunIdSet.has(id)));

    if (name !== null && coversBlockRuns) {
      return { metric: name, type: card.type, ...settingsField };
    }

    return {
      type: card.type,
      series: card.series.map((s) => ({ runId: s.runId, name: s.name, context_hash: s.context_hash })),
      ...settingsField,
    };
  });

  return doc;
}

/** Render a `CairnSpec` (as produced by `serializeCairnSpec`) to YAML text — the literal ```cairn fence body. */
export function stringifyCairnSpec(spec: CairnSpec): string {
  return stringifyYamlDoc(spec, { lineWidth: 0 }).trimEnd();
}
