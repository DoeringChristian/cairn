import { useOutletContext } from "react-router-dom";
import type { Param, Run } from "../api/types";
import { safeJsonParse } from "../lib/format";

interface Ctx {
  run: Run;
  params: Param[];
}

export default function RunOverviewTab() {
  const { run, params } = useOutletContext<Ctx>();
  const env = safeJsonParse<Record<string, unknown>>(run.env_snapshot);
  const tags = safeJsonParse<string[]>(run.tags) ?? [];
  const cliArgs = safeJsonParse<string[]>(run.cli_args) ?? [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Section title="Summary">
        <DefinitionList
          rows={[
            ["Project", run.project_id],
            ["Task", run.task_id],
            ["Status", run.status],
            ["Exit code", run.exit_code ?? "—"],
            ["Host", run.hostname ?? "—"],
            ["User", run.user ?? "—"],
          ]}
        />
      </Section>
      <Section title="Git">
        <DefinitionList
          rows={[
            ["Branch", run.git_branch ?? "—"],
            [
              "Commit",
              run.git_sha ? (
                <span className="mono text-fg">{run.git_sha.slice(0, 12)}</span>
              ) : (
                "—"
              ),
            ],
            [
              "Dirty",
              run.git_dirty === null ? "—" : run.git_dirty ? "yes" : "no",
            ],
          ]}
        />
      </Section>
      <Section title="Tags / Notes" className="lg:col-span-2">
        <div className="mb-3 flex flex-wrap gap-2">
          {tags.length === 0 ? (
            <span className="text-sm text-fg-subtle">(none)</span>
          ) : (
            tags.map((t) => (
              <span
                key={t}
                className="mono rounded border border-border bg-bg px-2 py-0.5 text-xs text-fg-muted"
              >
                {t}
              </span>
            ))
          )}
        </div>
        <p className="text-sm text-fg-muted">{run.notes || "(no notes)"}</p>
      </Section>
      <Section title={`Params (${params.length})`} className="lg:col-span-2">
        {params.length === 0 ? (
          <p className="text-sm text-fg-subtle">No params logged.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="pb-1 pr-4">Key</th>
                <th className="pb-1 pr-4">Type</th>
                <th className="pb-1">Value</th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => (
                <tr key={p.key} className="border-t border-border-subtle">
                  <td className="mono py-1 pr-4">{p.key}</td>
                  <td className="mono py-1 pr-4 text-fg-subtle">{p.value_type}</td>
                  <td className="mono py-1 text-fg-muted">{p.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      {cliArgs.length > 0 && (
        <Section title="CLI args">
          <pre className="mono overflow-x-auto rounded bg-bg p-2 text-xs text-fg-muted">
            {cliArgs.join(" ")}
          </pre>
        </Section>
      )}
      {env && (
        <Section title="Environment snapshot">
          <DefinitionList
            rows={[
              ["Python", String(env.python_version ?? "—")],
              ["Platform", String(env.platform ?? "—")],
              [
                "CUDA",
                env.cuda_available
                  ? `yes (${env.cuda_version ?? "?"})`
                  : "no",
              ],
              [
                "GPUs",
                Array.isArray(env.gpu_names) && env.gpu_names.length > 0
                  ? (env.gpu_names as string[]).join(", ")
                  : "—",
              ],
            ]}
          />
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card p-4 ${className}`}>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function DefinitionList({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-muted">{k}</dt>
          <dd className="mono text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
