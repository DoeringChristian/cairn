import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { diffLines } from "diff";
import { api } from "../api/client";
import { disambiguateRunLabels } from "../lib/run-label";

interface Props {
  compRunIds: string[];
}

type FileStatus = "modified" | "added" | "removed" | "unchanged";

interface MergedFile {
  path: string;
  status: FileStatus;
  leftSha?: string;
  rightSha?: string;
}

export default function ComparisonSourceTab({ compRunIds }: Props) {
  const labels = useMemo(
    () => disambiguateRunLabels(compRunIds),
    [compRunIds],
  );

  const [rawLeftId, setLeftId] = useState<string>("");
  const [rawRightId, setRightId] = useState<string>("");
  const leftId = compRunIds.includes(rawLeftId) ? rawLeftId : (compRunIds[0] ?? "");
  const rightId = compRunIds.includes(rawRightId) ? rawRightId : (compRunIds[1] ?? compRunIds[0] ?? "");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const leftTree = useQuery({
    queryKey: ["sourceTree", leftId],
    queryFn: () => api.sourceTree(leftId),
    enabled: !!leftId,
    staleTime: Infinity,
    retry: false,
  });

  const rightTree = useQuery({
    queryKey: ["sourceTree", rightId],
    queryFn: () => api.sourceTree(rightId),
    enabled: !!rightId,
    staleTime: Infinity,
    retry: false,
  });

  // Merge file trees
  const mergedFiles = useMemo<MergedFile[]>(() => {
    if (!leftTree.data || !rightTree.data) return [];
    const leftMap = new Map(leftTree.data.files.map((f) => [f.path, f.sha256]));
    const rightMap = new Map(rightTree.data.files.map((f) => [f.path, f.sha256]));
    const allPaths = new Set([...leftMap.keys(), ...rightMap.keys()]);
    const result: MergedFile[] = [];
    for (const path of Array.from(allPaths).sort()) {
      const l = leftMap.get(path);
      const r = rightMap.get(path);
      let status: FileStatus;
      if (l && r) {
        status = l === r ? "unchanged" : "modified";
      } else if (l) {
        status = "removed";
      } else {
        status = "added";
      }
      result.push({ path, status, leftSha: l, rightSha: r });
    }
    return result;
  }, [leftTree.data, rightTree.data]);

  const changedFiles = useMemo(
    () => mergedFiles.filter((f) => f.status !== "unchanged"),
    [mergedFiles],
  );

  // Determine the selected file's status so we skip fetching the missing side.
  const selectedFileStatus = useMemo(
    () => mergedFiles.find((f) => f.path === selectedFile)?.status ?? null,
    [mergedFiles, selectedFile],
  );

  // Fetch file contents for diff
  const leftFile = useQuery({
    queryKey: ["sourceFile", leftId, selectedFile],
    queryFn: () => api.sourceFile(leftId, selectedFile!),
    enabled: !!selectedFile && !!leftId && selectedFileStatus !== "added",
    staleTime: Infinity,
    retry: false,
  });

  const rightFile = useQuery({
    queryKey: ["sourceFile", rightId, selectedFile],
    queryFn: () => api.sourceFile(rightId, selectedFile!),
    enabled: !!selectedFile && !!rightId && selectedFileStatus !== "removed",
    staleTime: Infinity,
    retry: false,
  });

  if (compRunIds.length < 2) {
    return (
      <p className="text-sm text-fg-muted">
        Add at least 2 runs to this comparison to diff their source snapshots.
      </p>
    );
  }

  const noSnapshot =
    (leftTree.isError || (!leftTree.isLoading && !leftTree.data)) ||
    (rightTree.isError || (!rightTree.isLoading && !rightTree.data));

  return (
    <div className="flex flex-col gap-4">
      {/* Run pair selector */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          <span className="text-fg-muted">Left:</span>
          <select
            className="input py-0.5 text-xs"
            value={leftId}
            onChange={(e) => { setLeftId(e.target.value); setSelectedFile(null); }}
          >
            {compRunIds.map((id) => (
              <option key={id} value={id}>
                {labels[id] ?? id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-fg-muted">Right:</span>
          <select
            className="input py-0.5 text-xs"
            value={rightId}
            onChange={(e) => { setRightId(e.target.value); setSelectedFile(null); }}
          >
            {compRunIds.map((id) => (
              <option key={id} value={id}>
                {labels[id] ?? id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {leftTree.isLoading || rightTree.isLoading ? (
        <p className="text-fg-muted">Loading source trees...</p>
      ) : noSnapshot ? (
        <p className="text-fg-muted">
          One or both runs do not have a source snapshot.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
          {/* File list */}
          <aside className="card max-h-[30vh] overflow-auto p-3 md:max-h-[70vh]">
            <div className="mb-2 text-xs uppercase tracking-wide text-fg-muted">
              {changedFiles.length} changed file{changedFiles.length === 1 ? "" : "s"}
              {" / "}
              {mergedFiles.length} total
            </div>
            {changedFiles.length === 0 ? (
              <p className="text-xs text-fg-subtle">Sources are identical.</p>
            ) : (
              <ul className="space-y-0.5 text-sm">
                {changedFiles.map((f) => (
                  <li key={f.path}>
                    <button
                      onClick={() => setSelectedFile(f.path)}
                      className={`mono flex w-full items-center gap-1.5 truncate rounded px-2 py-0.5 text-left hover:bg-bg-hover ${
                        selectedFile === f.path
                          ? "bg-bg-hover text-fg"
                          : "text-fg-muted"
                      }`}
                      title={f.path}
                    >
                      <StatusIcon status={f.status} />
                      {f.path}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          {/* Diff viewer */}
          <main className="card max-h-[70vh] overflow-auto p-4">
            {!selectedFile ? (
              <p className="text-fg-muted">Pick a file on the left.</p>
            ) : leftFile.isLoading || rightFile.isLoading ? (
              <p className="text-fg-muted">Loading...</p>
            ) : (
              <DiffView
                leftContent={leftFile.data?.encoding === "utf-8" ? leftFile.data.content : null}
                rightContent={rightFile.data?.encoding === "utf-8" ? rightFile.data.content : null}
                leftLabel={labels[leftId] ?? leftId.slice(0, 8)}
                rightLabel={labels[rightId] ?? rightId.slice(0, 8)}
                path={selectedFile}
              />
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: FileStatus }) {
  const map: Record<FileStatus, { letter: string; cls: string }> = {
    modified: { letter: "M", cls: "text-yellow-400" },
    added: { letter: "A", cls: "text-green-400" },
    removed: { letter: "D", cls: "text-red-400" },
    unchanged: { letter: " ", cls: "text-fg-subtle" },
  };
  const { letter, cls } = map[status];
  return <span className={`inline-block w-3 text-center text-[10px] font-bold ${cls}`}>{letter}</span>;
}

interface DiffViewProps {
  leftContent: string | null;
  rightContent: string | null;
  leftLabel: string;
  rightLabel: string;
  path: string;
}

function DiffView({ leftContent, rightContent, leftLabel, rightLabel, path }: DiffViewProps) {
  const left = leftContent ?? "";
  const right = rightContent ?? "";
  const parts = useMemo(() => diffLines(left, right), [left, right]);

  if (leftContent == null && rightContent == null) {
    return <p className="text-fg-muted">Binary file — cannot display diff.</p>;
  }

  return (
    <div className="text-xs">
      <div className="mb-2 mono text-fg-muted">
        <span className="text-red-400">--- {leftLabel}/{path}</span>
        <br />
        <span className="text-green-400">+++ {rightLabel}/{path}</span>
      </div>
      <pre className="mono whitespace-pre-wrap">
        {parts.map((part, i) => {
          let cls = "text-fg-muted";
          let prefix = " ";
          if (part.added) {
            cls = "bg-green-900/20 text-green-300";
            prefix = "+";
          } else if (part.removed) {
            cls = "bg-red-900/20 text-red-300";
            prefix = "-";
          }
          const lines = part.value.replace(/\n$/, "").split("\n");
          return (
            <span key={i} className={cls}>
              {lines.map((line, j) => (
                <span key={j}>
                  {prefix}{line}
                  {"\n"}
                </span>
              ))}
            </span>
          );
        })}
      </pre>
    </div>
  );
}
