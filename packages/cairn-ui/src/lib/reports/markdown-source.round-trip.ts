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
 *
 * (c) WS-MDDELIM: the adjacent-markdown-cell boundary marker
 * (`CELL_BOUNDARY_MARKER` in markdown-source.ts). `runCellBoundaryRoundTripChecks()`
 * below asserts block *count* (not just byte-identity — a bug that silently
 * re-merges two cells into one can still be byte-identical on the source
 * side, since the merged single block would just cache the marker inside its
 * own text and re-emit it verbatim) for: two/three chained adjacent markdown
 * cells, a pre-existing report with no marker (must still merge, unchanged),
 * prose+card+prose, and a lone markdown cell (must emit no marker at all).
 */

import type { ComparisonCard } from "../comparisons";
import { isCardsBlock, isMarkdownBlock, type CardsBlock, type MarkdownBlock, type ReportBlock } from "./types";
import { CELL_BOUNDARY_MARKER, parseReportMarkdown, serializeReportToMarkdown } from "./markdown-source";

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
  {
    name: "two adjacent markdown cells — survive as two independent cells, not merged (WS-MDDELIM)",
    blocks: [
      { id: "md_a", type: "markdown", text: "Cell A text." } satisfies MarkdownBlock,
      { id: "md_b", type: "markdown", text: "Cell B text." } satisfies MarkdownBlock,
    ],
    settingsByCardId: {},
  },
  {
    name: "three adjacent markdown cells chained — all three survive independently (WS-MDDELIM)",
    blocks: [
      { id: "md_a", type: "markdown", text: "A" } satisfies MarkdownBlock,
      { id: "md_b", type: "markdown", text: "B" } satisfies MarkdownBlock,
      { id: "md_c", type: "markdown", text: "C" } satisfies MarkdownBlock,
    ],
    settingsByCardId: {},
  },
  {
    name: "single markdown cell — unaffected by the boundary marker (WS-MDDELIM)",
    blocks: [{ id: "md_1", type: "markdown", text: "Solo cell." } satisfies MarkdownBlock],
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

// ---------------------------------------------------------------------------
// (iii) WS-MDDELIM: block-*count* assertions the byte-identity check above
// can't catch (a silently-remerged cell would still byte-match, since the
// merged block just caches the marker inside its own text). Also covers
// hand-authored source containing the marker directly (simulating a report
// already saved by the fixed code) and the backward-compat "old report, no
// marker" case.
// ---------------------------------------------------------------------------

function countMarkdown(blocks: ReportBlock[]): number {
  return blocks.filter(isMarkdownBlock).length;
}

export function runCellBoundaryRoundTripChecks(): RoundTripResult[] {
  const results: RoundTripResult[] = [];

  // (a) Old report, no marker: two "paragraphs" joined by an ordinary
  // newline (today's pre-fix save output, or literally any hand-authored
  // markdown) must still merge into ONE markdown block — unchanged
  // behavior for every pre-existing report.
  {
    const source = "Cell A text.\nCell B text.";
    const parsed = parseReportMarkdown(source);
    const reserialized = serializeReportToMarkdown(parsed.blocks, parsed.settings, parsed.rawCairnSource);
    const pass = countMarkdown(parsed.blocks) === 1 && parsed.blocks.length === 1 && reserialized === source;
    results.push({
      name: "old report (no marker): adjacent prose still merges into one block — backward compatible (WS-MDDELIM)",
      pass,
      detail: pass ? undefined : `blocks: ${JSON.stringify(parsed.blocks)}\nreserialized: ${JSON.stringify(reserialized)}`,
    });
  }

  // (b) A source string already containing the marker (as the fixed
  // serializer would emit for two adjacent markdown cells) must parse into
  // TWO markdown blocks with the marker stripped from both texts, and must
  // reserialize back to byte-identical source.
  {
    const source = `Cell A text.${CELL_BOUNDARY_MARKER}\n\nCell B text.`;
    const parsed = parseReportMarkdown(source);
    const reserialized = serializeReportToMarkdown(parsed.blocks, parsed.settings, parsed.rawCairnSource);
    const texts = parsed.blocks.filter(isMarkdownBlock).map((b) => b.text);
    const pass =
      parsed.blocks.length === 2 &&
      texts.length === 2 &&
      texts[0] === "Cell A text." &&
      texts[1] === "Cell B text." &&
      reserialized === source;
    results.push({
      name: "source already containing the marker splits into two blocks and round-trips byte-identically (WS-MDDELIM)",
      pass,
      detail: pass ? undefined : `blocks: ${JSON.stringify(parsed.blocks)}\nreserialized: ${JSON.stringify(reserialized)}`,
    });
  }

  // (c) prose + card + prose: the fence already forces a split — must
  // remain 3 blocks (markdown, cards, markdown), no marker involved at all.
  {
    const source = "Intro paragraph.\n\n```cairn\nid: blk1\nruns:\n  ids: []\ncards: []\n```\n\nOutro paragraph.";
    const parsed = parseReportMarkdown(source);
    const pass =
      parsed.blocks.length === 3 &&
      isMarkdownBlock(parsed.blocks[0]!) &&
      !isMarkdownBlock(parsed.blocks[1]!) &&
      isMarkdownBlock(parsed.blocks[2]!);
    results.push({
      name: "prose + card + prose — still 3 blocks (WS-MDDELIM)",
      pass,
      detail: pass ? undefined : `blocks: ${JSON.stringify(parsed.blocks)}`,
    });
  }

  // (d) A single markdown cell — serializing it (with no following markdown
  // sibling) must never emit the marker at all.
  {
    const blocks: ReportBlock[] = [{ id: "md_1", type: "markdown", text: "Solo cell." } satisfies MarkdownBlock];
    const md = serializeReportToMarkdown(blocks, {}, {});
    const pass = !md.includes(CELL_BOUNDARY_MARKER) && md === "Solo cell.";
    results.push({
      name: "single markdown cell emits no boundary marker (WS-MDDELIM)",
      pass,
      detail: pass ? undefined : `md: ${JSON.stringify(md)}`,
    });
  }

  return results;
}
