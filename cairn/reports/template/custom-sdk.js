const VERSION = "1";
let renderFn = null, resizeFn = null, viewFn = null, themeFn = null, snapshotFn = null, settingsFn = null;
let last = null, rendering = false, pending = null, quiet = null, lastView;

function post(m) { m.v = 1; try { parent.postMessage(m, "*"); } catch (e) { /* the host is gone */ } }
function errorOf(e) { return { type: "cairn:error", message: String((e && e.message) || e), stack: e && e.stack ? String(e.stack) : undefined }; }
export function reportError(e) { post(errorOf(e)); }

function applyTheme(t) {
  if (!t) return;
  const s = document.documentElement.style;
  s.setProperty("--cairn-bg", t.bg); s.setProperty("--cairn-fg", t.fg); s.setProperty("--cairn-muted", t.muted);
  s.setProperty("--cairn-border", t.border); s.setProperty("--cairn-accent", t.accent); s.setProperty("--cairn-font", t.font);
  s.setProperty("--cairn-mono", t.monoFont); s.colorScheme = t.mode;
}

async function run(args) {
  if (!renderFn) { pending = args; return; }
  if (rendering) { pending = args; return; }
  rendering = true;
  try { await renderFn(args); post({ type: "cairn:rendered", seq: args.seq }); }
  catch (e) { post(errorOf(e)); }
  finally {
    rendering = false;
    if (pending) { const p = pending; pending = null; run(p); }
  }
}

addEventListener("message", (e) => {
  const d = e.data;
  if (e.source !== parent || !d || typeof d.type !== "string") return;
  switch (d.type) {
    case "cairn:render":
      last = { inputs: d.inputs || [], step: d.step, settings: d.settings || {}, size: d.size, theme: d.theme, view: d.view, seq: d.seq };
      lastView = d.view;
      applyTheme(d.theme);
      run(last);
      break;
    case "cairn:resize":
      if (!last) break;
      last = Object.assign({}, last, { size: d.size });
      if (resizeFn) { try { resizeFn(d.size); } catch (err) { post(errorOf(err)); } }
      else run(last);
      break;
    case "cairn:view":
      lastView = d.view;
      if (last) last = Object.assign({}, last, { view: d.view });
      if (viewFn) { try { viewFn(d.view); } catch (err) { post(errorOf(err)); } }
      break;
    case "cairn:theme":
      applyTheme(d.theme);
      if (last) last = Object.assign({}, last, { theme: d.theme });
      if (themeFn) { try { themeFn(d.theme); } catch (err) { post(errorOf(err)); } }
      else if (last) run(last);
      break;
    case "cairn:settings":
      if (!last) break;
      last = Object.assign({}, last, { settings: d.settings || {} });
      if (settingsFn) { try { settingsFn(last.settings); } catch (err) { post(errorOf(err)); } }
      else run(last);
      break;
    case "cairn:snapshot":
      takeSnapshot().then((url) => post({ type: "cairn:snapshot", id: d.id, url }));
      break;
  }
});

async function takeSnapshot() {
  try {
    if (snapshotFn) {
      const r = await snapshotFn();
      if (typeof r === "string") return r;
      if (r && typeof r.toDataURL === "function") return r.toDataURL("image/png");
      return null;
    }
    const c = document.querySelector("canvas");
    return c ? c.toDataURL("image/png") : null;
  } catch (e) { return null; }
}

/** Draw: called with {inputs, step, settings, size, theme, view} on every change; may be async. */
export function onRender(fn) { renderFn = fn; if (pending) { const p = pending; pending = null; run(p); } }
/** The frame was resized ({width, height, dpr}); without it, a resize re-renders. */
export function onResize(fn) { resizeFn = fn; }
/** A sibling pane (or the stored card state) moved the shared view. */
export function onView(fn) { viewFn = fn; if (lastView !== undefined && lastView !== null) { try { fn(lastView); } catch (e) { post(errorOf(e)); } } }
/** The card's settings changed (and nothing else); without it, a settings change re-renders. */
export function onSettings(fn) { settingsFn = fn; }
/** Change the card's settings (manifest keys); the host checks them and they come back through onSettings / a render. */
export function setSettings(patch) { post({ type: "cairn:settings", patch: Object.assign({}, patch) }); }
/** The settings of the last render or settings change. */
export function settings() { return last ? last.settings : null; }
/** The theme changed; without it, a theme change re-renders. */
export function onTheme(fn) { themeFn = fn; }
/** Share this pane's view (any JSON, e.g. a camera) with the card's other panes. */
export function setView(view, opts) {
  lastView = view;
  const final = !!(opts && opts.final);
  post({ type: "cairn:view", view, final });
  clearTimeout(quiet);
  if (!final) quiet = setTimeout(() => post({ type: "cairn:view", view: lastView, final: true }), 150);
}
/** How to picture this pane when it is paused or exported: return a data URL or a canvas. */
export function snapshot(fn) { snapshotFn = fn; }
/** The content's preferred height in CSS pixels (cards with auto height follow it). */
export function setHeight(px) { post({ type: "cairn:size", height: Math.max(0, Number(px) || 0) }); }
/** A blob URL of a file of the viewer folder (images, data, shaders); null when there is none. */
export function asset(path) {
  const files = window.__cairnFiles || {};
  const p = String(path).replace(/^\.?\//, "");
  return files[p] || null;
}
/** The current theme tokens. */
export function theme() { return last ? last.theme : null; }
export const version = VERSION;

