/**
 * The LOCAL content-addressed blob store (design spec §5).
 *
 * A page-level registry — `window.__cairnPlotStore` — keyed by content hash
 * to `{ mime, b64 }`, so multiple plots on ONE page (e.g. several notebook
 * cells sharing the page DOM) dedup + share their baked binary blobs (an
 * image referenced by two plots is stored once). Registration is
 * additive/idempotent (`Object.assign`), so N cells contribute to ONE store
 * and a repeated hash is a no-op.
 *
 * The store carries only LARGE binary artifacts (image bytes, npy/npz) that
 * benefit from dedup; small 2D JSON contracts (Series/points/matrix) are
 * inlined directly in the plot descriptor, not here.
 *
 * This module is the ONE definition of the store shape + LOCAL `DataSource`,
 * shared by the plot bootstrap (`plot-main.tsx`) and Phase C's Python-emitted
 * pages (which emit the inline `<script>` that seeds `window.__cairnPlotStore`
 * and then rely on this reader). The Python emitter and this reader MUST agree
 * on the shape below.
 */
import type { DataSource } from "./data-sources";

/** One stored blob: its MIME type and base64-encoded bytes. */
export interface PlotStoreEntry {
  mime: string;
  b64: string;
}

/** hash -> blob. The value written to `window.__cairnPlotStore`. */
export type PlotStore = Record<string, PlotStoreEntry>;

declare global {
  interface Window {
    __cairnPlotStore?: PlotStore;
  }
}

/** The DOM id of the inline `<script application/cairn-plot-store+json>` blob
 *  a Python-emitted page carries (design spec §5). */
export const PLOT_STORE_SCRIPT_ID = "__cairn_plot_store__";

/**
 * Idempotently merge `entries` into the page-level `window.__cairnPlotStore`
 * (creating it if absent) and return the live store. Mirrors the inline
 * `Object.assign(window.__cairnPlotStore ||= {}, ...)` a Python-emitted page
 * runs — exposed here so the bootstrap (and tests) can register a store the
 * same way without hand-writing the global.
 */
export function registerPlotStore(entries: PlotStore): PlotStore {
  const store: PlotStore = (window.__cairnPlotStore ??= {});
  Object.assign(store, entries);
  return store;
}

/**
 * Read + register the store baked into the page's inline
 * `<script id="__cairn_plot_store__" type="application/cairn-plot-store+json">`
 * blob, if present. No-op-safe (returns the live/empty store) when the script
 * tag is missing or unparseable — a descriptor may reference no binary blobs
 * (pure 2D JSON) and thus ship no store.
 */
export function loadPlotStoreFromDom(
  doc: Document = document,
): PlotStore {
  const el = doc.getElementById(PLOT_STORE_SCRIPT_ID);
  if (el?.textContent) {
    try {
      registerPlotStore(JSON.parse(el.textContent) as PlotStore);
    } catch {
      // Leave the existing store untouched on a malformed blob.
    }
  }
  return (window.__cairnPlotStore ??= {});
}

/** Decode a base64 string to an `ArrayBuffer` (browser `atob`). */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * The LOCAL `DataSource` (design spec §5) — resolves a content hash against
 * the page-level `window.__cairnPlotStore` with NO network:
 *  - `artifactUrl(hash)` = `data:${mime};base64,${b64}` (an `<img src>` /
 *    fetch target that inlines the bytes);
 *  - `bytes(hash)` = base64-decode the stored blob (for npy/npz parsers).
 * This is the LOCAL counterpart to `createEndpointDataSource`; the plot
 * bootstrap picks one or the other by `descriptor.mode`, and every downstream
 * `resolve*`/`fetch*` core in `data-sources.ts` works unchanged against it.
 */
export function createLocalDataSource(
  store: PlotStore = window.__cairnPlotStore ?? {},
): DataSource {
  const get = (hash: string): PlotStoreEntry => {
    const entry = store[hash];
    if (!entry) throw new Error(`plot store missing blob for hash ${hash}`);
    return entry;
  };
  return {
    artifactUrl(hash: string): string {
      const { mime, b64 } = get(hash);
      return `data:${mime};base64,${b64}`;
    },
    async bytes(hash: string): Promise<ArrayBuffer> {
      return base64ToArrayBuffer(get(hash).b64);
    },
  };
}
