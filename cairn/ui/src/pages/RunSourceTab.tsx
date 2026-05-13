import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useSourceFile, useSourceTree } from "../api/hooks";
import { formatBytes } from "../lib/format";
import { getHighlighter, langFromPath } from "../lib/syntax-highlight";

export default function RunSourceTab() {
  const { runId } = useParams<{ runId: string }>();
  const tree = useSourceTree(runId!);
  const [selected, setSelected] = useState<string | null>(null);
  const file = useSourceFile(runId!, selected);

  const highlighted = useQuery({
    queryKey: ["highlight", selected, file.data?.content],
    enabled: !!file.data && file.data.encoding === "utf-8",
    queryFn: async () => {
      const lang = langFromPath(selected!);
      if (!lang) return null;
      const h = await getHighlighter();
      return h.codeToHtml(file.data!.content, {
        lang,
        theme: "github-dark",
      });
    },
    retry: false,
    staleTime: Infinity,
  });

  if (tree.isLoading) return <p className="text-fg-muted">Loading source…</p>;
  if (tree.isError)
    return (
      <p className="text-fg-muted">
        No source archive was captured for this run.
      </p>
    );
  const files = tree.data?.files ?? [];
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
      <aside className="card max-h-[30vh] overflow-auto p-3 md:max-h-[70vh]">
        <div className="mb-2 text-xs uppercase tracking-wide text-fg-muted">
          {files.length} files
          {tree.data?.marker ? ` · marker: ${tree.data.marker}` : ""}
        </div>
        <ul className="space-y-0.5 text-sm">
          {files.map((f) => (
            <li key={f.path}>
              <button
                onClick={() => setSelected(f.path)}
                className={`mono block w-full truncate rounded px-2 py-0.5 text-left hover:bg-bg-hover ${
                  selected === f.path ? "bg-bg-hover text-fg" : "text-fg-muted"
                }`}
                title={f.path}
              >
                {f.path}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="card max-h-[70vh] overflow-auto p-4">
        {!selected ? (
          <p className="text-fg-muted">Pick a file on the left.</p>
        ) : file.isLoading ? (
          <p className="text-fg-muted">Loading…</p>
        ) : file.data?.encoding === "base64" ? (
          <p className="text-fg-muted">
            Binary file ({formatBytes(file.data.content.length)} base64).
          </p>
        ) : highlighted.data ? (
          <div
            className="text-xs overflow-auto"
            dangerouslySetInnerHTML={{ __html: highlighted.data }}
          />
        ) : (
          <pre className="mono whitespace-pre-wrap text-xs">
            {file.data?.content ?? ""}
          </pre>
        )}
      </main>
    </div>
  );
}
