/**
 * Shared GitHub-flavored markdown rendering surface.
 *
 * Sanitization contract: raw HTML in the source is NEVER rendered as markup
 * — react-markdown's default escaping stays on (no rehype-raw plugin), so a
 * `<script>` or any other tag in the source renders as inert text. Do not
 * add rehype-raw.
 *
 * Single source of truth for both MarkdownCard (run-logged markdown blobs)
 * and report markdown blocks — extracted here so both surfaces render GFM
 * markdown identically.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** `components` override map for react-markdown — theme tokens, no raw HTML. */
export const MD_COMPONENTS = {
  h1: (p: React.ComponentProps<"h1">) => <h1 className="mt-3 mb-2 text-lg font-semibold text-fg first:mt-0" {...p} />,
  h2: (p: React.ComponentProps<"h2">) => <h2 className="mt-3 mb-1.5 text-base font-semibold text-fg first:mt-0" {...p} />,
  h3: (p: React.ComponentProps<"h3">) => <h3 className="mt-2 mb-1 text-sm font-semibold text-fg first:mt-0" {...p} />,
  h4: (p: React.ComponentProps<"h4">) => <h4 className="mt-2 mb-1 text-sm font-semibold text-fg-muted first:mt-0" {...p} />,
  p: (p: React.ComponentProps<"p">) => <p className="my-1.5 leading-relaxed text-fg" {...p} />,
  a: (p: React.ComponentProps<"a">) => <a className="text-accent hover:underline" target="_blank" rel="noreferrer noopener" {...p} />,
  ul: (p: React.ComponentProps<"ul">) => <ul className="my-1.5 ml-5 list-disc space-y-0.5" {...p} />,
  ol: (p: React.ComponentProps<"ol">) => <ol className="my-1.5 ml-5 list-decimal space-y-0.5" {...p} />,
  li: (p: React.ComponentProps<"li">) => <li className="text-fg" {...p} />,
  blockquote: (p: React.ComponentProps<"blockquote">) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-fg-muted" {...p} />
  ),
  hr: (p: React.ComponentProps<"hr">) => <hr className="my-3 border-border" {...p} />,
  strong: (p: React.ComponentProps<"strong">) => <strong className="font-semibold text-fg" {...p} />,
  em: (p: React.ComponentProps<"em">) => <em className="italic" {...p} />,
  del: (p: React.ComponentProps<"del">) => <del className="text-fg-subtle" {...p} />,
  code: (p: React.ComponentProps<"code">) => (
    <code className="mono rounded bg-bg-hover px-1 py-0.5 text-[0.85em] text-fg" {...p} />
  ),
  pre: (p: React.ComponentProps<"pre">) => (
    <pre
      className="mono my-2 overflow-auto rounded bg-bg p-3 text-xs text-fg-muted [&>code]:rounded-none [&>code]:bg-transparent [&>code]:p-0"
      {...p}
    />
  ),
  table: (p: React.ComponentProps<"table">) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs" {...p} />
    </div>
  ),
  thead: (p: React.ComponentProps<"thead">) => <thead className="bg-bg-hover" {...p} />,
  th: (p: React.ComponentProps<"th">) => (
    <th className="border border-border px-2 py-1 text-left font-semibold text-fg" {...p} />
  ),
  td: (p: React.ComponentProps<"td">) => <td className="border border-border px-2 py-1 text-fg-muted" {...p} />,
  input: (p: React.ComponentProps<"input">) => (
    <input {...p} disabled className="mr-1 accent-accent align-middle" />
  ),
};

/**
 * Render GFM markdown text with the shared theme + sanitization contract.
 *
 * A thin wrapper around `<ReactMarkdown>` — deliberately renders no wrapper
 * element of its own so drop-in call sites (like MarkdownCard) keep an
 * identical DOM shape to inlining `<ReactMarkdown remarkPlugins={[remarkGfm]}
 * components={MD_COMPONENTS}>` directly.
 */
export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
      {children}
    </ReactMarkdown>
  );
}
