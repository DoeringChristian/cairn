/**
 * Named, persisted multi-comparison storage — public surface.
 *
 * See store.ts (CRUD), templates.ts (comparison templates), sync.ts (server
 * sync), events.ts (in-tab pubsub + the useComparisons hook), and types.ts
 * (shared types/guards) for implementation.
 */

export type {
  ComparisonSeriesRef,
  ComparisonCard,
  MultiRunCardType,
  SmartFilterEntry,
  SmartFilters,
  Comparison,
} from "./types";
export {
  compareRunId,
  cardSettingsKeyForScope,
  MULTI_RUN_CARD_TYPES,
  MULTI_RUN_CARD_LABELS,
  isMultiRunCardType,
} from "./types";

export {
  loadComparisons,
  saveComparisons,
  createComparison,
  renameComparison,
  deleteComparison,
  addCardToComparison,
  addCardsToComparison,
  addRunsToComparison,
  removeRunFromComparison,
  reorderComparisonCards,
  removeCardFromComparison,
} from "./store";

export { useComparisons } from "./events";

export type { ComparisonTemplateCard, ComparisonTemplate } from "./templates";
export {
  loadTemplates,
  saveTemplates,
  createTemplate,
  deleteTemplate,
  useTemplates,
} from "./templates";

export {
  syncComparisonToServer,
  deleteComparisonFromServer,
  syncComparisonsFromServer,
  cardSettingsKeyFor,
} from "./sync";

export {
  syncTemplateToServer,
  deleteTemplateFromServer,
  syncTemplatesFromServer,
} from "./template-sync";

export type {
  SeriesEntry,
  MatchedTemplateCard,
  SeqMap,
  ApplyTemplateResult,
} from "./apply-template";
export { buildSeqMap, matchTemplateCards, applyTemplateToRuns } from "./apply-template";
