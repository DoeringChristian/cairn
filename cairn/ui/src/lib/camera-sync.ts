import { createContext, useContext, useId } from "react";

/**
 * Live camera-sync group for a 3D card's OWN panes to mirror each other's
 * orbit/zoom/pan in real time. See `cairn-plot/three/camera-sync.ts` for the
 * underlying framework-free pub/sub bus that actually carries the
 * position/target/zoom updates.
 *
 * WS-VCP fix 1 SCOPE CORRECTION: the media cards' "Sync 3D views"
 * toggle now defaults to ON (see the four 3D `defaultXSettings()`
 * functions) — this file's ORIGINAL design (pre-WS-VCP) had every
 * sync-enabled 3D card mounted under one `CameraSyncContext` provider
 * (CardGrid/ComparePage) share a SINGLE implicit page-wide group
 * (`DEFAULT_CAMERA_SYNC_GROUP`), which was a reasonable behavior when the
 * toggle defaulted OFF (a user turning it on for 2+ cards was a deliberate
 * "link these cards" action). Once the toggle defaults ON, that same
 * page-wide grouping would silently link EVERY 3D card on the page by
 * default — never the intent ("only all the 3D views in a SINGLE card
 * should be synced, not over the whole application"). `useCameraSync` below
 * therefore now ALWAYS resolves a group scoped to the calling card instance
 * (`useId()`), ignoring `CameraSyncContext` for that decision — a card's own
 * panes still sync with each other (Fix 1's actual intent), but two
 * different cards never do by default. `CameraSyncContext`/
 * `DEFAULT_CAMERA_SYNC_GROUP`/`useCameraSyncHasProvider` are kept (not
 * deleted) as the pre-existing page-wide-sync machinery/pub-sub
 * infrastructure for a future EXPLICIT cross-card opt-in control (none
 * exists in the UI today) to build on — they are simply not consulted by
 * the default per-card path anymore.
 */
export interface CameraSyncGroup {
  groupId: string;
}

export const CameraSyncContext = createContext<CameraSyncGroup | null>(null);

/**
 * Provider value historically mounted at `<CameraSyncContext.Provider
 * value={...}>` (CardGrid/ComparePage) for page-wide sync. No longer read by
 * `useCameraSync`'s default per-card resolution (see this file's header
 * comment) — kept for a future explicit cross-card opt-in.
 */
export const DEFAULT_CAMERA_SYNC_GROUP: CameraSyncGroup = { groupId: "default" };

export function useCameraSyncHasProvider(): boolean {
  return useContext(CameraSyncContext) !== null;
}

/**
 * Resolves the live camera-sync group id for a 3D card — ALWAYS scoped to
 * THIS card instance (`useId()`), so a card's own panes (multi-run compare)
 * mirror each other's orbit/zoom/pan, but two different media card
 * instances never sync with each other by default (WS-VCP fix 1 scope
 * correction — see this file's header comment). `useId()` returns a stable
 * value for the component instance's lifetime, so every pane of one card
 * render pass gets the SAME group id (this hook is called ONCE per card, not
 * per pane) while a sibling card mounted alongside it gets a DIFFERENT id.
 *
 * Call once per card (not per pane) and thread the result to every pane's
 * viewer as `sync={groupId ? { groupId } : null}` — returns `null` when
 * `enabled` is false, so disabled cards never subscribe to the bus.
 */
export function useCameraSync(enabled: boolean): string | null {
  const localId = useId();
  if (!enabled) return null;
  return `card-${localId}`;
}
