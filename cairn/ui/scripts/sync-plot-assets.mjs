#!/usr/bin/env node
// @ts-check
/**
 * Sync the built cairn-plot renderer bundles into the cairn-plot PACKAGE data.
 *
 * The Vite build writes the self-contained IIFE bundles + design-token CSS to
 * `cairn/ui/dist/plot-inline/` (committed for the app). The standalone
 * `cairn-plot` Python distribution ships those exact files as PACKAGE DATA at
 * `packages/cairn-plot/src/cairn_plot/_assets/plot-inline/` so an installed
 * wheel renders offline with no repo checkout (packaging spec §5). This script
 * is the one-way copy dist → package-data, and its `--check` mode is the CI
 * identity guard (exit 1 on drift), replacing the "commit dist" convention for
 * the plot bundle.
 *
 * Dependency-free: plain Node fs.
 *
 * Usage:
 *   node scripts/sync-plot-assets.mjs          copy dist/plot-inline → _assets
 *   node scripts/sync-plot-assets.mjs --check  diff the two; exit 1 on drift
 *   (or: npm run sync:plot-assets [-- --check])
 */

import {
  readdirSync,
  readFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ -> cairn/ui/scripts ; repo root is three levels up.
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SRC_DIR = join(REPO_ROOT, "cairn", "ui", "dist", "plot-inline");
const DEST_DIR = join(
  REPO_ROOT,
  "packages",
  "cairn-plot",
  "src",
  "cairn_plot",
  "_assets",
  "plot-inline",
);

const CHECK = process.argv.includes("--check");

function fail(msg) {
  console.error(`sync-plot-assets: ${msg}`);
  process.exit(1);
}

if (!existsSync(SRC_DIR)) {
  fail(
    `source dir missing: ${SRC_DIR}\n` +
      "  Build it first: `cd cairn/ui && npm run build:plot-inline`.",
  );
}

const srcFiles = readdirSync(SRC_DIR).filter((f) => !f.startsWith("."));
if (srcFiles.length === 0) {
  fail(`source dir is empty: ${SRC_DIR}`);
}

function bytesEqual(a, b) {
  if (!existsSync(a) || !existsSync(b)) return false;
  const ba = readFileSync(a);
  const bb = readFileSync(b);
  return ba.length === bb.length && ba.equals(bb);
}

if (CHECK) {
  const drift = [];
  const destFiles = existsSync(DEST_DIR)
    ? readdirSync(DEST_DIR).filter((f) => !f.startsWith("."))
    : [];
  for (const f of srcFiles) {
    if (!bytesEqual(join(SRC_DIR, f), join(DEST_DIR, f))) {
      drift.push(f);
    }
  }
  for (const f of destFiles) {
    if (!srcFiles.includes(f)) drift.push(`${f} (stale, not in dist)`);
  }
  if (drift.length) {
    fail(
      `package assets are out of sync with dist/plot-inline:\n` +
        drift.map((f) => `  - ${f}`).join("\n") +
        `\n  Run \`npm run sync:plot-assets\` and commit the result.`,
    );
  }
  console.log(
    `sync-plot-assets: OK — ${srcFiles.length} file(s) in sync (${DEST_DIR}).`,
  );
  process.exit(0);
}

// Copy mode: mirror SRC_DIR → DEST_DIR exactly (add/update + prune stale).
mkdirSync(DEST_DIR, { recursive: true });
let copied = 0;
for (const f of srcFiles) {
  const from = join(SRC_DIR, f);
  const to = join(DEST_DIR, f);
  if (!bytesEqual(from, to)) {
    copyFileSync(from, to);
    copied += 1;
  }
}
let pruned = 0;
for (const f of readdirSync(DEST_DIR).filter((x) => !x.startsWith("."))) {
  if (!srcFiles.includes(f)) {
    rmSync(join(DEST_DIR, f));
    pruned += 1;
  }
}
console.log(
  `sync-plot-assets: synced ${srcFiles.length} file(s) → ${DEST_DIR} ` +
    `(${copied} updated, ${pruned} pruned).`,
);
