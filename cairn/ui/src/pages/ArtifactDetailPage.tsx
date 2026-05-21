import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useArtifactFamily } from "../api/hooks";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { formatBytes, formatRelative } from "../lib/format";

function typeBadgeColor(type: string): string {
  switch (type) {
    case "dataset":
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "model":
      return "bg-green-500/15 text-green-400 border-green-500/30";
    case "code":
      return "bg-purple-500/15 text-purple-400 border-purple-500/30";
    default:
      return "bg-fg-subtle/10 text-fg-muted border-border";
  }
}

export default function ArtifactDetailPage() {
  const { projectId, familyId } = useParams<{
    projectId: string;
    familyId: string;
  }>();
  const q = useArtifactFamily(projectId!, familyId!);
  const queryClient = useQueryClient();

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const renameMutation = useMutation({
    mutationFn: (name: string) =>
      api.updateArtifactFamily(familyId!, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: qk.artifactFamily(projectId!, familyId!),
      });
      queryClient.invalidateQueries({
        queryKey: qk.artifactFamilies(projectId!),
      });
      setEditingName(false);
    },
  });

  const [aliasInput, setAliasInput] = useState("");
  const [aliasVersionInput, setAliasVersionInput] = useState("");

  const aliasMutation = useMutation({
    mutationFn: ({ alias, version }: { alias: string; version: number }) =>
      api.setArtifactAlias(familyId!, alias, version),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: qk.artifactFamily(projectId!, familyId!),
      });
      setAliasInput("");
      setAliasVersionInput("");
    },
  });

  const deleteAliasMutation = useMutation({
    mutationFn: (alias: string) =>
      api.deleteArtifactAlias(familyId!, alias),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: qk.artifactFamily(projectId!, familyId!),
      });
    },
  });

  if (!projectId || !familyId) return null;
  if (q.isLoading) return <p className="text-fg-muted">Loading...</p>;
  if (q.isError)
    return <p className="text-status-failed">Error: {String(q.error)}</p>;
  if (!q.data) return null;

  const family = q.data;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-baseline gap-3">
        {editingName ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (nameDraft.trim()) renameMutation.mutate(nameDraft.trim());
            }}
          >
            <input
              className="input mono text-xl font-semibold"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              autoFocus
            />
            <button type="submit" className="btn px-2 py-1 text-xs">
              Save
            </button>
            <button
              type="button"
              className="btn px-2 py-1 text-xs"
              onClick={() => setEditingName(false)}
            >
              Cancel
            </button>
          </form>
        ) : (
          <h1
            className="mono text-xl font-semibold cursor-pointer hover:text-accent"
            onClick={() => {
              setNameDraft(family.name);
              setEditingName(true);
            }}
            title="Click to rename"
          >
            {family.name}
          </h1>
        )}
        <span
          className={`rounded border px-2 py-0.5 text-xs font-medium ${typeBadgeColor(family.type)}`}
        >
          {family.type}
        </span>
        {family.description && (
          <span className="text-sm text-fg-muted">{family.description}</span>
        )}
      </div>

      {/* Aliases */}
      <section className="card mb-6 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Aliases
        </h2>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {family.aliases.length === 0 && (
            <span className="text-sm text-fg-subtle">No aliases set.</span>
          )}
          {family.aliases.map((a) => (
            <span
              key={a}
              className="group mono inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-0.5 text-xs text-fg-muted"
            >
              {a}
              <button
                type="button"
                className="ml-0.5 transition-opacity hover:text-status-failed md:opacity-0 md:group-hover:opacity-100"
                onClick={() => deleteAliasMutation.mutate(a)}
                aria-label={`delete alias ${a}`}
              >
                {"\u00D7"}
              </button>
            </span>
          ))}
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const ver = parseInt(aliasVersionInput, 10);
            if (aliasInput.trim() && !isNaN(ver)) {
              aliasMutation.mutate({ alias: aliasInput.trim(), version: ver });
            }
          }}
        >
          <input
            className="input py-1 text-xs w-32"
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            placeholder="alias name"
          />
          <input
            className="input py-1 text-xs w-20"
            type="number"
            min={1}
            value={aliasVersionInput}
            onChange={(e) => setAliasVersionInput(e.target.value)}
            placeholder="version"
          />
          <button type="submit" className="btn px-2 py-1 text-xs">
            Set alias
          </button>
        </form>
      </section>

      {/* Version history */}
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Versions ({family.versions.length})
        </h2>
        {family.versions.length === 0 ? (
          <p className="text-sm text-fg-subtle">No versions yet.</p>
        ) : (
          <>
            {/* Mobile: card list */}
            <ul className="flex flex-col gap-2 md:hidden">
              {family.versions.map((v) => (
                <li key={v.id} className="rounded-lg border border-border bg-bg-elevated p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono font-semibold">v{v.version}</span>
                    <a
                      href={api.artifactUrl(v.hash)}
                      className="btn px-2 py-0.5 text-xs inline-flex items-center gap-1"
                      download
                    >
                      <i className="fa-solid fa-arrow-down" aria-hidden="true" /> Download
                    </a>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                    <span className="mono" title={v.hash}>{v.hash.slice(0, 12)}</span>
                    <span>{formatBytes(v.size_bytes)}</span>
                    <span>{formatRelative(v.created_at)}</span>
                    {v.created_by_run && (
                      <Link to={`/p/${projectId}/r/${v.created_by_run}`} className="mono text-accent hover:underline">
                        run {v.created_by_run.slice(0, 8)}
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
              <table className="w-full text-sm">
                <thead className="bg-bg-elevated text-left text-xs uppercase tracking-wide text-fg-muted">
                  <tr>
                    <th className="px-3 py-2">Version</th>
                    <th className="px-3 py-2">Hash</th>
                    <th className="px-3 py-2">Size</th>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Produced by</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {family.versions.map((v) => (
                    <tr
                      key={v.id}
                      className="border-t border-border-subtle hover:bg-bg-elevated"
                    >
                      <td className="mono num px-3 py-2">v{v.version}</td>
                      <td className="mono px-3 py-2 text-fg-muted" title={v.hash}>
                        {v.hash.slice(0, 12)}
                      </td>
                      <td className="mono num px-3 py-2 text-fg-muted">
                        {formatBytes(v.size_bytes)}
                      </td>
                      <td className="px-3 py-2 text-fg-muted">
                        {formatRelative(v.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        {v.created_by_run ? (
                          <Link
                            to={`/p/${projectId}/r/${v.created_by_run}`}
                            className="mono text-accent hover:underline text-xs"
                          >
                            {v.created_by_run.slice(0, 8)}
                          </Link>
                        ) : (
                          <span className="text-fg-subtle">{"\u2014"}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <a
                          href={api.artifactUrl(v.hash)}
                          className="btn px-2 py-0.5 text-xs inline-flex items-center gap-1"
                          download
                        >
                          <i className="fa-solid fa-arrow-down" aria-hidden="true" /> Download
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
