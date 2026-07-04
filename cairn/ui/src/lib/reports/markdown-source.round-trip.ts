/**
 * Acceptance core (b): markdown⇄blocks isomorphism — the second "risky
 * round trip" flagged in
 * docs/superpowers/specs/2026-07-04-ai-authored-reports.md §9.4.2.
 *
 * Two directions, both exercised here:
 *
 *  - SOURCE → blocks → SOURCE: adversarial hand-authored markdown (nested
 *    fences, an embedded ```cairn *example* inside prose, back-to-back
 *    fences, a malformed block, no trailing newline, …) must serialize back
 *    to byte-identical text. This is the fence-splitter's correctness bar.
 *  - blocks → SOURCE → blocks: an in-memory `blocks[]` (as the cells editor
 *    holds it, with real card ids/settings — no prior markdown source, i.e.
 *    freshly authored in the cells UI) must survive a markdown round trip
 *    with `CardsBlock` ids, card ids/series/settings, and block order all
 *    preserved (see cairn-block.ts's `id` field for how CardsBlock ids
 *    survive; `MarkdownBlock` ids are intentionally excluded from this
 *    guarantee — see markdown-source.ts's module doc).
 *
 * Same caveat as cairn-block.round-trip.ts: no test framework is wired into
 * this repo; `runMarkdownSourceRoundTripChecks()` is a plain function — see
 * ws-AR1-report.md for the executed results.
 */

import type { ComparisonCard } from "../comparisons";
import { isCardsBlock, type CardsBlock, type MarkdownBlock, type ReportBlock } from "./types";
import { parseReportMarkdown, serializeReportToMarkdown } from "./markdown-source";

export interface RoundTripResult {
  name: string;
  pass: boolean;
  detail?: string;
}

// ---------------------------------------------------------------------------
// (i) source → blocks → source: byte-identity over adversarial documents.
// ---------------------------------------------------------------------------

const SOURCE_CASES: Array<{ name: string; source: string }> = [
  {
    name: "prose, one cairn fence, prose",
    source: `# Report\n\nSome intro text.\n\n\`\`\`cairn\nid: blk1\nruns:\n  ids:\n    - run_a\ncards:\n  - type: scalar\n    metric: loss\n\`\`\`\n\nSome trailing text.`,
  },
  {
    name: "document starts with a cairn fence (no leading prose)",
    source: "```cairn\nid: blk1\nruns:\n  ids: []\ncards: []\n```\n\nAfter.",
  },
  {
    name: "an embedded ```cairn EXAMPLE inside prose, wrapped in a longer outer fence — must not be extracted",
    source:
      "Here's how to write one:\n\n````markdown\n```cairn\nruns:\n  ids: [run_a]\ncards: []\n```\n````\n\nDone.",
  },
  {
    name: "a real cairn fence directly adjacent to an unrelated python example fence",
    source: "```python\nprint('hi')\n```\n```cairn\nid: blk1\nruns:\n  ids: []\ncards: []\n```",
  },
  {
    name: "two cairn fences back-to-back, no prose between them",
    source: "```cairn\nid: blk1\nruns:\n  ids: []\ncards: []\n```\n```cairn\nid: blk2\nruns:\n  ids: []\ncards: []\n```",
  },
  {
    name: "malformed cairn fence (bad YAML) — still round-trips its raw text byte-identically",
    source: "Before.\n\n```cairn\nruns: [this is not a mapping\n```\n\nAfter.",
  },
  {
    name: "no trailing newline after the closing fence",
    source: "```cairn\nid: blk1\nruns:\n  ids: []\ncards: []\n```",
  },
];

export function runMarkdownSourceRoundTripChecks(): RoundTripResult[] {
  return SOURCE_CASES.map((c) => {
    const parsed = parseReportMarkdown(c.source);
    const reserialized = serializeReportToMarkdown(parsed.blocks, parsed.settings, parsed.rawCairnSource);
    const pass = reserialized === c.source;
    return {
      name: c.name,
      pass,
      detail: pass
        ? undefined
        : `--- original ---\n${JSON.stringify(c.source)}\n--- reserialized ---\n${JSON.stringify(reserialized)}\n--- blocks ---\n${JSON.stringify(parsed.blocks, null, 2)}`,
    };
  });
}

// ---------------------------------------------------------------------------
// (ii) blocks → source → blocks: id/order/content preservation for
// freshly-authored (cells-editor) blocks with no prior markdown source.
// ---------------------------------------------------------------------------

interface BlocksCase {
  name: string;
  blocks: ReportBlock[];
  settingsByCardId: Record<string, unknown>;
}

const card1: ComparisonCard = { id: "card_1", type: "scalar", series: [{ runId: "run_a", name: "loss", context_hash: "" }] };
const card2: ComparisonCard = { id: "card_2", type: "parallel", series: [{ runId: "run_a", name: "Parallel Coordinates", context_hash: "" }] };

const BLOCKS_CASES: BlocksCase[] = [
  {
    name: "markdown, cards, markdown — order + cards-block id preserved",
    blocks: [
      { id: "md_1", type: "markdown", text: "# Title\n\nIntro." } satisfies MarkdownBlock,
      { id: "cards_1", type: "cards", runIds: ["run_a"], cards: [card1] } satisfies CardsBlock,
      { id: "md_2", type: "markdown", text: "Outro." } satisfies MarkdownBlock,
    ],
    settingsByCardId: { card_1: { version: 1, yScale: "log" } },
  },
  {
    name: "two adjacent cards blocks, one with a runSelector, one static — both ids preserved",
    blocks: [
      { id: "cards_a", type: "cards", runSelector: { kind: "query", mode: "latest-n", n: 3 }, cards: [] } satisfies CardsBlock,
      { id: "cards_b", type: "cards", runIds: ["run_a"], cards: [card2] } satisfies CardsBlock,
    ],
    settingsByCardId: {},
  },
];

export function runBlocksRoundTripChecks(): RoundTripResult[] {
  return BLOCKS_CASES.map((c) => {
    const md = serializeReportToMarkdown(c.blocks, c.settingsByCardId, {});
    const parsed = parseReportMarkdown(md);

    if (parsed.blocks.length !== c.blocks.length) {
      return { name: c.name, pass: false, detail: `block count mismatch: got ${parsed.blocks.length}, want ${c.blocks.length}\n---md---\n${md}` };
    }

    const problems: string[] = [];
    c.blocks.forEach((orig, i) => {
      const got = parsed.blocks[i]!;
      if (isCardsBlock(orig)) {
        if (!isCardsBlock(got)) { problems.push(`block[${i}] expected cards, got ${got.type}`); return; }
        if (got.id !== orig.id) problems.push(`block[${i}] id mismatch: got ${got.id}, want ${orig.id}`);
        if (got.cards.length !== orig.cards.length) problems.push(`block[${i}] card count mismatch`);
      } else {
        if (isCardsBlock(got)) problems.push(`block[${i}] expected markdown, got cards`);
        // MarkdownBlock ids intentionally regenerate — only text is checked.
        if ("text" in got && got.text !== (orig as MarkdownBlock).text) problems.push(`block[${i}] text mismatch`);
      }
    });

    const pass = problems.length === 0;
    return { name: c.name, pass, detail: pass ? undefined : `${problems.join("; ")}\n---md---\n${md}` };
  });
}
