import type { Health } from "../api/types";

interface Props {
  health: Health | undefined;
  loading: boolean;
}

export default function ServerStatus({ health, loading }: Props) {
  const ok = !!health && health.status === "ok";
  const color = loading
    ? "bg-fg-subtle"
    : ok
      ? "bg-status-completed"
      : "bg-status-failed";
  const label = loading ? "checking…" : ok ? "online" : "offline";
  return (
    <div className="flex items-center gap-2 text-xs text-fg-muted">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      <span className="mono">{label}</span>
    </div>
  );
}
