/**
 * Markdown block editor/viewer for a report — textarea + live side-by-side
 * preview in edit mode, rendered prose only in view mode. Uses the shared
 * lib/markdown module (same MD_COMPONENTS + sanitization contract as
 * MarkdownCard — no raw HTML is ever rendered).
 */

import Markdown from "../../lib/markdown";
import type { MarkdownBlock } from "../../lib/reports";

interface Props {
  block: MarkdownBlock;
  editMode: boolean;
  onChange: (text: string) => void;
}

export default function ReportMarkdownBlock({ block, editMode, onChange }: Props) {
  if (!editMode) {
    return (
      <div className="rounded bg-bg p-3 text-sm">
        <Markdown>{block.text}</Markdown>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <textarea
        value={block.text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Write markdown… (GFM tables, task lists, code fences supported)"
        className="input h-64 w-full resize-y font-mono text-xs leading-relaxed"
        spellCheck={false}
      />
      <div className="h-64 overflow-y-auto rounded border border-border-subtle bg-bg p-3 text-sm">
        {block.text.trim() ? (
          <Markdown>{block.text}</Markdown>
        ) : (
          <span className="text-fg-subtle">Preview appears here…</span>
        )}
      </div>
    </div>
  );
}
