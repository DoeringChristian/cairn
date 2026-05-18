import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useRuns, useSetNotes, useSetTags, useRunInputArtifacts, useRunOutputArtifacts } from "../api/hooks";
import type { Param, Run } from "../api/types";
import { safeJsonParse } from "../lib/format";
import { useProjectTags } from "../lib/use-project-tags";
import TagInput from "../components/TagInput";

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
        <TagsEditor run={run} tags={tags} />
        <NotesEditor runId={run.id} notes={run.notes ?? ""} />
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
      <RunArtifactsSection run={run} />
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

function TagsEditor({ run, tags }: { run: Run; tags: string[] }) {
  const mutation = useSetTags(run.id);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const runsQ = useRuns({ project: run.project_id, limit: 500 });
  const suggestions = useProjectTags(runsQ.data?.runs ?? []);

  const removeTag = (tag: string) => {
    mutation.mutate(tags.filter((t) => t !== tag));
  };

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        {tags.length === 0 && !adding ? (
          <span className="text-sm text-fg-subtle">(none)</span>
        ) : (
          tags.map((t) => (
            <span
              key={t}
              className="mono group inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-0.5 text-xs text-fg-muted"
            >
              {t}
              <button
                type="button"
                onClick={() => removeTag(t)}
                className="ml-0.5 transition-opacity hover:border-status-failed hover:text-status-failed md:opacity-0 md:group-hover:opacity-100"
                aria-label={`remove tag ${t}`}
              >
                &times;
              </button>
            </span>
          ))
        )}
        {adding ? (
          <TagInput
            autoFocus
            className="w-40"
            value={draft}
            onChange={setDraft}
            onCommit={(tag) => {
              if (!tags.includes(tag)) mutation.mutate([...tags, tag]);
              setDraft("");
              setAdding(false);
            }}
            onCancel={() => { setDraft(""); setAdding(false); }}
            suggestions={suggestions}
            exclude={tags}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn px-2 py-0.5 text-xs"
            aria-label="add tag"
          >
            +
          </button>
        )}
      </div>
      {mutation.isError && (
        <span className="text-xs text-status-failed">save failed</span>
      )}
    </div>
  );
}

function RunArtifactsSection({ run }: { run: Run }) {
  const inputsQ = useRunInputArtifacts(run.id);
  const outputsQ = useRunOutputArtifacts(run.id);

  const inputs = inputsQ.data?.inputs ?? [];
  const outputs = outputsQ.data?.outputs ?? [];

  if (inputsQ.isLoading || outputsQ.isLoading) return null;
  if (inputs.length === 0 && outputs.length === 0) return null;

  return (
    <Section title="Artifacts" className="lg:col-span-2">
      {outputs.length > 0 && (
        <div className="mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-1">
            Produced
          </h3>
          <ul className="flex flex-col gap-1">
            {outputs.map((o) => (
              <li key={o.artifact_version_id} className="flex items-center gap-2 text-sm">
                <Link
                  to={`/p/${run.project_id}/artifacts/${o.family_id}`}
                  className="mono text-accent hover:underline"
                >
                  {o.family_name}
                </Link>
                <span className="mono text-fg-muted text-xs">v{o.version}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {inputs.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted mb-1">
            Consumed
          </h3>
          <ul className="flex flex-col gap-1">
            {inputs.map((inp) => (
              <li key={inp.artifact_version_id} className="flex items-center gap-2 text-sm">
                <Link
                  to={`/p/${run.project_id}/artifacts/${inp.family_id}`}
                  className="mono text-accent hover:underline"
                >
                  {inp.family_name}
                </Link>
                <span className="mono text-fg-muted text-xs">v{inp.version}</span>
                {inp.role && (
                  <span className="rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-fg-muted">
                    {inp.role}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function NotesEditor({ runId, notes }: { runId: string; notes: string }) {
  const mutation = useSetNotes(runId);
  const [draft, setDraft] = useState(notes);

  useEffect(() => {
    setDraft(notes);
  }, [notes]);

  const dirty = draft !== notes;

  return (
    <div className="flex flex-col gap-2">
      <textarea
        className="input min-h-[4rem] resize-y text-sm"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="(no notes)"
      />
      <div className="flex items-center gap-2">
        {dirty && (
          <button
            type="button"
            className="btn px-2 py-0.5 text-xs"
            onClick={() => mutation.mutate(draft)}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "saving…" : "save"}
          </button>
        )}
        {mutation.isError && (
          <span className="text-xs text-status-failed">save failed</span>
        )}
      </div>
    </div>
  );
}
