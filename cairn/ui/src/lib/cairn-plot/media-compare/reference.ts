// ---------------------------------------------------------------------------
// Reference resolution — pure/data-only half of the media-compare reference
// machinery, extracted from ImageGalleryCard's baseline logic.
//
// The other half (react-query fetching of the reference sequence data) lives
// in card-kit (`components/card-kit/use-media-reference.ts`), which composes
// these pure functions. Together they are the "one hook/function family"
// spec-visual-compare.md calls for: cards must call this shared code, not
// keep a private per-card copy.
// ---------------------------------------------------------------------------

/** Minimal point shape needed to resolve an artifact at a step — matches
 *  api/types.SequencePoint's relevant fields without importing the API layer
 *  into cairn-plot (which stays app-agnostic). */
export interface StepArtifactPoint {
  step: number;
  artifact_hash?: string | null;
}

export type MissingArtifactMode = "nothing" | "last_available";

/**
 * Resolve the artifact hash to show at `targetStep` from a per-series step
 * map. Falls back to the most recent step at or before `targetStep` when
 * `mode !== "nothing"` (default: fall back). Moved verbatim from
 * ImageGalleryCard's `resolveArtifact` — this is now the ONLY implementation;
 * every artifact-at-step lookup in the image card (foreground image,
 * overlays, `series-same-step` reference, per-run `external` reference,
 * screenshot export) goes through this function.
 */
export function resolveArtifactAtStep<T extends StepArtifactPoint>(
  stepMap: Map<number, T>,
  targetStep: number,
  sortedSteps: number[],
  mode?: MissingArtifactMode,
): { hash: string | undefined; fallbackStep: number | null } {
  const exact = stepMap.get(targetStep);
  if (exact?.artifact_hash) return { hash: exact.artifact_hash, fallbackStep: null };
  if (mode === "nothing") return { hash: undefined, fallbackStep: null };
  for (let i = sortedSteps.length - 1; i >= 0; i--) {
    if (sortedSteps[i]! > targetStep) continue;
    const pt = stepMap.get(sortedSteps[i]!);
    if (pt?.artifact_hash) {
      return { hash: pt.artifact_hash, fallbackStep: pt.step };
    }
  }
  return { hash: undefined, fallbackStep: null };
}

/**
 * Resolve a reference by *position* (not step-matching): the Nth point of a
 * separately-tracked reference series, clamped to its own bounds. This is
 * the "external, global" resolution path — a single shared reference image
 * that tracks the step slider's *index*, not the foreground series' step
 * values (the reference series may have a different, unrelated step axis).
 */
export function resolveGlobalPositionalReference<T extends StepArtifactPoint>(
  points: T[],
  safeIdx: number,
): string | undefined {
  if (points.length === 0) return undefined;
  return points[Math.min(safeIdx, Math.max(0, points.length - 1))]?.artifact_hash ?? undefined;
}

// ---------------------------------------------------------------------------
// Reference selection — the {source} contract from spec-visual-compare.md.
// ---------------------------------------------------------------------------

/**
 * Where the reference (baseline) comes from:
 *  - "series-same-step": another series already loaded on the card (picked
 *    by index), evaluated at the SAME step as the foreground — one shared
 *    reference broadcast to every pane. Covers today's `baselineIndex`.
 *  - "fixed-step": like "series-same-step", but pinned to an explicit step
 *    instead of tracking the live step slider. Covers the (currently
 *    unwired) `perRunBaselineStep` field — modeled here so a future UI can
 *    turn it on without a second resolution implementation.
 *  - "external": a series NOT among the card's loaded series (a dragged-in
 *    tag / different metric name), resolved with an explicit `scope`:
 *      - "global": positional (`resolveGlobalPositionalReference`) — one
 *        shared reference image for every pane.
 *      - "per-run": each run fetches its own copy of the same tag name and
 *        resolves it step-matched (`resolveArtifactAtStep`) — a per-pane
 *        reference.
 */
export type ReferenceSource = "series-same-step" | "fixed-step" | "external";

export interface ReferenceSelection {
  source: ReferenceSource;
  /** source === "series-same-step" | "fixed-step": index into the card's own series list. */
  seriesIndex?: number;
  /** source === "fixed-step": resolve at this step instead of the live current step. */
  fixedStep?: number;
  /** source === "external": which scope resolves the tag (see ReferenceSource docs). */
  externalScope?: "global" | "per-run";
}
