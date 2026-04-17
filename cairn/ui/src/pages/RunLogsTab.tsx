import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useLogs, useRun } from "../api/hooks";

function formatTime(wall: string): string {
  const d = new Date(wall);
  if (Number.isNaN(d.getTime())) return "--:--:--.---";
  const hms = d.toLocaleTimeString("en-US", { hour12: false });
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hms}.${ms}`;
}

const LINE_HEIGHT_PX = 16;

export default function RunLogsTab() {
  const { runId } = useParams<{ runId: string }>();
  const [search, setSearch] = useState("");
  const [stream, setStream] = useState<string>("");
  const [jumpTs, setJumpTs] = useState<string>("");
  const [isFollowing, setIsFollowing] = useState(true);

  const q = useLogs(runId!, {
    limit: 2000,
    search: search || undefined,
    stream: stream || undefined,
  });
  const runQ = useRun(runId!);
  const runIsRunning = runQ.data?.run.status === "running";

  const preRef = useRef<HTMLPreElement>(null);
  const lines = q.data?.lines ?? [];

  // Auto-follow: scroll to bottom when new lines arrive and we're in follow mode.
  useEffect(() => {
    if (!isFollowing || !runIsRunning) return;
    const el = preRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length, isFollowing, runIsRunning]);

  const onScroll = () => {
    const el = preRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop < 24;
    setIsFollowing(atBottom);
  };

  const jumpToBottom = () => {
    const el = preRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setIsFollowing(true);
  };

  const onJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!jumpTs) return;
    const target = new Date(jumpTs);
    if (Number.isNaN(target.getTime())) return;
    const idx = lines.findIndex((l) => new Date(l.wall_time) >= target);
    if (idx < 0) return;
    const el = preRef.current;
    if (!el) return;
    el.scrollTop = idx * LINE_HEIGHT_PX;
    setIsFollowing(false);
  };

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
        <form onSubmit={onJumpSubmit} className="flex items-center gap-1">
          <input
            type="datetime-local"
            step="1"
            className="input max-w-[14rem]"
            value={jumpTs}
            onChange={(e) => setJumpTs(e.target.value)}
            title="jump to timestamp"
          />
          <button type="submit" className="input px-2 text-xs">
            jump
          </button>
        </form>
        <span className="ml-auto text-xs text-fg-subtle">
          {q.data ? `${q.data.total} line(s)` : ""}
          {runIsRunning ? (isFollowing ? " · following" : " · paused") : ""}
        </span>
      </div>
      <div className="relative">
        <pre
          ref={preRef}
          onScroll={onScroll}
          className="mono h-[60vh] overflow-auto rounded border border-border bg-bg p-3 text-xs"
        >
          {q.isLoading ? (
            "Loading…"
          ) : lines.length === 0 ? (
            "(no log lines yet)"
          ) : (
            lines.map((l, i) => (
              <div
                key={`${l.line_no}-${i}`}
                className="whitespace-pre-wrap"
                style={{ lineHeight: `${LINE_HEIGHT_PX}px` }}
              >
                <span
                  className={
                    l.stream === "stderr" ? "text-accent" : "text-fg-subtle"
                  }
                >
                  {l.stream === "stderr" ? "E" : " "}
                </span>{" "}
                <span className="text-fg-subtle">
                  {l.line_no.toString().padStart(5)}
                </span>{" "}
                <span className="text-fg-subtle">{formatTime(l.wall_time)}</span>{" "}
                <span>{l.content}</span>
              </div>
            ))
          )}
        </pre>
        {!isFollowing && runIsRunning && (
          <button
            type="button"
            onClick={jumpToBottom}
            className="card absolute bottom-2 right-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 py-1 text-xs shadow hover:text-accent"
            title="resume tail-follow"
          >
            ↓ jump to bottom
          </button>
        )}
      </div>
    </div>
  );
}
