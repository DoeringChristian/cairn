/**
 * Fault-injection test hook (browser harness only) — a `?forceEngineFail`
 * URL-param convention (`URLSearchParams` check, "current page URL, read
 * fresh on every call" semantics — no memoization, so a test can
 * navigate/reload between assertions without stale state).
 *
 * When the page URL carries `?forceEngineFail`, `engine/pool.ts`'s
 * `activateEntry()` and `media-compare/GpuComparePane.tsx`'s device/surface
 * acquisition both throw synthetically instead of touching real GPU
 * resources — deterministically exercising the C1 hard-failure path (any
 * GPU init failure, e.g. driver/context exhaustion) without needing to
 * actually exhaust a real GPU resource cap. This is also the mechanism used
 * to exercise the capability-gate + C1-error-boundary fallback to the
 * legacy CPU pane (see `plot-renderers.tsx`'s `resolveImageRenderer`).
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
