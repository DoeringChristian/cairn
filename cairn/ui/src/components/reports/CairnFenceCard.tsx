/**
 * Renders one ```cairn fence's body inline as live cards — the
 * language-cairn render component (see
 * docs/superpowers/specs/2026-07-04-ai-authored-reports.md §3.1). Used by
 * ReportSourceMarkdown's `pre` override, in place of the default
 * `<pre><code>` for any fence whose info string is exactly "cairn".
 *
 * Parses (lib/reports/cairn-block.ts), resolves the block's run set (static
 * `runs.ids`, or live via `useRunSelectorResolution` for `runs.selector` —
 * the same hook ReportCardsBlock uses), builds a MetricIndex for type
 * inference, compiles to a CardsBlock, writes inline settings into the
 * card-settings store (so CardRenderer picks them up unchanged, per D5 in
 * the design doc), and renders through the *existing* `ReportCardsBlock` —
 * no parallel card-render path. A parse/compile failure renders an inline
 * error banner instead of crashing the surrounding report.
 */

import { useEffect, useMemo, useRef } from "react";
import type { Run } from "../../api/types";
import { useRunSelectorResolution } from "../../api/hooks";
import { saveCardSettings } from "../../lib/card-settings";
import {
  CairnBlockError,
  cardSettingsKeyForReport,
  compileCairnBlock,
  parseCairnSpec,
  useMetricIndex,
} from "../../lib/reports";
import type { QueryRunSelector } from "../../lib/run-selector";
import ReportCardsBlock from "./ReportCardsBlock";

interface Props {
  projectId: string;
  reportId: string;
  allProjectRuns: Run[];
  /** The fence's raw YAML body (no ```cairn/``` delimiters). */
  source: string;
}

export default function CairnFenceCard({ projectId, reportId, allProjectRuns, source }: Props) {
  // Stable fallback id for the lifetime of this fence's position in the
  // document (specs without their own `id:` still get a stable per-mount
  // id, so ReportCardsBlock's internal keys/effects don't churn every
  // render — see cairn-block.ts's compileCairnBlock `opts.id`).
  const fallbackId = useRef<string>();
  if (!fallbackId.current) fallbackId.current = `cairn-preview-${Math.random().toString(36).slice(2)}`;

  let parseError: string | null = null;
  let selector: QueryRunSelector | undefined;
  let staticRunIds: string[] = [];
  let spec: ReturnType<typeof parseCairnSpec> | null = null;
  try {
    spec = parseCairnSpec(source);
  } catch (e) {
    parseError = e instanceof CairnBlockError ? e.message : `Unexpected error: ${(e as Error).message}`;
  }

  if (Array.isArray(spec?.runs?.ids)) {
    staticRunIds = spec.runs.ids.filter((x): x is string => typeof x === "string");
  }

  // We need `selector` as a real QueryRunSelector to call the resolution
  // hook — reparse defensively (parseCairnSpec already validated shape) by
  // re-deriving it the same way compileCairnBlock does. Kept intentionally
  // simple: if `runs.selector.mode` is missing/invalid, compileCairnBlock
  // below will throw and we show that error instead.
  if (spec?.runs?.selector && typeof spec.runs.selector.mode === "string") {
    const s = spec.runs.selector;
    selector = {
      kind: "query",
      mode: s.mode as QueryRunSelector["mode"],
      namePattern: typeof s.namePattern === "string" ? s.namePattern : undefined,
      tags: Array.isArray(s.tags) ? (s.tags as string[]) : undefined,
      n: typeof s.n === "number" ? s.n : undefined,
    };
  }

  const resolution = useRunSelectorResolution(projectId, selector);
  const runIds = selector ? resolution.runIds : staticRunIds;

  const { index: metricIndex } = useMetricIndex(runIds);

  // While a selector is still resolving its first batch of runs, `runIds` is
  // transiently empty — compiling now would surface a misleading "cannot
  // infer type"/empty-card error instead of a loading state. Skip compiling
  // until resolution has settled at least once.
  const selectorResolving = !!selector && resolution.isFetching && runIds.length === 0;

  const compiled = useMemo(() => {
    if (!spec || selectorResolving) return null;
    try {
      return compileCairnBlock(spec, metricIndex, { id: fallbackId.current, resolvedRunIds: runIds });
    } catch (e) {
      return { error: e instanceof CairnBlockError ? e.message : `Unexpected error: ${(e as Error).message}` };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, runIds.join("|"), metricIndex, selectorResolving]);

  const compileError = compiled && "error" in compiled ? compiled.error : null;
  const block = compiled && "block" in compiled ? compiled.block : null;

  // Write inline settings into the card-settings store so CardRenderer
  // reads them exactly like a cells-editor-authored card (D5, the design
  // doc's "canonical storage" reconciliation).
  useEffect(() => {
    if (!block) return;
    const settings = compiled && "settings" in compiled ? compiled.settings : {};
    for (const card of block.cards) {
      const s = settings[card.id];
      if (s && typeof s === "object") {
        saveCardSettings(cardSettingsKeyForReport(reportId, card), s);
      }
    }
  }, [block, compiled, reportId]);

  const error = parseError ?? compileError;
  if (error) {
    return (
      <div
        data-cairn-card
        className="my-2 rounded border border-status-failed/40 bg-status-failed/10 p-3 text-xs text-status-failed"
      >
        <div className="mb-1 font-semibold">```cairn block error</div>
        <pre className="mono whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }
  if (selectorResolving) {
    return (
      <div data-cairn-card className="my-2 rounded border border-border-subtle p-3 text-xs text-fg-muted">
        Resolving runs…
      </div>
    );
  }
  if (!block) return null;

  return (
    <ReportCardsBlock
      projectId={projectId}
      reportId={reportId}
      block={block}
      editMode={false}
      allProjectRuns={allProjectRuns}
      onChange={() => {
        /* read-only inline preview — edits happen by editing the YAML source */
      }}
    />
  );
}
