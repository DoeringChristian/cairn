/**
 * Per-card-type minimum sizes and the collection-aware clamp helpers.
 *
 * A single source of truth: each card declares its `cardKind` to CardShell,
 * which stamps `data-cairn-min-h` / `data-cairn-min-span` on the card root.
 * The resize handle then reads those attributes off sibling cards to enforce
 * "no smaller than the largest minimum in the collection" — row-scoped for
 * height (cards sharing a visual row adopt one height) and section-scoped for
 * column span (colSpan syncs across the whole grid section).
 */

export type CardMinSize = { minHeight: number; minSpan: 1 | 2 | 3 | 4 | 6 };

/** Fallback when a card kind isn't in the table (or none is declared). */
export const DEFAULT_MIN_SIZE: CardMinSize = { minHeight: 150, minSpan: 1 };

/**
 * Minimum height (px) and column span each card type stays usable at. Values
 * are deliberately conservative — small enough not to fight normal use, large
 * enough that controls (sliders, legends, axes, settings rows) don't collapse.
 */
export const CARD_MIN_SIZES: Record<string, CardMinSize> = {
  scalar: { minHeight: 200, minSpan: 1 },
  image: { minHeight: 220, minSpan: 1 },
  figure: { minHeight: 300, minSpan: 2 },
  table: { minHeight: 220, minSpan: 2 },
  parallel: { minHeight: 250, minSpan: 2 },
  scatter: { minHeight: 220, minSpan: 1 },
  histogram: { minHeight: 180, minSpan: 1 },
  tensor: { minHeight: 200, minSpan: 1 },
  pointcloud: { minHeight: 280, minSpan: 2 },
  mesh: { minHeight: 280, minSpan: 2 },
  boxes3d: { minHeight: 280, minSpan: 2 },
  volume: { minHeight: 280, minSpan: 2 },
  bar: { minHeight: 200, minSpan: 1 },
  tile: { minHeight: 120, minSpan: 1 },
  html: { minHeight: 150, minSpan: 1 },
  markdown: { minHeight: 150, minSpan: 1 },
  text: { minHeight: 150, minSpan: 1 },
  audio: { minHeight: 120, minSpan: 1 },
  video: { minHeight: 180, minSpan: 1 },
  artifact: { minHeight: 120, minSpan: 1 },
};

export function cardMinSize(kind?: string): CardMinSize {
  return (kind ? CARD_MIN_SIZES[kind] : undefined) ?? DEFAULT_MIN_SIZE;
}

export const VALID_CARD_SPANS = [1, 2, 3, 4, 6] as const;

/** Round a raw minimum span up to the nearest valid span value. */
export function snapSpanUp(minSpan: number): number {
  for (const v of VALID_CARD_SPANS) if (v >= minSpan) return v;
  return VALID_CARD_SPANS[VALID_CARD_SPANS.length - 1];
}

function readMinHeight(el: Element): number {
  const v = Number((el as HTMLElement).getAttribute("data-cairn-min-h"));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MIN_SIZE.minHeight;
}

function readMinSpan(el: Element): number {
  const v = Number((el as HTMLElement).getAttribute("data-cairn-min-span"));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MIN_SIZE.minSpan;
}

/**
 * The largest per-card minimum height among the cards sharing `card`'s visual
 * row (top edges within `epsilonPx`). Includes `card` itself.
 */
export function rowMinHeight(card: HTMLElement, gridEl: HTMLElement, epsilonPx = 2): number {
  const top = card.getBoundingClientRect().top;
  let min = readMinHeight(card);
  for (const el of gridEl.querySelectorAll("[data-cairn-card]")) {
    if (Math.abs((el as HTMLElement).getBoundingClientRect().top - top) < epsilonPx) {
      min = Math.max(min, readMinHeight(el));
    }
  }
  return min;
}

/** The largest per-card minimum span among all cards in the grid section (colSpan syncs section-wide). */
export function sectionMinSpan(gridEl: HTMLElement): number {
  let min = 1;
  for (const el of gridEl.querySelectorAll("[data-cairn-card]")) {
    min = Math.max(min, readMinSpan(el));
  }
  return snapSpanUp(min);
}

/** This card's own minimum height, read off its root data attribute. */
export function ownMinHeight(card: HTMLElement | null): number {
  return card ? readMinHeight(card) : DEFAULT_MIN_SIZE.minHeight;
}

/** This card's own minimum span, read off its root data attribute. */
export function ownMinSpan(card: HTMLElement | null): number {
  return card ? readMinSpan(card) : DEFAULT_MIN_SIZE.minSpan;
}
