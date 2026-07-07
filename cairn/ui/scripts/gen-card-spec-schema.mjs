// WS-SCHEMA: generate docs/schemas/cairn-card-spec.schema.json from the
// authoritative TS types in src/lib/cards/card-spec.ts via
// ts-json-schema-generator. TS is the single source of truth; this schema is
// a derived artifact (committed so the Python side + CI can read it without a
// TS toolchain). Run: `npm run gen:card-schema`. The drift-check
// (check-card-spec-schema.mjs) re-runs this into a temp file and diffs.
//
// Usage:
//   node scripts/gen-card-spec-schema.mjs            # write the committed schema
//   node scripts/gen-card-spec-schema.mjs --stdout   # print to stdout (drift-check)

import { createGenerator } from "ts-json-schema-generator";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const uiRoot = resolve(here, "..");
const repoRoot = resolve(uiRoot, "../..");

const OUT = resolve(repoRoot, "docs/schemas/cairn-card-spec.schema.json");

const config = {
  path: resolve(uiRoot, "src/lib/cards/card-spec.ts"),
  tsconfig: resolve(uiRoot, "tsconfig.app.json"),
  // The umbrella root (see card-spec.ts) pulls every card-spec type into one
  // deterministic `definitions` block with no degenerate wildcard entry.
  type: "CardSpecSchema",
  expose: "all",
  topRef: true,
  jsDoc: "extended",
  // Card-spec.ts references DOM-free types only; skip the whole-program type
  // check (the UI's own `npm run typecheck` already gates correctness) so this
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
