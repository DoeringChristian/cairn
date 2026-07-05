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
 *  compare-mode pane needs (its own live view + one offscreen mirror).
 *
 *  WS-3DR2 fix round: raised from 8 → 16. 8 was too low for a 5+ pane
 *  synced split/diff compare — each pane mounts TWO offscreen contexts
 *  (primary + reference mirror), so a 5-pane compare alone wants 10; with
 *  "Sync 3D views" on, a single orbit fans out to every pane, and every
 *  subscriber's `requestRender` → `poolAcquire` fought over 8 slots,
 *  evicting panes that were themselves mid-render this same tick. */
export const MAX_LIVE_CONTEXTS = 16;

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

/**
 * IDs touched (via `poolAcquire`/`poolTouch`) during the CURRENT frame/tick
 * — cleared on the next animation frame (or microtask, if `rAF` isn't
 * available, e.g. tests/SSR). This is deliberately a SEPARATE notion from
 * "MRU end of `live`": a synced-orbit "storm" touches many panes in rapid
 * synchronous succession within the same tick, and plain MRU order still
 * ranks the first-touched-this-tick entries as "older" than the last-
 * touched-this-tick ones — which let `evictExcess` evict a pane that had
 * JUST been touched (re-acquired/re-rendered) moments earlier in the exact
 * same storm, starving it before its restore→render→snapshot cycle could
 * finish. Entries in this set are protected from eviction regardless of
 * their position in the `live` LRU order; only genuinely-idle (untouched
 * this tick) entries are evicted first.
 */
const touchedThisFrame = new Set<string>();
let clearTouchedScheduled = false;

function scheduleClearTouched(): void {
  if (clearTouchedScheduled) return;
  clearTouchedScheduled = true;
  const clear = () => {
    touchedThisFrame.clear();
    clearTouchedScheduled = false;
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(clear);
  } else {
    queueMicrotask(clear);
  }
}

function markTouched(id: string): void {
  touchedThisFrame.add(id);
  scheduleClearTouched();
}

function evictExcess(protectedId?: string): void {
  if (live.size <= MAX_LIVE_CONTEXTS) return;
  // First pass: only evict entries that are genuinely idle (not touched
  // this frame/tick) — preserves LRU semantics among idle entries via
  // `live`'s iteration order (oldest-first).
  for (const key of Array.from(live.keys())) {
    if (live.size <= MAX_LIVE_CONTEXTS) break;
    if (key === protectedId || touchedThisFrame.has(key)) continue;
    const entry = live.get(key);
    live.delete(key);
    entry?.park();
  }
  // If STILL over cap, every remaining (unprotected) entry was touched this
  // same frame/tick — a sync storm across more panes than the hard cap.
  // Evicting one of them here would re-introduce exactly the mutual-
  // eviction churn this set exists to prevent (parking a pane mid-render),
  // so we deliberately allow going over the cap for this one frame rather
  // than starving an actively-updating pane. The next tick's touch/acquire
  // will retry once `touchedThisFrame` clears.
}

/**
 * Registers `id` as holding a live context, moving it to the MRU end and
 * marking it touched-this-frame (protecting it from this call's own
 * eviction pass and any other eviction pass in the same tick).
 * Synchronously parks the least-recently-used, NOT-touched-this-frame
 * entries beyond `MAX_LIVE_CONTEXTS` (never `id` itself — a just-acquired
 * context is never immediately re-evicted).
 */
export function poolAcquire(id: string, park: () => void): void {
  live.delete(id);
  live.set(id, { park });
  markTouched(id);
  evictExcess(id);
}

/** Marks `id` as just-used, moving it to the MRU end and marking it
 *  touched-this-frame (no-op if `id` isn't currently registered — e.g.
 *  called from a render that happens while parked, before `poolAcquire`
 *  runs). */
export function poolTouch(id: string): void {
  const entry = live.get(id);
  if (!entry) return;
  live.delete(id);
  live.set(id, entry);
  markTouched(id);
}

/** Unregisters `id` (called when a viewer parks itself, e.g. after its own
 *  idle timeout, or unmounts). No-op if not registered. */
export function poolRelease(id: string): void {
  live.delete(id);
  touchedThisFrame.delete(id);
}

/** Current live-context count — exposed for tests/diagnostics only. */
export function poolLiveCount(): number {
  return live.size;
}
