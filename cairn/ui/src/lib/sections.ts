// Auto-grouping rule from CAIRN_SPEC.md §"Section groups on the canvas":
// metric names with a "." → prefix is the section; else "Charts". Artifacts
// go into Media. Fixed section order: Charts, user-prefixed sections
// alphabetically, Media, system last.

import type { SequenceMeta } from "../api/types";

export interface Section {
  name: string;
  items: SequenceMeta[];
}

const MEDIA_TYPES = new Set([
  "image",
  "audio",
  "video",
  "figure",
  "histogram",
  "plugin",
]);

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
  // Deterministic section order.
  const order = (name: string): number => {
    if (name === "Charts") return 0;
    if (name === "Media") return 98;
    if (name === "system") return 99;
    return 1; // user-defined sections
  };
  const entries = Array.from(buckets.entries()).sort(([a], [b]) => {
    const oa = order(a);
    const ob = order(b);
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });
  return entries.map(([name, items]) => ({ name, items }));
}
