import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useArtifactFamilies } from "../api/hooks";
import { formatBytes, formatRelative } from "../lib/format";

const TYPE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "dataset", label: "dataset" },
  { value: "model", label: "model" },
  { value: "code", label: "code" },
];

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

export default function ArtifactsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const q = useArtifactFamilies(projectId!);
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const families = useMemo(() => {
    const all = q.data?.families ?? [];
    return all.filter((f) => {
      if (typeFilter !== "all" && f.type !== typeFilter) return false;
      if (search.trim()) {
        try {
          const re = new RegExp(search.trim(), "i");
          if (!re.test(f.name) && !re.test(f.description ?? "")) return false;
        } catch {
          if (!f.name.toLowerCase().includes(search.toLowerCase())) return false;
        }
      }
      return true;
    });
  }, [q.data, typeFilter, search]);

  if (!projectId) return null;
  if (q.isLoading) return <p className="text-fg-muted">Loading...</p>;
  if (q.isError)
    return <p className="text-status-failed">Error: {String(q.error)}</p>;

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="mono text-xl font-semibold">{projectId} / artifacts</h1>
        <p className="text-sm text-fg-muted">
          {families.length} famil{families.length === 1 ? "y" : "ies"}
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-fg-muted">
          Type
          <select
            className="input py-1 text-xs"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-fg-muted">
          Search
          <input
            className="input py-1 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="name or description"
          />
        </label>
      </div>

      {families.length === 0 ? (
        <p className="text-fg-muted">
          {(q.data?.families ?? []).length === 0
            ? "No artifact families in this project yet."
            : "No families match the filters."}
        </p>
      ) : (
        <>
          {/* Mobile cards */}
          <ul className="flex flex-col gap-2 md:hidden">
            {families.map((f) => (
              <li
                key={f.id}
                className="rounded-lg border border-border bg-bg-elevated p-3"
              >
                <div className="flex items-center gap-2">
                  <Link
                    to={`/p/${projectId}/artifacts/${f.id}`}
                    className="mono flex-1 truncate text-accent hover:underline"
                  >
                    {f.name}
                  </Link>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${typeBadgeColor(f.type)}`}
                  >
                    {f.type}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
                  <span>v{f.latest_version ?? 0}</span>
                  <span>{formatBytes(f.total_size_bytes)}</span>
                  <span>{formatRelative(f.updated_at)}</span>
                </div>
                {f.aliases.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {f.aliases.map((a) => (
                      <span
                        key={a.alias}
                        className="mono rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-fg-muted"
                      >
                        {a.alias}:v{a.version}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-lg border border-border md:block">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevated text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Latest</th>
                  <th className="px-3 py-2">Total Size</th>
                  <th className="px-3 py-2">Aliases</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {families.map((f) => (
                  <tr
                    key={f.id}
                    className="border-t border-border-subtle hover:bg-bg-elevated"
                  >
                    <td className="px-3 py-2">
                      <Link
                        to={`/p/${projectId}/artifacts/${f.id}`}
                        className="mono text-accent hover:underline"
                      >
                        {f.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${typeBadgeColor(f.type)}`}
                      >
                        {f.type}
                      </span>
                    </td>
                    <td className="mono num px-3 py-2 text-fg-muted">
                      {f.latest_version != null ? `v${f.latest_version}` : "\u2014"}
                    </td>
                    <td className="mono num px-3 py-2 text-fg-muted">
                      {formatBytes(f.total_size_bytes)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {f.aliases.map((a) => (
                          <span
                            key={a.alias}
                            className="mono rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-fg-muted"
                          >
                            {a.alias}:v{a.version}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-fg-muted">
                      {formatRelative(f.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
