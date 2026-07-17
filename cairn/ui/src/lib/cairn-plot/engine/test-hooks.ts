/**
 * Fault-injection test hook (browser harness only) — mirrors `device.ts`'s
 * `?forceWebGL2` URL-param convention (same `URLSearchParams` check, same
 * "current page URL, read fresh on every call" semantics — no memoization,
 * so a test can navigate/reload between assertions without stale state).
 *
 * When the page URL carries `?forceEngineFail`, `engine/pool.ts`'s
 * `activateEntry()` and `media-compare/GpuComparePane.tsx`'s device/surface
 * acquisition both throw synthetically instead of touching real GPU
 * resources — deterministically exercising the C1 hard-failure path (a
 * WebGL2 `getContext` returning `null` under real browser live-context
 * exhaustion, or any other non-context-lost GPU init failure) without
 * needing to actually exhaust the browser's live WebGL2 context cap.
 *
 * See `renderers/__tests__/engine-fallback.browser.ts` for the fault
 * injection + legacy-fallback assertions this hook exists for.
 */
export function forceEngineFailRequested(): boolean {
  if (typeof location === "undefined") return false;
  try {
    return new URLSearchParams(location.search).has("forceEngineFail");
  } catch {
    return false;
  }
}
