import type { DiffMode } from "../types";
import type { MediaCompareModeKind } from "./mode";

// ---------------------------------------------------------------------------
// Settings migration-on-read: legacy {diffMode, compareMode, referenceMode}
// combo -> the new single `mode` field.
//
// Pre-refactor ImageGalleryCard settings had two independently-settable
// axes: `diffMode` ("none" | DiffMode) and `compareMode`
// ("side-by-side" | "split" | "blend", default "side-by-side"). Under the
// unified exclusive-mode model there is exactly one axis. The mapping below
// is the single, table-driven source of truth for collapsing old combos to
// the nearest new mode — cards must call `migrateLegacyMode`, not hand-roll
// their own ifs (spec-visual-compare.md quality bar #5).
//
// Rule (in priority order):
//   1. Any active diff (`diffMode !== "none"`) wins — this is the sanctioned
//      "split+diff (or side+diff) collapses to diff" delta from the spec.
//   2. Otherwise compareMode "split"/"blend" map directly.
//   3. Otherwise "side-by-side" (or unset) maps to "side" when the old
//      per-run reference scope was active (that combination visually showed
//      two panes), else "normal" (single pane, reference tracked but not
//      shown/diffed).
// ---------------------------------------------------------------------------

export interface LegacyModeInputs {
  diffMode: "none" | DiffMode;
  compareMode?: "side-by-side" | "split" | "blend";
  referenceMode?: "global" | "per-run";
}

export function migrateLegacyMode(input: LegacyModeInputs): MediaCompareModeKind {
  const { diffMode, compareMode = "side-by-side", referenceMode = "global" } = input;
  if (diffMode !== "none") return "diff";
  if (compareMode === "split") return "split";
  if (compareMode === "blend") return "blend";
  return referenceMode === "per-run" ? "side" : "normal";
}

// ---------------------------------------------------------------------------
// Table-driven coverage — every legacy combo a reviewer needs to check maps
// here, one row per case (co-located with the utility per spec-visual-compare
// quality bar #5). `assertLegacyModeMigrationTable` runs once at module load
// (cheap: a handful of function calls) so a broken mapping fails loudly
// without a test runner (this repo has none configured yet).
// ---------------------------------------------------------------------------

export const LEGACY_MODE_MIGRATION_TABLE: Array<{
  description: string;
  input: LegacyModeInputs;
  expected: MediaCompareModeKind;
}> = [
  {
    description: "fresh default: no diff, default compare, default (global) reference",
    input: { diffMode: "none" },
    expected: "normal",
  },
  {
    description: "no diff, explicit side-by-side, global reference",
    input: { diffMode: "none", compareMode: "side-by-side", referenceMode: "global" },
    expected: "normal",
  },
  {
    description: "no diff, side-by-side, per-run reference -> two visible panes",
    input: { diffMode: "none", compareMode: "side-by-side", referenceMode: "per-run" },
    expected: "side",
  },
  {
    description: "no diff, split compare, global reference",
    input: { diffMode: "none", compareMode: "split", referenceMode: "global" },
    expected: "split",
  },
  {
    description: "no diff, split compare, per-run reference (referenceMode irrelevant to split)",
    input: { diffMode: "none", compareMode: "split", referenceMode: "per-run" },
    expected: "split",
  },
  {
    description: "no diff, blend compare, global reference",
    input: { diffMode: "none", compareMode: "blend", referenceMode: "global" },
    expected: "blend",
  },
  {
    description: "no diff, blend compare, per-run reference (referenceMode irrelevant to blend)",
    input: { diffMode: "none", compareMode: "blend", referenceMode: "per-run" },
    expected: "blend",
  },
  {
    description: "absolute diff + default compare + global reference (the common single-pane diff view)",
    input: { diffMode: "absolute", compareMode: "side-by-side", referenceMode: "global" },
    expected: "diff",
  },
  {
    description: "signed diff + side-by-side + per-run reference -> previously-combinable side+diff collapses to diff",
    input: { diffMode: "signed", compareMode: "side-by-side", referenceMode: "per-run" },
    expected: "diff",
  },
  {
    description: "squared diff + split compare -> previously-combinable split+diff collapses to diff (the spec's headline case)",
    input: { diffMode: "squared", compareMode: "split", referenceMode: "global" },
    expected: "diff",
  },
  {
    description: "relative_absolute diff + blend compare -> collapses to diff",
    input: { diffMode: "relative_absolute", compareMode: "blend", referenceMode: "per-run" },
    expected: "diff",
  },
  {
    description: "relative_signed diff, compareMode unset (legacy default), global reference",
    input: { diffMode: "relative_signed" },
    expected: "diff",
  },
  {
    description: "relative_squared diff, compareMode unset, per-run reference -> diff still wins",
    input: { diffMode: "relative_squared", referenceMode: "per-run" },
    expected: "diff",
  },
];

export function assertLegacyModeMigrationTable(): void {
  for (const testCase of LEGACY_MODE_MIGRATION_TABLE) {
    const got = migrateLegacyMode(testCase.input);
    if (got !== testCase.expected) {
      throw new Error(
        `[media-compare] migrateLegacyMode regression: "${testCase.description}" ` +
          `expected "${testCase.expected}", got "${got}" (input: ${JSON.stringify(testCase.input)})`,
      );
    }
  }
}

assertLegacyModeMigrationTable();
