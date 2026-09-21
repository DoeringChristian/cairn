/**
 * WS-SCHEMA: the single canonical source of truth for cairn's card-type
 * vocabulary, and the schema-root types for the ```cairn dialect (and, via
 * `docs/schemas/cairn-card-spec.schema.json`, the Python side).
 *
 * Before this module there were **three independent "card type" lists** —
 * see docs/superpowers/specs/2026-07-07-notebook-python-and-embed.md §3.1:
 *
 *   1. The closed `ComparisonCard.type` union (16 members) in
 *      `lib/comparisons/types.ts`.
 *   2. The permissive runtime guard `isComparisonCard` (same file), which
 *      deliberately accepts *any* non-empty `type` string rather than a
 *      hardcoded set — see that function's doc for why (forward-compat: a
 *      newly-added card type must not make already-persisted comparisons
 *      vanish). Kept permissive here too, unchanged.
 *   3. The `CardRenderer` switch on `metric.object_type`
 *      (components/CardRenderer.tsx), which additionally handles
 *      `table`/`html`/`markdown`/`artifact` — types absent from
 *      the closed union above.
 *
 * `CARD_TYPES` below is the superset (21 members) all three now derive
 * from: `ComparisonCard.type` is typed as `CardType` (this file);
 * `CardRenderer` carries a compile-time exhaustiveness check tying its
 * switch back to this same list. It derives the per-metric case set as
 * `SeriesCardType = Exclude<CardType, MultiRunCardType>` and asserts the
 * switch's `default` branch narrows to `never` (see the never-guard in
 * components/CardRenderer.tsx), so there is no hand-maintained mirror of
 * the `case` labels. This keeps `cardFromSpec`/`CardRenderer`/
 * `compileCairnBlock` behavior byte-identical — this is a type-level
 * reconciliation, not a runtime one.
 *
 * This module is also the schema root read by
 * `scripts/gen-card-spec-schema.ts` (via `ts-json-schema-generator`) to
 * produce `docs/schemas/cairn-card-spec.schema.json`, which
 * `cairn/sdk/card_spec.py` mirrors as a pydantic model (see that file's
 * conformance test). Python never re-implements `cardFromSpec` — it only
 * builds/validates specs against this shape.
 *
 * Deliberately composes existing types (`ComparisonCard`,
 * `ComparisonSeriesRef`, `RunSelector`) rather than redefining them.
 */

import type { ComparisonCard, ComparisonSeriesRef } from "../comparisons/types";
import type { RunSelector } from "../run-selector";

/**
 * Every card type `CardRenderer` knows how to render. Order: per-metric
 * "series" cards first (a single metric across N runs), then the
 * workspace-level "multi-run" cards (a set of runs, not one metric — see
 * `MULTI_RUN_CARD_TYPES` in lib/comparisons/types.ts), then the
 * renderer-only types that were never folded into the closed
 * `ComparisonCard.type` union before this reconciliation.
 */
export const CARD_TYPES = [
  // Per-metric "series" cards.
  "scalar",
  "image",
  "figure",
  "audio",
  "video",
  "histogram",
  "tensor",
  "text",
  "pointcloud",
  "mesh",
  "boxes3d",
  "volume",
  // Workspace-level "multi-run" cards.
  "parallel",
  "scatter",
  "bar",
  "tile",
  // Renderer-only types (CardRenderer.tsx's `metric.object_type` switch)
  // that predate this reconciliation without a `ComparisonCard.type` entry.
  "table",
  "html",
  "markdown",
  "artifact",
] as const;

export type CardType = (typeof CARD_TYPES)[number];

/** Strict membership check against the canonical list — see `isComparisonCard` (lib/comparisons/types.ts) for the deliberately-permissive runtime guard used on parse paths. */
export function isCardType(x: unknown): x is CardType {
  return typeof x === "string" && (CARD_TYPES as readonly string[]).includes(x);
}

/** = `ComparisonSeriesRef` (lib/comparisons/types.ts) — one (run, metric) binding for a card. */
export type SeriesRef = ComparisonSeriesRef;

/** = `RunSelector` (lib/run-selector.ts) — a dynamic run-set binding. */
export type RunSelectorSpec = RunSelector;

/** Any valid JSON value — used to keep per-card `settings` permissive (see `CardSettingsSpec`). */
export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };

/**
 * Per-card `settings` are an untyped side-channel today (`Record<cardId,
 * unknown>` — see `ReportPayload.cardSettings` in lib/reports/types.ts and
 * `CairnCardInput.settings` in lib/reports/cairn-block.ts). Rather than a
 * full discriminated union keyed by card type (which would require typing
 * every one of `lib/card-settings.ts`'s ~20 per-type interfaces up front),
 * this starts permissive with a few well-known keys and tightens over time
 * — see docs/superpowers/specs/2026-07-07-notebook-python-and-embed.md §3.2.
 */
export interface CardSettingsSpec {
  version?: number;
  yScale?: "linear" | "log";
  smoothing?: number;
  step?: number;
  [key: string]: JSONValue | undefined;
}

/**
 * The schema root for one card entry — `ComparisonCard` (id/type/series)
 * plus the optional inline `settings` blob the ```cairn dialect carries
 * (see `CairnCardInput.settings` in lib/reports/cairn-block.ts).
 */
export type CardSpec = ComparisonCard & { settings?: CardSettingsSpec };

/** A `runs:` block — static ids or a dynamic selector (mirrors `CairnRunsInput` in lib/reports/cairn-block.ts). */
export interface RunsSpec {
  ids?: string[];
  selector?: RunSelectorSpec;
}

/**
 * The ```cairn dialect's schema root. Mirrors `CairnSpec`
 * (lib/reports/cairn-block.ts), which remains the actual parser's input
 * type — this is its schema-generation counterpart, kept in sync by hand
 * (both are small and rarely change independently of each other).
 */
export interface CardsSpec {
  id?: string;
  runs?: RunsSpec;
  title?: string;
  cards?: CardSpec[];
}

/**
 * The `cairn.Report.publish()` payload shape (§3.3 of the design doc) — a
 * report's canonical markdown `source` plus create-route metadata (mirrors
 * `ReportCreate` in cairn/server/routes/reports.py). Not wired into any
 * runtime path yet (that's WS-PYAPI); included here so the JSON
 * Schema/pydantic model has a stable root for it ahead of that workstream.
 */
export interface ReportSpec {
  name: string;
  project?: string;
  source: string;
}

/**
 * Umbrella entry point for schema generation only — `scripts/gen-card-spec-schema.mjs`
 * generates the JSON Schema from THIS type so every card-spec root
 * (`CardsSpec`, `CardSpec`, `ReportSpec`, `CardType`, …) lands under one
 * deterministic `definitions` block with no degenerate wildcard entry.
 * Never constructed at runtime; it exists purely to anchor the generator.
 */
export interface CardSpecSchema {
  cardType: CardType;
  cardSpec: CardSpec;
  cardsSpec: CardsSpec;
  reportSpec: ReportSpec;
  seriesRef: SeriesRef;
  runSelector: RunSelectorSpec;
}
