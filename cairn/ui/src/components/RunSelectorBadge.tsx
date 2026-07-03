/**
 * Shared "auto" badge + manual refresh affordance for anything bound to a
 * dynamic `RunSelector` (see lib/run-selector.ts) — used by both
 * ComparePage (comparisons) and ReportCardsBlock (report cards blocks) so
 * the visual language for "this run set re-resolves live" is identical
 * everywhere it appears.
 */

interface Props {
  /** Human description shown in the tooltip (see describeRunSelector). */
  title: string;
  /** Count of runs currently resolved — shown inline. */
  count: number;
  /** True while a refresh (re-resolve, and typically a card rebuild) is in flight. */
  isRefreshing: boolean;
  onRefresh: () => void;
}

export default function RunSelectorBadge({ title, count, isRefreshing, onRefresh }: Props) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent" title={title}>
      <span className="font-semibold uppercase tracking-wide">auto</span>
      <span className="text-fg-muted">
        {count} run{count === 1 ? "" : "s"}
      </span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
        className="text-accent hover:underline disabled:opacity-50"
        title="Re-resolve which runs currently match and refresh cards"
      >
        {isRefreshing ? "refreshing…" : "refresh"}
      </button>
    </span>
  );
}
