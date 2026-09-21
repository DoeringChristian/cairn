// Auto-grouping rule from CAIRN_SPEC.md §"Section groups on the canvas":
// metric names with a "." → prefix is the section; else "Charts". Artifacts
// go into Media. Fixed section order: Charts, user-prefixed sections
// alphabetically, Media, system last.

import type { SequenceMeta } from "../api/types";
import type { ComparisonCard } from "./comparisons";

export interface Section {
  name: string;
  items: SequenceMeta[];
}

// R0 fix: this set was missing 8 of the media-like object_types, so e.g.
// a `foo.mesh` metric landed in a "foo" section instead of Media. Hand-fixed
// now; DERIVED from the card manifests (section === "media") once R5 lands.
const MEDIA_TYPES = new Set([
  "image",
  "audio",
  "video",
  "figure",
  "histogram",
  "tensor",
  "table",
  "pointcloud",
  "mesh",
  "boxes3d",
  "volume",
  "html",
  "markdown",
]);

function sectionOrder(name: string): number {
  if (name === "Charts") return 0;
  if (name === "Media") return 98;
  if (name === "system") return 99;
  return 1;
}

function sortBuckets<T>(buckets: Map<string, T[]>): [string, T[]][] {
  return Array.from(buckets.entries()).sort(([a], [b]) => {
    const oa = sectionOrder(a);
    const ob = sectionOrder(b);
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });
}

export function groupIntoSections(meta: SequenceMeta[]): Section[] {
  const buckets = new Map<string, SequenceMeta[]>();
  for (const m of meta) {
    let section: string;
    if (MEDIA_TYPES.has(m.object_type)) {
      section = "Media";
    } else if (m.name.includes(".")) {
      section = m.name.split(".")[0]!;
    } else {
      section = "Charts";
    }
    const arr = buckets.get(section) ?? [];
    arr.push(m);
    buckets.set(section, arr);
  }
  // Sort members deterministically by (name, context_hash).
  for (const arr of buckets.values()) {
    arr.sort((a, b) => {
      const c = a.name.localeCompare(b.name);
      if (c !== 0) return c;
      return (a.context_hash ?? "").localeCompare(b.context_hash ?? "");
    });
  }
  return sortBuckets(buckets).map(([name, items]) => ({ name, items }));
}

export interface ComparisonSection {
  name: string;
  cards: ComparisonCard[];
}

export function groupComparisonCardsIntoSections(
  cards: ComparisonCard[],
): ComparisonSection[] {
  const buckets = new Map<string, ComparisonCard[]>();
  for (const card of cards) {
    let section: string;
    if (card.type === "parallel" || card.type === "scatter") {
      section = "Charts";
    } else if (MEDIA_TYPES.has(card.type)) {
      section = "Media";
    } else {
      const name = card.series[0]?.name ?? "";
      if (name.includes(".")) {
        section = name.split(".")[0]!;
      } else {
        section = "Charts";
      }
    }
    const arr = buckets.get(section) ?? [];
    arr.push(card);
    buckets.set(section, arr);
  }
  return sortBuckets(buckets).map(([name, cards]) => ({ name, cards }));
}
