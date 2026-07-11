// Phase C (cairn-plot Python library): generate
// docs/schemas/cairn-plot-spec.schema.json from the authoritative TS type
// `PlotDescriptor` in src/plot-descriptor.ts via ts-json-schema-generator. TS
// is the single source of truth; this schema is a derived artifact (committed
// so the Python side + CI can read it without a TS toolchain). It mirrors
// gen-card-spec-schema.mjs exactly. Run: `npm run gen:plot-schema`. The
// drift-check (check-plot-spec-schema.mjs) re-runs this into a temp buffer and
// diffs.
//
// Usage:
//   node scripts/gen-plot-spec-schema.mjs            # write the committed schema
//   node scripts/gen-plot-spec-schema.mjs --stdout   # print to stdout (drift-check)

import { createGenerator } from "ts-json-schema-generator";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const uiRoot = resolve(here, "..");
const repoRoot = resolve(uiRoot, "../..");

const OUT = resolve(repoRoot, "docs/schemas/cairn-plot-spec.schema.json");

const config = {
  path: resolve(uiRoot, "src/plot-descriptor.ts"),
  tsconfig: resolve(uiRoot, "tsconfig.app.json"),
  // `PlotDescriptor` is the descriptor contract the Python `PlotSpec` mirrors.
  type: "PlotDescriptor",
  expose: "all",
  topRef: true,
  jsDoc: "extended",
  // plot-descriptor.ts references DOM-free types only; skip the whole-program
  // type check (the UI's own typecheck already gates correctness) so this
  // stays fast and independent of unrelated app type errors.
  skipTypeCheck: true,
  additionalProperties: false,
};

const schema = createGenerator(config).createSchema(config.type);
// Stable 2-space JSON with a trailing newline — byte-identical across runs so
// the drift-check diff is meaningful.
const json = JSON.stringify(schema, null, 2) + "\n";

if (process.argv.includes("--stdout")) {
  process.stdout.write(json);
} else {
  writeFileSync(OUT, json);
  process.stderr.write(`wrote ${OUT}\n`);
}
