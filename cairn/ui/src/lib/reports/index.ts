/**
 * Report documents — public surface.
 *
 * See types.ts (block/payload shapes), scope.ts (settings pseudo-scope,
 * parallel to lib/comparisons' compareRunId), payload.ts (build/restore
 * card settings on save/load), ids.ts (block/card id generation).
 */

export type {
  MarkdownBlock,
  CardsBlock,
  ReportBlock,
  ReportPayload,
} from "./types";
export { isMarkdownBlock, isCardsBlock, allReportCards } from "./types";

export { reportRunId, cardSettingsKeyForReport } from "./scope";
export { buildReportPayload, restoreReportCardSettings } from "./payload";
export { newId } from "./ids";

export type { AddCardSelection, SelectionRuns } from "./card-from-spec";
export { cardFromSpec } from "./card-from-spec";

export type { MetricIndex, MetricIndexEntry } from "./metric-index";
export { buildMetricIndex, metricEntriesByName } from "./metric-index";

export type { CairnSpec, CompiledCairnBlock } from "./cairn-block";
export { CairnBlockError, parseCairnSpec, compileCairnBlock, serializeCairnSpec, stringifyCairnSpec } from "./cairn-block";

export type { ReportTemplate, ReportTemplateCard } from "./templates";
export {
  loadReportTemplates,
  saveReportTemplates,
  createReportTemplate,
  deleteReportTemplate,
  useReportTemplates,
} from "./templates";

export {
  syncReportTemplateToServer,
  deleteReportTemplateFromServer,
  syncReportTemplatesFromServer,
} from "./template-sync";

export type { ApplyReportTemplateResult } from "./apply-template";
export { applyReportTemplateToRuns } from "./apply-template";
