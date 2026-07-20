#!/usr/bin/env node
/**
 * Boundary lint for the extractable cairn-plot TS surface (prep for the
 * cairn-plot repo extraction — see docs/superpowers/specs/
 * 2026-07-19-cairn-plot-repo-extraction-prep.md, workstream P-A).
 *
 * RULE: the cairn-plot library + its standalone entry/bootstrap files must NOT
 * import app code. The APP importing the library is fine (that becomes the
 * `@cairn-plot/*` package dependency at cutover) — but nothing in the surface
 * below may reach the other way, into `src/components/**`, `src/lib/**`
 * (outside `lib/cairn-plot`), app CSS, or app entry files. Any such import
 * would break the clean `git filter-repo` split, so we fail CI on it here,
 * next to the other plot guards (`check:plot-schema`, `check:plot-assets`).
 *
 * The surface (kept in sync with the spec's P-A list):
 *   - src/lib/cairn-plot/**                    (the library)
 *   - src/plot-*.ts / src/plot-*.tsx           (standalone entries/bootstrap)
 *   - vite.plot-*.config.ts                    (standalone build configs)
 *   - scripts/{gen,check}-plot-spec-schema.mjs, sync-plot-assets.mjs,
 *     smoke-plot-gallery.mjs                   (plot build/gen scripts)
 *
 * An import is a VIOLATION when it is a *relative* specifier whose resolved
 * target lands OUTSIDE the surface (i.e. in app code). Bare specifiers
 * (node_modules packages, `node:` builtins) are always fine. Comments are
 * stripped before scanning so commented-out example paths never trip the lint.
 *
 * Usage: `node scripts/check-plot-boundary.mjs` — exit 0 clean, 1 on any
 * violation (with a `file:line  'spec'  -> resolved` report).
 */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative, extname } from "node:path";

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(UI_ROOT, "src");
const LIB = join(SRC, "lib", "cairn-plot");
const REPO_ROOT = resolve(UI_ROOT, "..", "..");

// --- surface enumeration -------------------------------------------------
function walk(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
function glob(dir, re) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => re.test(n))
    .map((n) => join(dir, n));
}

const plotEntries = glob(SRC, /^plot-.*\.(ts|tsx)$/);
const viteConfigs = glob(UI_ROOT, /^vite\.plot-.*\.config\.ts$/);
const plotScripts = [
  "gen-plot-spec-schema.mjs",
  "check-plot-spec-schema.mjs",
  "sync-plot-assets.mjs",
  "smoke-plot-gallery.mjs",
].map((n) => join(UI_ROOT, "scripts", n)).filter(existsSync);

const surface = [
  ...walk(LIB),
  ...plotEntries,
  ...viteConfigs,
  ...plotScripts,
];
const surfaceReal = new Set(surface.map((f) => resolve(f)));

function isIntraSurface(absPath) {
  const p = resolve(absPath);
  if (p === resolve(LIB) || p.startsWith(resolve(LIB) + "/")) return true;
  return surfaceReal.has(p);
}

// --- import extraction ---------------------------------------------------
const PARSE_EXT = new Set([".ts", ".tsx", ".mjs", ".js", ".jsx"]);

function stripComments(src) {
  // Remove block + line comments so import-like text inside docs never trips
  // the lint. Block comments are replaced by their own newlines so reported
  // line numbers stay aligned with the original file.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// import ... from '...'  /  export ... from '...'  /  import '...'
const FROM_RE = /(?:import|export)\b[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g;
const SIDE_RE = /import\s*['"]([^'"]+)['"]/g;
const DYN_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function lineOf(text, idx) {
  return text.slice(0, idx).split("\n").length;
}

function resolveSpec(fromFile, spec) {
  const base = dirname(fromFile);
  const target = resolve(base, spec);
  const cands = [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    `${target}.js`,
    `${target}.jsx`,
    `${target}.mjs`,
    `${target}.css`,
    join(target, "index.ts"),
    join(target, "index.tsx"),
    join(target, "index.js"),
  ];
  for (const c of cands) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return target; // unresolved guess
}

const violations = [];
for (const f of surface) {
  if (!PARSE_EXT.has(extname(f))) continue;
  const raw = readFileSync(f, "utf8");
  const src = stripComments(raw);
  const seen = new Set();
  for (const re of [FROM_RE, SIDE_RE, DYN_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const spec = m[1];
      const key = `${m.index}:${spec}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!spec.startsWith(".")) continue; // bare / node: → fine
      const resolved = resolveSpec(f, spec);
      if (!isIntraSurface(resolved)) {
        violations.push({
          file: relative(REPO_ROOT, f),
          line: lineOf(src, m.index),
          spec,
          target: relative(REPO_ROOT, resolved),
        });
      }
    }
  }
}

if (violations.length === 0) {
  console.log(
    `check:plot-boundary OK — ${surfaceReal.size} surface files, no app-reaching imports.`,
  );
  process.exit(0);
}

console.error(
  `check:plot-boundary FAILED — ${violations.length} app-reaching import(s) in the cairn-plot surface:\n`,
);
for (const v of violations.sort((a, b) =>
  (a.file + a.line).localeCompare(b.file + b.line),
)) {
  console.error(`  ${v.file}:${v.line}  '${v.spec}'  ->  ${v.target}`);
}
console.error(
  `\nThe cairn-plot library must not import app code. Move the shared code into` +
    ` src/lib/cairn-plot/**, inject it via a prop/registry seam, or duplicate a` +
    ` tiny constant with a comment. See the P-A audit in the extraction spec.`,
);
process.exit(1);
