/**
 * Pure core of the live-updates poller — no React, no react-query.
 *
 * Cards used to keep themselves fresh by re-downloading their WHOLE sequence
 * every 2s (`useSequencesForRuns` + `refetchInterval`). On a compare page with
 * a dozen cards over a running run that is dozens of megabytes a minute and a
 * saturated server. Instead the app polls ONE cursor-based endpoint per live
 * run (`GET /api/runs/{id}/updates?since=<cursor>`) and appends the delta into
 * the sequences react-query already holds.
 *
 * Everything here is a pure function or the module-level cursor map, so it is
 * testable under `node --test` (`live-updates.test.ts`); the React glue lives
 * in `live-updates.tsx`.
 */

import type { SequencePoint, UpdatePoint } from "./types";

/** How many `more` pages one run may drain in a single poll cycle. */
export const MAX_PAGES_PER_CYCLE = 20;

// ---------------------------------------------------------------------------
// Cursor map — app-wide, keyed by run id, surviving route changes.
// ---------------------------------------------------------------------------

const cursorByRun = new Map<string, number>();

/**
 * Seed a run's cursor from a full sequence response.
 *
 * Only the FIRST sighting counts. A sequence fetched later returns the max
 * rowid of *its own* series, which can sit ahead of the poller's cursor —
 * adopting it would skip rows belonging to other, already-cached series. The
 * poller owns the cursor from then on; the worst case of an early seed is one
 * catch-up poll whose already-known points dedupe away.
 */
export function seedRunCursor(runId: string, cursor: number): void {
  if (!runId || !Number.isFinite(cursor)) return;
  if (!cursorByRun.has(runId)) cursorByRun.set(runId, cursor);
}

/** The cursor to resume from, or undefined when the run has never been read. */
export function getRunCursor(runId: string): number | undefined {
  return cursorByRun.get(runId);
}

/** Advance a run's cursor (monotonic — a stale response can never rewind it). */
export function setRunCursor(runId: string, cursor: number): void {
  const current = cursorByRun.get(runId);
  if (current === undefined || cursor > current) cursorByRun.set(runId, cursor);
}

/** Test-only: drop all cursors. */
export function resetRunCursors(): void {
  cursorByRun.clear();
}

// ---------------------------------------------------------------------------
// Cursor advancement
// ---------------------------------------------------------------------------

export interface CursorStep {
  cursor: number;
  /** True when the server had no more rows — stop paging this cycle. */
  done: boolean;
}

/**
 * Fold one `/updates` response into the run's cursor. `more` means the
 * server's LIMIT was hit and another page should be pulled immediately.
 */
export function advanceCursor(
  since: number,
  res: { cursor: number; more?: boolean },
): CursorStep {
  const cursor = Number.isFinite(res.cursor) && res.cursor > since ? res.cursor : since;
  return { cursor, done: !res.more };
}

// ---------------------------------------------------------------------------
// Run selection
// ---------------------------------------------------------------------------

export interface RunCandidate {
  runId: string;
  /** At least one mounted component is observing a sequence of this run. */
  hasActiveSequenceObserver: boolean;
  /** Latest known run status; null/undefined when nothing has told us yet. */
  status: string | null | undefined;
  /** Resume cursor, or undefined when no sequence of this run was ever read. */
  cursor: number | undefined;
}

/**
 * Poll a run only when something on screen is showing its sequences, it is
 * (or might still be) running, and we know where to resume from. An unknown
 * status counts as live: the run detail query may simply not have landed yet,
 * and the first `/updates` response tells us the truth.
 */
export function shouldPollRun(c: RunCandidate): boolean {
  if (!c.runId) return false;
  if (!c.hasActiveSequenceObserver) return false;
  if (c.cursor === undefined) return false;
  return c.status == null || c.status === "running";
}

export function selectRunsToPoll(candidates: readonly RunCandidate[]): string[] {
  return candidates.filter(shouldPollRun).map((c) => c.runId);
}

// ---------------------------------------------------------------------------
// Query-key routing
// ---------------------------------------------------------------------------

/** Sentinel for a key slot we cannot read — never equal to a real hash. */
export const UNROUTABLE = "\u0000unroutable";

/**
 * The context identity carried by a `["sequence", runId, name, opts]` key.
 *
 * Call sites spell that fourth element three ways: a bare context hash
 * (`qk.sequence(rid, name, m.context_hash)`), the empty string for "no
 * context", and an options object (`{ context: hash | undefined }`). All three
 * collapse to the same hash string here. Anything else (e.g. the synthetic
 * "last-summary" key in ComparisonOverviewTab, which has its own queryFn)
 * returns `UNROUTABLE`, which never matches a real point — those queries are
 * left alone.
 */
export function keyContextHash(part: unknown): string {
  if (part === undefined || part === null) return "";
  if (typeof part === "string") return part;
  if (typeof part === "object") {
    const ctx = (part as { context?: unknown }).context;
    if (ctx === undefined || ctx === null) return "";
    if (typeof ctx === "string") return ctx;
  }
  return UNROUTABLE;
}

/** Routing key for a (name, context hash) series. */
export function seriesKey(name: string, contextHash: string): string {
  return `${name}\u0000${contextHash}`;
}

/** The series a cached `["sequence", ...]` query key belongs to, if any. */
export function seriesKeyOfQueryKey(queryKey: readonly unknown[]): string | null {
  const [, , name, opts] = queryKey;
  if (typeof name !== "string") return null;
  return seriesKey(name, keyContextHash(opts));
}

/** Group a `/updates` payload by the series each point belongs to. */
export function groupPointsBySeries(
  points: readonly UpdatePoint[],
): Map<string, UpdatePoint[]> {
  const out = new Map<string, UpdatePoint[]>();
  for (const p of points) {
    const key = seriesKey(p.name, p.context_hash ?? "");
    const bucket = out.get(key);
    if (bucket) bucket.push(p);
    else out.set(key, [p]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Point merging
// ---------------------------------------------------------------------------

/** Drop the routing fields so a cached point keeps the sequence-endpoint shape. */
function toSequencePoint(p: UpdatePoint): SequencePoint {
  const { name: _name, context_hash: _ctx, ...point } = p;
  return point;
}

/**
 * Append `incoming` to `points`, deduped by (step, context) and kept sorted by
 * step. Returns `points` UNCHANGED (same reference) when the point is already
 * there, so callers can skip a cache write and the re-render it would cause.
 *
 * Within one cached sequence the name and context hash are fixed by the query
 * key, so (step, context) is exactly the server's (name, step, context_hash)
 * primary key restricted to that series.
 */
export function appendDedup(
  points: readonly SequencePoint[],
  incoming: UpdatePoint | SequencePoint,
): SequencePoint[] {
  const point = "context_hash" in incoming
    ? toSequencePoint(incoming as UpdatePoint)
    : (incoming as SequencePoint);
  const ctx = point.context ?? null;

  const last = points[points.length - 1];
  // The common case by far: a live run appends strictly increasing steps.
  if (last === undefined || point.step > last.step) return [...points, point];

  // Out-of-order or backfilled delta: walk back to the insertion point,
  // checking every same-step row on the way (steps are contiguous when equal,
  // so this sees them all) and landing after the last of them.
  let insertAt = 0;
  let placed = false;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!;
    if (p.step > point.step) continue;
    if (!placed) {
      insertAt = i + 1;
      placed = true;
    }
    if (p.step < point.step) break;
    if ((p.context ?? null) === ctx) return points as SequencePoint[]; // already have it
  }
  const next = points.slice();
  next.splice(insertAt, 0, point);
  return next;
}

/** Fold a whole batch in, returning `points` unchanged when nothing is new. */
export function appendAllDedup(
  points: readonly SequencePoint[],
  incoming: readonly UpdatePoint[],
): SequencePoint[] {
  let out = points;
  for (const p of incoming) out = appendDedup(out, p);
  return out as SequencePoint[];
}
