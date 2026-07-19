#!/usr/bin/env node
// @ts-check
/**
 * Headless smoke harness for the standalone cairn.plot gallery.
 *
 * WHAT IT GUARDS. The gallery (examples/demo_cairn_plot.py) bakes one section
 * per plot type into a single self-contained HTML file, rendered by the very
 * same cairn-plot renderer bundle the web app ships. A whole class of
 * regressions makes a section render its *toolbar/chrome* but no actual plot
 * body — e.g. the chart <svg> that gates on a MEASURED non-zero container size
 * when the only size source is an async ResizeObserver (fixed in
 * use-container-size.ts), or the earlier missing-icons / broken-<img> bugs.
 * None of those trip a Python test or `tsc`: the page still *builds*, it just
 * renders empty. This script loads the emitted page in a real headless
 * Chromium, captures the freshly-painted DOM (see VIRTUAL_TIME_BUDGET_MS for
 * why the capture is early, not settled), and asserts every section contains
 * genuine rendered content — so an empty-body regression fails CI, not users.
 *
 * Dependency-free: plain Node + a headless Chromium invocation + string/regex
 * parsing of the dumped DOM (no jsdom, no puppeteer).
 *
 * Usage:  node scripts/smoke-plot-gallery.mjs   (or: npm run smoke:plot)
 * Env:    CHROME_BIN   path to a Chromium-family browser (else auto-detected)
 *         KEEP_DUMP=1  keep the dumped DOM at $TMPDIR/cairn-smoke-dump.html
 */

import { spawnSync } from "node:child_process";
import { existsSync, accessSync, constants, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ -> cairn/ui/scripts ; repo root is three levels up.
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const GALLERY_HTML = join(tmpdir(), "cairn-smoke-gallery.html");
const DUMP_HTML = join(tmpdir(), "cairn-smoke-dump.html");

// Headless capture point, in the page's VIRTUAL clock (Chromium fast-forwards
// virtual time through scheduled timers/rAF as fast as the CPU allows, so this
// is a *code-deterministic*, machine-independent instant — not wall-clock).
//
// Deliberately SHORT. The flagship regression this harness guards (chart <svg>
// gated on a measured non-zero size that used to come ONLY from an async
// ResizeObserver) is a FIRST-PAINT gap: with the fix the chart body is seeded
// synchronously in a layout effect and is present from the very first frame;
// without it the last-settling section (the synced-chart grid) stays blank
// until the async observer delivers (~400ms of virtual time here). A long
// budget (e.g. 15s) fast-forwards clean past that window and the regression
// hides — the empty page eventually fills in. Measured window on this bundle:
// the fix renders every section (incl. the async 3D / plotly / compare panes)
// by ~100ms of virtual time; the broken build leaves the synced-chart grid
// blank reliably through ~350ms and only fills in around ~400ms+. 250ms sits
// inside that window with margin on both sides — comfortably after every
// renderer's real first paint, comfortably before the broken build's async
// catch-up — so the harness stays green on good code and red on the
// regression. Override with SMOKE_VT_BUDGET_MS for debugging.
const VIRTUAL_TIME_BUDGET_MS = Number(process.env.SMOKE_VT_BUDGET_MS) || 250;

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;

function die(msg) {
  console.error(RED(`\nsmoke:plot FAILED — ${msg}\n`));
  process.exit(1);
}

// ── 1. Regenerate the gallery from the Python demo ──────────────────────────
function regenerateGallery() {
  const py = join(REPO_ROOT, ".venv", "bin", "python");
  const pyBin = existsSync(py) ? py : "python3";
  console.log(`• regenerating gallery → ${GALLERY_HTML}`);
  const r = spawnSync(
    pyBin,
    [join("examples", "demo_cairn_plot.py"), "-o", GALLERY_HTML],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONPATH: "." },
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (r.error) die(`could not launch python (${pyBin}): ${r.error.message}`);
  if (r.status !== 0) {
    die(
      `demo_cairn_plot.py exited ${r.status}.\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`,
    );
  }
  if (!existsSync(GALLERY_HTML)) die(`demo did not write ${GALLERY_HTML}`);
  process.stdout.write("  " + (r.stdout || "").trim() + "\n");
}

// ── 2. Locate a Chromium-family browser ─────────────────────────────────────
function findChrome() {
  if (process.env.CHROME_BIN) {
    if (isExecutable(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
    die(`CHROME_BIN is set to "${process.env.CHROME_BIN}" but it is not executable.`);
  }
  const candidates = [];
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      // Chromium-family fallbacks — the flags below are all Chromium flags.
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    );
  }
  for (const c of candidates) if (isExecutable(c)) return c;
  // PATH lookup.
  for (const name of [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "brave-browser",
  ]) {
    const w = spawnSync("command", ["-v", name], { shell: true, encoding: "utf-8" });
    const p = (w.stdout || "").trim().split("\n")[0];
    if (p && isExecutable(p)) return p;
  }
  die(
    "no Chromium-family browser found. Set CHROME_BIN=/path/to/chrome, or install " +
      "Google Chrome / Chromium (macOS default probed: /Applications/Google Chrome.app).",
  );
}

function isExecutable(p) {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ── 3. Headless render → settled DOM ────────────────────────────────────────
function dumpDom(chrome) {
  const url = pathToFileURL(GALLERY_HTML).href;
  const args = [
    "--headless=new",
    "--disable-gpu",
    // Software WebGL (SwiftShader) so the WebGL/three.js 3D sections
    // (PointCloud / Mesh / Volume / Boxes) still mount a <canvas> headlessly —
    // without this they render an empty mount div on a GPU-less CI box.
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    // NB: intentionally NO --user-data-dir. A throwaway profile dir makes some
    // Chromium builds (e.g. Brave) keep first-run background services alive,
    // which never closes stdout and hangs the --dump-dom pipe. headless=new
    // already uses an isolated ephemeral profile.
    `--virtual-time-budget=${VIRTUAL_TIME_BUDGET_MS}`,
    "--dump-dom",
    url,
  ];
  console.log(`• rendering headlessly via ${chrome}`);
  const r = spawnSync(chrome, args, {
    encoding: "utf-8",
    maxBuffer: 512 * 1024 * 1024, // the dump inlines the renderer bundle (tens of MB)
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) die(`could not launch Chrome: ${r.error.message}`);
  const dom = r.stdout || "";
  if (dom.length < 1000) {
    die(
      `Chrome --dump-dom produced almost no output (${dom.length} bytes).\n--- stderr ---\n${r.stderr}`,
    );
  }
  if (process.env.KEEP_DUMP) {
    writeFileSync(DUMP_HTML, dom);
    console.log(`  (kept settled DOM at ${DUMP_HTML})`);
  }
  return dom;
}

// ── 4. Parse & assert ───────────────────────────────────────────────────────
// The dumped DOM inlines the entire renderer bundle inside <script> tags (and
// theme CSS inside <style>), which contain literal "<img>", "<svg>", and the
// words "could not render" as source text. Strip those first so we only ever
// assert against RENDERED DOM, never against bundle source.
function stripCode(dom) {
  return dom
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}

function textOfH2(sectionHtml) {
  const m = sectionHtml.match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i);
  if (!m) return "(untitled section)";
  return m[1]
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Largest descendant-element count across the section's <svg> blocks. */
function maxSvgDescendants(sectionHtml) {
  let max = 0;
  for (const m of sectionHtml.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
    // count opening element tags, minus the <svg> itself
    const opens = (m[0].match(/<[a-zA-Z]/g) || []).length - 1;
    if (opens > max) max = opens;
  }
  return max;
}

function anySvgHasTickText(sectionHtml) {
  for (const m of sectionHtml.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
    if (/<text[\s>]/i.test(m[0])) return true;
  }
  return false;
}

function hasDataImg(sectionHtml) {
  // <img> whose src is a real data: URI (not the empty "data:," sentinel).
  return /<img\b[^>]*\bsrc\s*=\s*["']data:(?!,)[^"']+["']/i.test(sectionHtml);
}

function emptyImgCount(sectionHtml) {
  let n = 0;
  for (const m of sectionHtml.matchAll(/<img\b[^>]*>/gi)) {
    const src = m[0].match(/\bsrc\s*=\s*["']([^"']*)["']/i);
    if (src && (src[1] === "" || src[1] === "data:,")) n++;
  }
  return n;
}

// section headings whose bodies must be a real chart svg WITH axis tick <text>.
const CHART_SECTION = /^(Line|Scatter|Bar|Histogram|Heatmap)\b/;
const MIN_SVG_DESCENDANTS = 8;

function analyze(dom) {
  const clean = stripCode(dom);

  // Global error-placeholder scan (rendered DOM only).
  const globalErrors = [];
  if (/could not render/i.test(clean)) globalErrors.push('renderer placeholder: "could not render"');
  if (/BundleUnavailable/.test(clean)) globalErrors.push("BundleUnavailable");

  const sections = clean.split(/<section\b/i).slice(1);
  if (sections.length === 0) die("no <section> elements found in the settled DOM.");

  const rows = [];
  for (const s of sections) {
    const title = textOfH2(s);
    const svgDesc = maxSvgDescendants(s);
    const bigSvg = svgDesc >= MIN_SVG_DESCENDANTS;
    const hasCanvas = /<canvas[\s>]/i.test(s);
    const hasTable = /<table[\s>]/i.test(s);
    const dataImg = hasDataImg(s);
    const emptyImgs = emptyImgCount(s);

    const hasContent = bigSvg || hasCanvas || hasTable || dataImg;
    const isChart = CHART_SECTION.test(title);
    const chartOk = !isChart || (bigSvg && anySvgHasTickText(s));

    const reasons = [];
    if (!hasContent)
      reasons.push(
        `no content (max-svg-descendants=${svgDesc}<${MIN_SVG_DESCENDANTS}, no canvas/table/data-img)`,
      );
    if (isChart && !bigSvg) reasons.push(`chart svg too small (${svgDesc} descendants)`);
    if (isChart && bigSvg && !anySvgHasTickText(s))
      reasons.push("chart svg has no axis tick <text> nodes");
    if (emptyImgs > 0) reasons.push(`${emptyImgs} <img> with empty/data:, src`);

    rows.push({
      title,
      pass: hasContent && chartOk && emptyImgs === 0,
      svgDesc,
      hasCanvas,
      hasTable,
      dataImg,
      emptyImgs,
      isChart,
      reasons,
    });
  }
  return { rows, globalErrors };
}

// ── 5. Report ───────────────────────────────────────────────────────────────
function report({ rows, globalErrors }) {
  console.log("\n" + BOLD(`Gallery smoke — ${rows.length} sections`) + "\n");
  const w = Math.min(60, Math.max(...rows.map((r) => r.title.length)));
  let failed = 0;
  for (const r of rows) {
    const tag = r.pass ? GREEN("PASS") : RED("FAIL");
    const kind =
      [
        r.svgDesc >= MIN_SVG_DESCENDANTS ? `svg(${r.svgDesc})` : null,
        r.hasCanvas ? "canvas" : null,
        r.hasTable ? "table" : null,
        r.dataImg ? "img:data" : null,
      ]
        .filter(Boolean)
        .join(",") || "—";
    const title = r.title.length > w ? r.title.slice(0, w - 1) + "…" : r.title.padEnd(w);
    let line = `  ${tag}  ${title}  [${kind}]`;
    if (!r.pass) line += "  " + RED("← " + r.reasons.join("; "));
    console.log(line);
    if (!r.pass) failed++;
  }

  console.log("");
  if (globalErrors.length) {
    for (const e of globalErrors) console.log("  " + RED(`GLOBAL FAIL: ${e}`));
    console.log("");
  }

  const ok = failed === 0 && globalErrors.length === 0;
  if (ok) {
    console.log(GREEN(BOLD(`✓ all ${rows.length} sections render real content`)) + "\n");
    process.exit(0);
  } else {
    console.log(
      RED(
        BOLD(
          `✗ ${failed} section(s) failed${globalErrors.length ? " + " + globalErrors.length + " global error(s)" : ""}`,
        ),
      ) + "\n",
    );
    process.exit(1);
  }
}

// ── main ────────────────────────────────────────────────────────────────────
regenerateGallery();
const chrome = findChrome();
const dom = dumpDom(chrome);
report(analyze(dom));
