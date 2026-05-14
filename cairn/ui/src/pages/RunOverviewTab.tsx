import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useRuns, useSetNotes, useSetTags } from "../api/hooks";
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

function TagsEditor({ run, tags: serverTags }: { run: Run; tags: string[] }) {
  const mutation = useSetTags(run.id);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const runsQ = useRuns({ project: run.project_id, limit: 500 });
  const suggestions = useProjectTags(runsQ.data?.runs ?? []);

  // Keep optimistic local copy so rapid add/remove never works against stale
  // data.  Syncs back to server truth whenever the query refetches.
  const [localTags, setLocalTags] = useState(serverTags);
  useEffect(() => { setLocalTags(serverTags); }, [serverTags]);

  const applyTags = (next: string[]) => {
    setLocalTags(next);
    mutation.mutate(next);
  };

  const removeTag = (tag: string) => {
    applyTags(localTags.filter((t) => t !== tag));
  };

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        {localTags.length === 0 && !adding ? (
          <span className="text-sm text-fg-subtle">(none)</span>
        ) : (
          localTags.map((t) => (
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
              if (!localTags.includes(tag)) applyTags([...localTags, tag]);
              setDraft("");
              setAdding(false);
            }}
            onCancel={() => { setDraft(""); setAdding(false); }}
            suggestions={suggestions}
            exclude={localTags}
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
