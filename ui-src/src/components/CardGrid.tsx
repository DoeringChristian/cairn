import ScalarPlotCard from "./ScalarPlotCard";
import ImageGalleryCard from "./ImageGalleryCard";
import TextViewerCard from "./TextViewerCard";
import type { SequenceMeta } from "../api/types";
import { groupIntoSections } from "../lib/sections";

interface Props {
  runId: string;
  sequences: SequenceMeta[];
}

export default function CardGrid({ runId, sequences }: Props) {
  if (sequences.length === 0) {
    return <p className="text-fg-muted">No metrics logged for this run yet.</p>;
  }
  const sections = groupIntoSections(sequences);
  // Merge scalar series that share a name but differ only by context into
  // a single card with multiple lines.
  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <section key={section.name}>
          <header className="mb-3 flex items-baseline justify-between border-b border-border pb-1">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
              {section.name}
            </h2>
            <span className="text-xs text-fg-subtle">{section.items.length} card(s)</span>
          </header>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {collapseScalars(section.items).map((entry) => (
              <CardFor key={entry.primary.name + entry.primary.context_hash}
                runId={runId} entry={entry} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface Entry {
  primary: SequenceMeta;
  extras: SequenceMeta[];
}

function collapseScalars(metas: SequenceMeta[]): Entry[] {
  // Group scalar metrics with the same name into one card.
  const byKey = new Map<string, Entry>();
  const out: Entry[] = [];
  for (const m of metas) {
    if (m.object_type === "scalar") {
      const existing = byKey.get(m.name);
      if (existing) {
        existing.extras.push(m);
      } else {
        const e: Entry = { primary: m, extras: [] };
        byKey.set(m.name, e);
        out.push(e);
      }
    } else {
      out.push({ primary: m, extras: [] });
    }
  }
  return out;
}

function CardFor({ runId, entry }: { runId: string; entry: Entry }) {
  const { primary, extras } = entry;
  switch (primary.object_type) {
    case "scalar":
      return <ScalarPlotCard runId={runId} metric={primary} extraContexts={extras} />;
    case "image":
      return <ImageGalleryCard runId={runId} metric={primary} />;
    case "text":
      return <TextViewerCard runId={runId} metric={primary} />;
    default:
      return (
        <div className="card p-4 text-sm text-fg-muted">
          <div className="mono mb-1 font-semibold">{primary.name}</div>
          <div>
            object_type <span className="mono">{primary.object_type}</span> renderer
            will arrive in the next UI pass.
          </div>
        </div>
      );
  }
}
