import type { RunStatus } from "../api/types";

const colors: Record<RunStatus, string> = {
  running: "bg-status-running/15 text-status-running",
  completed: "bg-status-completed/15 text-status-completed",
  failed: "bg-status-failed/15 text-status-failed",
  killed: "bg-status-killed/15 text-status-killed",
};

export default function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <span
      className={`mono inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${colors[status]}`}
    >
      {status === "running" ? (
        <span className="inline-block h-1.5 w-1.5 motion-safe:animate-pulse rounded-full bg-current" />
      ) : null}
      {status}
    </span>
  );
}
