/**
 * Framework-free live camera-sync bus for 3D viewers.
 *
 * One `EventTarget` per `groupId`. A viewer publishes `{position, target,
 * zoom}` whenever its OrbitControls fires "change"; every other viewer
 * subscribed to the same group applies the incoming state to its own
 * camera/controls. There is no persistent rAF loop — state is only pushed on
 * a genuine "change" event and applied synchronously by subscribers.
 *
 * Two echo guards prevent feedback loops:
 * 1. Each publish carries the publishing viewer's `sourceId`; a subscriber
 *    ignores events whose `sourceId` matches its own, so a viewer never
 *    reacts to its own broadcast.
 * 2. `use-scene3d.ts` additionally suppresses re-publishing while it is
 *    applying an incoming remote state, so the "change" event fired by that
 *    programmatic update (setting camera.position / controls.update()) can't
 *    ping back onto the bus.
 *
 * This module is intentionally React-free so it can be reused by any future
 * renderer (mesh/boxes/volume) without pulling React into the dependency
 * graph, and is unit-testable without a DOM/React harness.
 */

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
}

interface CameraStateDetail {
  state: CameraState;
  sourceId: string;
}

const EVENT_TYPE = "camera-state";

const buses = new Map<string, EventTarget>();

function busFor(groupId: string): EventTarget {
  let bus = buses.get(groupId);
  if (!bus) {
    bus = new EventTarget();
    buses.set(groupId, bus);
  }
  return bus;
}

/** Broadcasts `state` to every other subscriber of `groupId`. */
export function publishCameraState(groupId: string, sourceId: string, state: CameraState): void {
  busFor(groupId).dispatchEvent(
    new CustomEvent<CameraStateDetail>(EVENT_TYPE, { detail: { state, sourceId } }),
  );
}

/**
 * Subscribes to camera-state broadcasts on `groupId`, ignoring the caller's
 * own publishes (matched by `sourceId`). Returns an unsubscribe function.
 */
export function subscribeCameraState(
  groupId: string,
  sourceId: string,
  onState: (state: CameraState) => void,
): () => void {
  const bus = busFor(groupId);
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<CameraStateDetail>).detail;
    if (detail.sourceId === sourceId) return;
    onState(detail.state);
  };
  bus.addEventListener(EVENT_TYPE, handler);
  return () => bus.removeEventListener(EVENT_TYPE, handler);
}

/** Generates a per-viewer-instance id for the echo guard (§1 above). */
export function makeCameraSyncSourceId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
