/**
 * Bounded LRU registry of "live" (context-holding) `useScene3D` instances —
 * WS-3DR2.
 *
 * The browser enforces a hard ceiling on simultaneously live WebGL contexts
 * (observable as "WARNING: Too many active WebGL contexts. Oldest context
 * will be lost." in the console once exceeded, followed by "THREE.
 * WebGLRenderer: Context Lost." on whichever context the browser evicts).
 * With many 3D cards/panes open — especially compare modes, which each mount
 * TWO extra hidden offscreen viewers per pane (`OffscreenComparePanes`) — the
 * app can trivially exceed that ceiling on its own, well before the user does
 * anything unusual.
 *
 * `use-scene3d.ts` already renders on-demand (no persistent rAF loop) and,
 * as of WS-3DR2, auto-*parks* a viewer shortly after it goes idle: it
 * snapshots the canvas to a cached image and releases its WebGL context
 * (`renderer.dispose()` + `forceContextLoss()`), showing the cached image in
 * place of the live canvas until the next interaction/data/color/size change
 * re-acquires a fresh context and re-renders. That alone keeps STEADY-STATE
 * live-context count low — but a BURST (e.g. opening a dozen 3D cards at
 * once, all still within their idle grace window) can still momentarily
 * exceed the budget before any of them have had a chance to park.
 *
 * This module is the safety net for that burst case: every `useScene3D`
 * instance registers itself here the moment it acquires a live context
 * (`poolAcquire`) and re-registers on every render (`poolTouch`, keeping it
 * at the most-recently-used end). Whenever the live set exceeds `MAX_LIVE_
 * CONTEXTS`, the LEAST-recently-used entries are parked immediately —
 * synchronously, at acquire time — regardless of their own idle timers, so
 * the total live-context count is bounded at all times, not just eventually.
 *
 * Actively-orbited/zoomed panes stay safe from eviction under normal use:
 * every camera "change" re-renders (see `use-scene3d.ts`'s `onChange`
 * handler), which calls `poolTouch`, keeping that entry at the MRU end —
 * eviction only reaches into genuinely idle entries first.
 *
 * Framework-free (like `camera-sync.ts`) so it has zero React overhead and
 * is trivially unit-testable.
 */

/** Safe default: comfortably under every major browser's practical live
 *  WebGL-context ceiling (commonly ~16, lower on constrained/integrated
 *  GPUs), while still leaving headroom for the transient doubling a single
 *  compare-mode pane needs (its own live view + one offscreen mirror). */
export const MAX_LIVE_CONTEXTS = 8;

interface PoolEntry {
  /** Releases this entry's WebGL context (snapshot + dispose + unregister).
   *  Provided by `use-scene3d.ts`'s `park()`; MUST be safe to call even if
   *  the entry was already parked for some other reason (idempotent). */
  park: () => void;
}

/** Insertion order doubles as LRU order: re-`set`ting an existing key moves
 *  it to the end (most-recently-used); the least-recently-used entry is
 *  always `.keys().next().value`. */
const live = new Map<string, PoolEntry>();

function evictExcess(protectedId?: string): void {
  while (live.size > MAX_LIVE_CONTEXTS) {
    const oldestKey = live.keys().next().value;
    if (oldestKey === undefined || oldestKey === protectedId) break;
    const entry = live.get(oldestKey);
    live.delete(oldestKey);
    entry?.park();
  }
}

/**
 * Registers `id` as holding a live context, moving it to the MRU end.
 * Synchronously parks the least-recently-used entries beyond `MAX_LIVE_
 * CONTEXTS` (never `id` itself — a just-acquired context is never
 * immediately re-evicted).
 */
export function poolAcquire(id: string, park: () => void): void {
  live.delete(id);
  live.set(id, { park });
  evictExcess(id);
}

/** Marks `id` as just-used, moving it to the MRU end (no-op if `id` isn't
 *  currently registered — e.g. called from a render that happens while
 *  parked, before `poolAcquire` runs). */
export function poolTouch(id: string): void {
  const entry = live.get(id);
  if (!entry) return;
  live.delete(id);
  live.set(id, entry);
}

/** Unregisters `id` (called when a viewer parks itself, e.g. after its own
 *  idle timeout, or unmounts). No-op if not registered. */
export function poolRelease(id: string): void {
  live.delete(id);
}

/** Current live-context count — exposed for tests/diagnostics only. */
export function poolLiveCount(): number {
  return live.size;
}
