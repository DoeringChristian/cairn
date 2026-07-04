/**
 * The one parse⇄serialize bridge between a report's canonical markdown
 * serialization (prose + fenced ```cairn card specs) and the `blocks[]`
 * cells model (see docs/superpowers/specs/2026-07-04-ai-authored-reports.md
 * §4). `blocks[]` is a lossless *view*: every `MarkdownBlock` is a prose
 * region between fences, every `CardsBlock` is one ```cairn fence, compiled
 * via `compileCairnBlock` (lib/reports/cairn-block.ts).
 *
 * Fence splitting is line-based and single-pass (mirrors how CommonMark
 * itself parses fenced code blocks — no recursion): a fence opens on a line
 * of 3+ backticks/tildes and stays open, verbatim, until a line with a
 * matching-or-longer run of the *same* character closes it (or EOF). Only a
 * fence whose info-string's first word is exactly "cairn" gets extracted
 * into a `CardsBlock`; every other fence (any other language, or none) is
 * *never* split out — it's consumed as one atomic unit and appended into the
 * surrounding prose verbatim. This is what makes nested/embedded ``` safe:
 * an outer fence (say 4 backticks) containing a literal ```cairn example
 * (3 backticks) never closes early, because the inner run is shorter than
 * the outer's declared length — same rule CommonMark uses for real nesting.
 *
 * A malformed ```cairn block never aborts the parse: `parseReportMarkdown`
 * catches `CairnBlockError` per-fence and still emits a `CardsBlock` (empty
 * `cards`), recording the failure in `errors` — the caller (the block
 * editor, the ```cairn render component) shows it as an inline error.
 *
 * Byte-preservation vs. regeneration: `parseReportMarkdown` returns the
 * exact original fence text (delimiters included) per block id in
 * `rawCairnSource`. `serializeReportToMarkdown` re-emits that raw text
 * verbatim when given a matching id (so an immediate parse→serialize round
 * trip is byte-identical, including malformed blocks, comments, or an
 * author's own YAML formatting/key order) and only regenerates a fence via
 * `serializeCairnSpec`/`stringifyCairnSpec` for a block with no cached raw
 * text (freshly created in the cells editor, never parsed from source).
 * Callers that mutate a block after parsing MUST drop that block's
 * `rawCairnSource` entry (see ReportEditorPage), or the stale cached text
 * will shadow the edit.
 *
 * Block ids: a ```cairn fence carries its block id inline (the spec's
 * optional `id:` field, see cairn-block.ts) so cards-block ids survive a
 * cells⇄markdown⇄cells round trip with no visible artifact. Prose blocks
 * have no equivalent hidden channel under the "no raw HTML" sanitization
 * contract (lib/markdown.tsx) — their ids simply regenerate on every parse.
 * This is a deliberate, scoped answer to the design doc's open question #2;
 * it doesn't matter for correctness because settings are keyed by *card*
 * id (see lib/reports/scope.ts), never by block id.
 */

import type { MetricIndex } from "./metric-index";
import { CairnBlockError, compileCairnBlock, parseCairnSpec, serializeCairnSpec, stringifyCairnSpec } from "./cairn-block";
import { newId } from "./ids";
import { isCardsBlock, isMarkdownBlock, type CardsBlock, type ReportBlock } from "./types";

export const CAIRN_FENCE_LANG = "cairn";

interface FenceSegment {
  kind: "fence";
  lang: string;
  /** The fence's inner content only (no delimiter lines). */
  body: string;
  /** The full original text of the fence, delimiters included, verbatim. */
  raw: string;
}
interface ProseSegment {
  kind: "prose";
  text: string;
}
type Segment = FenceSegment | ProseSegment;

/** True for a line consisting of ≤3 leading spaces then a run of 3+ backticks/tildes, optionally followed by an info string. */
function matchFenceOpen(line: string): { indent: string; char: string; len: number; info: string } | null {
  const m = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/.exec(line);
  if (!m) return null;
  const [, indent, run, info] = m;
  // Backtick fences' info string may not itself contain a backtick (CommonMark) — not enforced here, adversarial edge case out of scope.
  return { indent: indent!, char: run![0]!, len: run!.length, info: (info ?? "").trim() };
}

function matchFenceClose(line: string, char: string, minLen: number): boolean {
  const m = new RegExp(`^ {0,3}(${char === "`" ? "`" : "~"}{${minLen},})[ \\t]*$`).exec(line);
  return !!m;
}

/**
 * Split markdown source into top-level prose/fence segments. Every input
 * line belongs to exactly one segment, and segments appear in document
 * order — `segments.map(rawText).join("\n")` reconstructs `source` exactly
 * (see module doc).
 */
function splitFences(source: string): Segment[] {
  const lines = source.split("\n");
  const segments: Segment[] = [];
  let proseBuf: string[] = [];
  let i = 0;

  const flushProse = () => {
    if (proseBuf.length > 0) {
      segments.push({ kind: "prose", text: proseBuf.join("\n") });
      proseBuf = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const open = matchFenceOpen(line);
    if (!open) {
      proseBuf.push(line);
      i++;
      continue;
    }
    let closeIdx = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (matchFenceClose(lines[j]!, open.char, open.len)) {
        closeIdx = j;
        break;
      }
    }
    const closed = closeIdx !== -1;
    const endIdx = closed ? closeIdx : lines.length - 1;
    const raw = lines.slice(i, endIdx + 1).join("\n");
    const bodyLines = lines.slice(i + 1, closed ? closeIdx : lines.length);
    const lang = open.info.split(/\s+/)[0] ?? "";

    if (lang === CAIRN_FENCE_LANG) {
      flushProse();
      segments.push({ kind: "fence", lang, body: bodyLines.join("\n"), raw });
    } else {
      // Any other fence (language, none, or unterminated) is never split
      // out — it stays literal, atomic, inside the surrounding prose.
      proseBuf.push(raw);
    }
    i = closed ? closeIdx + 1 : lines.length;
  }
  flushProse();
  return segments;
}

export interface ParsedReportMarkdown {
  blocks: ReportBlock[];
  /** cardId → inline settings, aggregated from every ```cairn fence. */
  settings: Record<string, unknown>;
  /** blockId → error message, for ```cairn fences that failed to compile (the block still appears, with `cards: []`). */
  errors: Record<string, string>;
  /** blockId → original fence text (delimiters included) — see module doc on byte-preservation. */
  rawCairnSource: Record<string, string>;
}

/**
 * Parse a report's canonical markdown source into the `blocks[]` view.
 * `metricIndex` (default empty) is only consulted for ```cairn cards that
 * omit `type` and need it inferred from a metric name — irrelevant for
 * markdown this module itself produced (`serializeReportToMarkdown` always
 * emits an explicit `type`), so callers on the structural cells⇄markdown
 * toggle path can omit it entirely and stay synchronous.
 */
export function parseReportMarkdown(source: string, metricIndex: MetricIndex = new Map()): ParsedReportMarkdown {
  const segments = splitFences(source);
  const blocks: ReportBlock[] = [];
  const settings: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const rawCairnSource: Record<string, string> = {};

  for (const seg of segments) {
    if (seg.kind === "prose") {
      blocks.push({ id: newId(), type: "markdown", text: seg.text });
      continue;
    }

    let specId: string | undefined;
    try {
      const spec = parseCairnSpec(seg.body);
      specId = spec.id;
      const compiled = compileCairnBlock(spec, metricIndex, specId ? { id: specId } : undefined);
      blocks.push(compiled.block);
      Object.assign(settings, compiled.settings);
      rawCairnSource[compiled.block.id] = seg.raw;
    } catch (e) {
      const id = specId ?? newId();
      const message = e instanceof CairnBlockError ? e.message : `Unexpected error: ${(e as Error).message}`;
      const errBlock: CardsBlock = { id, type: "cards", runIds: [], cards: [] };
      blocks.push(errBlock);
      errors[id] = message;
      rawCairnSource[id] = seg.raw;
    }
  }

  return { blocks, settings, errors, rawCairnSource };
}

/**
 * Serialize `blocks[]` (+ per-card settings) back to canonical markdown
 * source. Reuses each block's original fence text verbatim when present in
 * `rawCairnSource` (byte-preserving an unedited round trip); otherwise
 * regenerates a fresh ```cairn fence via `serializeCairnSpec`.
 */
export function serializeReportToMarkdown(
  blocks: ReportBlock[],
  settingsByCardId: Record<string, unknown> = {},
  rawCairnSource: Record<string, string> = {},
): string {
  return blocks
    .map((b) => {
      if (isMarkdownBlock(b)) return b.text;
      if (isCardsBlock(b)) {
        const raw = rawCairnSource[b.id];
        if (raw !== undefined) return raw;
        const body = stringifyCairnSpec(serializeCairnSpec(b, settingsByCardId));
        return `\`\`\`${CAIRN_FENCE_LANG}\n${body}\n\`\`\``;
      }
      return "";
    })
    .join("\n");
}
