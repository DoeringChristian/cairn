// Phase C drift-check: regenerate the plot-spec JSON Schema from the TS source
// and fail if it differs from the committed
// docs/schemas/cairn-plot-spec.schema.json. This keeps TS `PlotDescriptor` and
// the committed schema (and therefore the Python `PlotSpec` pydantic model
// derived from it) from silently drifting. Mirrors check-card-spec-schema.mjs.
//
// Run: `npm run check:plot-schema` (exit 0 = in sync, exit 1 = drift).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const uiRoot = resolve(here, "..");
const repoRoot = resolve(uiRoot, "../..");
const committedPath = resolve(repoRoot, "docs/schemas/cairn-plot-spec.schema.json");

const genScript = resolve(here, "gen-plot-spec-schema.mjs");
const regenerated = execFileSync(process.execPath, [genScript, "--stdout"], {
  encoding: "utf8",
});

let committed;
try {
  committed = readFileSync(committedPath, "utf8");
} catch {
  console.error(
    `[check:plot-schema] committed schema missing at ${committedPath} — run \`npm run gen:plot-schema\` and commit it.`,
  );
  process.exit(1);
}

if (committed === regenerated) {
  console.log("[check:plot-schema] OK — committed schema matches the TS source.");
  process.exit(0);
}

console.error(
  "[check:plot-schema] DRIFT — docs/schemas/cairn-plot-spec.schema.json is out of date.\n" +
    "Regenerate with `npm run gen:plot-schema` and commit the result.\n",
);

const a = committed.split("\n");
const b = regenerated.split("\n");
const max = Math.max(a.length, b.length);
let shown = 0;
for (let i = 0; i < max && shown < 40; i++) {
  if (a[i] !== b[i]) {
    if (a[i] !== undefined) console.error(`- ${i + 1}: ${a[i]}`);
    if (b[i] !== undefined) console.error(`+ ${i + 1}: ${b[i]}`);
    shown++;
  }
}
process.exit(1);
