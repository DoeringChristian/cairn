import { createContext, useContext, useId } from "react";

/**
 * Live camera-sync group shared by every sync-enabled 3D card mounted under
 * one provider (CardGrid / ComparePage): all such cards' panes mirror each
 * other's orbit/zoom/pan in real time. See
 * `cairn-plot/three/camera-sync.ts` for the underlying framework-free
 * pub/sub bus that actually carries the position/target/zoom updates.
 */
export interface CameraSyncGroup {
  groupId: string;
}

export const CameraSyncContext = createContext<CameraSyncGroup | null>(null);

/**
 * Provider value to mount at `<CameraSyncContext.Provider value={...}>`.
 * One constant, reused by both CardGrid and ComparePage, so every 3D card on
 * either page shares a single implicit sync group (per the spec's "one
 * implicit group per provider" design decision).
 */
export const DEFAULT_CAMERA_SYNC_GROUP: CameraSyncGroup = { groupId: "default" };

export function useCameraSyncHasProvider(): boolean {
  return useContext(CameraSyncContext) !== null;
}

/**
 * Resolves the live camera-sync group id for a 3D card, following the same
 * ctx-??-local-fallback pattern as `useRunSelection` (see
 * `lib/use-run-selection.ts`): under a `CameraSyncContext` provider (CardGrid
 * / ComparePage), every sync-enabled 3D card on the page shares one group.
 * Standalone (no provider), a per-hook-call id keeps a single card's own
 * panes synced with each other without leaking into other card instances.
 *
 * Call once per card (not per pane) and thread the result to every pane's
 * viewer as `sync={groupId ? { groupId } : null}` — returns `null` when
 * `enabled` is false, so disabled cards never subscribe to the bus.
 */
export function useCameraSync(enabled: boolean): string | null {
  const ctx = useContext(CameraSyncContext);
  const localId = useId();
  if (!enabled) return null;
  return ctx?.groupId ?? `local-${localId}`;
}
