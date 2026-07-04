/**
 * Renders a full report markdown source string with ```cairn fences
 * compiled to live cards inline — the `language-cairn` extension point
 * added to the shared `<Markdown>` renderer (lib/markdown.tsx), scoped to
 * reports only. Base `MD_COMPONENTS` is never forked: every other markdown
 * construct (including any other fenced code block) renders exactly as
 * `<Markdown>` already does elsewhere (MarkdownCard, ReportMarkdownBlock).
 *
 * Used by the report editor's "Markdown source" view (live preview) and by
 * the read-only report viewer when rendering from `payload.source`.
 *
 * Intercepts at the `pre` level (not `code`): a fenced code block's HAST
 * shape is `<pre><code class="language-x">…</code></pre>`, and replacing
 * only `code` would leave our card grid nested inside the themed `<pre>`
 * box (overflow/padding meant for text). Overriding `pre` lets us bypass
 * that wrapper entirely for `language-cairn` blocks while falling through
 * to the original `pre` (calling `MD_COMPONENTS.pre` directly, not a copy)
 * for everything else.
 */

import { type ReactNode, isValidElement } from "react";
import type { Run } from "../../api/types";
import Markdown, { MD_COMPONENTS } from "../../lib/markdown";
import { CAIRN_FENCE_LANG } from "../../lib/reports";
import CairnFenceCard from "./CairnFenceCard";

interface Props {
  projectId: string;
  reportId: string;
  allProjectRuns: Run[];
  children: string;
}

function textFromChildren(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textFromChildren).join("");
  if (isValidElement<{ children?: ReactNode }>(children)) return textFromChildren(children.props.children);
  return "";
}

export default function ReportSourceMarkdown({ projectId, reportId, allProjectRuns, children }: Props) {
  return (
    <Markdown
      components={{
        pre: (p) => {
          const only = Array.isArray(p.children) ? (p.children.length === 1 ? p.children[0] : undefined) : p.children;
          const child = isValidElement<{ className?: string; children?: ReactNode }>(only) ? only : undefined;
          const classes = (child?.props.className ?? "").split(/\s+/);
          if (classes.includes(`language-${CAIRN_FENCE_LANG}`)) {
            const source = textFromChildren(child!.props.children).replace(/\n$/, "");
            return (
              <CairnFenceCard projectId={projectId} reportId={reportId} allProjectRuns={allProjectRuns} source={source} />
            );
          }
          return MD_COMPONENTS.pre(p);
        },
      }}
    >
      {children}
    </Markdown>
  );
}
