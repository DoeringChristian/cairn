/**
 * Per-run card layout overrides persisted to localStorage.
 *
 * A layout describes, per run:
 *   1. Which section each card belongs to (override for auto-assignment).
 *   2. The order of cards within each section.
 *   3. The order of sections on the page (used when the user drags a card into
 *      a section that didn't already exist in auto-grouped order).
 *
 * An empty layout (no entries) is observationally identical to no persisted
 * layout at all — behavior falls back to `groupIntoSections`.
 */

import type { SequenceMeta } from "../api/types";
import type { Section } from "./sections";

export interface RunLayout {
  version: 1;
  /** Section order. Auto-sections not listed here fall back to the default order after user sections. */
  sectionOrder: string[];
  /** cardKey → section name. Overrides auto-grouping. */
  cardSection: Record<string, string>;
  /** Within each section, the order of cards by cardKey. Cards not listed sort alphabetically after listed ones. */
  sectionOrderOfCards: Record<string, string[]>;
}

export const EMPTY_LAYOUT: RunLayout = {
  version: 1,
  sectionOrder: [],
  cardSection: {},
  sectionOrderOfCards: {},
};

/**
 * Build the storage cardKey for a SequenceMeta.
 *
 * Uses `::` as a separator (rather than string concat) so that two metrics
 * whose names end / start with the same characters can't collide.
 */
export function cardKeyOf(meta: SequenceMeta): string {
  return `${meta.name}::${meta.context_hash}`;
}

function storageKey(runId: string): string {
  return `cairn:run-layout:${runId}`;
}

export function loadRunLayout(runId: string): RunLayout {
  try {
    const raw = localStorage.getItem(storageKey(runId));
    if (!raw) return { ...EMPTY_LAYOUT };
    const parsed = JSON.parse(raw) as Partial<RunLayout> | null;
    if (!parsed || parsed.version !== 1) return { ...EMPTY_LAYOUT };
    return {
      version: 1,
      sectionOrder: Array.isArray(parsed.sectionOrder) ? [...parsed.sectionOrder] : [],
      cardSection:
        parsed.cardSection && typeof parsed.cardSection === "object"
          ? { ...parsed.cardSection }
          : {},
      sectionOrderOfCards:
        parsed.sectionOrderOfCards && typeof parsed.sectionOrderOfCards === "object"
          ? Object.fromEntries(
              Object.entries(parsed.sectionOrderOfCards).map(([k, v]) => [
                k,
                Array.isArray(v) ? [...v] : [],
              ]),
            )
          : {},
    };
  } catch {
    return { ...EMPTY_LAYOUT };
  }
}

export function saveRunLayout(runId: string, layout: RunLayout): void {
  try {
    localStorage.setItem(storageKey(runId), JSON.stringify(layout));
  } catch {
    /* quota exceeded or disabled storage; silently drop */
  }
}

export function resetRunLayout(runId: string): void {
  try {
    localStorage.removeItem(storageKey(runId));
  } catch {
    /* ignore */
  }
}

export function isEmptyLayout(layout: RunLayout): boolean {
  return (
    layout.sectionOrder.length === 0 &&
    Object.keys(layout.cardSection).length === 0 &&
    Object.keys(layout.sectionOrderOfCards).length === 0
  );
}

/**
 * Apply a layout on top of auto-grouped sections, returning the final render
 * list the UI should render.
 *
 * Algorithm:
 *   1. Walk every card in `autoSections` and route it to its override section
 *      (if any). Sections referenced by override but absent from auto-sections
 *      are created on the fly.
 *   2. Within each section, sort cards: those listed in
 *      `layout.sectionOrderOfCards[section]` come first in that order;
 *      remaining cards follow in their original auto-order (alphabetical).
 *   3. Sort sections: those listed in `layout.sectionOrder` come first in that
 *      order; remaining sections follow in the default order from
 *      `groupIntoSections` (Charts, user-prefixed alphabetical, Media, system).
 */
export function applyLayout(
  autoSections: Section[],
  layout: RunLayout,
): Section[] {
  // 1. Route cards to overridden sections.
  //
  // We preserve the auto-order of each card (its index in its auto-section)
  // so we can sort "unlisted" cards consistently in step 2.
  type Routed = {
    meta: SequenceMeta;
    autoIndex: number; // index in its *auto* section (for unlisted fallback)
  };
  const routed = new Map<string, Routed[]>();
  const defaultAutoOrder = autoSections.map((s) => s.name);

  // Ensure every auto section exists in routed (even if all its cards were
  // moved elsewhere) so we don't lose the default section-order anchor.
  for (const s of autoSections) {
    if (!routed.has(s.name)) routed.set(s.name, []);
  }

  for (const section of autoSections) {
    section.items.forEach((meta, idx) => {
      const key = cardKeyOf(meta);
      const target = layout.cardSection[key] ?? section.name;
      const arr = routed.get(target) ?? [];
      arr.push({ meta, autoIndex: idx });
      routed.set(target, arr);
    });
  }

  // 2. Sort cards within each section.
  const orderedSections: Section[] = [];
  for (const [name, items] of routed.entries()) {
    const listed = layout.sectionOrderOfCards[name] ?? [];
    const listedSet = new Set(listed);

    // Cards listed in layout, in layout order, filtered to those actually present.
    const byKey = new Map<string, Routed>();
    for (const r of items) byKey.set(cardKeyOf(r.meta), r);

    const ordered: SequenceMeta[] = [];
    for (const k of listed) {
      const r = byKey.get(k);
      if (r) ordered.push(r.meta);
    }
    // Remaining cards: keep original auto-order (alphabetical from
    // groupIntoSections) as the stable fallback.
    const remaining = items
      .filter((r) => !listedSet.has(cardKeyOf(r.meta)))
      .sort((a, b) => {
        if (a.autoIndex !== b.autoIndex) return a.autoIndex - b.autoIndex;
        return a.meta.name.localeCompare(b.meta.name);
      });
    for (const r of remaining) ordered.push(r.meta);

    orderedSections.push({ name, items: ordered });
  }

  // 3. Sort sections. `layout.sectionOrder` first (in order), then any
  // remaining sections in the default auto-order, then sections that exist
  // only in the layout (but not in `layout.sectionOrder` — shouldn't happen
  // via `moveCard`, but be defensive).
  const bySectionName = new Map<string, Section>();
  for (const s of orderedSections) bySectionName.set(s.name, s);

  const final: Section[] = [];
  const placed = new Set<string>();

  for (const name of layout.sectionOrder) {
    const s = bySectionName.get(name);
    if (s && !placed.has(name)) {
      final.push(s);
      placed.add(name);
    }
  }
  for (const name of defaultAutoOrder) {
    const s = bySectionName.get(name);
    if (s && !placed.has(name)) {
      final.push(s);
      placed.add(name);
    }
  }
  for (const s of orderedSections) {
    if (!placed.has(s.name)) {
      final.push(s);
      placed.add(s.name);
    }
  }

  // Drop sections that ended up empty (all cards moved out and nothing moved
  // in). Preserving empty sections would show ghost headers.
  return final.filter((s) => s.items.length > 0);
}

/**
 * Generate a new layout after a drag-drop operation.
 *
 * - Removes `cardKey` from whichever section's card-order list it currently
 *   appears in (searches all; also clears `cardSection[cardKey]` if moving to
 *   an existing auto-section anchor).
 * - Sets `cardSection[cardKey] = toSection`.
 * - Inserts `cardKey` into `sectionOrderOfCards[toSection]` at `toIndex`
 *   (appends if `toIndex` is null).
 * - Appends `toSection` to `sectionOrder` if not already present.
 *
 * Returns a new object (immutable update pattern).
 */
export function moveCard(
  current: RunLayout,
  cardKey: string,
  _fromSection: string,
  toSection: string,
  toIndex: number | null,
): RunLayout {
  // Deep-clone the bits we'll mutate.
  const sectionOrderOfCards: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(current.sectionOrderOfCards)) {
    sectionOrderOfCards[k] = v.filter((c) => c !== cardKey);
  }

  const cardSection: Record<string, string> = { ...current.cardSection };
  cardSection[cardKey] = toSection;

  const destList = sectionOrderOfCards[toSection] ?? [];
  if (toIndex === null || toIndex >= destList.length) {
    destList.push(cardKey);
  } else {
    const clamped = Math.max(0, toIndex);
    destList.splice(clamped, 0, cardKey);
  }
  sectionOrderOfCards[toSection] = destList;

  const sectionOrder = current.sectionOrder.includes(toSection)
    ? [...current.sectionOrder]
    : [...current.sectionOrder, toSection];

  return {
    version: 1,
    sectionOrder,
    cardSection,
    sectionOrderOfCards,
  };
}
