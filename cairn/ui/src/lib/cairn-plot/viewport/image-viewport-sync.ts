/**
 * Framework-free live viewport-sync bus for image panes — the IMAGE mirror of
 * `three/camera-sync.ts`'s 3D camera bus. One `EventTarget` per `groupId`. A
 * pane publishes `{zoom, pan}` (the image `Viewport` — see
 * `hooks/use-image-viewport.ts`) whenever ITS OWN `onViewportChange` fires
 * (a genuine local wheel-zoom or drag-pan gesture); every other pane
 * subscribed to the same group applies the incoming state to its own
 * viewport. There is no persistent rAF loop — state is only pushed on a
 * genuine local change and applied synchronously by subscribers.
 *
 * Unlike the 3D bus, image panes have no imperative side-channel (no
 * OrbitControls "change" event fired by a programmatic camera move) — the
 * viewport is a plain React-controlled `{zoom,pan}` value, so a SINGLE echo
 * guard suffices:
 *
 *   - Each publish carries the publishing pane's `sourceId`; a subscriber
 *     ignores events whose `sourceId` matches its own, so a pane never reacts
 *     to its own broadcast. Callers (the standalone adapters in
 *     `plot-renderers.tsx`) only ever call `publishImageViewportState` from
 *     their `onViewportChange` handler (a genuine local gesture) — never from
 *     an effect watching the viewport state itself — so a remote update
 *     applied via `setViewport` is never re-published, and no second
 *     "suppress while applying" guard (à la `use-scene3d.ts`'s
 *     `applyingRemoteRef`) is needed.
 *
 * Intentionally React-free so it is reusable by any future image-adjacent
 * renderer without pulling React into the dependency graph, and is
 * unit-testable without a DOM/React harness. Lives under `viewport/` (not
 * `three/`) since it has nothing to do with three.js and is reached by the
 * CORE bundle (image panes are core, not an addon) — it must stay tiny and
 * dependency-free so pulling it into `core.iife.js` never trips the bundle
 * guard.
 */

export interface ImageSyncViewport {
  zoom: number;
  pan: { x: number; y: number };
}

interface ViewportStateDetail {
  state: ImageSyncViewport;
  sourceId: string;
}

const EVENT_TYPE = "image-viewport-state";

const buses = new Map<string, EventTarget>();
const lastStates = new Map<string, ImageSyncViewport>();

function busFor(groupId: string): EventTarget {
  let bus = buses.get(groupId);
  if (!bus) {
    bus = new EventTarget();
    buses.set(groupId, bus);
  }
  return bus;
}

/** Broadcasts `state` to every other subscriber of `groupId`. */
export function publishImageViewportState(
  groupId: string,
  sourceId: string,
  state: ImageSyncViewport,
): void {
  lastStates.set(groupId, state);
  busFor(groupId).dispatchEvent(
    new CustomEvent<ViewportStateDetail>(EVENT_TYPE, { detail: { state, sourceId } }),
  );
}

/**
 * The most recent viewport published on `groupId`, or `undefined` if none has
 * been published yet. Lets a pane that JOINS a group late (mounts after
 * peers have already zoomed/panned) adopt the current viewport immediately
 * instead of starting back at `{zoom:1, pan:{0,0}}` — mirrors
 * `three/camera-sync.ts`'s `getLastCameraState`.
 */
export function getLastImageViewportState(groupId: string): ImageSyncViewport | undefined {
  return lastStates.get(groupId);
}

/**
 * Subscribes to viewport broadcasts on `groupId`, ignoring the caller's own
 * publishes (matched by `sourceId`). Returns an unsubscribe function.
 */
export function subscribeImageViewportState(
  groupId: string,
  sourceId: string,
  onState: (state: ImageSyncViewport) => void,
): () => void {
  const bus = busFor(groupId);
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<ViewportStateDetail>).detail;
    if (detail.sourceId === sourceId) return;
    onState(detail.state);
  };
  bus.addEventListener(EVENT_TYPE, handler);
  return () => bus.removeEventListener(EVENT_TYPE, handler);
}

/** Generates a per-pane-instance id for the echo guard (§ above). */
export function makeImageViewportSyncSourceId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
