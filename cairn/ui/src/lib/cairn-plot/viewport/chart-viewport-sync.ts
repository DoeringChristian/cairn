/**
 * Framework-free live viewport-sync bus for 2D charts — the CHART mirror of
 * `image-viewport-sync.ts` (image panes) and `three/camera-sync.ts` (3D
 * cameras). One `EventTarget` per `groupId`. A chart publishes its new DOMAIN
 * (data-space ranges) whenever its OWN viewport commits (a genuine local
 * box-zoom / pan / wheel / axis-gutter / zoomIn-out / autoscale gesture); every
 * other chart subscribed to the same group applies the incoming domain to its
 * own viewport. This is Plotly "matched-axes" behaviour: peers adopt the
 * incoming data-space range directly (NOT a pixel transform), so charts of
 * different sizes/paddings still frame the exact same window.
 *
 * There is no persistent rAF loop — a payload is pushed only on a genuine local
 * commit and applied synchronously by subscribers.
 *
 * A single echo guard suffices (mirroring `image-viewport-sync.ts`): each
 * publish carries the publisher's `sourceId`, and a subscriber ignores events
 * whose `sourceId` matches its own. The domain state (`useChartViewport`'s
 * `internal`) only ever publishes from its COMMIT path (a genuine local
 * gesture) — a remote payload delivered through `subscribe` is applied with
 * `setInternal` directly, never re-committed, so it is never re-published and
 * no second "suppress while applying" guard is needed.
 *
 * Intentionally React-free so it stays reusable and unit-testable without a
 * DOM/React harness, and so pulling it into `core.iife.js` (charts are core)
 * never trips the bundle guard — it must stay tiny and dependency-free.
 */

/**
 * A chart-viewport broadcast. A concrete domain carries the publisher's live
 * data-space ranges (each axis nullable so a 1D chart can sync only the axis it
 * owns and leave a peer's other axis untouched); `"home"` means "autoscale /
 * reset" — a peer returns to following its own home domain.
 */
export type ChartSyncPayload =
  | { x: [number, number] | null; y: [number, number] | null }
  | "home";

interface ChartSyncDetail {
  payload: ChartSyncPayload;
  sourceId: string;
}

const EVENT_TYPE = "chart-viewport-state";

const buses = new Map<string, EventTarget>();
const lastPayloads = new Map<string, ChartSyncPayload>();

function busFor(groupId: string): EventTarget {
  let bus = buses.get(groupId);
  if (!bus) {
    bus = new EventTarget();
    buses.set(groupId, bus);
  }
  return bus;
}

/** Broadcasts `payload` to every OTHER subscriber of `groupId`. */
export function publishChartViewport(
  groupId: string,
  sourceId: string,
  payload: ChartSyncPayload,
): void {
  lastPayloads.set(groupId, payload);
  busFor(groupId).dispatchEvent(
    new CustomEvent<ChartSyncDetail>(EVENT_TYPE, { detail: { payload, sourceId } }),
  );
}

/**
 * The most recent payload published on `groupId`, or `undefined` if none yet.
 * Lets a chart that JOINS a group late (mounts after peers have already
 * zoomed/panned) adopt the current window immediately instead of starting back
 * at its own home — mirrors `getLastImageViewportState`.
 */
export function getLastChartViewport(groupId: string): ChartSyncPayload | undefined {
  return lastPayloads.get(groupId);
}

/**
 * Subscribes to viewport broadcasts on `groupId`, ignoring the caller's own
 * publishes (matched by `sourceId`). Returns an unsubscribe function.
 */
export function subscribeChartViewport(
  groupId: string,
  sourceId: string,
  onPayload: (payload: ChartSyncPayload) => void,
): () => void {
  const bus = busFor(groupId);
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<ChartSyncDetail>).detail;
    if (detail.sourceId === sourceId) return;
    onPayload(detail.payload);
  };
  bus.addEventListener(EVENT_TYPE, handler);
  return () => bus.removeEventListener(EVENT_TYPE, handler);
}

/** Generates a per-chart-instance id for the echo guard (§ above). */
export function makeChartViewportSyncSourceId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
