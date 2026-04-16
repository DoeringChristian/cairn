import { useState } from "react";
import { useParams } from "react-router-dom";
import { useLogs } from "../api/hooks";

export default function RunLogsTab() {
  const { runId } = useParams<{ runId: string }>();
  const [search, setSearch] = useState("");
  const [stream, setStream] = useState<string>("");
  const q = useLogs(runId!, { limit: 2000, search: search || undefined, stream: stream || undefined });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input max-w-[8rem]"
          value={stream}
          onChange={(e) => setStream(e.target.value)}
        >
          <option value="">all streams</option>
          <option value="stdout">stdout</option>
          <option value="stderr">stderr</option>
        </select>
        <span className="ml-auto text-xs text-fg-subtle">
          {q.data ? `${q.data.total} line(s)` : ""}
        </span>
      </div>
      <pre className="mono h-[60vh] overflow-auto rounded border border-border bg-bg p-3 text-xs">
        {q.isLoading
          ? "Loading…"
          : (q.data?.lines ?? []).length === 0
            ? "(no log lines yet)"
            : (q.data?.lines ?? [])
                .map((l) =>
                  `${l.stream === "stderr" ? "E" : " "} ${l.line_no
                    .toString()
                    .padStart(5)}  ${l.content}`,
                )
                .join("\n")}
      </pre>
    </div>
  );
}
