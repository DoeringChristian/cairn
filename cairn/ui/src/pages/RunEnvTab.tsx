import { useOutletContext } from "react-router-dom";
import type { Run } from "../api/types";
import { safeJsonParse } from "../lib/format";

interface Ctx {
  run: Run;
}

export default function RunEnvTab() {
  const { run } = useOutletContext<Ctx>();
  const env = safeJsonParse<Record<string, unknown>>(run.env_snapshot);
  if (!env) return <p className="text-fg-muted">No environment captured.</p>;

  const pipText = String(env._pip_freeze_text ?? "");
  const rest = Object.entries(env).filter(([k]) => k !== "_pip_freeze_text");
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_2fr]">
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Environment
        </h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          {rest.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="mono whitespace-pre-wrap break-all text-fg">
                {formatValue(v)}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          pip freeze
        </h2>
        <pre className="mono max-h-[60vh] overflow-auto rounded bg-bg p-3 text-xs text-fg-muted">
          {pipText || "(not captured)"}
        </pre>
      </section>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
